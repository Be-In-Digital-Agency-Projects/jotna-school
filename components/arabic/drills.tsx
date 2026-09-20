"use client";

/**
 * LES EXERCICES DE RECONNAISSANCE — quatre familles, un seul squelette.
 *
 * TOUTES POSENT LA MÊME QUESTION SOUS UN ANGLE DIFFÉRENT : « sais-tu que ce
 * dessin est CETTE lettre ? ». Les séparer a un intérêt pédagogique précis,
 * parce qu'un enfant peut réussir l'une et échouer l'autre :
 *
 *   - `RecognizeGlyphDrill` — il ENTEND le nom et doit montrer la lettre.
 *     C'est l'exercice de la dictée : l'oreille commande l'œil ;
 *   - `RecognizeNameDrill` — il VOIT la lettre et doit la nommer. C'est
 *     l'exercice de la lecture, l'inverse du précédent ;
 *   - `DotsDrill` — il compte les points. Neuf groupes de lettres ne
 *     diffèrent que par eux (ب ت ث, ج ح خ, د ذ…), et un enfant qui les
 *     confond ne confond pas deux dessins : il n'a pas encore regardé ;
 *   - `FormsDrill` — il reconnaît la lettre ATTACHÉE, au début, au milieu ou
 *     à la fin d'un mot. Sans cet exercice, l'alphabet est su et la lecture
 *     reste impossible.
 *
 * LES LEURRES NE SONT PAS TIRÉS AU HASARD : `lib/arabic/session.ts` les
 * choisit parmi les lettres qui SE CONFONDENT avec la bonne et que l'enfant a
 * déjà vues. Proposer م, ع, ي quand on demande ت, c'est une question qu'on
 * réussit sans savoir lire.
 *
 * LE RETOUR EST IMMÉDIAT ET DOUX : on montre la bonne réponse, on ne barre
 * rien, et l'enfant avance. La note est déjà prise (`onAnswer`).
 */

import { useState } from "react";
import { Check } from "lucide-react";
import { getLetter, type ArabicLetterKey } from "@/convex/arabic/alphabet";
import { ListenButton } from "./listen-button";

interface DrillProps {
  onAnswer: (correct: boolean) => void;
}

/** Grille de choix — deux colonnes, cibles larges (WCAG 2.5.5). */
function ChoiceGrid({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="grid grid-cols-2 gap-3 sm:gap-4">{children}</div>;
}

function ChoiceButton({
  onClick,
  state,
  children,
  ariaLabel,
}: {
  onClick: () => void;
  state: "idle" | "correct" | "wrong" | "revealed";
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const styles =
    state === "correct"
      ? "border-green-400 bg-green-50 text-green-900"
      : state === "wrong"
        ? "border-red-300 bg-red-50 text-red-900"
        : state === "revealed"
          ? "border-green-300 bg-green-50/60 text-green-800"
          : "border-gray-200 bg-white text-gray-900 hover:border-teal-300 hover:bg-teal-50";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`flex min-h-24 items-center justify-center rounded-3xl border-3 px-4 py-4 text-center transition-all ${styles}`}
    >
      {children}
      {state === "correct" && (
        <Check className="ml-2 h-6 w-6 text-green-600" aria-hidden />
      )}
    </button>
  );
}

/** État partagé : une réponse, puis plus rien — on ne repique pas deux fois. */
function useAnswerOnce(onAnswer: (correct: boolean) => void) {
  const [picked, setPicked] = useState<string | number | null>(null);
  const answer = (value: string | number, correct: boolean) => {
    if (picked !== null) return;
    setPicked(value);
    onAnswer(correct);
  };
  return { picked, answer, answered: picked !== null };
}

function stateFor(
  value: string | number,
  picked: string | number | null,
  correctValue: string | number,
): "idle" | "correct" | "wrong" | "revealed" {
  if (picked === null) return "idle";
  if (value === picked) return value === correctValue ? "correct" : "wrong";
  return value === correctValue ? "revealed" : "idle";
}

// ---------------------------------------------------------------------------

export function RecognizeGlyphDrill({
  letterKey,
  options,
  onAnswer,
}: DrillProps & { letterKey: ArabicLetterKey; options: ArabicLetterKey[] }) {
  const { picked, answer } = useAnswerOnce(onAnswer);
  const letter = getLetter(letterKey);
  if (!letter) return null;

  return (
    <div className="space-y-5">
      <div className="space-y-3 text-center">
        <h2 className="font-display text-xl font-extrabold text-gray-900">
          Écoute, puis montre la bonne lettre
        </h2>
        <ListenButton
          speechRef={{ kind: "letterName", letterKey }}
          label="Écouter la lettre"
          className="mx-auto"
        />
      </div>

      <ChoiceGrid>
        {options.map((key) => {
          const option = getLetter(key);
          if (!option) return null;
          return (
            <ChoiceButton
              key={key}
              ariaLabel={option.nameFr}
              onClick={() => answer(key, key === letterKey)}
              state={stateFor(key, picked, letterKey)}
            >
              <span
                dir="rtl"
                lang="ar"
                className="font-arabic text-5xl leading-none"
              >
                {option.isolated}
              </span>
            </ChoiceButton>
          );
        })}
      </ChoiceGrid>
    </div>
  );
}

export function RecognizeNameDrill({
  letterKey,
  options,
  onAnswer,
}: DrillProps & { letterKey: ArabicLetterKey; options: ArabicLetterKey[] }) {
  const { picked, answer } = useAnswerOnce(onAnswer);
  const letter = getLetter(letterKey);
  if (!letter) return null;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="font-display text-xl font-extrabold text-gray-900">
          Comment s&apos;appelle cette lettre ?
        </h2>
        <div
          dir="rtl"
          lang="ar"
          className="font-arabic mx-auto mt-3 flex h-32 w-32 items-center justify-center rounded-3xl bg-teal-50 text-7xl leading-none text-teal-800"
        >
          {letter.isolated}
        </div>
      </div>

      <ChoiceGrid>
        {options.map((key) => {
          const option = getLetter(key);
          if (!option) return null;
          return (
            <ChoiceButton
              key={key}
              onClick={() => answer(key, key === letterKey)}
              state={stateFor(key, picked, letterKey)}
            >
              <span className="text-lg font-extrabold">{option.nameFr}</span>
            </ChoiceButton>
          );
        })}
      </ChoiceGrid>
    </div>
  );
}

export function DotsDrill({
  letterKey,
  options,
  onAnswer,
}: DrillProps & { letterKey: ArabicLetterKey; options: number[] }) {
  const { picked, answer, answered } = useAnswerOnce(onAnswer);
  const letter = getLetter(letterKey);
  if (!letter) return null;

  const correct = letter.dots.count;
  const where =
    letter.dots.position === "above"
      ? "au-dessus"
      : letter.dots.position === "below"
        ? "en dessous"
        : "";

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="font-display text-xl font-extrabold text-gray-900">
          Combien de points a cette lettre ?
        </h2>
        <div
          dir="rtl"
          lang="ar"
          className="font-arabic mx-auto mt-3 flex h-32 w-32 items-center justify-center rounded-3xl bg-teal-50 text-7xl leading-none text-teal-800"
        >
          {letter.isolated}
        </div>
      </div>

      <ChoiceGrid>
        {options.map((count) => (
          <ChoiceButton
            key={count}
            onClick={() => answer(count, count === correct)}
            state={stateFor(count, picked, correct)}
          >
            <span className="text-2xl font-extrabold">
              {count === 0 ? "Aucun" : count}
            </span>
          </ChoiceButton>
        ))}
      </ChoiceGrid>

      {answered && where && (
        <p className="text-center text-base font-semibold text-teal-800">
          {correct === 1 ? "Un point" : `${correct} points`} {where}.
        </p>
      )}
    </div>
  );
}

export function FormsDrill({
  letterKey,
  options,
  onAnswer,
  seed,
}: DrillProps & {
  letterKey: ArabicLetterKey;
  options: ArabicLetterKey[];
  seed: number;
}) {
  const { picked, answer } = useAnswerOnce(onAnswer);
  const letter = getLetter(letterKey);
  if (!letter) return null;

  // La forme montrée dépend de la graine, donc elle ne change pas quand
  // l'enfant recharge la page au milieu de sa séance.
  const forms = [
    { glyph: letter.initial, label: "au DÉBUT d'un mot" },
    { glyph: letter.medial, label: "au MILIEU d'un mot" },
    { glyph: letter.final, label: "à la FIN d'un mot" },
  ];
  const shown = forms[seed % forms.length];

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="font-display text-xl font-extrabold text-gray-900">
          Quelle lettre est-ce, {shown.label} ?
        </h2>
        <div
          dir="rtl"
          lang="ar"
          className="font-arabic mx-auto mt-3 flex h-32 w-full max-w-xs items-center justify-center rounded-3xl bg-amber-50 text-6xl leading-none text-amber-900"
        >
          {shown.glyph}
        </div>
      </div>

      <ChoiceGrid>
        {options.map((key) => {
          const option = getLetter(key);
          if (!option) return null;
          return (
            <ChoiceButton
              key={key}
              onClick={() => answer(key, key === letterKey)}
              state={stateFor(key, picked, letterKey)}
            >
              <span className="flex flex-col items-center gap-1">
                <span
                  dir="rtl"
                  lang="ar"
                  className="font-arabic text-4xl leading-none"
                >
                  {option.isolated}
                </span>
                <span className="text-sm font-bold text-gray-500">
                  {option.nameFr}
                </span>
              </span>
            </ChoiceButton>
          );
        })}
      </ChoiceGrid>
    </div>
  );
}
