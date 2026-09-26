import { describe, expect, it } from "vitest";

import {
  MAX_TIME_SPENT_MS,
  clampCount,
  clampSubmittedAt,
  clampTimeSpent,
  lowerBound,
} from "../paliers/journal";

/**
 * LE BORNAGE D'HORLOGE — décision D17.
 *
 * Ces règles décident de la SÉRIE de l'enfant à partir d'une date que son
 * appareil déclare. Elles doivent tenir les deux bouts : ne pas croire une
 * horloge avancée, et ne pas punir un enfant qui a joué là où il n'y a pas de
 * réseau.
 */

const LUNDI = Date.parse("2026-09-21T09:00:00Z");
const VENDREDI = Date.parse("2026-09-25T09:00:00Z");
const TELECHARGEMENT = Date.parse("2026-09-21T08:00:00Z");
const DEBUT_TENTATIVE = Date.parse("2026-09-21T07:59:00Z");

describe("lowerBound", () => {
  it("prend le téléchargement quand il est postérieur au début de la tentative", () => {
    expect(lowerBound(TELECHARGEMENT, DEBUT_TENTATIVE, VENDREDI)).toBe(
      TELECHARGEMENT,
    );
  });

  it("ne descend jamais avant le début de la tentative, qui est une date SERVEUR", () => {
    // L'appareil peut mentir sur son propre téléchargement.
    const menteur = Date.parse("2020-01-01T00:00:00Z");
    expect(lowerBound(menteur, DEBUT_TENTATIVE, VENDREDI)).toBe(DEBUT_TENTATIVE);
  });

  it("ne monte jamais au-delà de maintenant", () => {
    const futur = Date.parse("2030-01-01T00:00:00Z");
    expect(lowerBound(futur, DEBUT_TENTATIVE, VENDREDI)).toBe(VENDREDI);
  });
});

describe("clampSubmittedAt", () => {
  const lower = lowerBound(TELECHARGEMENT, DEBUT_TENTATIVE, VENDREDI);

  it("GARDE le lundi d'un enfant qui a joué sans réseau et synchronise vendredi", () => {
    // C'est le cas qui justifie tout le reste : dater à la synchronisation lui
    // ferait perdre sa série pour avoir joué là où il n'y a pas de réseau.
    expect(clampSubmittedAt(LUNDI, lower, VENDREDI)).toBe(LUNDI);
  });

  it("ramène une horloge avancée d'un mois", () => {
    const avance = Date.parse("2026-10-25T09:00:00Z");
    expect(clampSubmittedAt(avance, lower, VENDREDI)).toBe(VENDREDI);
  });

  it("ramène une date antérieure au téléchargement du lot", () => {
    const avant = Date.parse("2026-09-01T09:00:00Z");
    expect(clampSubmittedAt(avant, lower, VENDREDI)).toBe(lower);
  });

  it("une date illisible retombe sur maintenant, jamais sur NaN", () => {
    expect(clampSubmittedAt(Number.NaN, lower, VENDREDI)).toBe(VENDREDI);
  });
});

describe("clampTimeSpent", () => {
  it("garde une durée plausible", () => {
    expect(clampTimeSpent(45_000)).toBe(45_000);
  });

  it("plafonne à une heure", () => {
    expect(clampTimeSpent(5 * MAX_TIME_SPENT_MS)).toBe(MAX_TIME_SPENT_MS);
  });

  it("une durée négative ou illisible vaut zéro", () => {
    expect(clampTimeSpent(-1)).toBe(0);
    expect(clampTimeSpent(Number.NaN)).toBe(0);
  });
});

describe("clampCount", () => {
  it("entier, jamais négatif", () => {
    expect(clampCount(3)).toBe(3);
    expect(clampCount(2.7)).toBe(2);
    expect(clampCount(-5)).toBe(0);
    expect(clampCount(Number.NaN)).toBe(0);
  });

  it("zéro reste zéro — c'est la sentinelle des lignes d'indice", () => {
    // `requestHint` écrit `attemptNumber: 0`, et `submitPalier` filtre sur
    // `> 0`. Un bornage qui remonterait zéro à un ferait compter les indices
    // comme des tentatives, et le score s'effondrerait.
    expect(clampCount(0)).toBe(0);
  });
});
