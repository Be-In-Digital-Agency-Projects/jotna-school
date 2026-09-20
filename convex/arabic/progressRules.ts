/**
 * LES RÈGLES DE PROGRESSION — déverrouillage et étoiles.
 *
 * PUR, DONC PARTAGÉ. L'écran a besoin de savoir quelles leçons sont ouvertes
 * pour dessiner le parcours ; le serveur a besoin de la même réponse pour
 * accorder des étoiles. Une règle écrite deux fois est une règle qui finit par
 * dire deux choses — ici elle est écrite une fois, et testée
 * (`convex/__tests__/arabic.test.ts`).
 */

import { ARABIC_LESSONS } from "./curriculum";

/**
 * Une leçon est ouverte si celle qui la précède est terminée.
 *
 * SÉQUENTIEL, ET C'EST LE SUJET : on n'assemble pas des lettres qu'on ne sait
 * pas nommer, et on ne lit pas un verset avant de savoir assembler. Ouvrir
 * tout d'emblée laisserait un enfant de six ans choisir Al-Fātiḥa en premier
 * écran, échouer, et conclure qu'il n'y arrive pas.
 *
 * LA PREMIÈRE LEÇON EST TOUJOURS OUVERTE — sans quoi rien ne commence jamais.
 *
 * UNE LEÇON DÉJÀ TERMINÉE RESTE OUVERTE, évidemment : on révise l'alphabet
 * toute l'année, et une leçon qui se referme derrière l'enfant serait une
 * punition pour avoir avancé.
 */
export function isLessonUnlocked(
  lessonKey: string,
  completedKeys: ReadonlySet<string>,
): boolean {
  const index = ARABIC_LESSONS.findIndex((lesson) => lesson.key === lessonKey);
  if (index < 0) return false;
  if (index === 0) return true;
  if (completedKeys.has(lessonKey)) return true;
  return completedKeys.has(ARABIC_LESSONS[index - 1].key);
}

/** La première leçon ouverte et non terminée — le bouton « Continuer ». */
export function nextLessonKey(completedKeys: ReadonlySet<string>): string {
  for (const lesson of ARABIC_LESSONS) {
    if (completedKeys.has(lesson.key)) continue;
    if (isLessonUnlocked(lesson.key, completedKeys)) return lesson.key;
  }
  // Tout est terminé : on renvoie la dernière, pour que « Continuer » mène à
  // une révision plutôt qu'à rien.
  return ARABIC_LESSONS[ARABIC_LESSONS.length - 1].key;
}

/** Ce qu'une tentative vaut, de 0 à 1. */
export interface AttemptValue {
  drill: string;
  itemKey: string;
  correct: boolean;
  score?: number;
}

/**
 * La note d'une leçon : la MEILLEURE tentative de chaque exercice, moyennée.
 *
 * LE MEILLEUR ESSAI, PAS LA MOYENNE DES ESSAIS. Un enfant qui rate trois fois
 * le ع puis le réussit a APPRIS le ع — c'est exactement ce que le module veut
 * obtenir. Moyenner les échecs punirait l'entraînement, donc découragerait de
 * réessayer, qui est tout ce qu'on lui demande de faire.
 *
 * Un exercice est identifié par (famille, item) : prononcer ب et écrire ب sont
 * deux apprentissages, ils comptent deux fois.
 */
export function lessonScore(attempts: readonly AttemptValue[]): number {
  if (attempts.length === 0) return 0;

  const best = new Map<string, number>();
  for (const attempt of attempts) {
    const key = `${attempt.drill}:${attempt.itemKey}`;
    const value =
      typeof attempt.score === "number"
        ? clamp01(attempt.score)
        : attempt.correct
          ? 1
          : 0;
    const current = best.get(key);
    if (current === undefined || value > current) best.set(key, value);
  }

  let total = 0;
  for (const value of best.values()) total += value;
  return total / best.size;
}

/**
 * Les étoiles d'une leçon, de 1 à 3.
 *
 * JAMAIS ZÉRO POUR QUI A TERMINÉ. Une leçon finie vaut au moins une étoile :
 * l'enfant a écouté, répété, tracé. Le zéro est réservé à ce qui n'a pas été
 * commencé, et c'est ce que l'absence de ligne dit déjà.
 */
export function starsFor(score: number): 1 | 2 | 3 {
  if (score >= 0.9) return 3;
  if (score >= 0.7) return 2;
  return 1;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
