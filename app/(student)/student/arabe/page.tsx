"use client";

/**
 * LE PARCOURS — la carte du module, vue par l'enfant.
 *
 * Cinq niveaux, vingt-quatre leçons, et une seule leçon ouverte à la fois
 * (`isLessonUnlocked`). Ce n'est pas une contrainte technique : on n'assemble
 * pas des lettres qu'on ne sait pas nommer, et laisser un enfant de six ans
 * choisir Al-Fātiḥa en premier écran, c'est le faire échouer.
 *
 * LE CONTENU NE VIENT PAS DU SERVEUR. Les niveaux et les leçons sont du code
 * (`convex/arabic/curriculum.ts`), donc déjà dans le paquet de cette page ;
 * la requête ne rapporte que la PROGRESSION — ce que l'enfant a terminé et
 * avec combien d'étoiles. Un aller-retour, et il ne transporte que ce qui
 * change.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { ArrowRight, Check, Lock, Sparkles, Star } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  ARABIC_LESSONS,
  ARABIC_LEVELS,
  TOTAL_LESSONS,
} from "@/convex/arabic/curriculum";
import {
  isLessonUnlocked,
  nextLessonKey,
} from "@/convex/arabic/progressRules";
import { arabicCopy } from "@/lib/arabic/copy";
import { JotnaLoader } from "@/components/jotna-loader";
import { Pio } from "@/components/student/pio";

export default function ArabePathPage() {
  const path = useQuery(api.arabic.lessons.getPath);

  const completed = useMemo(
    () =>
      new Set(
        (path?.progress ?? [])
          .filter((row) => row.status === "completed")
          .map((row) => row.lessonKey),
      ),
    [path],
  );

  const starsByLesson = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of path?.progress ?? []) map.set(row.lessonKey, row.stars);
    return map;
  }, [path]);

  if (path === undefined) return <JotnaLoader />;

  if (!path.enabled) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border-2 border-amber-200 bg-white p-8 text-center shadow-sm">
        <Pio state="idle" size={80} className="mx-auto" />
        <h1 className="font-display mt-4 text-xl font-extrabold text-gray-900">
          {arabicCopy.notEnabled.title}
        </h1>
        <p className="mt-2 text-base text-gray-600">
          {arabicCopy.notEnabled.body}
        </p>
        <Link
          href="/student/home"
          className="mt-5 inline-block rounded-2xl bg-orange-500 px-5 py-2.5 text-base font-bold text-white"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    );
  }

  const next = nextLessonKey(completed);
  const doneCount = completed.size;

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-3xl bg-gradient-to-r from-teal-500 via-emerald-500 to-green-600 p-6 text-white shadow-xl sm:p-8"
      >
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-5xl" aria-hidden>
            🕌
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-extrabold sm:text-3xl">
              {arabicCopy.moduleTitle}
            </h1>
            <p className="mt-1 text-base opacity-95">
              {arabicCopy.moduleTagline}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href={`/student/arabe/lecon/${next}`}
            className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white px-5 py-3 text-base font-extrabold text-teal-700 shadow-md hover:bg-teal-50"
          >
            {doneCount === 0 ? "Commencer" : "Continuer"}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
          <Link
            href="/student/arabe/alphabet"
            className="inline-flex min-h-12 items-center gap-2 rounded-2xl border-2 border-white/60 px-5 py-3 text-base font-bold text-white hover:bg-white/10"
          >
            <Sparkles className="h-5 w-5" aria-hidden />
            Voir tout l&apos;alphabet
          </Link>
          <span className="rounded-2xl bg-white/15 px-4 py-2 text-sm font-bold">
            {doneCount} / {TOTAL_LESSONS} leçons
          </span>
        </div>
      </motion.div>

      {ARABIC_LEVELS.map((level) => {
        const lessons = ARABIC_LESSONS.filter(
          (lesson) => lesson.levelKey === level.key,
        );
        return (
          <section key={level.key}>
            <header className="mb-3 flex items-center gap-3">
              <span className="text-3xl" aria-hidden>
                {level.emoji}
              </span>
              <div>
                <h2 className="font-display text-xl font-extrabold text-gray-900">
                  Niveau {level.order} · {level.title}
                </h2>
                <p className="text-sm font-medium text-gray-500">
                  {level.subtitleFr}
                </p>
              </div>
            </header>

            <ul className="grid gap-3 sm:grid-cols-2">
              {lessons.map((lesson) => {
                const unlocked = isLessonUnlocked(lesson.key, completed);
                const done = completed.has(lesson.key);
                const stars = starsByLesson.get(lesson.key) ?? 0;

                return (
                  <li key={lesson.key}>
                    {unlocked ? (
                      <Link
                        href={`/student/arabe/lecon/${lesson.key}`}
                        className="flex h-full items-start gap-3 rounded-3xl border-2 border-transparent bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                        style={{ borderColor: done ? level.color : undefined }}
                      >
                        <LessonBadge done={done} color={level.color} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-base font-extrabold text-gray-900">
                            {lesson.title}
                          </span>
                          <span className="mt-0.5 block text-sm text-gray-500">
                            {lesson.goalFr}
                          </span>
                          {done && <StarRow stars={stars} />}
                        </span>
                      </Link>
                    ) : (
                      <div
                        className="flex h-full items-start gap-3 rounded-3xl border-2 border-dashed border-gray-200 bg-gray-50 p-4"
                        title={arabicCopy.lockedLesson}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gray-200 text-gray-500">
                          <Lock className="h-5 w-5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-base font-extrabold text-gray-400">
                            {lesson.title}
                          </span>
                          <span className="mt-0.5 block text-sm text-gray-400">
                            {arabicCopy.lockedLesson}
                          </span>
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function LessonBadge({ done, color }: { done: boolean; color: string }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white"
      style={{ backgroundColor: done ? color : "#99f6e4" }}
    >
      {done ? (
        <Check className="h-5 w-5" aria-hidden />
      ) : (
        <ArrowRight className="h-5 w-5 text-teal-800" aria-hidden />
      )}
    </span>
  );
}

function StarRow({ stars }: { stars: number }) {
  return (
    <span
      className="mt-1.5 flex items-center gap-0.5"
      aria-label={`${stars} étoile${stars > 1 ? "s" : ""}`}
    >
      {[1, 2, 3].map((n) => (
        <Star
          key={n}
          className={`h-4 w-4 ${
            n <= stars ? "fill-amber-400 text-amber-400" : "text-gray-300"
          }`}
          aria-hidden
        />
      ))}
    </span>
  );
}
