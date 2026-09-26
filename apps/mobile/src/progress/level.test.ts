import { describe, expect, it } from "vitest";

import { EXOS_PER_LEVEL, levelPercent } from "./level";

describe("levelPercent", () => {
  it("vide au début d'un niveau, plein à la marche suivante", () => {
    expect(levelPercent(EXOS_PER_LEVEL)).toBe(0);
    expect(levelPercent(0)).toBe(100);
  });

  it("proportionnel entre les deux", () => {
    expect(levelPercent(EXOS_PER_LEVEL / 2)).toBe(50);
    expect(levelPercent(EXOS_PER_LEVEL - 5)).toBe(10);
  });

  it("BORNE, et c'est ce qui compte", () => {
    // `exosToNextLevel` vient du serveur. Une valeur inattendue ne doit pas
    // produire une barre qui déborde de l'écran ou dont la largeur est
    // négative — React Native ne lève pas là-dessus, il dessine n'importe quoi.
    expect(levelPercent(-10)).toBe(100);
    expect(levelPercent(EXOS_PER_LEVEL * 3)).toBe(0);
  });

  it("ne rend jamais NaN", () => {
    for (const value of [0, 1, 49, 50, 51, -1, 1000]) {
      expect(Number.isNaN(levelPercent(value))).toBe(false);
    }
  });
});
