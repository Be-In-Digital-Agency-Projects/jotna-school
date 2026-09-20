/**
 * NOTER UN TRACÉ — l'enfant écrit la lettre au doigt, le module la juge.
 *
 * L'IDÉE, EN UNE PHRASE : on réduit la lettre modèle et le tracé de l'enfant à
 * deux GRILLES de cases noircies, puis on répond à deux questions — combien du
 * modèle a été recouvert (la couverture), et combien du tracé est tombé à côté
 * (le débordement).
 *
 * POURQUOI DES GRILLES ET NON DES COURBES. Comparer des chemins demanderait de
 * connaître l'ordre et le sens des traits de chaque lettre — une donnée qui
 * n'existe pas dans une police, et qu'il faudrait saisir vingt-huit fois à la
 * main, puis maintenir. La grille, elle, se fabrique depuis la police
 * elle-même : on dessine la lettre dans un canevas, on lit son canal alpha, on
 * la réduit. Ce que le module valide est donc « ta lettre ressemble à la
 * lettre », pas « tu as fait les traits dans l'ordre du maître ».
 *
 * CE QUE CETTE NOTE N'EST PAS. Elle est calculée SUR L'APPAREIL de l'enfant,
 * parce que seule la police du navigateur sait dessiner le modèle. Un élève
 * décidé pourrait donc fabriquer un score parfait — et il ne gagnerait qu'un
 * dessin qu'il n'a pas fait. Aucun droit, aucun accès, aucun euro ne dépend de
 * ce nombre : c'est une aide à l'apprentissage, jamais une garde. Ce que le
 * serveur en conserve est rangé comme tel (`arabicAttempts.source`).
 *
 * DEUX SEUILS, TROIS RÉPONSES — comme pour la prononciation, et pour la même
 * raison : un enfant dont la lettre est reconnaissable mais tremblée n'a pas
 * échoué, et lui dire « non » l'arrête là.
 *
 * TOUT EST PUR ICI : des tableaux d'octets entrent, des nombres sortent. Le
 * canevas, les événements de pointeur et la police vivent dans le composant
 * (`components/arabic/tracing-canvas.tsx`), les tests vivent dans
 * `lib/__tests__/tracing.test.ts`.
 */

/** Côté de la grille d'analyse. 48×48 = 2304 cases : assez fin pour un point. */
export const GRID_SIZE = 48;

/** Une grille : `size × size` cases valant 0 ou 1, en ligne puis colonne. */
export type Grid = Uint8Array;

/** Un point de tracé, en coordonnées normalisées (0..1) du carré d'écriture. */
export interface TracePoint {
  x: number;
  y: number;
}

/** Un trait continu : du poser du doigt à son lever. */
export type Stroke = readonly TracePoint[];

export const TRACE_OK = 0.7;
export const TRACE_CLOSE = 0.45;

/**
 * Le poids du débordement dans la note.
 *
 * À 0,8, un tracé qui couvre tout le modèle mais dont la moitié bave à côté
 * tombe à 0,6 — « presque ». C'est le bon réglage pour un enfant : gribouiller
 * la case entière couvrirait le modèle à 100 % et doit être refusé, mais une
 * lettre correcte avec une queue qui dépasse doit passer.
 */
const OVERFLOW_WEIGHT = 0.8;

/** Nombre de cases noircies. */
export function inkCount(grid: Grid): number {
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === 1) n += 1;
  return n;
}

/**
 * Épaissit une grille de `radius` cases (distance de Tchebychev).
 *
 * C'EST LA TOLÉRANCE, et elle sert dans les deux sens : le tracé de l'enfant
 * est épaissi pour juger ce qu'il a couvert du modèle (un trait qui frôle la
 * lettre l'a touchée), et le modèle est épaissi pour juger ce qui déborde (un
 * trait qui longe la lettre ne déborde pas vraiment).
 */
export function dilate(grid: Grid, size: number, radius: number): Grid {
  if (radius <= 0) return grid.slice();
  const out = new Uint8Array(grid.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y * size + x] !== 1) continue;
      const yMin = Math.max(0, y - radius);
      const yMax = Math.min(size - 1, y + radius);
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(size - 1, x + radius);
      for (let yy = yMin; yy <= yMax; yy++) {
        for (let xx = xMin; xx <= xMax; xx++) out[yy * size + xx] = 1;
      }
    }
  }
  return out;
}

/**
 * Rasterise les traits de l'enfant.
 *
 * Chaque segment est parcouru par pas d'une demi-case pour qu'un geste rapide
 * — deux points très éloignés — laisse une ligne continue et non deux taches.
 * `brush` est le rayon du doigt, en cases.
 */
export function strokesToGrid(
  strokes: readonly Stroke[],
  size: number = GRID_SIZE,
  brush: number = 1,
): Grid {
  const grid = new Uint8Array(size * size);

  const paint = (px: number, py: number) => {
    const cx = Math.round(px * (size - 1));
    const cy = Math.round(py * (size - 1));
    for (let dy = -brush; dy <= brush; dy++) {
      for (let dx = -brush; dx <= brush; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        grid[y * size + x] = 1;
      }
    }
  };

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    if (stroke.length === 1) {
      paint(stroke[0].x, stroke[0].y);
      continue;
    }
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1];
      const b = stroke[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distanceCells = Math.hypot(dx, dy) * size;
      const steps = Math.max(1, Math.ceil(distanceCells * 2));
      for (let s = 0; s <= steps; s++) {
        paint(a.x + (dx * s) / steps, a.y + (dy * s) / steps);
      }
    }
  }
  return grid;
}

/**
 * Réduit le canal alpha d'un canevas à une grille.
 *
 * Une case est noircie dès qu'UN pixel du bloc correspondant est opaque
 * (`threshold`). Un « ou » et non une moyenne : la fine barre du alif ne
 * couvre qu'une fraction de son bloc, et une moyenne l'effacerait.
 */
export function alphaToGrid(
  alpha: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  size: number = GRID_SIZE,
  threshold = 32,
): Grid {
  const grid = new Uint8Array(size * size);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(size - 1, Math.floor((y / height) * size));
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] < threshold) continue;
      const gx = Math.min(size - 1, Math.floor((x / width) * size));
      grid[gy * size + gx] = 1;
    }
  }
  return grid;
}

export type TraceVerdict = "ok" | "close" | "retry";

export interface TraceScore {
  /** La part du modèle que le tracé recouvre, 0..1. */
  coverage: number;
  /** La part du tracé tombée hors du modèle, 0..1. */
  overflow: number;
  /** La note finale, 0..1. */
  score: number;
  verdict: TraceVerdict;
}

/**
 * Note un tracé contre son modèle.
 *
 * `tolerance` est le rayon d'épaississement, en cases : 2 sur une grille de 48
 * revient à pardonner un écart d'environ 4 % de la largeur du carré.
 *
 * UN TRACÉ VIDE VAUT ZÉRO, et n'est pas un cas d'erreur : c'est l'état de
 * départ du carré d'écriture, et l'écran doit pouvoir l'afficher sans traiter
 * d'exception.
 */
export function scoreTrace(args: {
  target: Grid;
  drawn: Grid;
  size?: number;
  tolerance?: number;
}): TraceScore {
  const size = args.size ?? GRID_SIZE;
  const tolerance = args.tolerance ?? 2;

  const targetInk = inkCount(args.target);
  const drawnInk = inkCount(args.drawn);
  if (targetInk === 0 || drawnInk === 0) {
    return { coverage: 0, overflow: 0, score: 0, verdict: "retry" };
  }

  const drawnFat = dilate(args.drawn, size, tolerance);
  const targetFat = dilate(args.target, size, tolerance);

  let covered = 0;
  let outside = 0;
  for (let i = 0; i < args.target.length; i++) {
    if (args.target[i] === 1 && drawnFat[i] === 1) covered += 1;
    if (args.drawn[i] === 1 && targetFat[i] !== 1) outside += 1;
  }

  const coverage = covered / targetInk;
  const overflow = outside / drawnInk;
  const score = clamp01(coverage * (1 - OVERFLOW_WEIGHT * overflow));

  return {
    coverage,
    overflow,
    score,
    verdict: score >= TRACE_OK ? "ok" : score >= TRACE_CLOSE ? "close" : "retry",
  };
}

/**
 * De quel côté l'enfant a-t-il commencé ?
 *
 * L'arabe s'écrit de DROITE À GAUCHE, et c'est le premier réflexe à prendre :
 * un enfant scolarisé en français commence spontanément à gauche. On le
 * REMARQUE pour pouvoir le lui dire — jamais pour baisser sa note, parce
 * qu'une lettre bien formée reste bien formée, et qu'une pénalité doublerait
 * une correction que l'enfant vient déjà de recevoir en toutes lettres.
 *
 * `null` quand le premier trait est vertical ou trop court pour trancher :
 * l'alif se trace de haut en bas, et n'a rien à dire sur le sens.
 */
export function startedFromRight(strokes: readonly Stroke[]): boolean | null {
  const first = strokes.find((stroke) => stroke.length >= 2);
  if (!first) return null;
  const start = first[0];
  const end = first[first.length - 1];
  const dx = end.x - start.x;
  if (Math.abs(dx) < 0.12) return null;
  return dx < 0;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
