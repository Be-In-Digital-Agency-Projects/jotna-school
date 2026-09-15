/**
 * AI Gateway — agrégat de dépense mensuelle, fragmenté.
 *
 * Module pur : aucun import Convex, donc directement testable (comme
 * `accessRules.ts`, `linkRules.ts`, `pricing.ts`). Le câblage base de données
 * vit dans `db.ts` ; ici on ne garde que l'arithmétique.
 *
 * ## Pourquoi un agrégat plutôt qu'une somme à la volée
 *
 * La dépense du mois est lue AVANT CHAQUE génération (`index.ts`, contrôle de
 * budget) : c'est le chemin le plus chaud du produit. Une somme calculée en
 * balayant `aiUsage` coûterait de plus en plus cher au fil du mois — et si on
 * la borne (`.take(1000)`), elle devient fausse dès la millième ligne et le
 * plafond cesse de mordre. On tient donc un compteur courant, mis à jour dans
 * la même mutation que la ligne `aiUsage` (transaction Convex : la ligne et
 * l'agrégat ne peuvent pas diverger).
 *
 * ## Pourquoi le fragmenter
 *
 * Un compteur unique par mois ferait contendre TOUTES les écritures IA sur un
 * seul document. Convex sérialise les mutations par OCC : deux écritures
 * concurrentes sur le même document se conflictent et l'une est rejouée. Sur
 * le chemin chaud, ça se paye en latence et en réessais. On répartit donc les
 * écritures sur N documents ; la lecture les additionne tous.
 *
 * ## Pourquoi la lecture bornée reste exacte
 *
 * L'écriture fait une lecture ponctuelle de l'index `(month, shard)` puis
 * insère si la ligne manque. Les mutations Convex sont sérialisables : la
 * plage lue entre dans l'ensemble de lecture de la transaction, donc deux
 * insertions concurrentes sur la même clé ne peuvent pas commiter toutes les
 * deux. Il existe donc AU PLUS une ligne par `(month, shard)`, et `shard` est
 * par construction dans `[0, SPEND_SHARD_COUNT)` : **au plus
 * `SPEND_SHARD_COUNT` lignes par mois, jamais plus.** Lire
 * `.take(SPEND_SHARD_COUNT)` est donc démontrablement complet — c'est le même
 * raisonnement que l'invariant de disjointness (§4.5) : une borne est
 * acceptable quand une invariante garantit qu'elle ne peut rien manquer,
 * jamais parce qu'elle « devrait suffire ».
 *
 * ## Historique
 *
 * L'agrégat démarre à zéro : il ne connaît pas les lignes `aiUsage` déjà en
 * base au moment du déploiement. C'est sans conséquence ici (décision D6 :
 * base vide ou jetable). Si la base n'était pas vide, il faudrait une
 * migration de reconstruction — parcourir `aiUsage` par mois, page par page
 * via `.paginate()` en se replanifiant avec `ctx.scheduler.runAfter(0, ...)`
 * pour tenir dans les limites de transaction, et réécrire les fragments — à
 * lancer avant de rebrancher le contrôle de budget sur l'agrégat.
 */

/** Statuts possibles d'une ligne `aiUsage`. Miroir de `schema.ts`. */
export type AiUsageStatus =
  | "ok"
  | "failed"
  | "rejected_budget"
  | "rejected_quota"
  | "rejected_access";

/**
 * Nombre de fragments par mois.
 *
 * Choix : 8. Le pic réaliste est une classe de 30 élèves qui soumettent
 * ensemble ; chaque réponse libre fausse déclenche au plus une vérification IA,
 * donc au plus ~30 écritures d'agrégat dans la même seconde. Réparties
 * uniformément sur 8 fragments : ~4 écritures/seconde/fragment, et le pire
 * fragment (tirage de 30 boules dans 8 urnes) reste sous la dizaine. Chaque
 * écriture est un `patch` d'un document minuscule sur une plage d'index
 * ponctuelle, donc deux écritures visant des fragments différents ne se
 * conflictent jamais : ce qui contend, ce sont seulement les écritures qui
 * tombent sur le même fragment. 8 laisse donc une marge de l'ordre de la
 * dizaine de classes simultanées.
 *
 * Monter N réduirait encore la contention mais alourdirait la lecture, qui est
 * sur le chemin chaud (N documents lus avant chaque génération). 8 est le
 * compromis : contention négligeable au pic visé, lecture à 8 documents.
 *
 * Cette valeur ne doit pas baisser : des fragments d'indice supérieur écrits
 * par une version précédente deviendraient invisibles à la lecture.
 */
export const SPEND_SHARD_COUNT = 8;

export interface PurposeCounters {
  calls: number;
  cost: number;
}

/** Compteurs portés par un fragment — et par leur somme. */
export interface SpendCounters {
  /** Dépense réelle, en USD, tous statuts confondus. Voir `usageDelta`. */
  costUsd: number;
  /** Toutes les lignes, quel que soit leur statut. */
  calls: number;
  failed: number;
  rejectedBudget: number;
  rejectedQuota: number;
  rejectedAccess: number;
  /** Ventilation par usage. Borné : l'enum des usages est fixe. */
  byPurpose: Record<string, PurposeCounters>;
}

export function emptySpendCounters(): SpendCounters {
  return {
    costUsd: 0,
    calls: 0,
    failed: 0,
    rejectedBudget: 0,
    rejectedQuota: 0,
    rejectedAccess: 0,
    byPurpose: {},
  };
}

/**
 * Choisit le fragment à incrémenter à partir d'un tirage dans `[0, 1)`.
 *
 * Tirage uniforme et sans corrélation avec l'élève, l'usage ou l'horloge :
 * deux écritures simultanées ont 7 chances sur 8 de viser des documents
 * différents. Toute entrée hors plage ou non finie retombe dans la plage —
 * la fonction ne peut pas produire un indice qui échapperait à la lecture.
 */
export function pickSpendShard(random: number): number {
  if (!Number.isFinite(random)) return 0;
  const index = Math.floor(random * SPEND_SHARD_COUNT);
  if (index < 0) return 0;
  if (index >= SPEND_SHARD_COUNT) return SPEND_SHARD_COUNT - 1;
  return index;
}

/**
 * Traduit une ligne `aiUsage` en incrément d'agrégat.
 *
 * Le coût compté est `costUsd`, **quel que soit le statut** — et non le seul
 * coût des lignes `ok`, comme le faisait l'ancien `getMonthSpend`. Un appel
 * peut très bien recevoir une réponse d'OpenAI (donc être facturé) puis être
 * rejeté par la validation locale : la ligne est `failed` et porte pourtant
 * une dépense réelle. Filtrer sur le statut rouvrirait le trou par cet
 * autre bout. Les lignes qui n'ont rien dépensé portent `costUsd: 0` par
 * construction, elles n'ajoutent donc rien.
 *
 * La même règle vaut pour la ventilation par usage, de sorte que la somme des
 * barres du graphe admin égale toujours le total affiché.
 */
export function usageDelta(usage: {
  status: AiUsageStatus;
  purpose: string;
  costUsd: number;
}): SpendCounters {
  const spent = usage.costUsd;
  return {
    costUsd: spent,
    calls: 1,
    failed: usage.status === "failed" ? 1 : 0,
    rejectedBudget: usage.status === "rejected_budget" ? 1 : 0,
    rejectedQuota: usage.status === "rejected_quota" ? 1 : 0,
    rejectedAccess: usage.status === "rejected_access" ? 1 : 0,
    byPurpose: { [usage.purpose]: { calls: 1, cost: spent } },
  };
}

/** Somme de deux jeux de compteurs. Ni l'un ni l'autre n'est modifié. */
export function addSpendCounters(
  base: SpendCounters,
  delta: SpendCounters,
): SpendCounters {
  const byPurpose: Record<string, PurposeCounters> = {};
  for (const [purpose, counters] of Object.entries(base.byPurpose)) {
    byPurpose[purpose] = { calls: counters.calls, cost: counters.cost };
  }
  for (const [purpose, counters] of Object.entries(delta.byPurpose)) {
    const current = byPurpose[purpose] ?? { calls: 0, cost: 0 };
    byPurpose[purpose] = {
      calls: current.calls + counters.calls,
      cost: current.cost + counters.cost,
    };
  }
  return {
    costUsd: base.costUsd + delta.costUsd,
    calls: base.calls + delta.calls,
    failed: base.failed + delta.failed,
    rejectedBudget: base.rejectedBudget + delta.rejectedBudget,
    rejectedQuota: base.rejectedQuota + delta.rejectedQuota,
    rejectedAccess: base.rejectedAccess + delta.rejectedAccess,
    byPurpose,
  };
}

/** Additionne les fragments d'un mois. L'ordre est indifférent. */
export function foldSpendShards(
  shards: readonly SpendCounters[],
): SpendCounters {
  let total = emptySpendCounters();
  for (const shard of shards) {
    total = addSpendCounters(total, shard);
  }
  return total;
}

/** Clé de mois `YYYY-MM` en UTC, telle que stockée dans `aiUsage.month`. */
export function monthKey(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
