import { describe, it, expect } from "vitest";
import {
  buildDragDropAnswer,
  buildMatchAnswer,
  encodeDragDropAnswer,
  encodeMatchAnswer,
  encodeOrderAnswer,
  encodeQcmAnswer,
  encodeShortAnswer,
  verifyAnswer,
} from "../paliers/answers";

/**
 * TESTS DE CONFORMITÉ DU CONTRAT DE RÉPONSE (plan mobile, tâche 2.11).
 *
 * Ce que chaque cas démontre : la chaîne qu'un client fabrique avec l'encodeur
 * est EXACTEMENT celle que le serveur accepte. C'est le seul garde qui empêche
 * un enfant d'avoir raison et d'être compté faux.
 *
 * Le web et le mobile passeront tous deux par ces encodeurs. Un composant qui
 * fabriquerait sa chaîne à la main échapperait à ces tests — c'est la raison
 * pour laquelle les encodeurs existent plutôt qu'un simple `JSON.stringify`
 * recopié dans chaque écran.
 */

describe("qcm", () => {
  const payload = { correctIndex: 2 };

  it("l'indice choisi est accepté", () => {
    expect(verifyAnswer("qcm", payload, encodeQcmAnswer(2))).toBe(true);
  });

  it("un autre indice est refusé", () => {
    expect(verifyAnswer("qcm", payload, encodeQcmAnswer(0))).toBe(false);
  });

  it("l'indice zéro n'est pas confondu avec « pas de réponse »", () => {
    // `parseInt("0", 10) === 0` est vrai, mais un encodeur qui rendrait "" ou
    // qui testerait la valeur par sa véracité perdrait la première option.
    expect(verifyAnswer("qcm", { correctIndex: 0 }, encodeQcmAnswer(0))).toBe(true);
  });

  it("une chaîne qui n'est pas un nombre est refusée, jamais acceptée par accident", () => {
    // `parseInt("abc", 10)` rend NaN, et NaN n'égale rien — pas même NaN.
    expect(verifyAnswer("qcm", payload, "abc")).toBe(false);
  });
});

describe("order", () => {
  const payload = { correctSequence: ["un", "deux", "trois"] };

  it("la séquence rangée dans le bon ordre est acceptée", () => {
    expect(
      verifyAnswer("order", payload, encodeOrderAnswer(["un", "deux", "trois"])),
    ).toBe(true);
  });

  it("deux éléments intervertis sont refusés", () => {
    expect(
      verifyAnswer("order", payload, encodeOrderAnswer(["deux", "un", "trois"])),
    ).toBe(false);
  });

  it("une séquence incomplète est refusée", () => {
    expect(verifyAnswer("order", payload, encodeOrderAnswer(["un", "deux"]))).toBe(
      false,
    );
  });
});

describe("match", () => {
  const payload = {
    pairs: [
      { left: "chat", right: "mammifère" },
      { left: "aigle", right: "oiseau" },
    ],
  };

  it("les paires justes sont acceptées, dans n'importe quel ordre", () => {
    expect(
      verifyAnswer(
        "match",
        payload,
        encodeMatchAnswer([
          { left: "aigle", right: "oiseau" },
          { left: "chat", right: "mammifère" },
        ]),
      ),
    ).toBe(true);
  });

  it("une paire croisée est refusée", () => {
    expect(
      verifyAnswer(
        "match",
        payload,
        encodeMatchAnswer([
          { left: "chat", right: "oiseau" },
          { left: "aigle", right: "mammifère" },
        ]),
      ),
    ).toBe(false);
  });

  it("RESSERRÉ (ex-laxisme D21) — la même bonne paire répétée est refusée", () => {
    // LE TEST QUI A CHANGÉ DE SENS. Il épinglait le laxisme : longueur puis
    // appartenance, jamais l'unicité — relier une seule paire quatre fois
    // valait l'exercice entier. La comparaison porte désormais sur un
    // multi-ensemble, et chaque paire attendue ne peut servir qu'une fois.
    expect(
      verifyAnswer(
        "match",
        payload,
        encodeMatchAnswer([
          { left: "chat", right: "mammifère" },
          { left: "chat", right: "mammifère" },
        ]),
      ),
    ).toBe(false);
  });

  it("une paire correcte omise, une autre doublée : refusé", () => {
    // La forme que prendrait la triche : le bon compte, que des paires
    // connues, et pourtant l'exercice n'est pas fait.
    expect(
      verifyAnswer(
        "match",
        payload,
        encodeMatchAnswer([
          { left: "aigle", right: "oiseau" },
          { left: "aigle", right: "oiseau" },
        ]),
      ),
    ).toBe(false);
  });

  it("le séparateur de clé ne confond plus deux paires différentes", () => {
    // La clé était `${left}|||${right}`. Pour la paire correcte
    // (« a|||b », « c »), la réponse (« a », « b|||c ») produisait la MÊME
    // chaîne et passait — un mauvais appariement compté juste. Improbable en
    // français d'école, gratuit à fermer, et impossible à voir sans ce test.
    const tricky = { pairs: [{ left: "a|||b", right: "c" }] };
    expect(
      verifyAnswer("match", tricky, encodeMatchAnswer([{ left: "a|||b", right: "c" }])),
    ).toBe(true);
    expect(
      verifyAnswer("match", tricky, encodeMatchAnswer([{ left: "a", right: "b|||c" }])),
    ).toBe(false);
  });
});

describe("drag-drop", () => {
  const payload = {
    items: [
      { text: "pomme", correctZone: "fruits" },
      { text: "carotte", correctZone: "légumes" },
    ],
  };

  it("chaque élément dans sa zone est accepté", () => {
    expect(
      verifyAnswer(
        "drag-drop",
        payload,
        encodeDragDropAnswer({ pomme: "fruits", carotte: "légumes" }),
      ),
    ).toBe(true);
  });

  it("un élément mal posé est refusé", () => {
    expect(
      verifyAnswer(
        "drag-drop",
        payload,
        encodeDragDropAnswer({ pomme: "légumes", carotte: "légumes" }),
      ),
    ).toBe(false);
  });

  it("un élément non posé est refusé", () => {
    expect(
      verifyAnswer("drag-drop", payload, encodeDragDropAnswer({ pomme: "fruits" })),
    ).toBe(false);
  });

  it("RESSERRÉ (ex-laxisme D21) — une clé en trop est refusée", () => {
    // Le vérificateur ne regardait que les étiquettes attendues : le nombre
    // de réponses acceptées était littéralement infini. Le compte des clés
    // est maintenant testé AVANT les zones.
    expect(
      verifyAnswer(
        "drag-drop",
        payload,
        encodeDragDropAnswer({
          pomme: "fruits",
          carotte: "légumes",
          inconnu: "fruits",
        }),
      ),
    ).toBe(false);
  });

  it("une clé héritée du prototype ne vaut pas un rangement", () => {
    // `map[item.text]` allait chercher jusque dans `Object.prototype`.
    // `Object.entries` ne rend que les propriétés propres.
    const proto = { items: [{ text: "toString", correctZone: "fruits" }] };
    expect(verifyAnswer("drag-drop", proto, "{}")).toBe(false);
  });

  it("ce qui n'est pas un objet est refusé sans être interprété", () => {
    expect(verifyAnswer("drag-drop", payload, "[]")).toBe(false);
    expect(verifyAnswer("drag-drop", payload, "null")).toBe(false);
    expect(verifyAnswer("drag-drop", payload, "5")).toBe(false);
  });
});

describe("short-answer", () => {
  const payload = { acceptedAnswers: ["Dakar", "dakar "] };

  it("la réponse exacte est acceptée", () => {
    expect(
      verifyAnswer("short-answer", payload, encodeShortAnswer("Dakar")),
    ).toBe(true);
  });

  it("la casse et les espaces de bord ne comptent pas", () => {
    expect(
      verifyAnswer("short-answer", payload, encodeShortAnswer("  DAKAR  ")),
    ).toBe(true);
  });

  it("une autre réponse est refusée — l'IA rattrape ailleurs, pas ici", () => {
    // `attemptsVerify` peut retourner ce verdict VERS LE HAUT s'il juge la
    // réponse équivalente. Ce vérificateur-ci reste littéral, et c'est ce qui
    // permet de le faire tourner hors connexion (décision D16).
    expect(
      verifyAnswer("short-answer", payload, encodeShortAnswer("Thiès")),
    ).toBe(false);
  });

  it("l'encodeur ne rabote pas le texte de l'enfant", () => {
    // L'IA de rattrapage lit la réponse BRUTE pour juger d'une équivalence de
    // sens : un encodeur qui normaliserait lui retirerait de quoi juger.
    expect(encodeShortAnswer("  la ville de Dakar ")).toBe("  la ville de Dakar ");
  });
});

describe("type inconnu", () => {
  it("n'est jamais compté juste", () => {
    expect(verifyAnswer("charade", {}, "peu importe")).toBe(false);
  });
});

describe("chaîne illisible", () => {
  it.each(["order", "match", "drag-drop"] as const)(
    "%s — un JSON cassé est refusé, pas une exception",
    (type) => {
      expect(verifyAnswer(type, { pairs: [], correctSequence: [], items: [] }, "{[")).toBe(
        false,
      );
    },
  );
});

describe("buildMatchAnswer", () => {
  const left = ["chat", "aigle"];

  it("rend null tant qu'une paire manque — Valider reste éteint", () => {
    expect(buildMatchAnswer(left, { chat: "mammifère" })).toBeNull();
  });

  it("assemble dans l'ordre de la colonne affichée, quel que soit l'ordre des choix", () => {
    const a = buildMatchAnswer(left, { aigle: "oiseau", chat: "mammifère" });
    const b = buildMatchAnswer(left, { chat: "mammifère", aigle: "oiseau" });
    expect(a).toBe(b);
    expect(a).toBe(
      encodeMatchAnswer([
        { left: "chat", right: "mammifère" },
        { left: "aigle", right: "oiseau" },
      ]),
    );
  });

  it("ce qu'elle assemble est accepté par le vérificateur", () => {
    const payload = {
      pairs: [
        { left: "chat", right: "mammifère" },
        { left: "aigle", right: "oiseau" },
      ],
    };
    const answer = buildMatchAnswer(left, { chat: "mammifère", aigle: "oiseau" });
    expect(answer).not.toBeNull();
    expect(verifyAnswer("match", payload, answer!)).toBe(true);
  });
});

describe("buildDragDropAnswer", () => {
  const texts = ["pomme", "carotte"];

  it("rend null tant qu'une étiquette est au vivier", () => {
    expect(buildDragDropAnswer(texts, { pomme: "fruits" })).toBeNull();
  });

  it("ce qu'elle assemble est accepté par le vérificateur", () => {
    const payload = {
      items: [
        { text: "pomme", correctZone: "fruits" },
        { text: "carotte", correctZone: "légumes" },
      ],
    };
    const answer = buildDragDropAnswer(texts, {
      pomme: "fruits",
      carotte: "légumes",
    });
    expect(answer).not.toBeNull();
    expect(verifyAnswer("drag-drop", payload, answer!)).toBe(true);
  });

  it("la complétude se mesure sur les étiquettes ATTENDUES, pas sur la taille de l'objet", () => {
    // Une clé en trop ne remplace pas une étiquette manquante : `verifyDragDrop`
    // lirait `undefined` pour celle qui manque et refuserait.
    expect(
      buildDragDropAnswer(texts, { pomme: "fruits", inconnu: "légumes" }),
    ).toBeNull();
  });
});
