/**
 * LA SÉANCE — ce qu'une leçon fait faire, dans l'ordre, et combien de fois.
 *
 * PUR, ET C'EST LE POINT : la page de leçon ne décide de rien, elle déroule
 * une liste d'étapes fabriquée ici. On peut donc vérifier par des tests
 * qu'une séance d'alphabet finit toujours par le tracé, qu'aucune séance ne
 * dépasse la patience d'un enfant de six ans, et qu'un rechargement de page
 * redonne EXACTEMENT la même séance — c'est ce que la graine garantit.
 *
 * LA GRAINE VIENT DE LA CLÉ DE LEÇON, jamais de l'horloge : un enfant qui
 * perd le réseau au milieu d'une séance et recharge doit retrouver ses
 * questions, pas une nouvelle série qui effacerait ce qu'il venait de
 * comprendre.
 *
 * LE PLAFOND D'ÉTAPES EST UNE DÉCISION PÉDAGOGIQUE, pas une optimisation :
 * au-delà d'une vingtaine d'exercices, une séance devient une corvée, et le
 * niveau 2 en compte trente-six à lui seul (douze lettres × trois voyelles).
 * On en tire un échantillon stable plutôt que de tout imposer — le reste
 * revient à la révision suivante, avec la même graine, donc le même
 * échantillon. Pour les élargir : `ITEMS_PER_SESSION`.
 */

import {
  getLetter,
  pickDistractors,
  shuffle,
  type ArabicLetterKey,
} from "@/convex/arabic/alphabet";
import type { ArabicLesson, DrillKind } from "@/convex/arabic/curriculum";
import { lettersSeenUpTo } from "@/convex/arabic/curriculum";

/** Items de lecture retenus par séance — au-delà, on échantillonne. */
export const ITEMS_PER_SESSION = 8;

/** Choix proposés dans un QCM, bonne réponse comprise. */
export const CHOICES_PER_QUESTION = 4;

export type SessionStep =
  /** On découvre la lettre : on l'écoute, on lit son conseil. Non noté. */
  | { kind: "discoverLetter"; itemKey: ArabicLetterKey }
  /** On entend le nom, on retrouve la lettre parmi quatre. */
  | { kind: "recognizeGlyph"; itemKey: ArabicLetterKey; options: ArabicLetterKey[] }
  /** On voit la lettre, on retrouve son nom parmi quatre. */
  | { kind: "recognizeName"; itemKey: ArabicLetterKey; options: ArabicLetterKey[] }
  /** Combien de points ? Le détail qui sépare ب de ت de ث. */
  | { kind: "dots"; itemKey: ArabicLetterKey; options: number[] }
  /** La lettre au milieu d'un mot : la reconnaître sous sa forme attachée. */
  | { kind: "forms"; itemKey: ArabicLetterKey; options: ArabicLetterKey[] }
  /** L'enfant répète au micro. */
  | { kind: "pronounce"; itemKey: ArabicLetterKey }
  /** L'enfant écrit la lettre au doigt. */
  | { kind: "write"; itemKey: ArabicLetterKey }
  /** On écoute la syllabe, le mot ou le verset. Non noté. */
  | { kind: "discoverItem"; itemKey: string }
  /** On le lit à voix haute. */
  | { kind: "read"; itemKey: string };

/** Les étapes qui comptent pour la note — les autres sont de la découverte. */
export function isScored(step: SessionStep): boolean {
  return step.kind !== "discoverLetter" && step.kind !== "discoverItem";
}

/** La famille d'exercice enregistrée côté serveur, ou `null` si non notée. */
export function drillOf(step: SessionStep): DrillKind | null {
  switch (step.kind) {
    case "recognizeGlyph":
    case "recognizeName":
    case "dots":
    case "forms":
    case "write":
    case "read":
      return step.kind;
    case "pronounce":
      return "pronounce";
    default:
      return null;
  }
}

/** Graine stable, tirée du nom de la leçon (hachage FNV-1a 32 bits). */
export function seedFromKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

/**
 * Fabrique la séance d'une leçon.
 *
 * L'ORDRE DES FAMILLES EST FIXE, et il suit l'apprentissage : on découvre,
 * on reconnaît (à l'oreille puis à l'œil), on observe le détail (les points,
 * les formes attachées), on prononce, et on écrit en dernier — écrire une
 * lettre qu'on ne sait pas nommer n'apprend qu'un dessin.
 *
 * Seules les familles déclarées par la leçon (`lesson.drills`) sont retenues :
 * c'est le curriculum qui décide, pas cette fonction.
 */
export function buildSession(lesson: ArabicLesson): SessionStep[] {
  const seed = seedFromKey(lesson.key);
  const has = (drill: DrillKind) => lesson.drills.includes(drill);

  if (lesson.kind === "alphabet") {
    return buildLetterSession(lesson, seed, has);
  }
  return buildReadingSession(lesson, seed, has);
}

function buildLetterSession(
  lesson: ArabicLesson,
  seed: number,
  has: (drill: DrillKind) => boolean,
): SessionStep[] {
  const letters = lesson.letters as readonly ArabicLetterKey[];
  const pool = lettersSeenUpTo(lesson.key);
  const steps: SessionStep[] = [];

  for (const letterKey of letters) {
    steps.push({ kind: "discoverLetter", itemKey: letterKey });
  }

  const options = (letterKey: ArabicLetterKey, salt: number) =>
    shuffle(
      [
        letterKey,
        ...pickDistractors(letterKey, pool, CHOICES_PER_QUESTION - 1, seed + salt),
      ],
      seed + salt + 1,
    );

  if (has("recognizeGlyph")) {
    letters.forEach((letterKey, i) => {
      steps.push({
        kind: "recognizeGlyph",
        itemKey: letterKey,
        options: options(letterKey, i * 10),
      });
    });
  }

  if (has("recognizeName")) {
    letters.forEach((letterKey, i) => {
      steps.push({
        kind: "recognizeName",
        itemKey: letterKey,
        options: options(letterKey, i * 10 + 3),
      });
    });
  }

  if (has("dots")) {
    letters.forEach((letterKey, i) => {
      if (!getLetter(letterKey)) return;
      steps.push({
        kind: "dots",
        itemKey: letterKey,
        options: shuffle([0, 1, 2, 3], seed + i * 7),
      });
    });
  }

  if (has("forms")) {
    letters.forEach((letterKey, i) => {
      steps.push({
        kind: "forms",
        itemKey: letterKey,
        options: options(letterKey, i * 10 + 5),
      });
    });
  }

  if (has("pronounce")) {
    for (const letterKey of letters) {
      steps.push({ kind: "pronounce", itemKey: letterKey });
    }
  }

  // L'écriture EN DERNIER, toujours : c'est le geste qui fixe ce qui vient
  // d'être entendu, nommé et prononcé.
  if (has("write")) {
    for (const letterKey of letters) {
      steps.push({ kind: "write", itemKey: letterKey });
    }
  }

  return steps;
}

function buildReadingSession(
  lesson: ArabicLesson,
  seed: number,
  has: (drill: DrillKind) => boolean,
): SessionStep[] {
  // L'ÉCHANTILLON GARDE L'ORDRE DE LA LEÇON. Tirer au hasard puis lire dans
  // le désordre casserait la progression d'une sourate, dont les versets se
  // suivent. On choisit QUI est retenu, jamais dans quel ordre.
  const chosen =
    lesson.items.length <= ITEMS_PER_SESSION
      ? [...lesson.items]
      : shuffle(lesson.items, seed)
          .slice(0, ITEMS_PER_SESSION)
          .sort(
            (a, b) =>
              lesson.items.indexOf(a) - lesson.items.indexOf(b),
          );

  const steps: SessionStep[] = chosen.map((item) => ({
    kind: "discoverItem" as const,
    itemKey: item.key,
  }));

  // `read` SEUL, jamais `pronounce` : lire un mot à voix haute EST l'exercice
  // de prononciation à ce niveau, et les leçons de lecture ne déclarent que
  // celui-là (voir l'en-tête de `curriculum.ts`).
  if (has("read")) {
    for (const item of chosen) {
      steps.push({ kind: "read", itemKey: item.key });
    }
  }

  return steps;
}
