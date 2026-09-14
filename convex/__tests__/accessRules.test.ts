import { describe, it, expect } from "vitest";
import {
  decideAccess,
  PAST_DUE_GRACE_MS,
  type AccessInput,
} from "../accessRules";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_780_000_000_000;

/** Entrée de base : élève couvert par un abonnement actif. */
function base(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    now: NOW,
    role: "student",
    activeMembership: { schoolId: "school_1" },
    hasReleasedMembership: false,
    subscription: { status: "active", endsAt: NOW + 100 * DAY },
    oldestOverdueDueAt: null,
    ...overrides,
  };
}

describe("decideAccess — identité", () => {
  it("refuse un profil absent", () => {
    expect(decideAccess(base({ role: null }))).toEqual({
      ok: false,
      reason: "not_authenticated",
    });
  });

  it("refuse un non-élève", () => {
    for (const role of ["parent", "professeur", "directeur", "admin"]) {
      expect(decideAccess(base({ role }))).toEqual({
        ok: false,
        reason: "not_student",
      });
    }
  });
});

describe("decideAccess — rattachement école", () => {
  it("refuse un élève sans aucune inscription", () => {
    expect(
      decideAccess(base({ activeMembership: null, hasReleasedMembership: false })),
    ).toEqual({ ok: false, reason: "no_school" });
  });

  it("distingue un siège libéré d'une absence d'école", () => {
    expect(
      decideAccess(base({ activeMembership: null, hasReleasedMembership: true })),
    ).toEqual({ ok: false, reason: "seat_released" });
  });
});

describe("decideAccess — abonnement", () => {
  it("refuse quand l'école n'a aucun abonnement", () => {
    expect(decideAccess(base({ subscription: null }))).toEqual({
      ok: false,
      reason: "no_subscription",
    });
  });

  it("accorde l'accès sur un abonnement actif non échu", () => {
    expect(decideAccess(base())).toEqual({
      ok: true,
      schoolId: "school_1",
      endsAt: NOW + 100 * DAY,
    });
  });

  it("refuse un abonnement actif dont la date de fin est passée", () => {
    expect(
      decideAccess(
        base({ subscription: { status: "active", endsAt: NOW - DAY } }),
      ),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuse un devis et un contrat signé non payé", () => {
    for (const status of ["draft", "pending_payment"] as const) {
      expect(
        decideAccess(base({ subscription: { status, endsAt: NOW + 100 * DAY } })),
      ).toEqual({ ok: false, reason: "pending_payment" });
    }
  });

  it("refuse un abonnement expiré ou résilié avec la bonne raison", () => {
    expect(
      decideAccess(
        base({ subscription: { status: "expired", endsAt: NOW + 100 * DAY } }),
      ),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      decideAccess(
        base({ subscription: { status: "cancelled", endsAt: NOW + 100 * DAY } }),
      ),
    ).toEqual({ ok: false, reason: "cancelled" });
  });
});

describe("decideAccess — délai de grâce past_due", () => {
  const pastDue = { status: "past_due" as const, endsAt: NOW + 100 * DAY };

  it("laisse l'accès ouvert pendant la grâce", () => {
    const state = decideAccess(
      base({ subscription: pastDue, oldestOverdueDueAt: NOW - 5 * DAY }),
    );
    expect(state.ok).toBe(true);
  });

  it("ferme l'accès au-delà de la grâce", () => {
    expect(
      decideAccess(
        base({ subscription: pastDue, oldestOverdueDueAt: NOW - 30 * DAY }),
      ),
    ).toEqual({ ok: false, reason: "past_due" });
  });

  it("est inclusif à la borne : l'accès tient à la dernière milliseconde", () => {
    const dueAt = NOW - PAST_DUE_GRACE_MS + 1;
    expect(
      decideAccess(base({ subscription: pastDue, oldestOverdueDueAt: dueAt })).ok,
    ).toBe(true);
  });

  it("ferme pile à l'expiration de la grâce", () => {
    const dueAt = NOW - PAST_DUE_GRACE_MS;
    expect(
      decideAccess(base({ subscription: pastDue, oldestOverdueDueAt: dueAt })),
    ).toEqual({ ok: false, reason: "past_due" });
  });

  it("accorde l'accès si past_due sans tranche échue identifiée", () => {
    expect(
      decideAccess(base({ subscription: pastDue, oldestOverdueDueAt: null })).ok,
    ).toBe(true);
  });

  it("fait primer la fin d'année sur la grâce", () => {
    expect(
      decideAccess(
        base({
          subscription: { status: "past_due", endsAt: NOW - DAY },
          oldestOverdueDueAt: NOW - DAY,
        }),
      ),
    ).toEqual({ ok: false, reason: "expired" });
  });
});
