/**
 * JUGER UNE PRONONCIATION — ce que le module fait de ce que l'enfant a dit.
 *
 * LA CHAÎNE COMPLÈTE : l'enfant parle, `voice.ts` envoie l'audio à la
 * transcription (ElevenLabs Scribe), qui rend du TEXTE ARABE. Ce fichier
 * compare ce texte à ce qui était attendu, et rend un verdict. Il ne parle à
 * personne — pas de `fetch`, pas de `ctx` — pour être testable ligne à ligne
 * (`convex/__tests__/arabic.test.ts`).
 *
 * POURQUOI ON NE COMPARE PAS DEUX CHAÎNES DIRECTEMENT. Une transcription
 * arabe arrive sans voyelles brèves (le modèle les restitue rarement), parfois
 * avec une hamza portée autrement (أ pour ا), un tā' marbūṭa rendu en hā', ou
 * un `ال` collé. « بَاء » attendu peut revenir « باء », « با », « الباء ».
 * Comparer sans normaliser refuserait un enfant qui a bien prononcé — le pire
 * défaut possible pour ce module.
 *
 * TROIS VERDICTS, PAS DEUX. « Presque » existe parce qu'un enfant de six ans
 * qui dit « ta » pour « tha » n'a pas échoué : il a mal placé sa langue. Le
 * distinguer d'un « je n'ai rien reconnu » change ce qu'on lui répond, et
 * c'est tout l'intérêt d'écouter.
 *
 * CE QUI N'EST PAS ICI, ET NE DOIT PAS Y VENIR : le tajwīd. Juger une
 * récitation (allongements, nasalisations, points d'articulation) demande une
 * oreille humaine et un maître ; une similarité de chaînes n'en dit rien. Le
 * module fait lire, il n'évalue pas une récitation.
 */

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Les signes qu'on retire : voyelles brèves, sukūn, chadda, tanwīn, petits
 * signes coraniques, et la tatwīl (ـ) qui n'est qu'un étirement graphique.
 *
 * `ً-ْ` couvre fatha, kasra, damma, leurs tanwīn, la chadda et le
 * sukūn ; `ٰ` la petite alif suscrite (الرَّحْمَٰن) ; `ۖ-ۭ` les
 * marques de pause et les signes de récitation des mushafs.
 */
const DIACRITICS = /[ً-ْٰۖ-ۭـ]/g;

/** Ce qui n'est ni une lettre arabe ni une espace : ponctuation, chiffres, latin. */
const NON_ARABIC = /[^ء-غف-يٱ\s]/g;

/**
 * Met deux textes arabes sur le même pied.
 *
 * Chaque règle répare une divergence OBSERVABLE entre ce qu'on écrit et ce
 * qu'une transcription rend :
 *   - les diacritiques disparaissent : le modèle ne les restitue pas ;
 *   - أ إ آ ٱ ٲ ٳ → ا : la hamza portée par l'alif s'écrit de six façons ;
 *   - ى → ي et ة → ه : deux lettres que la transcription choisit librement ;
 *   - ؤ ئ → و ي : mêmes hamza portées, mêmes hésitations ;
 *   - la hamza isolée ء disparaît en fin de mot (مَاء ↔ ما) ;
 *   - l'article ال en tête de mot disparaît : un enfant à qui l'on demande
 *     « bâ » peut répondre « al-bâ », et il a raison.
 */
export function normalizeArabic(input: string): string {
  let text = input.normalize("NFC").replace(DIACRITICS, "");
  text = text
    .replace(/[أإآٱٲٳ]/g, "ا") // أ إ آ ٱ → ا
    .replace(/ى/g, "ي") // ى → ي
    .replace(/ة/g, "ه") // ة → ه
    .replace(/ؤ/g, "و") // ؤ → و
    .replace(/ئ/g, "ي") // ئ → ي
    .replace(/ء/g, ""); //   ء isolée : muette à l'écrit normalisé
  text = text.replace(NON_ARABIC, " ");
  return text
    .split(/\s+/)
    .map(stripArticle)
    .filter((word) => word.length > 0)
    .join(" ");
}

/** Retire l'article défini ال quand il reste au moins deux lettres derrière. */
function stripArticle(word: string): string {
  if (word.startsWith("ال") && word.length > 3) return word.slice(2);
  return word;
}

/** Les mots d'un texte normalisé. */
export function tokenize(normalized: string): string[] {
  return normalized.split(" ").filter((word) => word.length > 0);
}

// ---------------------------------------------------------------------------
// Similarité
// ---------------------------------------------------------------------------

/** Distance d'édition de Levenshtein, en O(|a|·|b|) temps et O(|b|) mémoire. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1, // insertion
        previous[j] + 1, // suppression
        previous[j - 1] + cost, // substitution
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** 1 pour deux textes identiques, 0 pour deux textes sans rien de commun. */
export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export type PronunciationVerdict = "ok" | "close" | "retry";

/**
 * LES DEUX SEUILS, et pourquoi ils sont bas.
 *
 * Une transcription de SYLLABE est bruitée : le modèle entend un mot d'une
 * seconde, sans contexte, prononcé par un enfant. Exiger 0,9 refuserait des
 * prononciations correctes, et le module perdrait sa raison d'être — l'enfant
 * cesserait d'essayer. On préfère un « bravo » de trop à un « non » de trop,
 * et c'est la garde `requireGlyph` ci-dessous qui empêche que « bravo » soit
 * dit à n'importe quoi.
 */
export const PRONUNCIATION_OK = 0.7;
export const PRONUNCIATION_CLOSE = 0.4;

export interface PronunciationJudgement {
  verdict: PronunciationVerdict;
  /** 0..1 — la meilleure similarité trouvée parmi les formes acceptées. */
  score: number;
  /** La forme acceptée qui a le mieux correspondu, normalisée. */
  best: string | null;
  /** Ce que la transcription disait, une fois normalisée. */
  heard: string;
}

/**
 * Juge une syllabe ou un nom de lettre.
 *
 * `accepted` liste TOUTES les réponses justes — pour ب : « باء » (le nom),
 * « ب » (la lettre), « با » (la syllabe). On garde la meilleure.
 *
 * `requireGlyph` EST LA GARDE QUI TIENT L'ENSEMBLE. Sans elle, un seuil à 0,7
 * sur des chaînes de deux caractères dirait « bravo » à un enfant qui a dit
 * « ta » pour « ba » (une substitution sur deux caractères = 0,5, mais sur
 * trois = 0,67, et le bruit fait le reste). Avec elle, la lettre demandée doit
 * APPARAÎTRE dans ce qui a été entendu : on peut se tromper de voyelle, pas
 * de lettre. Un `requireGlyph` absent (syllabes mélangées, mots) laisse la
 * similarité seule décider.
 */
export function judgePronunciation(args: {
  accepted: readonly string[];
  transcript: string;
  requireGlyph?: string;
}): PronunciationJudgement {
  const heard = normalizeArabic(args.transcript);

  let score = 0;
  let best: string | null = null;
  for (const candidate of args.accepted) {
    const normalized = normalizeArabic(candidate);
    if (normalized.length === 0) continue;
    // Le mot le plus proche de la transcription, et non la phrase entière :
    // « la lettre bâ » transcrit en trois mots ne doit pas être puni pour les
    // deux mots en trop.
    const words = tokenize(heard);
    const candidates = words.length > 0 ? words : [heard];
    for (const word of candidates) {
      const s = similarity(normalized, word);
      if (s > score) {
        score = s;
        best = normalized;
      }
    }
  }

  const glyph = args.requireGlyph
    ? normalizeArabic(args.requireGlyph)
    : "";
  const glyphHeard = glyph.length === 0 || heard.includes(glyph);

  if (score >= PRONUNCIATION_OK && glyphHeard) {
    return { verdict: "ok", score, best, heard };
  }
  if (score >= PRONUNCIATION_CLOSE) {
    return { verdict: "close", score, best, heard };
  }
  return { verdict: "retry", score, best, heard };
}

export const READING_OK = 0.7;
export const READING_CLOSE = 0.4;

/** Un mot compte comme lu si la transcription s'en approche d'au moins autant. */
const WORD_MATCH = 0.7;

export interface ReadingJudgement {
  verdict: PronunciationVerdict;
  /** La part des mots attendus qu'on a retrouvés, 0..1. */
  score: number;
  /** Les mots attendus qu'on n'a pas retrouvés — l'écran les surligne. */
  missing: string[];
  heard: string;
}

/**
 * Juge la lecture d'un texte de plusieurs mots — un mot, un verset.
 *
 * MOT À MOT, PAS CHAÎNE À CHAÎNE. Sur un verset, une distance d'édition
 * globale est ingouvernable : deux mots inversés coûtent autant que deux mots
 * absents, et un verset long pardonne tout tandis qu'un verset court ne
 * pardonne rien. Compter les mots retrouvés donne une note qu'un enseignant
 * peut lire — « il a lu cinq mots sur six » — et surtout la LISTE de ceux qui
 * manquent, que l'écran peut montrer.
 *
 * CHAQUE MOT ENTENDU NE SERT QU'UNE FOIS (`used`), sinon un enfant qui répète
 * « النَّاس » six fois validerait An-Nās en entier.
 */
export function judgeReading(args: {
  expected: string;
  transcript: string;
}): ReadingJudgement {
  const heard = normalizeArabic(args.transcript);
  const expectedWords = tokenize(normalizeArabic(args.expected));
  const heardWords = tokenize(heard);

  if (expectedWords.length === 0) {
    return { verdict: "retry", score: 0, missing: [], heard };
  }

  const used = new Set<number>();
  const missing: string[] = [];
  let matched = 0;

  for (const word of expectedWords) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < heardWords.length; i++) {
      if (used.has(i)) continue;
      const s = similarity(word, heardWords[i]);
      if (s > bestScore) {
        bestScore = s;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0 && bestScore >= WORD_MATCH) {
      used.add(bestIndex);
      matched += 1;
    } else {
      missing.push(word);
    }
  }

  const score = matched / expectedWords.length;
  const verdict: PronunciationVerdict =
    score >= READING_OK ? "ok" : score >= READING_CLOSE ? "close" : "retry";
  return { verdict, score, missing, heard };
}

/**
 * Les réponses acceptées quand on demande UNE LETTRE.
 *
 * Construites depuis la lettre plutôt qu'écrites lettre par lettre : vingt-
 * huit listes recopiées à la main, c'est vingt-huit occasions de se tromper,
 * et la règle est la même pour toutes.
 */
export function acceptedFormsForLetter(letter: {
  isolated: string;
  nameAr: string;
  syllables: { fatha: string; kasra: string; damma: string };
}): string[] {
  return [
    letter.nameAr,
    letter.isolated,
    letter.syllables.fatha,
    // « بَا » — la syllabe allongée, que beaucoup d'enfants disent
    // spontanément à la place de « بَ ».
    letter.isolated + "ا",
  ];
}
