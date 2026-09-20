"use client";

/**
 * LA CARTE D'UNE LETTRE — tout ce qu'un enfant doit voir d'elle.
 *
 * QUATRE FORMES AFFICHÉES, TOUJOURS. C'est le point que les méthodes sautent
 * le plus souvent, et celui qui bloque la lecture : un enfant qui n'a vu que
 * la forme isolée ne reconnaît pas la même lettre attachée dans un mot, et
 * croit qu'il en existe cent douze au lieu de vingt-huit.
 *
 * LES POINTS SONT DITS EN TOUTES LETTRES (« deux points au-dessus »), parce
 * que neuf groupes de lettres ne diffèrent QUE par eux et qu'un enfant les
 * regarde rarement de lui-même.
 *
 * `dir="rtl"` ET `lang="ar"` sur tout ce qui est en arabe : sans eux, un
 * navigateur peut recomposer l'ordre des glyphes, et un lecteur d'écran lit
 * de l'arabe avec une voix française.
 */

import type { ArabicLetter } from "@/convex/arabic/alphabet";
import { HARAKAT } from "@/convex/arabic/alphabet";
import { ListenButton } from "./listen-button";

const DOT_LABEL: Record<string, string> = {
  "0-none": "Aucun point",
  "1-above": "1 point au-dessus",
  "1-below": "1 point en dessous",
  "2-above": "2 points au-dessus",
  "2-below": "2 points en dessous",
  "3-above": "3 points au-dessus",
  "3-below": "3 points en dessous",
};

const FORM_LABELS = [
  { key: "isolated", label: "Seule" },
  { key: "initial", label: "Au début" },
  { key: "medial", label: "Au milieu" },
  { key: "final", label: "À la fin" },
] as const;

export function LetterCard({
  letter,
  showSyllables = true,
}: {
  letter: ArabicLetter;
  showSyllables?: boolean;
}) {
  const dots = DOT_LABEL[`${letter.dots.count}-${letter.dots.position}`] ?? "";

  return (
    <div className="space-y-5 rounded-3xl border-2 border-teal-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-5">
        <div
          dir="rtl"
          lang="ar"
          className="font-arabic flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-teal-50 text-7xl leading-none text-teal-800"
        >
          {letter.isolated}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-extrabold text-gray-900">
            {letter.nameFr}
            <span
              dir="rtl"
              lang="ar"
              className="font-arabic ml-2 text-xl text-gray-500"
            >
              {letter.nameAr}
            </span>
          </h2>
          <p className="mt-1 text-base font-semibold text-teal-700">
            Son : « {letter.soundFr} »
          </p>
          <p className="mt-0.5 text-sm font-medium text-gray-500">{dots}</p>
        </div>
      </div>

      <p className="rounded-2xl bg-amber-50 px-4 py-3 text-base font-medium text-amber-900">
        {letter.hintFr}
      </p>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
          Ses quatre formes
        </h3>
        <div className="grid grid-cols-4 gap-2">
          {FORM_LABELS.map((form) => (
            <div
              key={form.key}
              className="rounded-2xl border border-gray-200 bg-gray-50 p-2 text-center"
            >
              <div
                dir="rtl"
                lang="ar"
                className="font-arabic text-4xl leading-tight text-gray-900"
              >
                {letter[form.key]}
              </div>
              <div className="mt-1 text-[11px] font-semibold text-gray-500">
                {form.label}
              </div>
            </div>
          ))}
        </div>
        {!letter.connectsToNext && (
          <p className="mt-2 text-sm font-medium text-gray-500">
            ⚠️ Cette lettre n&apos;attache jamais la lettre suivante.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ListenButton
          speechRef={{ kind: "letterName", letterKey: letter.key }}
          label="Son nom"
        />
        {showSyllables &&
          HARAKAT.map((haraka) => (
            <ListenButton
              key={haraka.key}
              variant="chip"
              speechRef={{
                kind: "letterSyllable",
                letterKey: letter.key,
                haraka: haraka.key,
              }}
              label={`${letter.syllables[haraka.key]} — « ${letter.soundFr}${haraka.soundFr} »`}
            />
          ))}
      </div>
    </div>
  );
}
