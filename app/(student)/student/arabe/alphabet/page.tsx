"use client";

/**
 * L'ALPHABET EN ENTIER — l'écran où un enfant vient ÉCOUTER une lettre.
 *
 * Il double le parcours, et ce n'est pas un doublon : le parcours enseigne
 * quatre lettres à la fois et verrouille le reste ; ici, tout est ouvert,
 * rien n'est noté, rien n'est compté. C'est l'affiche de la classe — on
 * cherche le ع parce qu'on l'a oublié, on l'écoute trois fois, on repart.
 *
 * On y entend le NOM de la lettre et ses TROIS SYLLABES : une lettre arabe ne
 * se prononce pas seule, elle se prononce avec sa voyelle, et c'est بَ بِ بُ
 * qui apprend à lire, pas « bâ ».
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ARABIC_LETTERS, type ArabicLetterKey } from "@/convex/arabic/alphabet";
import { getLetter } from "@/convex/arabic/alphabet";
import { LetterCard } from "@/components/arabic/letter-card";
import { arabicCopy } from "@/lib/arabic/copy";
import { JotnaLoader } from "@/components/jotna-loader";

export default function ArabicAlphabetPage() {
  const path = useQuery(api.arabic.lessons.getPath);
  const [selected, setSelected] = useState<ArabicLetterKey>("alif");

  if (path === undefined) return <JotnaLoader />;

  if (!path.enabled) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border-2 border-amber-200 bg-white p-8 text-center shadow-sm">
        <h1 className="font-display text-xl font-extrabold text-gray-900">
          {arabicCopy.notEnabled.title}
        </h1>
        <p className="mt-2 text-base text-gray-600">
          {arabicCopy.notEnabled.body}
        </p>
      </div>
    );
  }

  const letter = getLetter(selected);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/student/arabe"
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl px-3 py-2 text-base font-bold text-teal-700 hover:bg-teal-50"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
          Parcours
        </Link>
        <h1 className="font-display text-2xl font-extrabold text-gray-900">
          Les 28 lettres
        </h1>
      </div>

      <p className="text-base text-gray-600">
        Touche une lettre pour l&apos;entendre et voir comment elle s&apos;écrit.
      </p>

      <div
        dir="rtl"
        lang="ar"
        className="grid grid-cols-4 gap-2 sm:grid-cols-7"
      >
        {ARABIC_LETTERS.map((item) => {
          const active = item.key === selected;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setSelected(item.key)}
              aria-pressed={active}
              aria-label={item.nameFr}
              className={`font-arabic flex min-h-16 items-center justify-center rounded-2xl border-2 text-3xl transition-all ${
                active
                  ? "border-teal-500 bg-teal-500 text-white shadow-md"
                  : "border-gray-200 bg-white text-gray-900 hover:border-teal-300 hover:bg-teal-50"
              }`}
            >
              {item.isolated}
            </button>
          );
        })}
      </div>

      {letter && <LetterCard letter={letter} />}
    </div>
  );
}
