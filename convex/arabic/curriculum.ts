/**
 * LE PARCOURS « ARABE & CORAN » — cinq niveaux, vingt-quatre leçons.
 *
 * L'ORDRE EST LA PÉDAGOGIE, et il ne se contourne pas : on ne lit pas une
 * sourate avant de savoir qu'une lettre change de forme selon sa place, et on
 * n'assemble pas deux lettres avant de connaître les trois voyelles brèves.
 * Chaque niveau suppose le précédent :
 *
 *   1. L'ALPHABET — les vingt-huit lettres, quatre par leçon. On écoute, on
 *      reconnaît, on prononce, on écrit. Rien d'autre : une lettre seule ne
 *      se lit pas encore.
 *   2. LES VOYELLES — fatha, kasra, damma. La lettre devient syllabe (بَ بِ
 *      بُ) et l'enfant lit ses premiers sons.
 *   3. ASSEMBLER — sukūn, chadda, tanwīn, prolongations. C'est le niveau qui
 *      fait passer de « je déchiffre des syllabes » à « je lis un mot ».
 *   4. MES PREMIERS MOTS — des mots courts et connus, pour lire sans
 *      déchiffrer lettre à lettre.
 *   5. MES PREMIÈRES SOURATES — six sourates courtes, verset par verset.
 *
 * LE CONTENU EST CALCULÉ, PAS RECOPIÉ, partout où il peut l'être : les leçons
 * de l'alphabet découpent `ARABIC_LETTERS`, les leçons de voyelles lisent les
 * syllabes que chaque lettre porte déjà, les leçons de Coran lisent `SURAHS`.
 * Seuls les MOTS du niveau 4 sont écrits à la main — ils n'existent nulle part
 * ailleurs. Une liste recopiée est une liste qui diverge.
 *
 * `drills` DIT CE QU'UNE LEÇON FAIT FAIRE, et l'écran de session s'y plie.
 * C'est donc ici — et pas dans un composant — qu'on décide qu'une leçon de
 * Coran ne demande pas d'écrire au doigt, ou qu'une leçon d'alphabet finit
 * toujours par le tracé de la lettre.
 *
 * ET IL NE DÉCLARE QUE CE QUI ARRIVE VRAIMENT. Les leçons de lecture ne
 * portent que `read` : lire un mot à voix haute EST l'exercice de
 * prononciation à ce niveau-là, et `pronounce` — qui vise une lettre isolée —
 * n'y produirait aucune étape. Une liste qui annonce un exercice que la séance
 * ne construit jamais finit par servir de spécification à quelqu'un, et le
 * test `convex/__tests__/arabic.test.ts` vérifie désormais l'égalité entre ce
 * qui est déclaré et ce qui est joué.
 */

import {
  ARABIC_LETTERS,
  HARAKAT,
  type ArabicLetter,
  type ArabicLetterKey,
} from "./alphabet";
import { SURAHS, type Surah } from "./quran";

/** Les familles d'exercices qu'une leçon peut enchaîner. */
export type DrillKind =
  /** On entend la lettre, on la retrouve parmi quatre. */
  | "recognizeGlyph"
  /** On voit la lettre, on retrouve son nom parmi quatre. */
  | "recognizeName"
  /** Combien de points, et de quel côté ? Le détail qui sépare ب de ت. */
  | "dots"
  /** Retrouver la lettre dans ses quatre formes, au milieu d'un mot. */
  | "forms"
  /** L'élève répète au micro ; la prononciation est jugée. */
  | "pronounce"
  /** L'élève écrit la lettre au doigt, le tracé est jugé. */
  | "write"
  /** L'élève lit l'item à voix haute (syllabe, mot, verset). */
  | "read";

export type ArabicLessonKind =
  | "alphabet"
  | "harakat"
  | "assemblage"
  | "mots"
  | "coran";

/** Une chose à lire : une syllabe, un mot, un verset. */
export interface ReadingItem {
  /** Unique dans la leçon — sert de clé de tentative et de cache audio. */
  key: string;
  /** Le texte arabe vocalisé, tel qu'il s'affiche et tel qu'on le fait dire. */
  ar: string;
  /** Sa lecture en lettres françaises, pour l'enfant qui bute. */
  translit?: string;
  /** Son sens, quand il en a un (les syllabes n'en ont pas). */
  fr?: string;
}

export interface ArabicLevel {
  key: string;
  order: number;
  title: string;
  subtitleFr: string;
  /** Emoji d'en-tête — le module suit la langue visuelle de l'espace élève. */
  emoji: string;
  /** Teinte de la carte, en hexadécimal, comme `subjects.color`. */
  color: string;
}

export interface ArabicLesson {
  key: string;
  levelKey: string;
  /** Rang GLOBAL dans le parcours, à partir de 1 — il pilote le déverrouillage. */
  order: number;
  title: string;
  goalFr: string;
  kind: ArabicLessonKind;
  /** Les lettres enseignées ou révisées par cette leçon. */
  letters: readonly ArabicLetterKey[];
  /** Ce qu'il y a à lire. Vide pour les leçons d'alphabet pur. */
  items: readonly ReadingItem[];
  drills: readonly DrillKind[];
  /** Renseigné pour les leçons de Coran seulement. */
  surahKey?: string;
}

export const ARABIC_LEVELS: readonly ArabicLevel[] = [
  {
    key: "alphabet",
    order: 1,
    title: "L'alphabet",
    subtitleFr: "Les 28 lettres : les entendre, les reconnaître, les écrire.",
    emoji: "🔤",
    color: "#0d9488",
  },
  {
    key: "harakat",
    order: 2,
    title: "Les voyelles",
    subtitleFr: "Fatha, kasra, damma : la lettre devient un son.",
    emoji: "🎵",
    color: "#7c3aed",
  },
  {
    key: "assemblage",
    order: 3,
    title: "Assembler",
    subtitleFr: "Sukūn, chadda, tanwīn, prolongations : on lit des mots.",
    emoji: "🧩",
    color: "#ea580c",
  },
  {
    key: "mots",
    order: 4,
    title: "Mes premiers mots",
    subtitleFr: "Des mots courts qu'on lit d'un seul regard.",
    emoji: "📖",
    color: "#2563eb",
  },
  {
    key: "coran",
    order: 5,
    title: "Mes premières sourates",
    subtitleFr: "Six sourates courtes, verset par verset.",
    emoji: "🕌",
    color: "#15803d",
  },
];

// ---------------------------------------------------------------------------
// Niveau 1 — l'alphabet, quatre lettres par leçon.
// ---------------------------------------------------------------------------

const LETTERS_PER_LESSON = 4;

function alphabetLessons(startOrder: number): ArabicLesson[] {
  const lessons: ArabicLesson[] = [];
  for (let i = 0; i < ARABIC_LETTERS.length; i += LETTERS_PER_LESSON) {
    const slice = ARABIC_LETTERS.slice(i, i + LETTERS_PER_LESSON);
    const index = i / LETTERS_PER_LESSON + 1;
    lessons.push({
      key: `alphabet-${index}`,
      levelKey: "alphabet",
      order: startOrder + index - 1,
      title: `Lettres ${slice[0].nameFr} → ${slice[slice.length - 1].nameFr}`,
      goalFr: `Entendre, reconnaître, prononcer et écrire ${slice
        .map((l) => l.isolated)
        .join(" ")}.`,
      kind: "alphabet",
      letters: slice.map((l) => l.key),
      items: [],
      // L'ordre compte : on ÉCOUTE avant de reconnaître, on reconnaît avant
      // de prononcer, et on n'écrit qu'une lettre qu'on sait nommer.
      drills: ["recognizeGlyph", "recognizeName", "dots", "forms", "pronounce", "write"],
    });
  }
  return lessons;
}

// ---------------------------------------------------------------------------
// Niveau 2 — les voyelles brèves.
//
// Une leçon par voyelle, puis une leçon qui les mélange : c'est le mélange
// qui apprend à LIRE, les trois premières n'apprenant qu'à reconnaître un
// signe. Les lettres choisies sont les plus simples à prononcer pour un
// francophone (pas de ع ni de ق au premier contact avec la voyelle).
// ---------------------------------------------------------------------------

const EASY_LETTERS: readonly ArabicLetterKey[] = [
  "ba", "ta", "dal", "ra", "sin", "kaf", "lam", "mim", "nun", "waw", "ya", "fa",
];

function letterByKey(key: ArabicLetterKey): ArabicLetter {
  const found = ARABIC_LETTERS.find((l) => l.key === key);
  // Impossible par construction : `EASY_LETTERS` est écrit à la main mais
  // typé sur les clés réelles, donc une clé fausse ne compile pas.
  if (!found) throw new Error(`Lettre inconnue : ${key}`);
  return found;
}

function harakatLessons(startOrder: number): ArabicLesson[] {
  const perHaraka = HARAKAT.map((haraka, i) => ({
    key: `harakat-${haraka.key}`,
    levelKey: "harakat",
    order: startOrder + i,
    title: `La ${haraka.nameFr} — le son « ${haraka.soundFr} »`,
    goalFr: `Le signe ${haraka.mark} se pose sur la lettre et lui donne le son « ${haraka.soundFr} » (${haraka.exampleFr}).`,
    kind: "harakat" as const,
    letters: EASY_LETTERS,
    items: EASY_LETTERS.map((key) => {
      const letter = letterByKey(key);
      return {
        key: `${key}-${haraka.key}`,
        ar: letter.syllables[haraka.key],
        translit: `${letter.soundFr}${haraka.soundFr}`,
      };
    }),
    drills: ["read"] as DrillKind[],
  }));

  const mixed: ArabicLesson = {
    key: "harakat-melange",
    levelKey: "harakat",
    order: startOrder + HARAKAT.length,
    title: "Les trois voyelles mélangées",
    goalFr: "Lire la bonne voyelle du premier coup : بَ، بِ، بُ ne se disent pas pareil.",
    kind: "harakat",
    letters: EASY_LETTERS,
    items: EASY_LETTERS.flatMap((key) => {
      const letter = letterByKey(key);
      return HARAKAT.map((haraka) => ({
        key: `${key}-${haraka.key}`,
        ar: letter.syllables[haraka.key],
        translit: `${letter.soundFr}${haraka.soundFr}`,
      }));
    }),
    drills: ["read"],
  };

  return [...perHaraka, mixed];
}

// ---------------------------------------------------------------------------
// Niveau 3 — assembler.
//
// Les quatre signes qui manquent pour lire un mot entier. Écrits à la main :
// ce sont des règles, pas des combinaisons à dérouler, et chacune a son
// exemple canonique.
// ---------------------------------------------------------------------------

function assemblageLessons(startOrder: number): ArabicLesson[] {
  return [
    {
      key: "assemblage-sukun",
      levelKey: "assemblage",
      order: startOrder,
      title: "Le sukūn — la lettre sans voyelle",
      goalFr: "Le petit rond ْ dit que la lettre n'a pas de voyelle : on la colle à celle d'avant.",
      kind: "assemblage",
      letters: ["ba", "ta", "mim", "nun", "lam", "sin"],
      items: [
        { key: "sukun-1", ar: "بَبْ", translit: "bab" },
        { key: "sukun-2", ar: "مَنْ", translit: "man", fr: "qui" },
        { key: "sukun-3", ar: "هَلْ", translit: "hal", fr: "est-ce que" },
        { key: "sukun-4", ar: "كَمْ", translit: "kam", fr: "combien" },
        { key: "sukun-5", ar: "قُلْ", translit: "qoul", fr: "dis" },
        { key: "sukun-6", ar: "نَعَمْ", translit: "na'am", fr: "oui" },
      ],
      drills: ["read"],
    },
    {
      key: "assemblage-chadda",
      levelKey: "assemblage",
      order: startOrder + 1,
      title: "La chadda — la lettre doublée",
      goalFr: "Le signe ّ double la lettre : on appuie dessus deux fois plus longtemps.",
      kind: "assemblage",
      letters: ["ba", "dal", "mim", "nun", "ra"],
      items: [
        { key: "chadda-1", ar: "رَبّ", translit: "rabb", fr: "Seigneur" },
        { key: "chadda-2", ar: "أُمّ", translit: "oumm", fr: "maman" },
        { key: "chadda-3", ar: "جَدّ", translit: "jadd", fr: "grand-père" },
        { key: "chadda-4", ar: "حَقّ", translit: "haqq", fr: "vérité" },
        { key: "chadda-5", ar: "كُلّ", translit: "koull", fr: "tout" },
      ],
      drills: ["read"],
    },
    {
      key: "assemblage-tanwin",
      levelKey: "assemblage",
      order: startOrder + 2,
      title: "Le tanwīn — la voyelle doublée",
      goalFr: "Deux fatha, deux kasra ou deux damma ajoutent un « n » à la fin du mot.",
      kind: "assemblage",
      letters: ["ba", "kaf", "lam", "mim", "dal"],
      items: [
        { key: "tanwin-1", ar: "كِتَابٌ", translit: "kitâboun", fr: "un livre" },
        { key: "tanwin-2", ar: "بَيْتٌ", translit: "baytoun", fr: "une maison" },
        { key: "tanwin-3", ar: "وَلَدًا", translit: "waladan", fr: "un garçon" },
        { key: "tanwin-4", ar: "قَلَمٍ", translit: "qalamin", fr: "d'un stylo" },
        { key: "tanwin-5", ar: "أَحَدٌ", translit: "ahadoun", fr: "un seul" },
      ],
      drills: ["read"],
    },
    {
      key: "assemblage-madd",
      levelKey: "assemblage",
      order: startOrder + 3,
      title: "Les prolongations — â, î, oû",
      goalFr: "ا و ي allongent la voyelle d'avant : on tient le son deux temps.",
      kind: "assemblage",
      letters: ["alif", "waw", "ya"],
      items: [
        { key: "madd-1", ar: "بَاب", translit: "bâb", fr: "porte" },
        { key: "madd-2", ar: "نُور", translit: "noûr", fr: "lumière" },
        { key: "madd-3", ar: "كَبِير", translit: "kabîr", fr: "grand" },
        { key: "madd-4", ar: "قَالَ", translit: "qâla", fr: "il a dit" },
        { key: "madd-5", ar: "يَقُول", translit: "yaqoûl", fr: "il dit" },
      ],
      drills: ["read"],
    },
  ];
}

// ---------------------------------------------------------------------------
// Niveau 4 — les premiers mots.
// ---------------------------------------------------------------------------

function motsLessons(startOrder: number): ArabicLesson[] {
  return [
    {
      key: "mots-maison",
      levelKey: "mots",
      order: startOrder,
      title: "À la maison",
      goalFr: "Six mots de tous les jours, lus d'un seul regard.",
      kind: "mots",
      letters: ["alif", "ba", "ta", "mim", "ya", "dal"],
      items: [
        { key: "mot-ab", ar: "أَب", translit: "ab", fr: "papa" },
        { key: "mot-oumm", ar: "أُمّ", translit: "oumm", fr: "maman" },
        { key: "mot-bayt", ar: "بَيْت", translit: "bayt", fr: "maison" },
        { key: "mot-bab", ar: "بَاب", translit: "bâb", fr: "porte" },
        { key: "mot-yad", ar: "يَد", translit: "yad", fr: "main" },
        { key: "mot-ma", ar: "مَاء", translit: "mâ'", fr: "eau" },
      ],
      drills: ["read"],
    },
    {
      key: "mots-ecole",
      levelKey: "mots",
      order: startOrder + 1,
      title: "À l'école",
      goalFr: "Les mots de la classe.",
      kind: "mots",
      letters: ["kaf", "ta", "qaf", "lam", "mim", "dal", "ra", "sin"],
      items: [
        { key: "mot-kitab", ar: "كِتَاب", translit: "kitâb", fr: "livre" },
        { key: "mot-qalam", ar: "قَلَم", translit: "qalam", fr: "stylo" },
        { key: "mot-madrasa", ar: "مَدْرَسَة", translit: "madrasa", fr: "école" },
        { key: "mot-dars", ar: "دَرْس", translit: "dars", fr: "leçon" },
        { key: "mot-mouallim", ar: "مُعَلِّم", translit: "mou'allim", fr: "maître" },
        { key: "mot-waraqa", ar: "وَرَقَة", translit: "waraqa", fr: "feuille" },
      ],
      drills: ["read"],
    },
    {
      key: "mots-monde",
      levelKey: "mots",
      order: startOrder + 2,
      title: "Le monde autour de moi",
      goalFr: "Le soleil, la lune, les animaux — et le mot « paix ».",
      kind: "mots",
      letters: ["shin", "qaf", "nun", "jim", "alif", "sin", "waw", "ra"],
      items: [
        { key: "mot-chams", ar: "شَمْس", translit: "chams", fr: "soleil" },
        { key: "mot-qamar", ar: "قَمَر", translit: "qamar", fr: "lune" },
        { key: "mot-najm", ar: "نَجْم", translit: "najm", fr: "étoile" },
        { key: "mot-samak", ar: "سَمَك", translit: "samak", fr: "poisson" },
        { key: "mot-jamal", ar: "جَمَل", translit: "jamal", fr: "chameau" },
        { key: "mot-asad", ar: "أَسَد", translit: "asad", fr: "lion" },
        { key: "mot-ward", ar: "وَرْد", translit: "ward", fr: "rose" },
        { key: "mot-salam", ar: "سَلَام", translit: "salâm", fr: "paix" },
      ],
      drills: ["read"],
    },
  ];
}

// ---------------------------------------------------------------------------
// Niveau 5 — les sourates.
//
// Une leçon par sourate, un item par verset. PAS de `write` ici : le tracé
// s'apprend sur une lettre, pas sur un verset — et faire tracer du texte
// coranique au doigt sur un écran, c'est promettre une note à un geste qui
// n'en attend pas.
// ---------------------------------------------------------------------------

function coranLessons(startOrder: number): ArabicLesson[] {
  return SURAHS.map((surah: Surah, i) => ({
    key: `coran-${surah.key}`,
    levelKey: "coran",
    order: startOrder + i,
    title: `${surah.nameFr} — ${surah.nameAr}`,
    goalFr: `${surah.meaningFr} · ${surah.ayahs.length} versets. On lit un verset à la fois, après l'avoir écouté.`,
    kind: "coran" as const,
    letters: [],
    items: surah.ayahs.map((ayah) => ({
      key: `${surah.key}-${ayah.number}`,
      ar: ayah.ar,
      fr: `Verset ${ayah.number}`,
    })),
    drills: ["read"] as DrillKind[],
    surahKey: surah.key,
  }));
}

/** Le parcours complet, dans l'ordre. `order` est unique et contigu. */
export const ARABIC_LESSONS: readonly ArabicLesson[] = (() => {
  const alphabet = alphabetLessons(1);
  const harakat = harakatLessons(alphabet.length + 1);
  const assemblage = assemblageLessons(alphabet.length + harakat.length + 1);
  const mots = motsLessons(
    alphabet.length + harakat.length + assemblage.length + 1,
  );
  const coran = coranLessons(
    alphabet.length + harakat.length + assemblage.length + mots.length + 1,
  );
  return [...alphabet, ...harakat, ...assemblage, ...mots, ...coran];
})();

const LESSON_BY_KEY: ReadonlyMap<string, ArabicLesson> = new Map(
  ARABIC_LESSONS.map((lesson) => [lesson.key, lesson]),
);

/** La leçon, ou `null` si la clé ne désigne rien — une clé vient du client. */
export function getLesson(key: string): ArabicLesson | null {
  return LESSON_BY_KEY.get(key) ?? null;
}

/** Vrai si la chaîne désigne une leçon. Garde d'entrée des mutations. */
export function isLessonKey(key: string): boolean {
  return LESSON_BY_KEY.has(key);
}

/** Le niveau d'une leçon, ou `null`. */
export function getLevel(key: string): ArabicLevel | null {
  return ARABIC_LEVELS.find((level) => level.key === key) ?? null;
}

/**
 * Les lettres qu'un élève a déjà rencontrées en arrivant à cette leçon —
 * la RÉSERVE DE LEURRES des QCM (`pickDistractors`).
 *
 * Inclut les lettres de la leçon elle-même : la question porte sur elles, et
 * un leurre doit pouvoir être une lettre de la même fournée, sinon la réponse
 * se devine sans lire — « c'est forcément la nouvelle ».
 */
export function lettersSeenUpTo(lessonKey: string): ArabicLetterKey[] {
  const target = LESSON_BY_KEY.get(lessonKey);
  if (!target) return [];
  const seen = new Set<ArabicLetterKey>();
  for (const lesson of ARABIC_LESSONS) {
    if (lesson.order > target.order) break;
    for (const key of lesson.letters) seen.add(key);
  }
  return [...seen];
}

/** Le nombre total de leçons — affiché sur le parcours de l'élève. */
export const TOTAL_LESSONS = ARABIC_LESSONS.length;
