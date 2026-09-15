/**
 * Règle d'ACTIVATION d'un contrat — fonction PURE.
 *
 * Aucune lecture de base ici : `schools.activateSubscription` lit le contrat
 * que le paywall tient pour courant, puis passe les scalaires sur lesquels la
 * décision porte. Même découpage que accessRules.ts (pur, testé) / access.ts
 * (I/O), et que linkRules.ts / profiles.linkChild.
 *
 * POURQUOI CETTE RÈGLE EXISTE. `schools.recordSubscription` refuse
 * d'enregistrer `active` un contrat qui n'a pas commencé — à raison :
 * `accessRules.decideAccess` ne lit jamais `startsAt`, donc un contrat futur
 * marqué actif ouvrirait l'accès aujourd'hui. Elle conseille donc d'enregistrer
 * le contrat en attente de paiement. Encore faut-il que quelque chose sache
 * l'activer le jour venu, sans quoi l'école n'a jamais l'accès de l'année
 * qu'elle a signée.
 *
 * UNE SEULE TRANSITION, ET C'EST ELLE QUI AUTORISE LA MUTATION À EXISTER.
 * `subscriptions.status` n'avait aucun écrivain après l'insertion, et DEUX
 * raisonnements de cette branche s'appuient sur cette absence :
 *
 *   - le refus de `cancelled` à la saisie (spec §4.5), dont toute la preuve est
 *     « aucune ligne ne peut DEVENIR résiliée, puisque rien ne patche le
 *     statut » ;
 *   - la branche `past_due` de `decideAccess` (spec §8.5), qui tient un
 *     `past_due` sans tranche échue pour une INCOHÉRENCE de données, au motif
 *     que ce statut-là est posé par une machine — celle qui marque la tranche
 *     impayée.
 *
 * Les deux survivent parce que la seule transition décrite ici part de
 * `pending_payment` et arrive à `active`, sur un contrat qui a commencé et
 * n'est pas fini. Aucune ligne ne peut donc devenir `cancelled` par ce
 * chemin-là, et les dates n'étant jamais touchées, la disjointness de §4.5 est
 * intacte : la sélection en UN document du paywall reste exacte. Élargir cette
 * règle, c'est reprendre ces deux preuves — ici, en §4.5 et en §8.5.
 *
 * L'ENCAISSEMENT A DEPUIS AJOUTÉ DEUX ÉCRIVAINS, et les deux preuves y
 * survivent aussi — elles ne disent pas « personne n'écrit », elles disent
 * « personne n'écrit CECI » :
 *
 *   - `billing.applyPayment` n'écrit qu'`active`, comme ici, quand une tranche
 *     est encaissée. Il ne peut donc pas produire de `cancelled` ;
 *   - `billing.markOverdueInstallments` écrit `past_due`, ce que rien n'écrivait
 *     avant lui. La branche §8.5 ne s'appuyait pas sur l'absence de ce statut
 *     mais sur le fait qu'il soit posé PAR UNE MACHINE, celle qui marque la
 *     tranche impayée : c'est exactement ce cron, et il écrit les deux dans la
 *     même transaction.
 *
 * Aucun des deux ne touche aux dates, et aucune saisie humaine ne pose jamais
 * ni `past_due` ni `cancelled`.
 *
 * POURQUOI `draft` EST REFUSÉ, alors qu'il n'ouvre pas plus d'accès que
 * `pending_payment` : « brouillon » veut dire NON CONCLU. Activer ouvre
 * l'accès de toute une école, et rien ne sait le refermer ; « en attente de
 * paiement » atteste au moins qu'un accord existe, un brouillon non. Décision
 * du propriétaire du projet.
 *
 * ET `recordSubscription` N'ACCEPTE PLUS `draft` NON PLUS — les deux décisions
 * vont ensemble, et la seconde referme ce que la première ouvrirait. Une ligne
 * qu'aucune transition ne peut faire avancer serait un PIÈGE : rien ne
 * supprime ni ne redate une ligne d'abonnement, et sa période resterait prise
 * pour toujours, le contrôle de chevauchement de `recordSubscription` ne
 * regardant pas le statut. Une école à qui on aurait saisi un brouillon par
 * erreur n'aurait plus jamais d'accès sur ces dates. En interdisant la saisie
 * du brouillon, tout contrat enregistrable peut avancer : `pending_payment`
 * s'active ici, `active` est déjà en vigueur.
 *
 * Le motif `status_draft` reste donc, et c'est délibéré : le schéma autorise
 * toujours la valeur — la facturation créera peut-être de vrais devis un
 * jour — et une règle qui ne saurait pas quoi en dire l'activerait par
 * omission. Plus aucune écriture du dépôt ne produit cette valeur ; une ligne
 * ANTÉRIEURE au refus, en revanche, resterait immobile avec sa période, et le
 * message de refus le dit en face plutôt que de conseiller l'impossible.
 */

import type { SubscriptionStatus } from "./accessRules";

/**
 * Le seul statut de départ. `Extract` sur l'union du schéma, et non un
 * littéral recopié : le jour où ce statut disparaîtrait, ce type vaudrait
 * `never` et tout ce qui en dépend cesserait de compiler, à commencer par la
 * ligne de trace qui le recopie.
 */
export type ActivatableStatus = Extract<SubscriptionStatus, "pending_payment">;

/**
 * Pourquoi l'activation est refusée — un motif par cause, et non un motif
 * fourre-tout « statut invalide » : chaque cause appelle une conduite
 * différente de la part de l'administrateur, et c'est la mutation qui met les
 * phrases sur ces motifs (`schools.ts`), comme `lib/accessCopy.ts` met les
 * phrases sur les motifs de `decideAccess`.
 */
export type ActivationDenyReason =
  | "already_active"
  | "status_draft"
  | "status_past_due"
  | "status_expired"
  | "status_cancelled"
  | "not_started"
  | "period_over";

/**
 * Rend le statut de départ quand elle accepte, et pas seulement `ok`.
 *
 * C'est ce qui permet à la trace d'écrire « statut avant » sans transtypage :
 * la ligne recopie ce que la RÈGLE a établi, jamais ce que l'appelant croit
 * savoir. Élargir `ActivatableStatus` sans élargir le schéma de la trace ne
 * compilera pas.
 */
export type ActivationDecision =
  | { ok: true; from: ActivatableStatus }
  | { ok: false; reason: ActivationDenyReason };

export interface ActivationInput {
  /** Statut actuel de la ligne `subscriptions`. */
  status: SubscriptionStatus;
  startsAt: number;
  endsAt: number;
  now: number;
}

/** Où `now` tombe par rapport à la période d'un contrat. */
export type ContractPeriod = "not_started" | "running" | "period_over";

/**
 * LA SEULE définition de « ce contrat court-il ? » du dépôt.
 *
 * Elle est extraite parce qu'un SECOND lecteur est arrivé : `billingRules
 * .decidePostPayment` doit savoir, lui aussi, si le contrat qu'un paiement
 * vient de solder est en cours — et une tranche encaissée ne peut pas ouvrir
 * l'accès d'une année qui n'a pas commencé, pas plus qu'un clic
 * d'administrateur. Recopier la comparaison là-bas aurait donné deux façons de
 * répondre à une même question, qui finissent toujours par diverger : c'est la
 * règle D18 du plan 1/3, et elle vaut ici autant que pour les sièges.
 *
 * TROIS VALEURS ET NON UN BOOLÉEN : ses deux appelants doivent distinguer « pas
 * encore commencé » de « déjà fini » pour dire à l'administrateur ce qu'il en
 * est, et un booléen leur imposerait de refaire la comparaison pour trouver
 * laquelle des deux — donc de rouvrir exactement le trou qu'on ferme.
 *
 * BORNES : début INCLUS, fin EXCLUE. C'est la convention de tout le chantier,
 * et elle vient de `decideAccess`, qui tient `now >= endsAt` pour échu : un
 * contrat qui finit à midi ne couvre pas midi. Un renouvellement peut donc
 * commencer exactement à la fin du précédent sans les faire se chevaucher
 * (§4.5).
 */
export function decidePeriod(
  now: number,
  startsAt: number,
  endsAt: number,
): ContractPeriod {
  if (now < startsAt) return "not_started";
  if (now >= endsAt) return "period_over";
  return "running";
}

/**
 * Le statut refusé, mis en motif. Exhaustive sur les cinq statuts qui ne sont
 * pas activables : un septième statut au schéma ne compilera pas ici, la
 * fonction n'ayant alors plus de valeur de retour sur ce chemin. C'est
 * volontaire — un nouveau statut doit être examiné, pas hérité d'un `default`.
 */
function refusalForStatus(
  status: Exclude<SubscriptionStatus, ActivatableStatus>,
): ActivationDenyReason {
  switch (status) {
    case "active":
      return "already_active";
    case "draft":
      return "status_draft";
    case "past_due":
      return "status_past_due";
    case "expired":
      return "status_expired";
    case "cancelled":
      return "status_cancelled";
  }
}

export function decideActivation(input: ActivationInput): ActivationDecision {
  // LISTE BLANCHE, et non liste noire. Le statut de départ est nommé
  // positivement : tout ce qui n'est pas `pending_payment` est refusé, y
  // compris un statut que le schéma n'a pas encore. Une liste de refus
  // laisserait un futur statut activable par omission — exactement la faute
  // que ce module existe pour empêcher.
  if (input.status !== "pending_payment") {
    return { ok: false, reason: refusalForStatus(input.status) };
  }

  // LE CONTRAT DOIT AVOIR COMMENCÉ, ET NE PAS ÊTRE FINI.
  //
  // Le premier est le trou que `recordSubscription` ferme à la saisie et qui se
  // rouvrirait ici : `decideAccess` ne lit que `status` et `endsAt`, donc un
  // contrat de l'an prochain marqué actif ouvrirait l'accès AUJOURD'HUI, pour
  // une période que l'école n'a pas commencé à payer. Le second évite de
  // laisser en base un « actif » que la lecture suivante contredit : activer un
  // contrat terminé n'ouvre aucun accès.
  //
  // Les deux comparaisons vivent dans `decidePeriod`, partagée avec
  // `billingRules.decidePostPayment` : une seule définition de « ce contrat
  // court-il », pour que l'encaissement et le clic d'activation ne puissent pas
  // en juger différemment.
  const period = decidePeriod(input.now, input.startsAt, input.endsAt);
  if (period !== "running") {
    return { ok: false, reason: period };
  }

  return { ok: true, from: input.status };
}
