import { describe, expect, it } from "vitest";
import {
  addSpendCounters,
  emptySpendCounters,
  foldSpendShards,
  monthKey,
  pickSpendShard,
  SPEND_SHARD_COUNT,
  type SpendCounters,
  usageDelta,
} from "../aiGateway/spendShards";
import { approximateTokenCount, estimateCostUsd } from "../aiGateway/registry";

describe("pickSpendShard — le fragment visé reste toujours dans la plage", () => {
  it("couvre exactement les fragments 0..N-1 sur l'intervalle unité", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const shard = pickSpendShard(i / 1000);
      expect(Number.isInteger(shard)).toBe(true);
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(SPEND_SHARD_COUNT);
      seen.add(shard);
    }
    expect(seen.size).toBe(SPEND_SHARD_COUNT);
  });

  it("répartit à peu près uniformément (aucun fragment ne concentre tout)", () => {
    const counts = new Array<number>(SPEND_SHARD_COUNT).fill(0);
    for (let i = 0; i < 8000; i++) counts[pickSpendShard(i / 8000)]++;
    for (const c of counts) expect(c).toBe(1000);
  });

  it("ramène dans la plage toute entrée aberrante — jamais de fragment invisible", () => {
    expect(pickSpendShard(-0.5)).toBe(0);
    expect(pickSpendShard(1)).toBe(SPEND_SHARD_COUNT - 1);
    expect(pickSpendShard(42)).toBe(SPEND_SHARD_COUNT - 1);
    expect(pickSpendShard(Number.NaN)).toBe(0);
    expect(pickSpendShard(Number.POSITIVE_INFINITY)).toBe(0);
    expect(pickSpendShard(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("usageDelta — ce qui compte comme dépense", () => {
  it("compte le coût d'un appel réussi", () => {
    const d = usageDelta({ status: "ok", purpose: "palier_base", costUsd: 0.5 });
    expect(d.costUsd).toBe(0.5);
    expect(d.calls).toBe(1);
    expect(d.byPurpose).toEqual({ palier_base: { calls: 1, cost: 0.5 } });
  });

  it("compte AUSSI le coût d'un appel en échec qui a reçu une réponse facturée", () => {
    // Le cas qui rouvrait le trou : OpenAI a répondu (jetons facturés), la
    // validation locale a rejeté. Statut `failed`, dépense bien réelle.
    const d = usageDelta({
      status: "failed",
      purpose: "palier_base",
      costUsd: 0.036,
    });
    expect(d.costUsd).toBe(0.036);
    expect(d.failed).toBe(1);
    expect(d.byPurpose).toEqual({ palier_base: { calls: 1, cost: 0.036 } });
  });

  it("n'invente pas de dépense pour un rejet (coût nul par construction)", () => {
    const budget = usageDelta({
      status: "rejected_budget",
      purpose: "explain_mistake",
      costUsd: 0,
    });
    expect(budget.costUsd).toBe(0);
    expect(budget.rejectedBudget).toBe(1);
    expect(budget.calls).toBe(1);

    const quota = usageDelta({
      status: "rejected_quota",
      purpose: "explain_mistake",
      costUsd: 0,
    });
    expect(quota.rejectedQuota).toBe(1);

    const access = usageDelta({
      status: "rejected_access",
      purpose: "explain_mistake",
      costUsd: 0,
    });
    expect(access.rejectedAccess).toBe(1);
  });

  it("classe chaque statut dans un seul compteur", () => {
    const d = usageDelta({ status: "ok", purpose: "verify_math", costUsd: 1 });
    expect(d.failed + d.rejectedBudget + d.rejectedQuota + d.rejectedAccess).toBe(
      0,
    );
  });
});

describe("addSpendCounters", () => {
  it("ne modifie aucun de ses deux arguments", () => {
    const base = usageDelta({
      status: "ok",
      purpose: "palier_base",
      costUsd: 1,
    });
    const delta = usageDelta({
      status: "ok",
      purpose: "palier_base",
      costUsd: 2,
    });
    addSpendCounters(base, delta);
    expect(base.costUsd).toBe(1);
    expect(base.byPurpose.palier_base).toEqual({ calls: 1, cost: 1 });
    expect(delta.costUsd).toBe(2);
  });

  it("fusionne les usages communs et conserve les usages distincts", () => {
    const merged = addSpendCounters(
      usageDelta({ status: "ok", purpose: "palier_base", costUsd: 1 }),
      usageDelta({ status: "ok", purpose: "verify_short_answer", costUsd: 0.25 }),
    );
    expect(merged.costUsd).toBe(1.25);
    expect(merged.calls).toBe(2);
    expect(merged.byPurpose).toEqual({
      palier_base: { calls: 1, cost: 1 },
      verify_short_answer: { calls: 1, cost: 0.25 },
    });
  });

  it("est neutre vis-à-vis des compteurs vides", () => {
    const d = usageDelta({ status: "ok", purpose: "pdf_extract", costUsd: 3 });
    expect(addSpendCounters(emptySpendCounters(), d)).toEqual(d);
    expect(addSpendCounters(d, emptySpendCounters())).toEqual(d);
  });
});

describe("foldSpendShards — la somme fragmentée est exacte, pas approchée", () => {
  it("vaut zéro quand aucun fragment n'existe (mois neuf)", () => {
    expect(foldSpendShards([])).toEqual(emptySpendCounters());
  });

  /**
   * Le cœur du correctif : 5000 appels répartis sur les fragments doivent se
   * resommer exactement, là où l'ancien `.take(1000)` en perdait 4000.
   */
  it("retrouve le total de 5000 appels répartis sur les fragments", () => {
    const shards: SpendCounters[] = Array.from(
      { length: SPEND_SHARD_COUNT },
      () => emptySpendCounters(),
    );
    let expected = 0;
    for (let i = 0; i < 5000; i++) {
      const cost = 0.01;
      expected += cost;
      const shard = pickSpendShard(i / 5000);
      shards[shard] = addSpendCounters(
        shards[shard],
        usageDelta({ status: "ok", purpose: "palier_base", costUsd: cost }),
      );
    }
    const total = foldSpendShards(shards);
    expect(total.calls).toBe(5000);
    expect(total.costUsd).toBeCloseTo(expected, 8);
    expect(total.byPurpose.palier_base.calls).toBe(5000);
  });

  it("donne le même total quel que soit l'ordre des fragments", () => {
    const shards = [
      usageDelta({ status: "ok", purpose: "palier_base", costUsd: 1 }),
      usageDelta({ status: "failed", purpose: "verify_math", costUsd: 0.5 }),
      usageDelta({ status: "rejected_budget", purpose: "pdf_extract", costUsd: 0 }),
    ];
    const forward = foldSpendShards(shards);
    const backward = foldSpendShards([...shards].reverse());
    expect(forward).toEqual(backward);
    expect(forward.costUsd).toBe(1.5);
    expect(forward.calls).toBe(3);
  });

  it("la ventilation par usage se resomme au total affiché", () => {
    const total = foldSpendShards([
      usageDelta({ status: "ok", purpose: "palier_base", costUsd: 2 }),
      usageDelta({ status: "ok", purpose: "explain_mistake", costUsd: 0.5 }),
      usageDelta({ status: "failed", purpose: "explain_mistake", costUsd: 0.1 }),
    ]);
    const sumOfBars = Object.values(total.byPurpose).reduce(
      (acc, p) => acc + p.cost,
      0,
    );
    expect(sumOfBars).toBeCloseTo(total.costUsd, 8);
  });
});

describe("monthKey", () => {
  it("formate en YYYY-MM UTC avec un mois sur deux chiffres", () => {
    expect(monthKey(new Date(Date.UTC(2026, 0, 31, 23, 0, 0)))).toBe("2026-01");
    expect(monthKey(new Date(Date.UTC(2026, 8, 14, 12, 0, 0)))).toBe("2026-09");
    expect(monthKey(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe(
      "2026-12",
    );
  });
});

describe("tarif gpt-4o — le poste le plus cher est désormais dans la table", () => {
  it("chiffre l'extraction PDF au tarif gpt-4o, pas à celui du mini", () => {
    const pdf = estimateCostUsd("pdf_extract", 1_000_000, 1_000_000);
    const mini = estimateCostUsd("palier_base", 1_000_000, 1_000_000);
    expect(pdf).toBeCloseTo(12.5, 8);
    expect(mini).toBeCloseTo(0.75, 8);
    expect(pdf / mini).toBeGreaterThan(16);
  });
});

describe("approximateTokenCount — filet contre le zéro faux", () => {
  it("estime ~4 caractères par jeton et arrondit vers le haut", () => {
    expect(approximateTokenCount("")).toBe(0);
    expect(approximateTokenCount("abcd")).toBe(1);
    expect(approximateTokenCount("abcde")).toBe(2);
    expect(approximateTokenCount("x".repeat(4000))).toBe(1000);
  });

  it("ne renvoie jamais zéro pour un texte non vide", () => {
    for (const text of ["a", "ab", "réponse", "0"]) {
      expect(approximateTokenCount(text)).toBeGreaterThan(0);
    }
  });
});
