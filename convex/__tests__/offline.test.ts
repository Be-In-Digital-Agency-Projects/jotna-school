import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  encodeDragDropAnswer,
  encodeMatchAnswer,
  encodeOrderAnswer,
  encodeQcmAnswer,
  encodeShortAnswer,
  verifyAnswer,
  type ExerciseType,
} from "../paliers/answers";
import { saltFor, sha256Hex } from "../paliers/digest";
import { buildDigests, verifyOffline } from "../paliers/offline";

/**
 * TESTS CROISÉS APPAREIL / SERVEUR — tâche 3.1 du plan mobile.
 *
 * Chaque cas pose la MÊME question aux deux côtés et exige la même réponse :
 *
 *     verifyOffline(appareil)  ===  verifyAnswer(serveur)
 *
 * C'est le seul garde contre la divergence que la Décision D12 rend possible :
 * hors ligne, l'appareil montre une coche verte que le serveur n'a pas encore
 * donnée. Si les deux ne s'accordent pas, un enfant voit « juste » puis lit
 * « faux » à la synchronisation — ou l'inverse, ce qui est pire.
 *
 * Le hachage est celui de Node ; sur l'appareil ce sera `expo-crypto`. Seule
 * compte la propriété « même entrée, même sortie », que les deux tiennent.
 */
const SALT = "sel-de-test-1234";

const digest = async (input: string): Promise<string> =>
  createHash("sha256").update(input, "utf8").digest("hex");

/** La forme assainie, comme `sanitizePayload` la produit (mélange en moins). */
function clientPayloadOf(type: ExerciseType, server: Record<string, unknown>) {
  switch (type) {
    case "qcm":
      return { options: server.options ?? [] };
    case "order":
      return { items: server.correctSequence as string[] };
    case "match": {
      const pairs = server.pairs as { left: string; right: string }[];
      return { left: pairs.map((p) => p.left), right: pairs.map((p) => p.right) };
    }
    case "drag-drop": {
      const items = server.items as { text: string; correctZone: string }[];
      return { zones: server.zones, items: items.map((it) => ({ text: it.text })) };
    }
    case "short-answer":
      return { tolerance: null };
  }
}

/** Pose la question aux deux côtés et exige le même verdict. */
async function bothAgree(
  type: ExerciseType,
  serverPayload: Record<string, unknown>,
  submitted: string,
): Promise<boolean> {
  const digests = await buildDigests(type, serverPayload, SALT, digest);
  const offline = await verifyOffline(
    type,
    clientPayloadOf(type, serverPayload),
    submitted,
    digests,
    SALT,
    digest,
  );
  const server = verifyAnswer(type, serverPayload, submitted);
  expect(
    offline,
    `l'appareil dit ${offline}, le serveur dit ${server} — pour « ${submitted} »`,
  ).toBe(server);
  return server;
}

describe("qcm", () => {
  const payload = { correctIndex: 2, options: ["a", "b", "c", "d"] };

  it("la bonne option", async () => {
    expect(await bothAgree("qcm", payload, encodeQcmAnswer(2))).toBe(true);
  });
  it("une autre option", async () => {
    expect(await bothAgree("qcm", payload, encodeQcmAnswer(0))).toBe(false);
  });
  it("l'indice zéro quand c'est lui la bonne réponse", async () => {
    expect(
      await bothAgree("qcm", { correctIndex: 0, options: ["a", "b"] }, encodeQcmAnswer(0)),
    ).toBe(true);
  });
  it("une saisie qui n'est pas un nombre", async () => {
    expect(await bothAgree("qcm", payload, "abc")).toBe(false);
  });
});

describe("order", () => {
  const payload = { correctSequence: ["un", "deux", "trois"] };

  it("le bon ordre", async () => {
    expect(
      await bothAgree("order", payload, encodeOrderAnswer(["un", "deux", "trois"])),
    ).toBe(true);
  });
  it("deux éléments intervertis", async () => {
    expect(
      await bothAgree("order", payload, encodeOrderAnswer(["deux", "un", "trois"])),
    ).toBe(false);
  });
  it("une séquence incomplète", async () => {
    expect(await bothAgree("order", payload, encodeOrderAnswer(["un", "deux"]))).toBe(
      false,
    );
  });
  it("un JSON cassé", async () => {
    expect(await bothAgree("order", payload, "{[")).toBe(false);
  });
});

describe("short-answer", () => {
  const payload = { acceptedAnswers: ["Dakar", "la ville de Dakar"] };

  it("la réponse exacte", async () => {
    expect(
      await bothAgree("short-answer", payload, encodeShortAnswer("Dakar")),
    ).toBe(true);
  });
  it("la casse et les espaces ne comptent pas", async () => {
    expect(
      await bothAgree("short-answer", payload, encodeShortAnswer("  DAKAR ")),
    ).toBe(true);
  });
  it("une seconde forme acceptée", async () => {
    expect(
      await bothAgree("short-answer", payload, encodeShortAnswer("La Ville De Dakar")),
    ).toBe(true);
  });
  it("une autre réponse", async () => {
    expect(await bothAgree("short-answer", payload, encodeShortAnswer("Thiès"))).toBe(
      false,
    );
  });
});

describe("match", () => {
  const payload = {
    pairs: [
      { left: "chat", right: "mammifère" },
      { left: "aigle", right: "oiseau" },
      { left: "truite", right: "poisson" },
    ],
  };

  it("les bonnes paires", async () => {
    expect(
      await bothAgree(
        "match",
        payload,
        encodeMatchAnswer([
          { left: "chat", right: "mammifère" },
          { left: "aigle", right: "oiseau" },
          { left: "truite", right: "poisson" },
        ]),
      ),
    ).toBe(true);
  });

  it("l'ordre des paires ne compte pas", async () => {
    expect(
      await bothAgree(
        "match",
        payload,
        encodeMatchAnswer([
          { left: "truite", right: "poisson" },
          { left: "chat", right: "mammifère" },
          { left: "aigle", right: "oiseau" },
        ]),
      ),
    ).toBe(true);
  });

  it("une paire croisée", async () => {
    expect(
      await bothAgree(
        "match",
        payload,
        encodeMatchAnswer([
          { left: "chat", right: "oiseau" },
          { left: "aigle", right: "mammifère" },
          { left: "truite", right: "poisson" },
        ]),
      ),
    ).toBe(false);
  });

  // LE CAS QUI A FAIT CHANGER LE SCHÉMA D'EMPREINTES.
  //
  // CE TEST A CHANGÉ DE SENS, ET C'EST TOUT L'INTÉRÊT DE `bothAgree`.
  //
  // Il épinglait un laxisme partagé : les deux côtés acceptaient la même bonne
  // paire répétée, l'appareil par construction (un atome connu suffisait), le
  // serveur par appartenance à un ensemble. Les deux l'ont perdu ENSEMBLE —
  // `verifyMatch` compare des multi-ensembles de paires, `verifyOffline` des
  // multi-ensembles d'empreintes. Si l'un des deux avait été resserré seul,
  // c'est ici que ça se verrait, et pas en production chez un enfant.
  it("RESSERRÉ — la même bonne paire répétée : les deux côtés la refusent", async () => {
    expect(
      await bothAgree(
        "match",
        payload,
        encodeMatchAnswer([
          { left: "chat", right: "mammifère" },
          { left: "chat", right: "mammifère" },
          { left: "chat", right: "mammifère" },
        ]),
      ),
    ).toBe(false);
  });

  it("le mauvais NOMBRE de paires", async () => {
    expect(
      await bothAgree(
        "match",
        payload,
        encodeMatchAnswer([{ left: "chat", right: "mammifère" }]),
      ),
    ).toBe(false);
  });
});

describe("drag-drop", () => {
  const payload = {
    zones: ["fruits", "légumes"],
    items: [
      { text: "pomme", correctZone: "fruits" },
      { text: "carotte", correctZone: "légumes" },
    ],
  };

  it("chaque étiquette dans sa zone", async () => {
    expect(
      await bothAgree(
        "drag-drop",
        payload,
        encodeDragDropAnswer({ pomme: "fruits", carotte: "légumes" }),
      ),
    ).toBe(true);
  });

  it("une étiquette mal posée", async () => {
    expect(
      await bothAgree(
        "drag-drop",
        payload,
        encodeDragDropAnswer({ pomme: "légumes", carotte: "légumes" }),
      ),
    ).toBe(false);
  });

  it("une étiquette non posée", async () => {
    expect(
      await bothAgree("drag-drop", payload, encodeDragDropAnswer({ pomme: "fruits" })),
    ).toBe(false);
  });

  it("RESSERRÉ — une clé en trop est refusée des deux côtés", async () => {
    expect(
      await bothAgree(
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

  it("un rangement JUSTE passe toujours, resserrement compris", async () => {
    // LE GARDE DU GARDE. Un resserrement qui refuserait aussi les bonnes
    // réponses serait pire que le laxisme : l'enfant ferait tout bien et
    // l'application lui dirait non. Ce cas-là doit rester vert quoi qu'il
    // arrive aux deux précédents.
    expect(
      await bothAgree(
        "drag-drop",
        payload,
        encodeDragDropAnswer({ carotte: "légumes", pomme: "fruits" }),
      ),
    ).toBe(true);
  });
});

describe("les exercices dégénérés — là où les deux côtés divergeaient", () => {
  // TROUVÉ EN RELISANT LE RESSERREMENT, pas en le testant. Un exercice sans
  // paire ni étiquette n'arrive pas par l'interface — les composants le
  // refusent — mais `verifyAnswer` est la frontière de confiance, et il
  // répondait JUSTE là où l'appareil répondait FAUX. `bothAgree` l'aurait
  // signalé si quelqu'un avait pensé à poser le cas. Voilà le cas.
  it("relier sans aucune paire : les deux refusent", async () => {
    expect(await bothAgree("match", { pairs: [] }, encodeMatchAnswer([]))).toBe(
      false,
    );
  });

  it("ranger sans aucune étiquette : les deux refusent", async () => {
    expect(
      await bothAgree(
        "drag-drop",
        { zones: ["a", "b"], items: [] },
        encodeDragDropAnswer({}),
      ),
    ).toBe(false);
  });
});

describe("le sel et le type isolent les empreintes", () => {
  it("deux exercices de types différents ne se valident pas l'un l'autre", async () => {
    // Sans le préfixe de type, l'atome d'une réponse courte « 2 » et celui
    // d'un QCM d'indice 2 seraient identiques.
    const qcm = await buildDigests("qcm", { correctIndex: 2 }, SALT, digest);
    const short = await verifyOffline(
      "short-answer",
      { tolerance: null },
      encodeShortAnswer("2"),
      qcm,
      SALT,
      digest,
    );
    expect(short).toBe(false);
  });

  it("un sel différent donne une empreinte différente", async () => {
    const a = await buildDigests("qcm", { correctIndex: 2 }, "sel-a", digest);
    const b = await buildDigests("qcm", { correctIndex: 2 }, "sel-b", digest);
    expect(a).not.toEqual(b);
  });

  it("le lot d'un exercice ne valide pas la réponse d'un autre", async () => {
    const autre = await buildDigests("qcm", { correctIndex: 3 }, SALT, digest);
    expect(
      await verifyOffline(
        "qcm",
        { options: [] },
        encodeQcmAnswer(2),
        autre,
        SALT,
        digest,
      ),
    ).toBe(false);
  });
});

describe("l'empreinte RÉELLE du serveur", () => {
  it("sha256Hex accorde l'appareil et le serveur, comme celle de Node", async () => {
    // Les tests ci-dessus injectent le hachage de Node. Celui-ci éprouve la
    // fonction que le serveur emploie VRAIMENT — `crypto.subtle`, disponible
    // dans l'exécution Convex comme dans l'environnement de test.
    const payload = {
      pairs: [
        { left: "chat", right: "mammifère" },
        { left: "aigle", right: "oiseau" },
      ],
    };
    const salt = saltFor("attempt_abc", "exo_123");
    const digests = await buildDigests("match", payload, salt, sha256Hex);

    const juste = await verifyOffline(
      "match",
      { left: ["chat", "aigle"], right: ["oiseau", "mammifère"] },
      encodeMatchAnswer([
        { left: "chat", right: "mammifère" },
        { left: "aigle", right: "oiseau" },
      ]),
      digests,
      salt,
      sha256Hex,
    );
    expect(juste).toBe(true);
  });

  it("rend de l'hexadécimal minuscule — c'est le contrat entre les deux côtés", async () => {
    const d = await sha256Hex("peu importe");
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });

  it("le sel dérivé est unique par couple (tentative, exercice)", async () => {
    expect(saltFor("a", "x")).not.toBe(saltFor("a", "y"));
    expect(saltFor("a", "x")).not.toBe(saltFor("b", "x"));
    // Et STABLE : une mutation rejouée doit livrer les mêmes empreintes.
    expect(saltFor("a", "x")).toBe(saltFor("a", "x"));
  });
});
