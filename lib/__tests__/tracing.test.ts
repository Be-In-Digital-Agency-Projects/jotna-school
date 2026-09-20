import { describe, it, expect } from "vitest";
import {
  alphaToGrid,
  dilate,
  GRID_SIZE,
  inkCount,
  scoreTrace,
  startedFromRight,
  strokesToGrid,
  TRACE_OK,
  type Grid,
} from "../arabic/tracing";

/** Une grille carrée fabriquée à la main, pour tester sans canevas. */
function gridOf(size: number, cells: Array<[number, number]>): Grid {
  const grid = new Uint8Array(size * size);
  for (const [x, y] of cells) grid[y * size + x] = 1;
  return grid;
}

/** Un trait horizontal plein, de x0 à x1 sur la ligne y. */
function line(size: number, y: number, x0: number, x1: number): Grid {
  const cells: Array<[number, number]> = [];
  for (let x = x0; x <= x1; x++) cells.push([x, y]);
  return gridOf(size, cells);
}

describe("inkCount / dilate", () => {
  it("compte les cases noircies", () => {
    expect(inkCount(gridOf(8, [[1, 1], [2, 2]]))).toBe(2);
    expect(inkCount(new Uint8Array(64))).toBe(0);
  });

  it("un rayon nul ne change rien", () => {
    const grid = gridOf(8, [[4, 4]]);
    expect(inkCount(dilate(grid, 8, 0))).toBe(1);
  });

  it("épaissit d'un carré de (2r+1)²", () => {
    const grid = gridOf(9, [[4, 4]]);
    expect(inkCount(dilate(grid, 9, 1))).toBe(9);
    expect(inkCount(dilate(grid, 9, 2))).toBe(25);
  });

  it("ne déborde pas du cadre", () => {
    const grid = gridOf(5, [[0, 0]]);
    expect(inkCount(dilate(grid, 5, 1))).toBe(4); // coin : un quart du carré
  });
});

describe("strokesToGrid", () => {
  it("un trait rapide laisse une ligne CONTINUE, pas deux taches", () => {
    // Deux points seulement, aux extrémités : c'est ce que produit un doigt
    // qui balaie vite l'écran. Sans interpolation, le milieu resterait vide et
    // la couverture serait fausse.
    const grid = strokesToGrid([[{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }]], 32, 0);
    let holes = 0;
    for (let x = 4; x <= 28; x++) {
      if (grid[Math.round(0.5 * 31) * 32 + x] !== 1) holes += 1;
    }
    expect(holes).toBe(0);
  });

  it("un point isolé marque quand même", () => {
    expect(inkCount(strokesToGrid([[{ x: 0.5, y: 0.5 }]], 16, 0))).toBe(1);
  });

  it("un tracé vide donne une grille vide", () => {
    expect(inkCount(strokesToGrid([], 16, 1))).toBe(0);
    expect(inkCount(strokesToGrid([[]], 16, 1))).toBe(0);
  });

  it("le pinceau épaissit le trait", () => {
    const thin = strokesToGrid([[{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }]], 32, 0);
    const thick = strokesToGrid([[{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }]], 32, 2);
    expect(inkCount(thick)).toBeGreaterThan(inkCount(thin));
  });
});

describe("alphaToGrid", () => {
  it("une case s'allume dès qu'UN pixel du bloc est opaque", () => {
    // La barre du alif est fine : une moyenne l'effacerait, un « ou » la garde.
    const width = 4;
    const height = 4;
    const alpha = new Uint8Array(width * height);
    alpha[0] = 255; // un seul pixel sur les quatre du bloc (0,0)
    const grid = alphaToGrid(alpha, width, height, 2);
    expect(grid[0]).toBe(1);
    expect(inkCount(grid)).toBe(1);
  });

  it("ignore ce qui est sous le seuil", () => {
    const alpha = new Uint8Array(16).fill(10);
    expect(inkCount(alphaToGrid(alpha, 4, 4, 2, 32))).toBe(0);
  });
});

describe("scoreTrace", () => {
  const size = 32;
  const target = line(size, 16, 6, 25);

  it("le tracé exact vaut 1 et valide", () => {
    const out = scoreTrace({ target, drawn: target, size, tolerance: 1 });
    expect(out.coverage).toBe(1);
    expect(out.overflow).toBe(0);
    expect(out.score).toBe(1);
    expect(out.verdict).toBe("ok");
  });

  it("un carré vierge vaut zéro, sans lever", () => {
    const out = scoreTrace({
      target,
      drawn: new Uint8Array(size * size),
      size,
    });
    expect(out.score).toBe(0);
    expect(out.verdict).toBe("retry");
  });

  it("un modèle vide vaut zéro — on ne note pas contre rien", () => {
    const out = scoreTrace({
      target: new Uint8Array(size * size),
      drawn: target,
      size,
    });
    expect(out.score).toBe(0);
  });

  it("un trait légèrement décalé reste accepté — la tolérance sert à ça", () => {
    const out = scoreTrace({
      target,
      drawn: line(size, 17, 6, 25),
      size,
      tolerance: 2,
    });
    expect(out.coverage).toBe(1);
    expect(out.score).toBeGreaterThanOrEqual(TRACE_OK);
  });

  it("la moitié du modèle tracée : la couverture tombe de moitié", () => {
    // Le modèle fait vingt cases (6..25), l'enfant en a tracé dix (6..15).
    // La tolérance en ajoute UNE de chaque côté du tracé, d'où 11/20 et non
    // 10/20 : c'est la tolérance qui déborde, pas une erreur de compte.
    const out = scoreTrace({
      target,
      drawn: line(size, 16, 6, 15),
      size,
      tolerance: 1,
    });
    expect(out.coverage).toBeCloseTo(11 / 20, 5);
    expect(out.verdict).not.toBe("ok");
  });

  it("GRIBOUILLER TOUTE LA CASE NE PASSE PAS", () => {
    // C'est la tricherie évidente : noircir tout couvre le modèle à 100 %.
    // Sans la pénalité de débordement, elle donnerait trois étoiles.
    const scribble = new Uint8Array(size * size).fill(1);
    const out = scoreTrace({ target, drawn: scribble, size, tolerance: 2 });
    expect(out.coverage).toBe(1);
    expect(out.overflow).toBeGreaterThan(0.8);
    expect(out.verdict).toBe("retry");
  });

  it("un trait ailleurs est refusé", () => {
    const out = scoreTrace({
      target,
      drawn: line(size, 2, 6, 25),
      size,
      tolerance: 2,
    });
    expect(out.score).toBe(0);
    expect(out.verdict).toBe("retry");
  });

  it("la taille par défaut est celle de la grille d'analyse", () => {
    const full = new Uint8Array(GRID_SIZE * GRID_SIZE).fill(1);
    expect(scoreTrace({ target: full, drawn: full }).score).toBe(1);
  });
});

describe("startedFromRight", () => {
  it("vrai quand le trait part de la droite — le sens de l'arabe", () => {
    expect(
      startedFromRight([[{ x: 0.9, y: 0.5 }, { x: 0.1, y: 0.5 }]]),
    ).toBe(true);
  });

  it("faux quand l'enfant part de la gauche, comme en français", () => {
    expect(
      startedFromRight([[{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }]]),
    ).toBe(false);
  });

  it("null pour un trait vertical — l'alif ne dit rien du sens", () => {
    expect(
      startedFromRight([[{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.9 }]]),
    ).toBeNull();
  });

  it("null quand il n'y a rien à lire", () => {
    expect(startedFromRight([])).toBeNull();
    expect(startedFromRight([[{ x: 0.5, y: 0.5 }]])).toBeNull();
  });
});
