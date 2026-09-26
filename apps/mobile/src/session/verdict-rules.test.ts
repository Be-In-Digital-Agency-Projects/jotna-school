import { describe, expect, it } from "vitest";

import {
  VERDICT_MAX_AGE_MS,
  verdictStillOpens,
  type CachedVerdict,
} from "./verdict-rules";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function verdict(over: Partial<CachedVerdict> = {}): CachedVerdict {
  return { endsAt: NOW + 90 * DAY, askedAt: NOW - DAY, ...over };
}

describe("verdictStillOpens — le cas nominal", () => {
  it("ouvre quand l'abonnement court et que le souvenir est frais", () => {
    expect(verdictStillOpens(verdict(), NOW)).toBe(true);
  });

  it("n'ouvre rien quand il n'y a pas de souvenir", () => {
    expect(verdictStillOpens(null, NOW)).toBe(false);
  });
});

describe("verdictStillOpens — la borne d'abonnement", () => {
  it("se ferme à la seconde où l'abonnement finit", () => {
    expect(verdictStillOpens(verdict({ endsAt: NOW + 1 }), NOW)).toBe(true);
    expect(verdictStillOpens(verdict({ endsAt: NOW }), NOW)).toBe(false);
    expect(verdictStillOpens(verdict({ endsAt: NOW - 1 }), NOW)).toBe(false);
  });

  it("un souvenir tout frais ne sauve pas un abonnement fini", () => {
    // C'est l'ordre des deux bornes qui compte : la fraîcheur ne rachète pas
    // l'expiration. Une école qui n'a pas renouvelé n'ouvre plus la porte,
    // même si l'enfant a ouvert l'application il y a cinq minutes.
    expect(
      verdictStillOpens(
        verdict({ endsAt: NOW - DAY, askedAt: NOW - 60_000 }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("verdictStillOpens — la borne de fraîcheur", () => {
  it("cesse de croire un souvenir trop vieux, abonnement valable ou non", () => {
    const old = verdict({ askedAt: NOW - VERDICT_MAX_AGE_MS });
    expect(verdictStillOpens(old, NOW)).toBe(false);
    const almost = verdict({ askedAt: NOW - VERDICT_MAX_AGE_MS + 1000 });
    expect(verdictStillOpens(almost, NOW)).toBe(true);
  });

  it("la durée par défaut est celle du bail d'un lot — quatorze jours", () => {
    // Au-delà, il n'y a de toute façon plus rien de jouable sur l'appareil :
    // `getOfflineBundle` borne `accessValidUntil` à la même durée. Entrer
    // n'apporterait donc rien, et croire plus longtemps ne servirait qu'à
    // laisser passer un enfant qui a quitté l'école.
    expect(VERDICT_MAX_AGE_MS).toBe(14 * DAY);
  });
});

describe("verdictStillOpens — l'horloge de l'appareil", () => {
  it("REFUSE un souvenir daté du futur plutôt que d'en calculer l'âge", () => {
    // Une horloge reculée rendrait `now - askedAt` négatif, donc « plus frais
    // que frais » : la borne de fraîcheur passerait toujours. C'est la manière
    // la plus simple de prolonger un accès sans toucher au serveur.
    expect(verdictStillOpens(verdict({ askedAt: NOW + 1 }), NOW)).toBe(false);
    expect(
      verdictStillOpens(verdict({ askedAt: NOW + 365 * DAY }), NOW),
    ).toBe(false);
  });

  it("une horloge AVANCÉE ferme l'accès d'elle-même, ce qui est le bon sens", () => {
    // Avancer l'horloge fait passer `endsAt` ET la fraîcheur : l'enfant qui
    // triche dans ce sens-là se verrouille tout seul. On ne le rattrape pas.
    const future = NOW + 365 * DAY;
    expect(verdictStillOpens(verdict(), future)).toBe(false);
  });

  it("un souvenir daté exactement de maintenant passe", () => {
    expect(verdictStillOpens(verdict({ askedAt: NOW }), NOW)).toBe(true);
  });
});
