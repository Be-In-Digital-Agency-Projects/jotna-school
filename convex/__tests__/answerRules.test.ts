import { describe, it, expect } from "vitest";
import {
  verifyAnswer,
  verifyDragDrop,
  verifyMatch,
  verifyOrder,
  verifyQcm,
  verifyShortAnswer,
} from "../answerRules";

// ---------------------------------------------------------------------------
// Ces tests importent la production. Les vérificateurs vivaient dans deux
// fichiers de mutations et étaient RÉÉCRITS dans `attempts.test.ts` : la suite
// notait une copie, pas le code exécuté. Tout ce qui suit passe par le module
// réellement appelé par `attempts.submit` et `palierAttempts.verifyAttempt`.
// ---------------------------------------------------------------------------

describe("verifyMatch — bijection exigée", () => {
  const payload = {
    pairs: [
      { left: "Cat", right: "Chat" },
      { left: "Dog", right: "Chien" },
      { left: "Bird", right: "Oiseau" },
      { left: "Fish", right: "Poisson" },
    ],
  };

  it("accepte les quatre paires justes", () => {
    expect(verifyMatch(JSON.stringify(payload.pairs), payload)).toBe(true);
  });

  it("accepte quel que soit l'ordre des paires", () => {
    const shuffled = [...payload.pairs].reverse();
    expect(verifyMatch(JSON.stringify(shuffled), payload)).toBe(true);
  });

  it("REFUSE la même bonne paire répétée quatre fois", () => {
    const answer = JSON.stringify([
      { left: "Cat", right: "Chat" },
      { left: "Cat", right: "Chat" },
      { left: "Cat", right: "Chat" },
      { left: "Cat", right: "Chat" },
    ]);
    expect(verifyMatch(answer, payload)).toBe(false);
  });

  it("REFUSE un doublon qui remplace une paire manquante", () => {
    const answer = JSON.stringify([
      { left: "Cat", right: "Chat" },
      { left: "Cat", right: "Chat" },
      { left: "Dog", right: "Chien" },
      { left: "Bird", right: "Oiseau" },
    ]);
    expect(verifyMatch(answer, payload)).toBe(false);
  });

  it("refuse une paire fausse", () => {
    const answer = JSON.stringify([
      { left: "Cat", right: "Chien" },
      { left: "Dog", right: "Chat" },
      { left: "Bird", right: "Oiseau" },
      { left: "Fish", right: "Poisson" },
    ]);
    expect(verifyMatch(answer, payload)).toBe(false);
  });

  it("refuse un nombre de paires différent", () => {
    expect(verifyMatch(JSON.stringify([payload.pairs[0]]), payload)).toBe(false);
    expect(
      verifyMatch(JSON.stringify([...payload.pairs, payload.pairs[0]]), payload),
    ).toBe(false);
  });

  it("accepte une répétition quand le contenu l'attend vraiment", () => {
    // Deux paires identiques dans le payload : la soumission doit la porter
    // deux fois. Un multi-ensemble le permet, un « aucun doublon » non.
    const repeated = {
      pairs: [
        { left: "Cat", right: "Chat" },
        { left: "Cat", right: "Chat" },
      ],
    };
    expect(verifyMatch(JSON.stringify(repeated.pairs), repeated)).toBe(true);
    expect(
      verifyMatch(JSON.stringify([{ left: "Cat", right: "Chat" }]), repeated),
    ).toBe(false);
  });

  it("refuse une collision fabriquée avec le séparateur", () => {
    const tricky = { pairs: [{ left: "a", right: "b|||c" }] };
    expect(
      verifyMatch(JSON.stringify([{ left: "a|||b", right: "c" }]), tricky),
    ).toBe(false);
  });

  it("refuse un JSON invalide, un non-tableau, une paire malformée", () => {
    expect(verifyMatch("not json", payload)).toBe(false);
    expect(verifyMatch(JSON.stringify({ left: "Cat" }), payload)).toBe(false);
    expect(verifyMatch(JSON.stringify([null, null, null, null]), payload)).toBe(
      false,
    );
    expect(
      verifyMatch(JSON.stringify([{ left: 1, right: 2 }]), payload),
    ).toBe(false);
  });
});

describe("verifyDragDrop — clés inattendues refusées", () => {
  const payload = {
    items: [
      { text: "Apple", correctZone: "Fruits" },
      { text: "Carrot", correctZone: "Vegetables" },
      { text: "Banana", correctZone: "Fruits" },
    ],
  };

  it("accepte tous les éléments bien placés", () => {
    const answer = JSON.stringify({
      Apple: "Fruits",
      Carrot: "Vegetables",
      Banana: "Fruits",
    });
    expect(verifyDragDrop(answer, payload)).toBe(true);
  });

  it("REFUSE une clé en trop, même quand tout l'attendu est juste", () => {
    const answer = JSON.stringify({
      Apple: "Fruits",
      Carrot: "Vegetables",
      Banana: "Fruits",
      Hammer: "Fruits",
    });
    expect(verifyDragDrop(answer, payload)).toBe(false);
  });

  it("refuse un élément mal placé", () => {
    const answer = JSON.stringify({
      Apple: "Vegetables",
      Carrot: "Vegetables",
      Banana: "Fruits",
    });
    expect(verifyDragDrop(answer, payload)).toBe(false);
  });

  it("refuse un élément manquant", () => {
    const answer = JSON.stringify({ Apple: "Fruits", Carrot: "Vegetables" });
    expect(verifyDragDrop(answer, payload)).toBe(false);
  });

  it("refuse un JSON invalide, un tableau, null", () => {
    expect(verifyDragDrop("not json", payload)).toBe(false);
    expect(verifyDragDrop(JSON.stringify(["Fruits"]), payload)).toBe(false);
    expect(verifyDragDrop("null", payload)).toBe(false);
  });
});

describe("verifyQcm", () => {
  const payload = { correctIndex: 2 };
  it("accepte l'index juste", () => expect(verifyQcm("2", payload)).toBe(true));
  it("refuse un index faux", () => expect(verifyQcm("3", payload)).toBe(false));
  it("refuse une entrée non numérique", () =>
    expect(verifyQcm("abc", payload)).toBe(false));
});

describe("verifyOrder", () => {
  const payload = { correctSequence: ["First", "Second", "Third"] };
  it("accepte la séquence exacte", () =>
    expect(verifyOrder(JSON.stringify(payload.correctSequence), payload)).toBe(
      true,
    ));
  it("refuse un ordre faux", () =>
    expect(
      verifyOrder(JSON.stringify(["Second", "First", "Third"]), payload),
    ).toBe(false));
  it("refuse un doublon à la place d'un élément", () =>
    expect(
      verifyOrder(JSON.stringify(["First", "First", "Third"]), payload),
    ).toBe(false));
  it("refuse un JSON invalide ou un non-tableau", () => {
    expect(verifyOrder("not json", payload)).toBe(false);
    expect(verifyOrder(JSON.stringify({ 0: "First" }), payload)).toBe(false);
  });
});

describe("verifyShortAnswer", () => {
  const payload = { acceptedAnswers: ["Paris"] };
  it("accepte la casse et les espaces de bord", () => {
    expect(verifyShortAnswer("  pArIs ", payload)).toBe(true);
  });
  it("refuse une autre réponse et la chaîne vide", () => {
    expect(verifyShortAnswer("Lyon", payload)).toBe(false);
    expect(verifyShortAnswer("", payload)).toBe(false);
  });
});

describe("verifyAnswer — aiguillage", () => {
  it("route chaque type vers son vérificateur", () => {
    expect(verifyAnswer("qcm", { correctIndex: 1 }, "1")).toBe(true);
    expect(
      verifyAnswer(
        "match",
        { pairs: [{ left: "a", right: "b" }] },
        JSON.stringify([{ left: "a", right: "b" }]),
      ),
    ).toBe(true);
    expect(
      verifyAnswer("order", { correctSequence: ["a"] }, JSON.stringify(["a"])),
    ).toBe(true);
    expect(
      verifyAnswer(
        "drag-drop",
        { items: [{ text: "a", correctZone: "Z" }] },
        JSON.stringify({ a: "Z" }),
      ),
    ).toBe(true);
    expect(
      verifyAnswer("short-answer", { acceptedAnswers: ["a"] }, "A"),
    ).toBe(true);
  });

  it("refuse un type inconnu", () => {
    expect(verifyAnswer("sudoku", {}, "anything")).toBe(false);
  });

  it("refuse plutôt que de lever sur un payload malformé", () => {
    expect(verifyAnswer("match", {}, JSON.stringify([]))).toBe(false);
    expect(verifyAnswer("drag-drop", {}, JSON.stringify({}))).toBe(false);
  });
});
