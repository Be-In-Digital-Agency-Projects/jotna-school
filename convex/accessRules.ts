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
      if (input.oldestOverdueDueAt === null) return granted;
      return input.now < input.oldestOverdueDueAt + PAST_DUE_GRACE_MS
        ? granted
        : { ok: false, reason: "past_due" };
    }

    case "draft":
    case "pending_payment":
      return { ok: false, reason: "pending_payment" };

    case "expired":
      return { ok: false, reason: "expired" };

    case "cancelled":
      return { ok: false, reason: "cancelled" };
  }
}
