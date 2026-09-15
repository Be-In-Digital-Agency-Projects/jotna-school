/**
 * Règles de droit d'accès — fonction PURE.
 *
 * Aucune lecture de base ici : les documents sont lus par les wrappers de
 * `convex/access.ts` et passés en entrée. Même découpage que
 * aiGateway/budget.ts (pur, testé) / aiGateway/db.ts (I/O).
 *
 * Spec : docs/superpowers/specs/2026-09-14-abonnement-ecoles-design.md §5
 */

/** Délai de grâce sur tranche échue : 21 jours (spec §8.5). */
export const PAST_DUE_GRACE_MS = 21 * 24 * 60 * 60 * 1000;

export type AccessReason =
  | "not_authenticated"
  | "not_student"
  | "no_school"
  | "seat_released"
  | "no_subscription"
  | "pending_payment"
  | "past_due"
  | "expired"
  | "cancelled";

export type AccessState =
  | { ok: true; schoolId: string; endsAt: number }
  | { ok: false; reason: AccessReason };

export type SubscriptionStatus =
  | "draft"
  | "pending_payment"
  | "active"
  | "past_due"
  | "expired"
  | "cancelled";

export interface AccessInput {
  now: number;
  /** Rôle du profil, ou null si aucun profil n'a pu être résolu. */
  role: string | null;
  /** Inscription active de l'élève, ou null. */
  activeMembership: { schoolId: string } | null;
  /** Vrai si l'élève a une inscription passée en "released". */
  hasReleasedMembership: boolean;
  /** Abonnement le plus récent de l'école, quel que soit son statut. */
  subscription: { status: SubscriptionStatus; endsAt: number } | null;
  /** `dueAt` de la tranche échue la plus ancienne. Lu seulement si past_due. */
  oldestOverdueDueAt: number | null;
}

export function decideAccess(input: AccessInput): AccessState {
  if (input.role === null) {
    return { ok: false, reason: "not_authenticated" };
  }
  if (input.role !== "student") {
    return { ok: false, reason: "not_student" };
  }

  if (input.activeMembership === null) {
    return input.hasReleasedMembership
      ? { ok: false, reason: "seat_released" }
      : { ok: false, reason: "no_school" };
  }

  const sub = input.subscription;
  if (sub === null) {
    return { ok: false, reason: "no_subscription" };
  }

  // La fin d'année prime sur tout : un abonnement échu ne couvre plus rien,
  // quel que soit son statut nominal.
  if (input.now >= sub.endsAt) {
    return { ok: false, reason: "expired" };
  }

  const granted: AccessState = {
    ok: true,
    schoolId: input.activeMembership.schoolId,
    endsAt: sub.endsAt,
  };

  switch (sub.status) {
    case "active":
      return granted;

    case "past_due": {
      // Couper des enfants parce qu'un intendant est en retard est cruel et
      // commercialement suicidaire : on laisse 21 jours (spec §8.5).
      //
      // Mais une grâce se compte À PARTIR DE QUELQUE CHOSE. Sans tranche échue
      // identifiable, il n'y a pas de date à laquelle l'ancrer — et accorder
      // l'accès quand même n'était pas de la clémence, c'était l'ABSENCE de
      // règle : un `past_due` sans ancre ouvrait l'accès sans aucune limite de
      // temps. C'était la seule branche de cette fonction à échouer en ouvert,
      // toutes les autres échouant en fermé.
      //
      // Un `past_due` sans ancre n'est pas un état légitime, c'est une
      // INCOHÉRENCE de nos données : le statut est posé par une machine, et
      // celle qui le posera est la même qui marque la tranche impayée. Un
      // paywall ne doit pas accorder un accès illimité sur des données
      // incohérentes.
      //
      // Ce raisonnement tient MOT POUR MOT depuis que
      // `schools.activateSubscription` existe : une personne écrit désormais
      // `status`, mais elle n'écrit que `active`, et seulement depuis
      // `pending_payment` (`convex/subscriptionRules.ts`). Aucune saisie
      // humaine ne pose `past_due`, ici comme à l'enregistrement.
      //
      // INVARIANTE QUE LE PLAN 3 DOIT TENIR — le cron qui fera basculer un
      // abonnement en `past_due` doit, DANS LA MÊME TRANSACTION, créer ou
      // marquer la tranche échue qui ancre la grâce. S'il pose le statut sans
      // l'ancre, cette branche coupera l'école immédiatement au lieu de lui
      // laisser ses 21 jours. C'est le prix de fermer le trou, et il se paie
      // là-bas, pas ici.
      if (input.oldestOverdueDueAt === null) {
        return { ok: false, reason: "past_due" };
      }
      return input.now < input.oldestOverdueDueAt + PAST_DUE_GRACE_MS
        ? granted
        : { ok: false, reason: "past_due" };
    }

    // `draft` est INATTEIGNABLE PAR LA SAISIE depuis que
    // `schools.recordSubscription` ne l'accepte plus : rien dans le dépôt
    // n'écrit cette valeur, ni à l'insertion ni par `patch`. La branche reste
    // quand même, et ce n'est pas l'oubli d'un flux mort — c'est une défense
    // sur une valeur que le SCHÉMA autorise toujours, parce qu'un flux de
    // devis pourrait en créer un jour. Sans elle, la fonction ne compilerait
    // pas (le `switch` est exhaustif), et la supprimer exigerait de retirer
    // `draft` du schéma, ce qui n'est pas additif. Un brouillon n'ouvre aucun
    // accès, et il est dit avec le même motif que « en attente de paiement » :
    // pour l'élève, les deux veulent dire « pas encore payé ».
    case "draft":
    case "pending_payment":
      return { ok: false, reason: "pending_payment" };

    case "expired":
      return { ok: false, reason: "expired" };

    case "cancelled":
      return { ok: false, reason: "cancelled" };
  }
}
