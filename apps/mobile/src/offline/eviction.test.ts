import { describe, expect, it } from "vitest";

import { planEviction, type EvictionCandidate } from "./eviction";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function bundle(over: Partial<EvictionCandidate> & { palierAttemptId: string }): EvictionCandidate {
  return {
    downloadedAt: NOW - DAY,
    accessValidUntil: NOW + 7 * DAY,
    bytes: 100,
    hasPending: false,
    awaitsClose: false,
    ...over,
  };
}

describe("planEviction — les trois protections", () => {
  it("ne touche à rien quand on est sous le plafond", () => {
    const plan = planEviction(
      [bundle({ palierAttemptId: "a" }), bundle({ palierAttemptId: "b" })],
      { now: NOW, maxBytes: 1000 },
    );
    expect(plan.remove).toEqual([]);
    expect(plan.remaining).toBe(200);
  });

  it("NE SUPPRIME JAMAIS un lot dont des réponses attendent, même le plus gros et le plus vieux", () => {
    const plan = planEviction(
      [
        bundle({
          palierAttemptId: "travail",
          downloadedAt: NOW - 30 * DAY,
          bytes: 900,
          hasPending: true,
        }),
        bundle({ palierAttemptId: "jetable", bytes: 100 }),
      ],
      { now: NOW, maxBytes: 500 },
    );
    expect(plan.remove).toEqual(["jetable"]);
    // Le plafond CÈDE : 900 restent, au-dessus des 500 demandés.
    expect(plan.remaining).toBe(900);
  });

  it("NE SUPPRIME JAMAIS un lot qui attend sa clôture — le marqueur vit dans sa ligne", () => {
    const plan = planEviction(
      [bundle({ palierAttemptId: "fini", bytes: 900, awaitsClose: true })],
      { now: NOW, maxBytes: 100 },
    );
    expect(plan.remove).toEqual([]);
    expect(plan.remaining).toBe(900);
  });

  it("ne supprime pas ce que l'appelant garde — le lot qu'on joue", () => {
    const plan = planEviction(
      [
        bundle({ palierAttemptId: "en-cours", downloadedAt: NOW - 30 * DAY, bytes: 900 }),
        bundle({ palierAttemptId: "vieux", downloadedAt: NOW - 20 * DAY, bytes: 900 }),
      ],
      { keep: ["en-cours"], now: NOW, maxBytes: 1000 },
    );
    expect(plan.remove).toEqual(["vieux"]);
  });
});

describe("planEviction — l'ordre", () => {
  it("les périmés partent d'abord, sans regarder la taille", () => {
    const plan = planEviction(
      [bundle({ palierAttemptId: "perime", accessValidUntil: NOW - 1, bytes: 10 })],
      { now: NOW, maxBytes: 1_000_000 },
    );
    expect(plan.remove).toEqual(["perime"]);
    expect(plan.remaining).toBe(0);
  });

  it("un lot périmé MAIS en attente de synchronisation survit quand même", () => {
    // Le bail d'accès est fini, mais les réponses n'ont pas été envoyées :
    // `flushJournal` a encore besoin de la date de téléchargement de ce lot.
    const plan = planEviction(
      [
        bundle({
          palierAttemptId: "perime-mais-plein",
          accessValidUntil: NOW - 1,
          hasPending: true,
        }),
      ],
      { now: NOW, maxBytes: 0 },
    );
    expect(plan.remove).toEqual([]);
  });

  it("la place des périmés est décomptée AVANT de condamner un lot valable", () => {
    // C'est le bug que ce test verrouille : si l'on ne décompte les périmés
    // qu'en les croisant, le total reste au-dessus du plafond et l'on
    // condamne « recent » alors que la place de « perime » suffisait.
    const plan = planEviction(
      [
        bundle({ palierAttemptId: "recent", downloadedAt: NOW - DAY, bytes: 400 }),
        bundle({
          palierAttemptId: "perime",
          downloadedAt: NOW - 10 * DAY,
          accessValidUntil: NOW - 1,
          bytes: 400,
        }),
      ],
      { now: NOW, maxBytes: 500 },
    );
    expect(plan.remove).toEqual(["perime"]);
    expect(plan.remaining).toBe(400);
  });

  it("puis les plus VIEUX, et l'on s'arrête dès qu'on repasse sous le plafond", () => {
    const plan = planEviction(
      [
        bundle({ palierAttemptId: "c", downloadedAt: NOW - 1 * DAY, bytes: 300 }),
        bundle({ palierAttemptId: "a", downloadedAt: NOW - 3 * DAY, bytes: 300 }),
        bundle({ palierAttemptId: "b", downloadedAt: NOW - 2 * DAY, bytes: 300 }),
      ],
      { now: NOW, maxBytes: 600 },
    );
    expect(plan.remove).toEqual(["a"]);
    expect(plan.remaining).toBe(600);
  });

  it("l'ordre d'entrée ne change pas la décision — c'est la date qui décide", () => {
    const candidates = [
      bundle({ palierAttemptId: "a", downloadedAt: NOW - 3 * DAY, bytes: 300 }),
      bundle({ palierAttemptId: "b", downloadedAt: NOW - 2 * DAY, bytes: 300 }),
      bundle({ palierAttemptId: "c", downloadedAt: NOW - 1 * DAY, bytes: 300 }),
    ];
    const forward = planEviction(candidates, { now: NOW, maxBytes: 300 });
    const backward = planEviction([...candidates].reverse(), {
      now: NOW,
      maxBytes: 300,
    });
    expect(forward.remove).toEqual(["a", "b"]);
    expect(backward.remove).toEqual(["a", "b"]);
  });

  it("ne modifie pas la liste qu'on lui donne", () => {
    const candidates = [
      bundle({ palierAttemptId: "c", downloadedAt: NOW - 1 * DAY }),
      bundle({ palierAttemptId: "a", downloadedAt: NOW - 3 * DAY }),
    ];
    planEviction(candidates, { now: NOW, maxBytes: 0 });
    expect(candidates.map((c) => c.palierAttemptId)).toEqual(["c", "a"]);
  });
});

describe("planEviction — le cas où tout est protégé", () => {
  it("rend une liste vide plutôt que de choisir une victime", () => {
    const plan = planEviction(
      [
        bundle({ palierAttemptId: "a", bytes: 5000, hasPending: true }),
        bundle({ palierAttemptId: "b", bytes: 5000, awaitsClose: true }),
        bundle({ palierAttemptId: "c", bytes: 5000 }),
      ],
      { keep: ["c"], now: NOW, maxBytes: 100 },
    );
    expect(plan.remove).toEqual([]);
    expect(plan.remaining).toBe(15000);
  });
});
