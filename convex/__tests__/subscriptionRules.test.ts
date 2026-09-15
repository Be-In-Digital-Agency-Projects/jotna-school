import { describe, it, expect } from "vitest";
import {
  decideActivation,
  type ActivationInput,
} from "../subscriptionRules";
import type { SubscriptionStatus } from "../accessRules";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_780_000_000_000;

/** Entrée de base : contrat en attente de paiement, commencé, non fini. */
function base(overrides: Partial<ActivationInput> = {}): ActivationInput {
  return {
    status: "pending_payment",
    startsAt: NOW - 30 * DAY,
    endsAt: NOW + 300 * DAY,
    now: NOW,
    ...overrides,
  };
}

describe("decideActivation — le statut de départ", () => {
  it("accepte « en attente de paiement », et rend ce statut", () => {
    expect(decideActivation(base())).toEqual({
      ok: true,
      from: "pending_payment",
    });
  });

  // C'est le test qui garde l'étroitesse : cinq des six statuts du schéma sont
  // refusés, chacun avec son propre motif. Un septième statut ne compilerait
  // pas (`refusalForStatus` est exhaustive), et un statut qu'on rendrait
  // activable par erreur tomberait ici.
  it("refuse les CINQ autres statuts du schéma, chacun avec son motif", () => {
    const cases: [Exclude<SubscriptionStatus, "pending_payment">, string][] = [
      ["draft", "status_draft"],
      ["active", "already_active"],
      ["past_due", "status_past_due"],
      ["expired", "status_expired"],
      ["cancelled", "status_cancelled"],
    ];

    for (const [status, reason] of cases) {
      expect(decideActivation(base({ status }))).toEqual({ ok: false, reason });
    }
  });

  // Le statut prime sur la période : un contrat résilié qui n'a pas commencé
  // s'entend dire qu'il est résilié, pas qu'il est trop tôt. Le motif rendu
  // doit désigner ce qui empêche VRAIMENT, sinon le message envoie
  // l'administrateur attendre une date qui ne changera rien.
  it("juge le statut avant la période", () => {
    expect(
      decideActivation(base({ status: "cancelled", startsAt: NOW + DAY })),
    ).toEqual({ ok: false, reason: "status_cancelled" });
  });
});

describe("decideActivation — la période", () => {
  it("refuse un contrat qui n'a pas commencé", () => {
    expect(decideActivation(base({ startsAt: NOW + 1 }))).toEqual({
      ok: false,
      reason: "not_started",
    });
  });

  // Borne BASSE incluse : le jour du début, le contrat s'active. C'est le cas
  // même pour lequel cette règle existe — l'école qui a signé en juillet.
  it("accepte à l'instant exact du début", () => {
    expect(decideActivation(base({ startsAt: NOW }))).toEqual({
      ok: true,
      from: "pending_payment",
    });
  });

  // Borne HAUTE exclue, comme `decideAccess` qui tient `now >= endsAt` pour
  // échu : activer là laisserait en base un « actif » que la lecture suivante
  // contredit.
  it("refuse un contrat fini, borne haute exclue", () => {
    expect(decideActivation(base({ endsAt: NOW }))).toEqual({
      ok: false,
      reason: "period_over",
    });
    expect(decideActivation(base({ endsAt: NOW - 1 }))).toEqual({
      ok: false,
      reason: "period_over",
    });
  });

  it("accepte tant qu'il reste une milliseconde", () => {
    expect(decideActivation(base({ endsAt: NOW + 1 }))).toEqual({
      ok: true,
      from: "pending_payment",
    });
  });

  // La propriété que le paywall et la spec §8.4 bis demandent : sur toute la
  // durée de vie d'un contrat, l'activation n'est possible QUE dans sa période.
  // Avant, elle ouvrirait l'accès pour une année non commencée — le trou que
  // `recordSubscription` ferme à la saisie ; après, elle n'ouvrirait rien.
  it("n'accepte nulle part hors de [startsAt, endsAt)", () => {
    const startsAt = NOW;
    const endsAt = NOW + 300 * DAY;
    const instants = [
      startsAt - 300 * DAY,
      startsAt - DAY,
      startsAt - 1,
      startsAt,
      startsAt + DAY,
      endsAt - 1,
      endsAt,
      endsAt + DAY,
      endsAt + 300 * DAY,
    ];

    for (const now of instants) {
      const decision = decideActivation(base({ startsAt, endsAt, now }));
      expect(decision.ok).toBe(now >= startsAt && now < endsAt);
    }
  });
});
