import { describe, it, expect } from "vitest";
import {
  classEnum,
  VISIBLE_CLASSES,
  HIDDEN_CLASSES,
  isHiddenClass,
  assertVisibleClass,
  visibleClassValidator,
  type ClassName,
} from "../curriculum";

/** Les littéraux d'une union de validateurs Convex. */
function literals(union: typeof classEnum | typeof visibleClassValidator) {
  return union.members.map((member) => String(member.value));
}

describe("curriculum — ce que le schéma accepte, ce que le client voit", () => {
  it("classe chaque niveau du schéma dans exactement une des deux listes", () => {
    // LE TEST QUI COMPTE. Le jour où un niveau entre dans `classEnum` sans
    // être rangé, il n'est ni servi ni masqué : `isHiddenClass` le laisse
    // passer, et du contenu non relu s'affiche chez un élève.
    const declared = literals(classEnum).sort();
    const classified = [...VISIBLE_CLASSES, ...HIDDEN_CLASSES].sort();

    expect(classified).toEqual(declared);
    expect(new Set(classified).size).toBe(classified.length);
  });

  it("ne montre que l'élémentaire, et masque collège et lycée", () => {
    expect([...VISIBLE_CLASSES]).toEqual([
      "CI",
      "CP",
      "CE1",
      "CE2",
      "CM1",
      "CM2",
    ]);
    for (const klass of VISIBLE_CLASSES) {
      expect(isHiddenClass(klass)).toBe(false);
    }
    for (const klass of HIDDEN_CLASSES) {
      expect(isHiddenClass(klass)).toBe(true);
    }
  });

  it("ne masque pas une thématique sans niveau", () => {
    // `topics.class` est optionnel : les lignes semées avant la décision 14
    // n'en portent pas, et elles appartiennent à l'élémentaire.
    expect(isHiddenClass(undefined)).toBe(false);
    expect(isHiddenClass(null)).toBe(false);
  });

  it("n'autorise à l'écriture que les niveaux visibles", () => {
    expect(literals(visibleClassValidator).sort()).toEqual(
      [...VISIBLE_CLASSES].sort(),
    );
  });

  it("refuse un niveau masqué là où seul l'élémentaire a un sens", () => {
    expect(assertVisibleClass("CM1")).toBe("CM1");
    expect(() => assertVisibleClass("Tle" as ClassName)).toThrow(/Tle/);
  });
});
