"use client";

/**
 * LA SÉANCE — une leçon, du premier écoute au dernier tracé.
 *
 * CETTE PAGE NE DÉCIDE DE RIEN. La suite des exercices vient de
 * `buildSession` (`lib/arabic/session.ts`), les règles d'étoiles du serveur,
 * le contenu du curriculum. Elle déroule, elle affiche, elle enregistre —
 * c'est ce qui permet de tester la pédagogie sans ouvrir un navigateur.
 *
 * QUI ENREGISTRE QUOI, ET POURQUOI C'EST SÉPARÉ :
 *   - les exercices jugés SUR L'APPAREIL (QCM, points, formes, tracé) passent
 *     par `recordAttempt`, qui marque la tentative « device » ;
 *   - la PRONONCIATION est enregistrée par l'action qui a entendu l'enfant
 *     (`arabic.voice.verifyPronunciation`), côté serveur, et cette page n'y
 *     touche pas. Enregistrer ici en plus compterait chaque répétition deux
 *     fois et fausserait la note.
 *
 * ON NE BLOQUE JAMAIS UN ENFANT. Chaque étape a sa sortie (« Passer ») :
 * micro refusé, écran qui ne prend pas le doigt, lettre qui ne vient pas ce
 * jour-là. Passer ne coûte rien de plus qu'une étoile en moins, et laisser un
 * enfant coincé sur une lettre lui ferait quitter le module, pas apprendre le ع.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { ArrowRight, Check, Star, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { getLetter } from "@/convex/arabic/alphabet";
import { ARABIC_LESSONS, getLesson } from "@/convex/arabic/curriculum";
import { isLessonUnlocked } from "@/convex/arabic/progressRules";
import {
  buildSession,
  drillOf,
  seedFromKey,
  type SessionStep,
} from "@/lib/arabic/session";
import { arabicCopy } from "@/lib/arabic/copy";
import { LetterCard } from "@/components/arabic/letter-card";
import { ListenButton } from "@/components/arabic/listen-button";
import { RecordButton } from "@/components/arabic/record-button";
import { TracingCanvas } from "@/components/arabic/tracing-canvas";
import {
  DotsDrill,
  FormsDrill,
  RecognizeGlyphDrill,
  RecognizeNameDrill,
} from "@/components/arabic/drills";
import { JotnaLoader } from "@/components/jotna-loader";
import { Pio } from "@/components/student/pio";

export default function ArabicLessonPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key: lessonKey } = use(params);
  const lesson = getLesson(lessonKey);

  const path = useQuery(api.arabic.lessons.getPath);
  // L'état de CETTE leçon : ce qu'elle vaut déjà. Un enfant qui révise doit
  // voir ce qu'il avait obtenu, sinon refaire une leçon ressemble à la
  // découvrir — et la surprise de perdre ses étoiles n'existe pas, `completeLesson`
  // ne redescend jamais.
  const state = useQuery(api.arabic.lessons.getLessonState, { lessonKey });
  const recordAttempt = useMutation(api.arabic.lessons.recordAttempt);
  const completeLesson = useMutation(api.arabic.lessons.completeLesson);

  const steps = useMemo(() => (lesson ? buildSession(lesson) : []), [lesson]);
  const [index, setIndex] = useState(0);
  const [stepDone, setStepDone] = useState(false);
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<{ stars: number; score: number } | null>(
    null,
  );
  const completing = useRef(false);

  const step = steps[index];
  const atEnd = steps.length > 0 && index >= steps.length;

  // La clôture part d'elle-même à la dernière étape : demander un clic de plus
  // à un enfant qui vient de finir, c'est risquer qu'il ferme l'onglet avant
  // d'avoir ses étoiles.
  useEffect(() => {
    if (!atEnd || completing.current || !lesson) return;
    completing.current = true;
    void completeLesson({ lessonKey })
      .then((outcome) => setResult(outcome))
      // Un échec de clôture ne doit pas laisser un écran vide : les tentatives
      // sont déjà écrites, l'enfant a travaillé, on le lui dit.
      .catch(() => setResult({ stars: 1, score: 0 }));
  }, [atEnd, completeLesson, lesson, lessonKey]);

  const advance = useCallback(() => {
    setStepDone(false);
    setTries(0);
    setIndex((current) => current + 1);
  }, []);

  const onDeviceAnswer = useCallback(
    async (
      current: SessionStep,
      correct: boolean,
      score?: number,
      verdict?: "ok" | "close" | "retry",
    ) => {
      setStepDone(true);
      const drill = drillOf(current);
      if (!drill) return;
      try {
        await recordAttempt({
          lessonKey,
          drill,
          itemKey: current.itemKey,
          correct,
          ...(score !== undefined ? { score } : {}),
          ...(verdict !== undefined ? { verdict } : {}),
        });
      } catch {
        // Une tentative perdue coûte une fraction d'étoile, pas la séance :
        // on n'interrompt pas un enfant pour un aller-retour raté.
      }
    },
    [lessonKey, recordAttempt],
  );

  if (!lesson) return <NotFound />;
  if (path === undefined) return <JotnaLoader />;

  if (!path.enabled) {
    return (
      <Centered title={arabicCopy.notEnabled.title}>
        {arabicCopy.notEnabled.body}
      </Centered>
    );
  }

  const completed = new Set(
    path.progress.filter((row) => row.status === "completed").map((r) => r.lessonKey),
  );
  if (!isLessonUnlocked(lessonKey, completed)) {
    return (
      <Centered title="Cette leçon n'est pas encore ouverte">
        {arabicCopy.lockedLesson}
      </Centered>
    );
  }

  if (result) {
    return <LessonSummary lessonKey={lessonKey} stars={result.stars} />;
  }

  if (!step) return <JotnaLoader />;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col gap-5">
      <header className="flex items-center gap-3">
        <Link
          href="/student/arabe"
          aria-label="Quitter la leçon"
          className="flex h-11 w-11 items-center justify-center rounded-2xl text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-6 w-6" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-gray-500">
            {lesson.title}
            {state?.status === "completed" && state.stars > 0 && (
              <span
                className="ml-2 font-normal text-amber-500"
                aria-label={`Déjà réussie avec ${state.stars} étoile${state.stars > 1 ? "s" : ""}`}
              >
                {"⭐".repeat(state.stars)}
              </span>
            )}
          </p>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
            <motion.div
              className="h-full rounded-full bg-teal-500"
              initial={false}
              animate={{ width: `${(index / steps.length) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
        <span className="shrink-0 text-sm font-bold text-gray-500">
          {index + 1}/{steps.length}
        </span>
      </header>

      <main className="flex-1">
        <StepView
          step={step}
          lessonKey={lessonKey}
          tries={tries}
          onDeviceAnswer={onDeviceAnswer}
          onVoiceOutcome={() => {
            setTries((n) => n + 1);
            setStepDone(true);
          }}
        />
      </main>

      <footer className="sticky bottom-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={advance}
          className={`inline-flex min-h-14 items-center gap-2 rounded-3xl px-7 py-3 text-lg font-extrabold shadow-lg transition-all ${
            stepDone
              ? "bg-teal-600 text-white shadow-teal-200 hover:bg-teal-700"
              : "border-2 border-gray-200 bg-white text-gray-500 hover:border-gray-300"
          }`}
        >
          {stepDone ? "Suivant" : "Passer"}
          <ArrowRight className="h-5 w-5" aria-hidden />
        </button>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepView({
  step,
  lessonKey,
  tries,
  onDeviceAnswer,
  onVoiceOutcome,
}: {
  step: SessionStep;
  lessonKey: string;
  tries: number;
  onDeviceAnswer: (
    step: SessionStep,
    correct: boolean,
    score?: number,
    verdict?: "ok" | "close" | "retry",
  ) => void;
  onVoiceOutcome: () => void;
}) {
  const lesson = getLesson(lessonKey);
  const seed = seedFromKey(`${lessonKey}:${step.itemKey}`);

  switch (step.kind) {
    case "discoverLetter": {
      const letter = getLetter(step.itemKey);
      return letter ? <LetterCard letter={letter} /> : null;
    }

    case "recognizeGlyph":
      return (
        <RecognizeGlyphDrill
          letterKey={step.itemKey}
          options={step.options}
          onAnswer={(correct) => onDeviceAnswer(step, correct)}
        />
      );

    case "recognizeName":
      return (
        <RecognizeNameDrill
          letterKey={step.itemKey}
          options={step.options}
          onAnswer={(correct) => onDeviceAnswer(step, correct)}
        />
      );

    case "dots":
      return (
        <DotsDrill
          letterKey={step.itemKey}
          options={step.options}
          onAnswer={(correct) => onDeviceAnswer(step, correct)}
        />
      );

    case "forms":
      return (
        <FormsDrill
          letterKey={step.itemKey}
          options={step.options}
          seed={seed}
          onAnswer={(correct) => onDeviceAnswer(step, correct)}
        />
      );

    case "pronounce": {
      const letter = getLetter(step.itemKey);
      if (!letter) return null;
      return (
        <div className="space-y-5 text-center">
          <h2 className="font-display text-xl font-extrabold text-gray-900">
            Écoute, puis répète
          </h2>
          <div
            dir="rtl"
            lang="ar"
            className="font-arabic mx-auto flex h-36 w-36 items-center justify-center rounded-3xl bg-teal-50 text-8xl leading-none text-teal-800"
          >
            {letter.isolated}
          </div>
          <p className="text-base font-semibold text-gray-600">
            {letter.hintFr}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <ListenButton
              speechRef={{ kind: "letterName", letterKey: letter.key }}
              label="Écouter le nom"
            />
            <ListenButton
              variant="chip"
              speechRef={{
                kind: "letterSyllable",
                letterKey: letter.key,
                haraka: "fatha",
              }}
              label={letter.syllables.fatha}
            />
          </div>
          <RecordButton
            key={`${lessonKey}:${step.itemKey}:pronounce`}
            lessonKey={lessonKey}
            itemKey={step.itemKey}
            drill="pronounce"
            attemptIndex={tries}
            onOutcome={onVoiceOutcome}
          />
        </div>
      );
    }

    case "write": {
      const letter = getLetter(step.itemKey);
      if (!letter) return null;
      return (
        <div className="space-y-4">
          <h2 className="font-display text-center text-xl font-extrabold text-gray-900">
            Écris la lettre {letter.nameFr}
          </h2>
          <div className="flex justify-center">
            <ListenButton
              variant="chip"
              speechRef={{ kind: "letterName", letterKey: letter.key }}
              label="Réécouter"
            />
          </div>
          <TracingCanvas
            key={`${lessonKey}:${step.itemKey}:write`}
            glyph={letter.isolated}
            onValidate={(outcome) =>
              onDeviceAnswer(
                step,
                outcome.verdict !== "retry",
                outcome.score,
                outcome.verdict,
              )
            }
          />
        </div>
      );
    }

    case "discoverItem":
    case "read": {
      const item = lesson?.items.find((entry) => entry.key === step.itemKey);
      if (!item) return null;
      const isQuran = lesson?.kind === "coran";
      return (
        <div className="space-y-5 text-center">
          <h2 className="font-display text-xl font-extrabold text-gray-900">
            {step.kind === "read" ? "À toi de lire" : "Écoute bien"}
          </h2>
          {isQuran && (
            <p className="text-sm font-medium text-gray-500">
              {arabicCopy.quranNote}
            </p>
          )}
          <p
            dir="rtl"
            lang="ar"
            className="font-arabic rounded-3xl bg-white px-5 py-8 text-4xl leading-[1.9] text-gray-900 shadow-sm sm:text-5xl"
          >
            {item.ar}
          </p>
          {item.translit && (
            <p className="text-lg font-bold text-teal-700">{item.translit}</p>
          )}
          {item.fr && (
            <p className="text-base font-medium text-gray-500">{item.fr}</p>
          )}
          <ListenButton
            speechRef={{ kind: "lessonItem", lessonKey, itemKey: item.key }}
            className="mx-auto"
          />
          {step.kind === "read" && (
            <RecordButton
              key={`${lessonKey}:${item.key}:read`}
              lessonKey={lessonKey}
              itemKey={item.key}
              drill="read"
              attemptIndex={tries}
              onOutcome={onVoiceOutcome}
            />
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

function LessonSummary({
  lessonKey,
  stars,
}: {
  lessonKey: string;
  stars: number;
}) {
  const current = ARABIC_LESSONS.findIndex((item) => item.key === lessonKey);
  const next = current >= 0 ? ARABIC_LESSONS[current + 1] : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow-xl"
    >
      <Pio state="cheer" size={96} className="mx-auto" />
      <h1 className="font-display mt-4 text-2xl font-extrabold text-gray-900">
        {arabicCopy.lessonDone.title(stars)}
      </h1>
      <div className="mt-3 flex justify-center gap-1">
        {[1, 2, 3].map((n) => (
          <Star
            key={n}
            className={`h-8 w-8 ${
              n <= stars ? "fill-amber-400 text-amber-400" : "text-gray-200"
            }`}
            aria-hidden
          />
        ))}
      </div>
      <p className="mt-3 text-base text-gray-600">{arabicCopy.lessonDone.body}</p>

      <div className="mt-6 flex flex-col gap-2">
        {next && (
          <Link
            href={`/student/arabe/lecon/${next.key}`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-teal-600 px-6 py-3 text-base font-extrabold text-white shadow-md hover:bg-teal-700"
          >
            {arabicCopy.lessonDone.next}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        )}
        <Link
          href="/student/arabe"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-gray-200 px-6 py-3 text-base font-bold text-gray-600 hover:border-gray-300"
        >
          <Check className="h-5 w-5" aria-hidden />
          {arabicCopy.lessonDone.back}
        </Link>
      </div>
    </motion.div>
  );
}

function Centered({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md rounded-3xl border-2 border-amber-200 bg-white p-8 text-center shadow-sm">
      <h1 className="font-display text-xl font-extrabold text-gray-900">
        {title}
      </h1>
      <p className="mt-2 text-base text-gray-600">{children}</p>
      <Link
        href="/student/arabe"
        className="mt-5 inline-block rounded-2xl bg-teal-600 px-5 py-2.5 text-base font-bold text-white"
      >
        Retour au parcours
      </Link>
    </div>
  );
}

function NotFound() {
  return (
    <Centered title="Leçon introuvable">
      Cette leçon n&apos;existe pas (ou plus). Reviens au parcours pour choisir
      la suivante.
    </Centered>
  );
}
