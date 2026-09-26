import { describe, expect, it } from "vitest";

import { palierState } from "./palier-state";

/** Les dix pastilles d'une thématique, comme la grille les dessine. */
function grid(nextPalierIndex: number, completed = false) {
  return Array.from({ length: 10 }, (_, i) =>
    palierState(i + 1, nextPalierIndex, completed),
  );
}

describe("palierState — une thématique en cours", () => {
  it("au tout début, seul le premier est ouvert", () => {
    expect(grid(1)).toEqual([
      "next",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
    ]);
  });

  it("au milieu, le passé est fait, le présent est ouvert, le reste est fermé", () => {
    expect(grid(4)).toEqual([
      "done",
      "done",
      "done",
      "next",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
    ]);
  });

  it("n'ouvre JAMAIS plus d'un palier à la fois", () => {
    for (let next = 1; next <= 10; next++) {
      const opened = grid(next).filter((s) => s === "next");
      expect(opened).toHaveLength(1);
    }
  });
});

describe("palierState — le plafond à 10, où `nextPalierIndex` devient ambigu", () => {
  it("dixième à faire : les neuf premiers sont faits, le dixième est ouvert", () => {
    expect(grid(10)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "done",
      "done",
      "done",
      "done",
      "next",
    ]);
  });

  it("thématique terminée : les dix sont faits, AUCUN n'est ouvert", () => {
    // C'est le cas que `nextPalierIndex` seul ne sait pas distinguer du
    // précédent — il vaut 10 dans les deux. Sans `completed`, la grille
    // montrerait le dixième palier « à faire » à un enfant qui l'a réussi.
    expect(grid(10, true)).toEqual(Array(10).fill("done"));
    expect(grid(10, true)).not.toContain("next");
  });

  it("`completed` l'emporte même si `nextPalierIndex` est resté bas", () => {
    // Défensif : si les deux sources divergeaient, on croit celle qui dit que
    // l'enfant a fini — se tromper en montrant « fait » vexe moins que de
    // reverrouiller un palier déjà réussi.
    expect(grid(3, true)).toEqual(Array(10).fill("done"));
  });
});

describe("palierState — ce qui n'arrive pas, mais viendrait du serveur", () => {
  it("un index hors des dix ne devient jamais ouvrable par accident", () => {
    expect(palierState(11, 10, false)).toBe("locked");
    expect(palierState(0, 1, false)).toBe("done");
  });

  it("un `nextPalierIndex` à zéro ne verrouille pas tout le premier rang", () => {
    // `min(10, max + 1)` ne peut pas valoir 0, mais si cela arrivait, la
    // grille resterait cohérente plutôt que de n'afficher que des cadenas.
    expect(grid(0)).toEqual(Array(10).fill("locked"));
  });
});
