import { describe, it, expect } from "vitest";
import {
  buildSession,
  drillOf,
  isScored,
  ITEMS_PER_SESSION,
  seedFromKey,
  type SessionStep,
} from "../arabic/session";
import { ARABIC_LESSONS, getLesson } from "@/convex/arabic/curriculum";

const alphabetLesson = getLesson("alphabet-1")!;
const coranLesson = getLesson("coran-an-nas")!;
const mixedHarakat = getLesson("harakat-melange")!;

describe("seedFromKey", () => {
  it("stable et non nul", () => {
    expect(seedFromKey("alphabet-1")).toBe(seedFromKey("alphabet-1"));
    expect(seedFromKey("alphabet-1")).not.toBe(seedFromKey("alphabet-2"));
    expect(seedFromKey("")).toBeGreaterThan(0);
  });
});

describe("buildSession — leçon d'alphabet", () => {
  const steps = buildSession(alphabetLesson);

  it("commence par la découverte de chaque lettre", () => {
    const firstFour = steps.slice(0, 4);
    expect(firstFour.every((s) => s.kind === "discoverLetter")).toBe(true);
    expect(firstFour.map((s) => s.itemKey)).toEqual([
      ...alphabetLesson.letters,
    ]);
  });

  it("finit TOUJOURS par l'écriture — le geste qui fixe le reste", () => {
    const last = steps[steps.length - 1];
    expect(last.kind).toBe("write");
  });

  it("prononce avant d'écrire : on n'écrit pas ce qu'on ne sait pas dire", () => {
    const firstWrite = steps.findIndex((s) => s.kind === "write");
    const lastPronounce = steps.map((s) => s.kind).lastIndexOf("pronounce");
    expect(lastPronounce).toBeLessThan(firstWrite);
  });

  it("chaque lettre est prononcée et écrite", () => {
    for (const letterKey of alphabetLesson.letters) {
      expect(
        steps.some((s) => s.kind === "pronounce" && s.itemKey === letterKey),
      ).toBe(true);
      expect(
        steps.some((s) => s.kind === "write" && s.itemKey === letterKey),
      ).toBe(true);
    }
  });

  it("les QCM contiennent la bonne réponse et quatre choix au plus", () => {
    for (const step of steps) {
      if (step.kind !== "recognizeGlyph" && step.kind !== "recognizeName") {
        continue;
      }
      expect(step.options).toContain(step.itemKey);
      expect(step.options.length).toBeGreaterThanOrEqual(2);
      expect(step.options.length).toBeLessThanOrEqual(4);
      expect(new Set(step.options).size).toBe(step.options.length);
    }
  });

  it("le QCM des points propose toujours les quatre comptes possibles", () => {
    for (const step of steps) {
      if (step.kind !== "dots") continue;
      expect([...step.options].sort()).toEqual([0, 1, 2, 3]);
    }
  });

  it("la même leçon rend la même séance — un rechargement ne rebat rien", () => {
    expect(buildSession(alphabetLesson)).toEqual(steps);
  });
});

describe("buildSession — leçon de lecture", () => {
  it("chaque verset est d'abord écouté, puis lu", () => {
    const steps = buildSession(coranLesson);
    const discovered = steps.filter((s) => s.kind === "discoverItem");
    const read = steps.filter((s) => s.kind === "read");
    expect(discovered).toHaveLength(coranLesson.items.length);
    expect(read).toHaveLength(coranLesson.items.length);
    // L'écoute vient AVANT la lecture, pour tous les versets.
    const lastDiscover = steps.map((s) => s.kind).lastIndexOf("discoverItem");
    const firstRead = steps.findIndex((s) => s.kind === "read");
    expect(lastDiscover).toBeLessThan(firstRead);
  });

  it("aucune écriture au doigt sur un verset", () => {
    expect(buildSession(coranLesson).some((s) => s.kind === "write")).toBe(
      false,
    );
  });

  it("une leçon trop longue est échantillonnée, sans casser l'ordre", () => {
    // 12 lettres × 3 voyelles = 36 items : on n'en impose pas 36 à un enfant.
    expect(mixedHarakat.items.length).toBeGreaterThan(ITEMS_PER_SESSION);
    const steps = buildSession(mixedHarakat);
    const picked = steps
      .filter((s) => s.kind === "discoverItem")
      .map((s) => s.itemKey);
    expect(picked).toHaveLength(ITEMS_PER_SESSION);

    const order = mixedHarakat.items.map((item) => item.key);
    const positions = picked.map((key) => order.indexOf(key));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("toutes les leçons du parcours", () => {
  it("produisent une séance jouable et bornée", () => {
    for (const lesson of ARABIC_LESSONS) {
      const steps = buildSession(lesson);
      expect(steps.length).toBeGreaterThan(0);
      // Au-delà d'une trentaine d'étapes, une séance devient une corvée.
      expect(steps.length).toBeLessThanOrEqual(30);
    }
  });

  it("chaque étape notée porte une famille que le serveur accepte", () => {
    const accepted = new Set([
      "recognizeGlyph", "recognizeName", "dots", "forms", "pronounce",
      "write", "read",
    ]);
    for (const lesson of ARABIC_LESSONS) {
      for (const step of buildSession(lesson)) {
        const drill = drillOf(step);
        if (isScored(step)) {
          expect(drill).not.toBeNull();
          expect(accepted.has(drill as string)).toBe(true);
        } else {
          expect(drill).toBeNull();
        }
      }
    }
  });

  it("joue EXACTEMENT les familles que la leçon déclare — ni plus, ni moins", () => {
    // L'invariant qui empêche la dérive : `curriculum.drills` sert de
    // spécification lisible (« cette leçon fait écrire »), et une famille
    // déclarée que la séance ne construit jamais est un mensonge silencieux.
    for (const lesson of ARABIC_LESSONS) {
      const played = new Set(
        buildSession(lesson)
          .map((step) => drillOf(step))
          .filter((drill): drill is NonNullable<typeof drill> => drill !== null),
      );
      expect([...played].sort()).toEqual([...lesson.drills].sort());
    }
  });

  it("chaque item visé appartient bien à sa leçon — le serveur le refuserait sinon", () => {
    for (const lesson of ARABIC_LESSONS) {
      const known = new Set<string>([
        ...lesson.letters,
        ...lesson.items.map((item) => item.key),
      ]);
      for (const step of buildSession(lesson) as SessionStep[]) {
        expect(known.has(step.itemKey)).toBe(true);
      }
    }
  });
});
