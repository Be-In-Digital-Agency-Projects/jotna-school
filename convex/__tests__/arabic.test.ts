import { describe, it, expect } from "vitest";
import {
  ARABIC_LETTERS,
  getLetter,
  isLetterKey,
  pickDistractors,
  shuffle,
  type ArabicLetterKey,
} from "../arabic/alphabet";
import {
  ARABIC_LESSONS,
  ARABIC_LEVELS,
  getLesson,
  lettersSeenUpTo,
  TOTAL_LESSONS,
} from "../arabic/curriculum";
import {
  ayahWords,
  EXPECTED_AYAH_COUNT,
  getSurah,
  SURAHS,
} from "../arabic/quran";
import {
  acceptedFormsForLetter,
  judgePronunciation,
  judgeReading,
  levenshtein,
  normalizeArabic,
  similarity,
  tokenize,
} from "../arabic/matching";
import {
  isLessonUnlocked,
  lessonScore,
  nextLessonKey,
  starsFor,
} from "../arabic/progressRules";

// ---------------------------------------------------------------------------
// L'alphabet — la donnée de référence. Ces tests ne jugent pas du goût des
// translittérations ; ils tiennent les invariants dont le reste du module
// dépend, et qu'une retouche distraite casserait sans rien afficher.
// ---------------------------------------------------------------------------

describe("alphabet", () => {
  it("compte exactement 28 lettres", () => {
    expect(ARABIC_LETTERS).toHaveLength(28);
  });

  it("des clés uniques et des rangs contigus de 1 à 28", () => {
    const keys = new Set(ARABIC_LETTERS.map((l) => l.key));
    expect(keys.size).toBe(28);
    expect(ARABIC_LETTERS.map((l) => l.order)).toEqual(
      Array.from({ length: 28 }, (_, i) => i + 1),
    );
  });

  it("chaque lettre confusable existe et n'est pas elle-même", () => {
    for (const letter of ARABIC_LETTERS) {
      for (const key of letter.confusables) {
        expect(isLetterKey(key)).toBe(true);
        expect(key).not.toBe(letter.key);
      }
    }
  });

  it("les six lettres qui n'attachent pas ont la même forme initiale qu'isolée", () => {
    // ا د ذ ر ز و — la règle d'écriture que le niveau 1 enseigne. Si une
    // retouche donnait une forme initiale attachée à l'une d'elles, l'écran
    // montrerait un mot impossible.
    const nonConnecting = ARABIC_LETTERS.filter((l) => !l.connectsToNext);
    expect(nonConnecting.map((l) => l.key)).toEqual([
      "alif", "dal", "dhal", "ra", "zay", "waw",
    ]);
    for (const letter of nonConnecting) {
      expect(letter.initial).toBe(letter.isolated);
    }
  });

  it("les lettres qui attachent ont quatre formes distinctes de l'isolée", () => {
    for (const letter of ARABIC_LETTERS.filter((l) => l.connectsToNext)) {
      expect(letter.initial).not.toBe(letter.final);
      expect(letter.medial.startsWith("ـ")).toBe(true);
      expect(letter.final.startsWith("ـ")).toBe(true);
    }
  });

  it("chaque syllabe porte bien sa lettre et sa voyelle", () => {
    for (const letter of ARABIC_LETTERS) {
      // L'alif fait exception : ses syllabes s'écrivent avec la hamza
      // (أَ إِ أُ), qui est ce qu'on prononce réellement.
      if (letter.key === "alif") continue;
      expect(letter.syllables.fatha).toBe(letter.isolated + "َ");
      expect(letter.syllables.kasra).toBe(letter.isolated + "ِ");
      expect(letter.syllables.damma).toBe(letter.isolated + "ُ");
    }
  });

  it("getLetter rend null pour une clé inventée", () => {
    expect(getLetter("zorglub")).toBeNull();
    expect(getLetter("ba")?.nameFr).toBe("bâ");
  });
});

describe("pickDistractors", () => {
  const pool = ARABIC_LETTERS.map((l) => l.key);

  it("ne propose jamais la bonne réponse comme leurre", () => {
    for (const letter of ARABIC_LETTERS) {
      const picks = pickDistractors(letter.key, pool, 3, 42);
      expect(picks).not.toContain(letter.key);
      expect(new Set(picks).size).toBe(picks.length);
    }
  });

  it("préfère les lettres qui se confondent — ت tire d'abord ب ث ن", () => {
    const picks = pickDistractors("ta", pool, 3, 7);
    expect(picks.sort()).toEqual(["ba", "nun", "tha"]);
  });

  it("reste dans la réserve, même quand elle est minuscule", () => {
    const tiny: ArabicLetterKey[] = ["alif", "ba", "ta"];
    const picks = pickDistractors("ba", tiny, 3, 1);
    expect(picks).toHaveLength(2); // deux seulement : la réserve n'en a pas plus
    for (const key of picks) expect(tiny).toContain(key);
  });

  it("même graine, même tirage — un rechargement ne rebat pas les cartes", () => {
    expect(pickDistractors("sin", pool, 3, 99)).toEqual(
      pickDistractors("sin", pool, 3, 99),
    );
  });
});

describe("shuffle", () => {
  it("conserve tous les éléments", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(input, 12345);
    expect(out.sort((a, b) => a - b)).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// Le Coran — on ne peut pas tester un texte sacré, on peut tester sa FORME.
// Ces assertions attrapent un verset perdu au copier-coller, pas une voyelle
// fausse : la relecture humaine reste due (voir l'en-tête de `quran.ts`).
// ---------------------------------------------------------------------------

describe("sourates", () => {
  it("chaque sourate a le nombre de versets attendu", () => {
    for (const surah of SURAHS) {
      expect(EXPECTED_AYAH_COUNT[surah.key]).toBe(surah.ayahs.length);
    }
    expect(Object.keys(EXPECTED_AYAH_COUNT).sort()).toEqual(
      SURAHS.map((s) => s.key).sort(),
    );
  });

  it("les versets sont numérotés de 1 à n, sans trou ni doublon", () => {
    for (const surah of SURAHS) {
      expect(surah.ayahs.map((a) => a.number)).toEqual(
        Array.from({ length: surah.ayahs.length }, (_, i) => i + 1),
      );
    }
  });

  it("aucun verset vide, et tous en écriture arabe", () => {
    for (const surah of SURAHS) {
      for (const ayah of surah.ayahs) {
        expect(ayah.ar.trim().length).toBeGreaterThan(0);
        expect(/[ء-ي]/.test(ayah.ar)).toBe(true);
      }
    }
  });

  it("toutes les sourates sont dans la même riwāya — mélanger serait pire que tout", () => {
    for (const surah of SURAHS) expect(surah.riwaya).toBe("hafs");
  });

  it("ayahWords découpe sur les espaces", () => {
    expect(ayahWords({ number: 2, ar: "مَلِكِ النَّاسِ" })).toHaveLength(2);
    expect(getSurah("an-nas")?.ayahs).toHaveLength(6);
    expect(getSurah("inconnue")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Le parcours
// ---------------------------------------------------------------------------

describe("curriculum", () => {
  it("des clés de leçon uniques et des rangs contigus", () => {
    const keys = new Set(ARABIC_LESSONS.map((l) => l.key));
    expect(keys.size).toBe(ARABIC_LESSONS.length);
    expect(ARABIC_LESSONS.map((l) => l.order)).toEqual(
      Array.from({ length: TOTAL_LESSONS }, (_, i) => i + 1),
    );
  });

  it("chaque leçon appartient à un niveau déclaré", () => {
    const levels = new Set(ARABIC_LEVELS.map((l) => l.key));
    for (const lesson of ARABIC_LESSONS) {
      expect(levels.has(lesson.levelKey)).toBe(true);
    }
  });

  it("le niveau 1 enseigne les 28 lettres, chacune une seule fois", () => {
    const taught = ARABIC_LESSONS.filter((l) => l.levelKey === "alphabet")
      .flatMap((l) => l.letters);
    expect(taught).toHaveLength(28);
    expect(new Set(taught).size).toBe(28);
  });

  it("aucune leçon sans exercice, aucune leçon de lecture sans contenu", () => {
    for (const lesson of ARABIC_LESSONS) {
      expect(lesson.drills.length).toBeGreaterThan(0);
      if (lesson.kind !== "alphabet") {
        expect(lesson.items.length).toBeGreaterThan(0);
      }
    }
  });

  it("les clés d'items sont uniques à l'intérieur d'une leçon", () => {
    for (const lesson of ARABIC_LESSONS) {
      const keys = lesson.items.map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("une leçon de Coran ne fait pas écrire au doigt", () => {
    for (const lesson of ARABIC_LESSONS.filter((l) => l.kind === "coran")) {
      expect(lesson.drills).not.toContain("write");
      expect(lesson.surahKey).toBeTruthy();
    }
  });

  it("la réserve de lettres vues ne fait que grandir", () => {
    let previous = 0;
    for (const lesson of ARABIC_LESSONS) {
      const seen = lettersSeenUpTo(lesson.key).length;
      expect(seen).toBeGreaterThanOrEqual(previous);
      previous = seen;
    }
    // Arrivé au bout, l'élève a rencontré tout l'alphabet.
    expect(previous).toBe(28);
  });

  it("getLesson rend null pour une clé inventée", () => {
    expect(getLesson("nope")).toBeNull();
    expect(getLesson("alphabet-1")?.letters).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// La comparaison de prononciation
// ---------------------------------------------------------------------------

describe("normalizeArabic", () => {
  it("retire les voyelles brèves", () => {
    expect(normalizeArabic("بَاء")).toBe(normalizeArabic("باء"));
  });

  it("unifie les hamza portées par l'alif", () => {
    expect(normalizeArabic("أَحَد")).toBe(normalizeArabic("احد"));
    expect(normalizeArabic("إِيَّاكَ")).toBe(normalizeArabic("اياك"));
  });

  it("unifie ة et ه, ى et ي", () => {
    expect(normalizeArabic("مَدْرَسَة")).toBe(normalizeArabic("مدرسه"));
    expect(normalizeArabic("عَلَى")).toBe(normalizeArabic("علي"));
  });

  it("laisse tomber l'article défini — « al-bâ » vaut « bâ »", () => {
    expect(normalizeArabic("الباء")).toBe(normalizeArabic("باء"));
  });

  it("écarte la ponctuation, les chiffres et le latin", () => {
    expect(normalizeArabic("باء, 12 ok!")).toBe(normalizeArabic("باء"));
  });

  it("tokenize rend les mots d'un verset", () => {
    expect(tokenize(normalizeArabic("مَلِكِ النَّاسِ"))).toHaveLength(2);
  });
});

describe("levenshtein / similarity", () => {
  it("0 pour deux chaînes identiques, 1 pour une substitution", () => {
    expect(levenshtein("باء", "باء")).toBe(0);
    expect(levenshtein("باء", "تاء")).toBe(1);
  });

  it("similarité de 1 à 0", () => {
    expect(similarity("باء", "باء")).toBe(1);
    expect(similarity("", "")).toBe(1);
    expect(similarity("باء", "")).toBe(0);
  });
});

describe("judgePronunciation", () => {
  const ba = getLetter("ba")!;
  const accepted = acceptedFormsForLetter(ba);

  it("accepte le nom de la lettre", () => {
    const out = judgePronunciation({
      accepted,
      transcript: "باء",
      requireGlyph: ba.isolated,
    });
    expect(out.verdict).toBe("ok");
    expect(out.score).toBe(1);
  });

  it("accepte la syllabe allongée que les enfants disent spontanément", () => {
    const out = judgePronunciation({
      accepted,
      transcript: "با",
      requireGlyph: ba.isolated,
    });
    expect(out.verdict).toBe("ok");
  });

  it("accepte le mot noyé dans une phrase transcrite", () => {
    const out = judgePronunciation({
      accepted,
      transcript: "حرف باء",
      requireGlyph: ba.isolated,
    });
    expect(out.verdict).toBe("ok");
  });

  it("refuse une AUTRE lettre, même quand les chaînes se ressemblent", () => {
    // « تاء » ne diffère de « باء » que d'un caractère sur trois : sans la
    // garde sur le glyphe, la similarité (0,67) frôlerait le seuil. C'est le
    // défaut précis que `requireGlyph` existe pour fermer.
    const out = judgePronunciation({
      accepted,
      transcript: "تاء",
      requireGlyph: ba.isolated,
    });
    expect(out.verdict).not.toBe("ok");
  });

  it("rend « presque » quand on n'est pas loin", () => {
    const out = judgePronunciation({
      accepted,
      transcript: "تاء",
      requireGlyph: ba.isolated,
    });
    expect(out.verdict).toBe("close");
  });

  it("rend « on réessaie » sur du silence ou du bruit", () => {
    const out = judgePronunciation({ accepted, transcript: "" });
    expect(out.verdict).toBe("retry");
    expect(out.score).toBe(0);
  });
});

describe("judgeReading", () => {
  const ayah = "قُلْ أَعُوذُ بِرَبِّ النَّاسِ";

  it("verset lu en entier : tous les mots retrouvés", () => {
    const out = judgeReading({ expected: ayah, transcript: ayah });
    expect(out.verdict).toBe("ok");
    expect(out.score).toBe(1);
    expect(out.missing).toEqual([]);
  });

  it("un mot oublié se voit, et se nomme", () => {
    const out = judgeReading({
      expected: ayah,
      transcript: "قل أعوذ برب",
    });
    expect(out.score).toBeCloseTo(0.75, 5);
    expect(out.missing).toHaveLength(1);
  });

  it("répéter le même mot ne valide pas le verset", () => {
    // Sans la consommation des mots entendus, « الناس » répété quatre fois
    // vaudrait quatre mots retrouvés.
    const out = judgeReading({
      expected: ayah,
      transcript: "الناس الناس الناس الناس",
    });
    expect(out.score).toBeLessThanOrEqual(0.25);
  });

  it("un verset vide ne peut pas être réussi", () => {
    const out = judgeReading({ expected: "", transcript: "قل" });
    expect(out.verdict).toBe("retry");
  });
});

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

describe("déverrouillage", () => {
  const first = ARABIC_LESSONS[0].key;
  const second = ARABIC_LESSONS[1].key;
  const third = ARABIC_LESSONS[2].key;

  it("la première leçon est toujours ouverte", () => {
    expect(isLessonUnlocked(first, new Set())).toBe(true);
  });

  it("la suivante attend que la précédente soit terminée", () => {
    expect(isLessonUnlocked(second, new Set())).toBe(false);
    expect(isLessonUnlocked(second, new Set([first]))).toBe(true);
    expect(isLessonUnlocked(third, new Set([first]))).toBe(false);
  });

  it("une leçon terminée reste ouverte — on révise", () => {
    expect(isLessonUnlocked(third, new Set([third]))).toBe(true);
  });

  it("une clé inconnue n'ouvre rien", () => {
    expect(isLessonUnlocked("nope", new Set())).toBe(false);
  });

  it("nextLessonKey suit le fil, puis retombe sur la dernière", () => {
    expect(nextLessonKey(new Set())).toBe(first);
    expect(nextLessonKey(new Set([first]))).toBe(second);
    const all = new Set(ARABIC_LESSONS.map((l) => l.key));
    expect(nextLessonKey(all)).toBe(
      ARABIC_LESSONS[ARABIC_LESSONS.length - 1].key,
    );
  });
});

describe("note et étoiles", () => {
  it("garde le MEILLEUR essai de chaque exercice", () => {
    const score = lessonScore([
      { drill: "pronounce", itemKey: "ba", correct: false, score: 0.1 },
      { drill: "pronounce", itemKey: "ba", correct: true, score: 0.9 },
    ]);
    expect(score).toBeCloseTo(0.9, 5);
  });

  it("prononcer et écrire la même lettre comptent pour deux", () => {
    const score = lessonScore([
      { drill: "pronounce", itemKey: "ba", correct: true, score: 1 },
      { drill: "write", itemKey: "ba", correct: false, score: 0 },
    ]);
    expect(score).toBeCloseTo(0.5, 5);
  });

  it("un QCM sans note vaut 1 ou 0", () => {
    expect(
      lessonScore([{ drill: "recognizeGlyph", itemKey: "ba", correct: true }]),
    ).toBe(1);
    expect(
      lessonScore([{ drill: "recognizeGlyph", itemKey: "ba", correct: false }]),
    ).toBe(0);
  });

  it("aucune tentative : zéro, et pas une division par zéro", () => {
    expect(lessonScore([])).toBe(0);
  });

  it("une note hors bornes est ramenée dans [0,1]", () => {
    expect(
      lessonScore([{ drill: "write", itemKey: "ba", correct: true, score: 4 }]),
    ).toBe(1);
  });

  it("les étoiles ne descendent jamais à zéro pour qui a terminé", () => {
    expect(starsFor(0)).toBe(1);
    expect(starsFor(0.7)).toBe(2);
    expect(starsFor(0.95)).toBe(3);
  });
});
