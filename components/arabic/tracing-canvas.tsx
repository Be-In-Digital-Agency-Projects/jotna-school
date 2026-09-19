"use client";

/**
 * LE CARRÉ D'ÉCRITURE — l'enfant trace la lettre au doigt, et on la note.
 *
 * COMMENT LE MODÈLE EST OBTENU : on dessine la lettre dans un canevas hors
 * écran avec la police arabe de la page, on lit son canal alpha, et on le
 * réduit en grille (`alphaToGrid`). Le modèle vient donc de la POLICE, pas
 * d'un tracé saisi à la main pour chacune des vingt-huit lettres — une donnée
 * qui n'existe nulle part et qu'il faudrait maintenir.
 *
 * DEUX CANEVAS, ET C'EST NÉCESSAIRE : celui qu'on voit (avec le guide pâle et
 * le trait de l'enfant) est dessiné à la résolution de l'écran ; celui qui
 * SERT À NOTER est un carré fixe, sans guide ni décor, pour que la note d'un
 * enfant sur un téléphone soit la même que sur une tablette.
 *
 * LA NOTE EST CALCULÉE ICI, sur l'appareil — seul le navigateur a la police.
 * Elle n'est donc pas une preuve, et rien d'important n'en dépend : voir
 * l'en-tête de `lib/arabic/tracing.ts` et le champ `arabicAttempts.source`.
 *
 * UNE LETTRE, UN CARRÉ VIERGE : l'appelant donne au composant une `key` qui
 * change avec la lettre, et React le remonte à neuf. C'est plus sûr qu'un
 * effet de remise à zéro, qui laisserait le trait précédent visible le temps
 * d'un rendu — sous une AUTRE lettre.
 *
 * ACCESSIBILITÉ : le tracé au doigt ne peut pas être fait au clavier. Le
 * bouton « je passe » n'est donc pas une facilité, c'est la sortie de secours
 * d'un enfant qui ne peut pas tracer — il passe à la suite sans être bloqué,
 * et sans note.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";
import {
  alphaToGrid,
  GRID_SIZE,
  scoreTrace,
  startedFromRight,
  strokesToGrid,
  type Stroke,
  type TracePoint,
  type TraceVerdict,
} from "@/lib/arabic/tracing";
import { arabicCopy } from "@/lib/arabic/copy";

/** Côté du canevas de NOTATION, en pixels. Fixe, donc note reproductible. */
const SCORE_CANVAS = 192;

/** Rayon du doigt sur la grille d'analyse, en cases. */
const BRUSH_CELLS = 1;

export interface TraceOutcome {
  score: number;
  verdict: TraceVerdict;
  startedRight: boolean | null;
}

export function TracingCanvas({
  glyph,
  onValidate,
}: {
  /** La lettre à tracer, dans la forme qu'on demande (isolée en général). */
  glyph: string;
  onValidate: (outcome: TraceOutcome) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<TracePoint[]>([]);
  const [hasInk, setHasInk] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [fontReady, setFontReady] = useState(false);

  // La police arabe arrive après le premier rendu : sans cette attente, le
  // guide serait dessiné dans la police de repli, et le modèle de notation
  // ne serait pas la lettre qu'on montre.
  useEffect(() => {
    let cancelled = false;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    // Toujours au travers d'une promesse, même quand il n'y a rien à
    // attendre : un `setState` synchrone dans un effet relance un rendu en
    // cascade, et la règle `react-hooks/set-state-in-effect` le refuse.
    void (fonts ? fonts.ready : Promise.resolve()).then(() => {
      if (!cancelled) setFontReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** La famille de police arabe, telle que la feuille de style la définit. */
  const arabicFont = useCallback((): string => {
    if (typeof window === "undefined") return "serif";
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-arabic")
      .trim();
    return value.length > 0 ? `${value}, serif` : "serif";
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    const size = canvas.clientWidth;
    if (canvas.width !== size * ratio) {
      canvas.width = size * ratio;
      canvas.height = size * ratio;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Le guide : la lettre en pâle, et les repères de la ligne d'écriture.
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, size * 0.72);
    ctx.lineTo(size, size * 0.72);
    ctx.stroke();

    ctx.fillStyle = "#d9f2ec";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(size * 0.62)}px ${arabicFont()}`;
    ctx.fillText(glyph, size / 2, size / 2);

    // Le tracé de l'enfant.
    ctx.strokeStyle = "#0f766e";
    ctx.lineWidth = Math.max(8, size * 0.05);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of [...strokesRef.current, currentRef.current]) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * size, stroke[0].y * size);
      for (const point of stroke.slice(1)) {
        ctx.lineTo(point.x * size, point.y * size);
      }
      if (stroke.length === 1) {
        ctx.lineTo(stroke[0].x * size + 0.1, stroke[0].y * size + 0.1);
      }
      ctx.stroke();
    }
  }, [arabicFont, glyph]);

  // Redessine quand la police arrive : le guide serait sinon tracé dans la
  // police de repli. Aucun état n'est touché ici — la remise à neuf du carré
  // se fait par la `key` que l'appelant donne au composant.
  useEffect(() => {
    redraw();
  }, [redraw, fontReady]);

  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redraw]);

  const pointFrom = (event: React.PointerEvent<HTMLCanvasElement>): TracePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  const handleDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    currentRef.current = [pointFrom(event)];
    setHasInk(true);
    redraw();
  };

  const handleMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (currentRef.current.length === 0) return;
    currentRef.current.push(pointFrom(event));
    redraw();
  };

  const handleUp = () => {
    if (currentRef.current.length > 0) {
      strokesRef.current = [...strokesRef.current, currentRef.current];
      currentRef.current = [];
      redraw();
    }
  };

  const clear = () => {
    strokesRef.current = [];
    currentRef.current = [];
    setHasInk(false);
    setHint(null);
    redraw();
  };

  const validate = () => {
    if (strokesRef.current.length === 0) {
      setHint(arabicCopy.write.empty);
      return;
    }

    const target = rasterizeGlyph(glyph, arabicFont());
    if (!target) {
      // Sans canevas hors écran (navigateur exotique), on ne note pas plutôt
      // que de noter faux : l'enfant a écrit, on le crédite sans note.
      onValidate({ score: 1, verdict: "ok", startedRight: null });
      return;
    }

    const drawn = strokesToGrid(strokesRef.current, GRID_SIZE, BRUSH_CELLS);
    const result = scoreTrace({ target, drawn, size: GRID_SIZE, tolerance: 3 });
    const startedRight = startedFromRight(strokesRef.current);

    if (startedRight === false) setHint(arabicCopy.write.wrongDirection);
    onValidate({
      score: result.score,
      verdict: result.verdict,
      startedRight,
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-center text-base font-semibold text-gray-700">
        {arabicCopy.write.instruction}
      </p>

      <canvas
        ref={canvasRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onPointerLeave={handleUp}
        aria-label={`Carré d'écriture pour la lettre ${glyph}`}
        className="mx-auto block aspect-square w-full max-w-xs touch-none rounded-3xl border-4 border-dashed border-teal-200 bg-white shadow-inner"
      />

      {hint && (
        <p className="rounded-2xl bg-amber-50 px-4 py-2 text-center text-sm font-semibold text-amber-800">
          {hint}
        </p>
      )}

      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={clear}
          className="inline-flex min-h-12 items-center gap-2 rounded-2xl border-2 border-gray-200 bg-white px-4 py-2.5 text-base font-bold text-gray-600 hover:border-gray-300"
        >
          <Eraser className="h-5 w-5" aria-hidden />
          {arabicCopy.write.clear}
        </button>
        <button
          type="button"
          onClick={validate}
          disabled={!hasInk}
          className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-teal-600 px-6 py-2.5 text-base font-extrabold text-white shadow-md shadow-teal-200 hover:bg-teal-700 disabled:opacity-50"
        >
          <PenLine className="h-5 w-5" aria-hidden />
          {arabicCopy.write.validate}
        </button>
      </div>
    </div>
  );
}

/**
 * Dessine la lettre hors écran et rend sa grille — le MODÈLE de notation.
 *
 * Résultat mis en cache : la même lettre revient à chaque validation, et
 * rasteriser coûte un canevas et une lecture de pixels.
 */
const targetCache = new Map<string, Uint8Array | null>();

function rasterizeGlyph(glyph: string, font: string): Uint8Array | null {
  const cacheKey = `${glyph}|${font}`;
  const cached = targetCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let grid: Uint8Array | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SCORE_CANVAS;
    canvas.height = SCORE_CANVAS;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.clearRect(0, 0, SCORE_CANVAS, SCORE_CANVAS);
      ctx.fillStyle = "#000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.round(SCORE_CANVAS * 0.62)}px ${font}`;
      ctx.fillText(glyph, SCORE_CANVAS / 2, SCORE_CANVAS / 2);

      const image = ctx.getImageData(0, 0, SCORE_CANVAS, SCORE_CANVAS);
      const alpha = new Uint8Array(SCORE_CANVAS * SCORE_CANVAS);
      for (let i = 0; i < alpha.length; i++) alpha[i] = image.data[i * 4 + 3];
      grid = alphaToGrid(alpha, SCORE_CANVAS, SCORE_CANVAS, GRID_SIZE);
    }
  } catch {
    grid = null;
  }

  targetCache.set(cacheKey, grid);
  return grid;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
