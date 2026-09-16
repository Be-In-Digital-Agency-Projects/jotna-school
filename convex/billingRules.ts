/**
 * Règles d'ENCAISSEMENT — fonctions PURES.
 *
 * Aucune lecture de base ici : `convex/billing.ts` lit les documents et passe
 * les scalaires, `convex/billingPaydunya.ts` parle au prestataire. Même
 * découpage que `accessRules.ts` / `access.ts` et que `pricing.ts` /
 * `schools.ts`, et pour une raison de plus : ces fonctions-là décident du sort
 * d'un PAIEMENT, et le dépôt n'a pas `convex-test`. Une règle qui solde une
 * tranche de quatre cent mille francs doit pouvoir être éprouvée sans base de
 * données, et sans réseau.
 *
 * Spec : docs/superpowers/specs/2026-09-14-abonnement-ecoles-design.md §8
 * Plan : docs/superpowers/plans/2026-09-15-encaissement-paydunya.md (D34 à D46)
 */

import type { SubscriptionStatus } from "./accessRules";
import { decidePeriod } from "./subscriptionRules";

// ---------------------------------------------------------------------------
// L'ÉCHÉANCIER — §8.1
// ---------------------------------------------------------------------------

/** Trois échéances calées sur le calendrier scolaire sénégalais (§8.1). */
export const INSTALLMENT_COUNT = 3;

/**
 * Le pas NOMINAL entre deux échéances : un trimestre.
 *
 * Quatre-vingt-dix jours, et non « trois mois de calendrier » : c'est déjà la
 * durée que le dépôt appelle un trimestre (`PALIER_TTL_MS`), et reprendre la
 * même évite d'inventer une seconde notion de trimestre qui divergerait de la
 * première à la première année bissextile.
 */
export const INSTALLMENT_STEP_MS = 90 * 24 * 60 * 60 * 1000;

/** Délai laissé à une école pour payer l'avenant qu'elle vient de signer. */
export const AMENDMENT_DUE_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

/** Une échéance à créer : son rang, son montant, sa date. */
export interface PlannedInstallment {
  /** 1, 2, 3 — le `index` de la ligne `installments`, jamais un indice de tableau. */
  index: number;
  amountFcfa: number;
  dueAt: number;
}

/**
 * Découpe un total en `count` montants ENTIERS dont la somme est EXACTE.
 *
 * LE RESTE TOMBE SUR LA PREMIÈRE TRANCHE (§8.1) : le plus gros versement
 * arrive quand le budget de l'école est le plus frais. 1 250 000 FCFA se
 * découpent en 416 668 + 416 666 + 416 666, et non en trois fois 416 666,67
 * arrondis chacun de leur côté — trois arrondis indépendants ne redonnent le
 * total que par chance, et le franc CFA n'a pas de sous-unité où cacher
 * l'écart.
 *
 * L'ÉGALITÉ `Σ tranches = totalFcfa` EST L'INVARIANTE DE TOUT LE PLAN (D34).
 * C'est elle qui permet de lire un échéancier et de savoir, sans calcul, que
 * l'école paiera exactement ce que le contrat dit. Les tests la prouvent par
 * balayage, pas sur trois exemples choisis.
 *
 * Une entrée absurde — négative, fractionnaire, non finie — ne vaut AUCUN
 * franc plutôt qu'un montant inventé : même convention que `billedSeats` dans
 * `pricing.ts`, et le seul repli qui ne peut jamais surfacturer une école.
 * `recordSubscription` ne fait de toute façon jamais passer ici autre chose
 * qu'un total issu de `quoteSubscription`.
 */
export function splitInstallmentAmounts(
  totalFcfa: number,
  count: number,
): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  if (!Number.isInteger(totalFcfa) || totalFcfa < 0) {
    return new Array<number>(count).fill(0);
  }

  const base = Math.floor(totalFcfa / count);
  const remainder = totalFcfa - base * count;
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? base + remainder : base,
  );
}

/**
 * Les dates d'échéance, DÉRIVÉES DES DATES DU CONTRAT (D36).
 *
 * §8.1 nomme octobre, janvier et avril. Les prendre au pied de la lettre
 * demanderait de l'arithmétique de calendrier ET CASSERAIT sur un contrat qui
 * ne commence pas en octobre : une école qui signe en février verrait ses deux
 * premières échéances déjà dépassées, marquées impayées dès le lendemain, et
 * son accès menacé pour un contrat qu'elle vient de signer.
 *
 * On dérive donc les échéances de la période elle-même :
 *
 *     pas = min(un trimestre, durée du contrat / count)
 *     échéance n = startsAt + (n − 1) × pas
 *
 * Un contrat du 1ᵉʳ octobre au 30 juin donne octobre, fin décembre, fin mars —
 * octobre, janvier, avril à quelques jours près, sans regarder un calendrier.
 * Un contrat plus court resserre le pas et garde ses trois échéances DANS la
 * période, ce qui n'est pas de l'élégance : une échéance postérieure à `endsAt`
 * ne serait jamais marquée impayée, donc jamais réclamée, et l'école aurait des
 * sièges que personne ne lui facture.
 *
 * LA PREMIÈRE ÉCHÉANCE TOMBE À `startsAt`, et l'école n'y perd rien : tant
 * qu'aucune tranche n'est encaissée le contrat reste « en attente de
 * paiement », statut qui n'ouvre AUCUN accès (§8.4). L'échéance est immédiate
 * parce que la contrepartie l'est aussi.
 *
 * Une période illisible rend `count` fois `startsAt` plutôt que des `NaN` :
 * `recordSubscription` refuse déjà `endsAt <= startsAt` à la saisie, ceci est
 * une seconde ligne.
 */
export function installmentDueDates(
  startsAt: number,
  endsAt: number,
  count: number,
): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
    return new Array<number>(count).fill(startsAt);
  }

  const span = endsAt - startsAt;
  const step = span > 0 ? Math.min(INSTALLMENT_STEP_MS, span / count) : 0;

  // `floor` ET NON `round`, et c'est ce qui rend la promesse démontrable plutôt
  // que probable : la dernière échéance vaut au plus
  // `startsAt + (count − 1) × span / count`, strictement inférieur à `endsAt`.
  // Arrondi au plus proche, elle pourrait tomber SUR `endsAt` quand le pas
  // n'est pas entier — sur une période assez courte pour que la fraction pèse —
  // et une échéance à la fin exacte du contrat ne serait jamais réclamée.
  // Sur une année scolaire les deux donnent la même date, le pas étant entier.
  return Array.from({ length: count }, (_, i) =>
    Math.floor(startsAt + i * step),
  );
}

/** Ce que `recordSubscription` doit insérer à côté du contrat qu'il crée. */
export function planInstallments(input: {
  totalFcfa: number;
  startsAt: number;
  endsAt: number;
  count?: number;
}): PlannedInstallment[] {
  const count = input.count ?? INSTALLMENT_COUNT;
  const amounts = splitInstallmentAmounts(input.totalFcfa, count);
  const dueDates = installmentDueDates(input.startsAt, input.endsAt, count);
  return amounts.map((amountFcfa, i) => ({
    index: i + 1,
    amountFcfa,
    dueAt: dueDates[i],
  }));
}

/**
 * Quand l'école doit payer l'avenant qu'elle vient de signer (D44).
 *
 * Trente jours, et JAMAIS après la fin du contrat : une échéance postérieure à
 * `endsAt` ne serait jamais marquée impayée — le cron ne regarde que des dates
 * passées — donc jamais réclamée. Une école qui ajoute des sièges à deux
 * semaines de la fin paie donc à la fin, pas trente jours après.
 *
 * `endsAt` lui-même est la borne, et non `endsAt − 1` : la tranche devient
 * exigible à l'instant exact où le contrat s'achève, ce qui est la dernière
 * date où elle peut encore l'être.
 */
export function amendmentDueAt(now: number, endsAt: number): number {
  if (!Number.isFinite(now)) return endsAt;
  if (!Number.isFinite(endsAt)) return now + AMENDMENT_DUE_DELAY_MS;
  return Math.min(now + AMENDMENT_DUE_DELAY_MS, endsAt);
}

// ---------------------------------------------------------------------------
// LE WEBHOOK — §8.2 et §8.3
// ---------------------------------------------------------------------------

/**
 * Compare deux empreintes SANS sortir au premier octet qui diffère.
 *
 * `a === b` s'arrête au premier écart, et le temps qu'il met à répondre dit
 * donc combien de caractères étaient justes. Sur un secret que l'appelant peut
 * soumettre autant de fois qu'il veut — un webhook est ouvert sur l'internet —
 * cette information se récolte.
 *
 * L'ATTAQUE EST TRÈS THÉORIQUE ICI : deviner 128 caractères hexadécimaux à
 * travers la latence d'un réseau public n'est pas un chemin praticable. Mais
 * la comparaison à temps constant ne coûte rien, et écrire l'autre laisserait
 * un exemple à copier là où ce serait grave.
 *
 * LA LONGUEUR, ELLE, EST PUBLIQUE : SHA-512 fait toujours 128 caractères, une
 * empreinte d'une autre taille n'est pas un secret presque juste, c'est une
 * réponse hors sujet. La refuser tout de suite ne dit rien à personne.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * L'empreinte SHA-512 d'un texte, en hexadécimal minuscule.
 *
 * C'est la forme que PayDunya envoie dans `data[hash]` : le SHA-512 de la clé
 * maîtresse du marchand (D39). `crypto.subtle` est disponible dans
 * l'exécution Convex — `@convex-dev/auth` s'en sert pour ses propres jetons —
 * et dans l'environnement de test, ce qui permet d'éprouver cette fonction sur
 * un vecteur connu plutôt que de croire au nom de l'algorithme.
 *
 * Déterministe et sans état : elle appartient au module des règles, même si
 * elle est `async`.
 */
export async function sha512Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-512", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * LE VOCABULAIRE COMMUN DES PRESTATAIRES — quatre issues, et quatre seulement.
 *
 * POURQUOI IL EXISTE. PayDunya dit « completed », Bictorys dit « succeeded », et
 * le prochain dira autre chose. Laisser la règle de décision comparer des
 * CHAÎNES de prestataire, c'est lui demander de connaître le dialecte de chacun
 * — et le jour où l'un d'eux ajoute un statut, la règle le traite par omission,
 * silencieusement, sur de l'argent.
 *
 * Chaque prestataire a donc son traducteur, pur et testé, juste en dessous. La
 * règle, elle, ne voit plus que ces quatre issues.
 *
 * `pending` N'EST PAS UN ÉCHEC, et c'est la distinction qui compte : la facture
 * vit encore, le prestataire rappellera, et marquer la ligne `failed` ferait
 * croire à un paiement perdu. « Annulé » et « échoué » sont des fins ; tout ce
 * qui n'est ni l'un ni l'autre ni un succès est une attente.
 */
export type ProviderOutcome = "completed" | "cancelled" | "failed" | "pending";

/**
 * Le statut PayDunya, traduit.
 *
 * Valeurs documentées : `completed`, `pending`, `cancelled` — `failed` est
 * observé sans être documenté, on le reconnaît quand même.
 */
export function paydunyaOutcome(status: string): ProviderOutcome {
  switch (status.trim().toLowerCase()) {
    case "completed":
      return "completed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * Le statut Bictorys, traduit — l'énumération complète de leur OpenAPI.
 *
 * `authorized` EST TRAITÉ COMME UNE ATTENTE, et c'est un choix. Leur propre
 * exemple d'intégration l'accepte comme un succès ; nous non. « Autorisé » veut
 * dire qu'un montant est RÉSERVÉ sur la carte, pas qu'il est encaissé : une
 * autorisation non capturée expire, et l'école aurait alors eu l'accès sans
 * qu'un franc soit arrivé. Nos charges sont créées sans `authorization`, donc
 * les cartes sont débitées immédiatement et ce statut ne devrait pas nous
 * parvenir — s'il arrive, c'est que quelque chose a changé, et l'attente est le
 * repli sûr.
 *
 * `reversed` EST TRAITÉ COMME UN ÉCHEC, faute de mieux. Un paiement rétracté
 * après coup — impayé, contestation — n'a pas d'équivalent dans notre modèle :
 * rien ne DÉFAIT une tranche soldée (spec §10). S'il arrive AVANT que la
 * tranche soit créditée, le traiter en échec est juste. S'il arrive APRÈS, la
 * ligne de paiement passera à `failed` mais la tranche restera réglée : c'est
 * un trou connu, et il appartient au plan de facturation avec le remboursement.
 */
export function bictorysOutcome(status: string): ProviderOutcome {
  switch (status.trim().toLowerCase()) {
    case "succeeded":
      return "completed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "failed":
    case "reversed":
      return "failed";
    case "pending":
    case "processing":
    case "authorized":
      return "pending";
    default:
      // Un statut que Bictorys ajouterait sans prévenir — leur documentation
      // demande explicitement de ne pas valider strictement les champs
      // inconnus. On attend plutôt que d'inventer une fin.
      return "pending";
  }
}

/** Ce qu'il advient d'un paiement que PayDunya nous annonce. */
export type PaymentOutcome =
  /** La tranche est soldée. Le seul cas qui ouvre quelque chose. */
  | "credited"
  /** Jeton déjà traité : ne rien écrire, répondre 200 (§8.3, règle 3). */
  | "replayed"
  /** La tranche était déjà soldée par un AUTRE paiement. */
  | "already_paid"
  /** Moins que le montant dû : rien n'est acquitté (D42). */
  | "amount_short"
  /** PayDunya ne dit pas « payé » : en attente, annulé, échoué. */
  | "not_completed"
  /** Le paiement ne désigne aucune tranche connue. */
  | "unknown_installment";

export interface PaymentDecision {
  outcome: PaymentOutcome;
  /**
   * Le statut à écrire sur la ligne `payments`, ou `null` pour n'y pas
   * toucher. `null` n'est PAS « échec » : c'est « rien de nouveau », le cas
   * d'un rejeu et celui d'une facture encore en attente chez le prestataire,
   * que PayDunya rappellera.
   */
  paymentStatus: "completed" | "failed" | "cancelled" | null;
  /** Vrai seulement quand la tranche doit passer à `paid`. */
  creditsInstallment: boolean;
}

export interface PaymentApplicationInput {
  /** Statut de la ligne `payments` déjà en base, ou `null` si elle manque. */
  existingPaymentStatus: "initiated" | "completed" | "failed" | "cancelled" | null;
  /**
   * L'issue que LE PRESTATAIRE nous a confirmée, déjà traduite par son
   * traducteur — jamais le statut brut du corps du POST.
   */
  providerOutcome: ProviderOutcome;
  /**
   * Le montant BRUT que le prestataire nous a confirmé, frais compris — jamais
   * celui du corps du POST, et jamais un montant net.
   *
   * « Brut » n'est pas une précision d'écriture : Bictorys rend dans
   * `transactions/{id}.amount` un montant NET DE FRAIS. Comparé tel quel à ce
   * que la tranche réclame, il serait systématiquement inférieur, et AUCUN
   * paiement ne serait jamais crédité. C'est à l'adaptateur de reconstituer le
   * brut avant d'arriver ici.
   */
  confirmedAmountFcfa: number;
  /** Le montant relu dans `installments`, ou `null` si la tranche est introuvable. */
  dueAmountFcfa: number | null;
  /** Le statut relu dans `installments`, ou `null` si elle est introuvable. */
  installmentStatus: "pending" | "paid" | "overdue" | "failed" | null;
}

/**
 * Que faire d'un paiement — les quatre règles non négociables de §8.3, dans
 * l'ordre où elles doivent mordre.
 *
 * LE REJEU PASSE EN PREMIER (règle 3). PayDunya rejoue ses appels, tous les
 * agrégateurs le font, et une tranche créditée deux fois est une perte sèche
 * que rien ne rattrape ensuite. Tester le rejeu AVANT le montant ou le statut
 * garantit qu'un second appel ne peut rien faire, pas même changer un statut.
 *
 * PUIS LE STATUT DU PRESTATAIRE. « En attente » n'est pas un échec : la facture
 * vit encore, PayDunya rappellera, et marquer la ligne `failed` maintenant
 * ferait mentir l'écran. « Annulé » et « échoué », eux, sont des fins.
 *
 * PUIS LE MONTANT (règle 2), relu en base et jamais cru sur parole. Un payload
 * annonçant 100 FCFA ne solde pas une tranche de 400 000 — et la comparaison ne
 * porte même pas sur ce payload, mais sur ce que PayDunya nous a reconfirmé
 * (D39).
 *
 * UN TROP-PERÇU ACQUITTE (D42). Exiger l'égalité stricte laisserait sans accès
 * une école qui a payé PLUS que ce qu'elle devait, ce qui est impossible à
 * expliquer à quiconque. Un paiement partiel, lui, n'acquitte rien : une
 * tranche est une créance, pas une cagnotte, et le dépôt n'a rien pour
 * additionner des versements successifs sur une même ligne.
 *
 * LA RÈGLE 1 — vérifier la signature avant toute chose — n'est PAS ici : elle
 * se joue dans `convex/http.ts`, avant même que cette décision soit demandée,
 * parce qu'un appel non authentifié ne doit pas atteindre la base du tout.
 */
export function decidePaymentApplication(
  input: PaymentApplicationInput,
): PaymentDecision {
  if (input.existingPaymentStatus === "completed") {
    return {
      outcome: "replayed",
      paymentStatus: null,
      creditsInstallment: false,
    };
  }

  if (input.providerOutcome !== "completed") {
    return {
      outcome: "not_completed",
      // « Annulé » et « échoué » sont des fins, et se recopient. « En attente »
      // laisse la ligne telle quelle : le prestataire rappellera, et une ligne
      // marquée `failed` par excès de zèle ferait croire à un paiement perdu.
      paymentStatus:
        input.providerOutcome === "pending" ? null : input.providerOutcome,
      creditsInstallment: false,
    };
  }

  if (input.dueAmountFcfa === null || input.installmentStatus === null) {
    // L'argent est bien arrivé : le marquer `failed` serait un mensonge, et
    // `completed` l'attribuerait à une tranche qu'on ne sait pas nommer. On
    // n'écrit donc pas de statut — la charge utile brute, elle, est conservée
    // par l'appelant, et c'est par elle qu'un humain retrouvera le versement.
    return {
      outcome: "unknown_installment",
      paymentStatus: null,
      creditsInstallment: false,
    };
  }

  if (input.confirmedAmountFcfa < input.dueAmountFcfa) {
    return {
      outcome: "amount_short",
      paymentStatus: "failed",
      creditsInstallment: false,
    };
  }

  if (input.installmentStatus === "paid") {
    // Le versement est réel et se marque `completed` — c'est de l'argent
    // encaissé, et l'écran doit le montrer. Mais la tranche ne se solde pas
    // deux fois : deux factures ouvertes sur la même échéance, et le second
    // paiement est un trop-perçu qui appartient à la facturation (§10).
    return {
      outcome: "already_paid",
      paymentStatus: "completed",
      creditsInstallment: false,
    };
  }

  return {
    outcome: "credited",
    paymentStatus: "completed",
    creditsInstallment: true,
  };
}

// ---------------------------------------------------------------------------
// CE QUE LE PAIEMENT FAIT AU CONTRAT — §8.4
// ---------------------------------------------------------------------------

export interface PostPaymentInput {
  status: SubscriptionStatus;
  startsAt: number;
  endsAt: number;
  now: number;
  /**
   * Reste-t-il une tranche échue impayée APRÈS celle qu'on vient de solder ?
   *
   * Une école en retard de deux tranches qui n'en paie qu'une est toujours en
   * retard : la sortir de `past_due` effacerait l'ancre de la grâce, et la
   * seconde tranche impayée ne serait plus comptée à partir de rien.
   */
  hasRemainingOverdue: boolean;
}

/** Le contrat passe-t-il à `active`, et sinon pourquoi pas. */
export type PostPaymentDecision =
  | { activate: true }
  | {
      activate: false;
      reason:
        | "already_active"
        | "not_started"
        | "period_over"
        | "still_overdue"
        | "status_draft"
        | "status_cancelled"
        | "status_expired";
    };

/**
 * Ce qu'un encaissement fait au statut du contrat.
 *
 * DEUX CHEMINS ET DEUX SEULEMENT mènent à `active` :
 *
 *   - « en attente de paiement » → la première tranche encaissée ouvre l'accès.
 *     C'est le flux nominal de §8.2 ;
 *   - « impayé » → la tranche en retard soldée referme la parenthèse, à
 *     condition qu'il n'en reste aucune autre. L'école retrouve un contrat
 *     ordinaire, et la grâce cesse d'être comptée.
 *
 * LA PÉRIODE COMPTE AUTANT QUE LE STATUT, et c'est la même `decidePeriod` que
 * le clic d'activation (`subscriptionRules`) : une école qui paie en août la
 * première tranche d'un contrat d'octobre n'ouvre RIEN — `decideAccess` ne lit
 * pas `startsAt`, donc un « actif » posé en août donnerait l'accès deux mois
 * trop tôt. Le contrat reste « en attente de paiement », sa tranche est soldée,
 * et le bouton « Activer » l'attend le jour venu. Deux façons de juger qu'un
 * contrat court auraient fini par diverger — c'est la règle D18 du plan 1/3.
 *
 * AUCUN CHEMIN NE FAIT REDESCENDRE UN STATUT, ici comme ailleurs : cette
 * fonction n'écrit jamais `cancelled`, `expired` ni `past_due`. Le seul
 * écrivain de `past_due` reste le cron (D37, D43), qui pose l'ancre dans la
 * même transaction.
 */
export function decidePostPayment(
  input: PostPaymentInput,
): PostPaymentDecision {
  switch (input.status) {
    case "active":
      return { activate: false, reason: "already_active" };
    case "draft":
      return { activate: false, reason: "status_draft" };
    case "cancelled":
      return { activate: false, reason: "status_cancelled" };
    case "expired":
      return { activate: false, reason: "status_expired" };
    case "past_due":
      if (input.hasRemainingOverdue) {
        return { activate: false, reason: "still_overdue" };
      }
      break;
    case "pending_payment":
      break;
  }

  const period = decidePeriod(input.now, input.startsAt, input.endsAt);
  if (period !== "running") return { activate: false, reason: period };
  return { activate: true };
}

// ---------------------------------------------------------------------------
// LE CRON — §8.6, et l'invariante que §8.5 lègue à ce plan
// ---------------------------------------------------------------------------

export interface OverdueInput {
  installmentStatus: "pending" | "paid" | "overdue" | "failed";
  dueAt: number;
  now: number;
  subscriptionStatus: SubscriptionStatus;
  subscriptionStartsAt: number;
  subscriptionEndsAt: number;
}

export interface OverdueDecision {
  /** La tranche passe-t-elle à `overdue` ? */
  marksInstallment: boolean;
  /** Le contrat passe-t-il à `past_due` ? JAMAIS sans la ligne du dessus. */
  marksSubscription: boolean;
}

/**
 * Ce que le cron quotidien doit écrire pour une tranche donnée (§8.6).
 *
 * LES DEUX ÉCRITURES SONT LIÉES, ET C'EST TOUT L'ENJEU. §8.5 lègue à ce plan
 * une invariante explicite : le cron qui fait basculer un abonnement en
 * `past_due` doit, DANS LA MÊME TRANSACTION, marquer la tranche échue qui ancre
 * la grâce. Un statut posé sans son ancre fait de `decideAccess` un couperet
 * immédiat au lieu des vingt et un jours promis. C'est pourquoi cette fonction
 * rend les deux décisions ENSEMBLE, et pourquoi `marksSubscription` ne peut
 * jamais être vrai sans `marksInstallment` : la forme du type porte
 * l'invariante, l'appelant n'a pas à s'en souvenir.
 *
 * `past_due` NE SE POSE QUE DEPUIS `active` (D37), et c'est la décision la plus
 * dangereuse du plan lue à l'envers : `past_due` OUVRE l'accès pendant vingt et
 * un jours. Le poser sur un contrat qui n'a jamais rien encaissé donnerait
 * trois semaines d'application gratuite à une école qui n'a pas payé un franc —
 * exactement ce que le paywall existe pour empêcher. Un contrat « en attente de
 * paiement » dont l'échéance passe garde donc son statut : sa tranche est
 * marquée impayée, ce qui est comptablement exact, mais il n'y a rien à retirer
 * à qui n'a rien reçu.
 *
 * ET PAS SUR UN CONTRAT FINI : `decideAccess` juge l'expiration sur `endsAt`,
 * donc un « impayé » posé après coup ne changerait aucun accès et laisserait en
 * base un statut que la lecture suivante contredit. Même raison qu'au refus
 * d'activer un contrat terminé.
 */
export function decideOverdue(input: OverdueInput): OverdueDecision {
  const marksInstallment =
    input.installmentStatus === "pending" && input.dueAt <= input.now;

  if (!marksInstallment) {
    return { marksInstallment: false, marksSubscription: false };
  }

  const running =
    decidePeriod(
      input.now,
      input.subscriptionStartsAt,
      input.subscriptionEndsAt,
    ) === "running";

  return {
    marksInstallment: true,
    marksSubscription: running && input.subscriptionStatus === "active",
  };
}
