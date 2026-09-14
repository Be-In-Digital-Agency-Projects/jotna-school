import { describe, it, expect } from "vitest";
import {
  quoteSubscription,
  PRICING_SCALE,
  type SubscriptionQuote,
} from "../pricing";

/** Le total de la spec pour un plancher plein : 50 × 3 000. */
const FLOOR_TOTAL = 150_000;

describe("PRICING_SCALE — la structure, pas les valeurs", () => {
  // Ces trois propriétés sont ce que la spec §7.2 exige de PROTÉGER ; les
  // montants, eux, sont provisoires et changeront. Un barème qui les
  // violerait ferait mentir `quoteSubscription` sans qu'aucun autre test ne
  // s'en aperçoive — le calcul cumulatif suppose des bornes croissantes, et
  // la monotonie du tarif moyen suppose des prix non croissants.
  it("a des bornes strictement croissantes", () => {
    const bounds = PRICING_SCALE.tiers.map((tier) => tier.upToSeat);
    expect(bounds).toEqual([...bounds].sort((a, b) => a - b));
    expect(new Set(bounds).size).toBe(bounds.length);
  });

  it("a des prix par siège non croissants", () => {
    const prices = PRICING_SCALE.tiers.map((tier) => tier.pricePerSeatFcfa);
    for (let i = 1; i < prices.length; i += 1) {
      expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
    }
  });

  it("se termine par une tranche sans borne supérieure", () => {
    const last = PRICING_SCALE.tiers[PRICING_SCALE.tiers.length - 1];
    expect(last.upToSeat).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("quoteSubscription — les trois exemples chiffrés de la spec", () => {
  it("facture 80 sièges 240 000 FCFA", () => {
    expect(quoteSubscription(80)).toEqual<SubscriptionQuote>({
      seatsBilled: 80,
      totalFcfa: 240_000,
      pricePerSeatFcfa: 3_000,
    });
  });

  it("facture 250 sièges 660 000 FCFA", () => {
    // (100 × 3 000) + (150 × 2 400)
    expect(quoteSubscription(250)).toEqual<SubscriptionQuote>({
      seatsBilled: 250,
      totalFcfa: 660_000,
      pricePerSeatFcfa: 2_640,
    });
  });

  it("facture 500 sièges 1 140 000 FCFA", () => {
    // (100 × 3 000) + (200 × 2 400) + (200 × 1 800)
    expect(quoteSubscription(500)).toEqual<SubscriptionQuote>({
      seatsBilled: 500,
      totalFcfa: 1_140_000,
      pricePerSeatFcfa: 2_280,
    });
  });
});

describe("quoteSubscription — les bornes exactes des paliers", () => {
  it("facture le 100e siège au premier palier", () => {
    expect(quoteSubscription(100).totalFcfa).toBe(300_000);
  });

  it("facture le 101e siège au DEUXIÈME palier, et lui seul", () => {
    expect(quoteSubscription(101).totalFcfa).toBe(300_000 + 2_400);
  });

  it("facture le 300e siège au deuxième palier", () => {
    expect(quoteSubscription(300).totalFcfa).toBe(300_000 + 200 * 2_400);
  });

  it("facture le 301e siège au TROISIÈME palier, et lui seul", () => {
    expect(quoteSubscription(301).totalFcfa).toBe(
      300_000 + 200 * 2_400 + 1_800,
    );
  });

  it("ne facture jamais tout le contrat au prix du dernier palier atteint", () => {
    // Le piège que la spec §7.2 identifie : à prix de tranche unique,
    // 101 × 2 400 = 242 400 serait MOINS cher que 100 × 3 000 = 300 000.
    expect(quoteSubscription(101).totalFcfa).toBeGreaterThan(
      quoteSubscription(100).totalFcfa,
    );
    expect(quoteSubscription(101).totalFcfa).not.toBe(101 * 2_400);
    expect(quoteSubscription(301).totalFcfa).not.toBe(301 * 1_800);
  });
});

describe("quoteSubscription — le plancher de 50 sièges", () => {
  it("facture 50 sièges à qui en demande moins", () => {
    for (const requested of [1, 30, 49, 50]) {
      expect(quoteSubscription(requested)).toEqual<SubscriptionQuote>({
        seatsBilled: 50,
        totalFcfa: FLOOR_TOTAL,
        pricePerSeatFcfa: 3_000,
      });
    }
  });

  it("OUVRE les sièges qu'il facture : 51 demandés, 51 facturés", () => {
    expect(quoteSubscription(51)).toEqual<SubscriptionQuote>({
      seatsBilled: 51,
      totalFcfa: 153_000,
      pricePerSeatFcfa: 3_000,
    });
  });

  it("rend le plancher de la constante, pas un 50 recopié", () => {
    expect(quoteSubscription(1).seatsBilled).toBe(PRICING_SCALE.seatFloor);
  });
});

describe("quoteSubscription — entrées absurdes", () => {
  // Zéro, négatif, fractionnaire, NaN, infini : aucun siège, aucun franc, et
  // surtout aucune remontée au plancher — une saisie erronée ne doit pas se
  // transformer en facture. `recordSubscription` les refuse en amont ; ceci
  // est la seconde ligne.
  it("ne facture rien pour 0 siège", () => {
    expect(quoteSubscription(0)).toEqual<SubscriptionQuote>({
      seatsBilled: 0,
      totalFcfa: 0,
      pricePerSeatFcfa: 0,
    });
  });

  it("ne facture rien pour une entrée illisible", () => {
    const absurd = [
      -1,
      -500,
      0.5,
      49.9,
      120.000001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (const value of absurd) {
      expect(quoteSubscription(value)).toEqual<SubscriptionQuote>({
        seatsBilled: 0,
        totalFcfa: 0,
        pricePerSeatFcfa: 0,
      });
    }
  });

  it("ne rend jamais NaN comme tarif moyen", () => {
    expect(Number.isNaN(quoteSubscription(0).pricePerSeatFcfa)).toBe(false);
  });
});

describe("quoteSubscription — monotonie (spec §7.2)", () => {
  // La plage traverse le plancher (50), les deux bornes de palier (100/101 et
  // 300/301) et déborde le dernier palier : c'est là, et seulement là, que la
  // propriété peut se casser.
  const RANGE_END = 420;

  it("ne fait jamais baisser le total quand on ajoute un siège", () => {
    for (let seats = 0; seats < RANGE_END; seats += 1) {
      expect(quoteSubscription(seats + 1).totalFcfa).toBeGreaterThanOrEqual(
        quoteSubscription(seats).totalFcfa,
      );
    }
  });

  it("ne fait jamais remonter le tarif moyen par siège facturé", () => {
    // À partir d'un siège : en dessous il n'y a pas de contrat, donc pas de
    // tarif moyen à comparer (0 y vaut « sans objet », pas « gratuit »).
    for (let seats = 1; seats < RANGE_END; seats += 1) {
      expect(quoteSubscription(seats + 1).pricePerSeatFcfa).toBeLessThanOrEqual(
        quoteSubscription(seats).pricePerSeatFcfa,
      );
    }
  });

  it("ne fait jamais baisser le nombre de sièges facturés", () => {
    for (let seats = 0; seats < RANGE_END; seats += 1) {
      expect(quoteSubscription(seats + 1).seatsBilled).toBeGreaterThanOrEqual(
        quoteSubscription(seats).seatsBilled,
      );
    }
  });
});

describe("quoteSubscription — le tarif moyen ne fait pas foi", () => {
  it("rend un tarif moyen ENTIER", () => {
    for (const seats of [101, 137, 250, 301, 499]) {
      expect(Number.isInteger(quoteSubscription(seats).pricePerSeatFcfa)).toBe(
        true,
      );
    }
  });

  it("ne se reconstitue pas en total : l'arrondi perd des francs", () => {
    // La raison pour laquelle §7.2 interdit de recalculer un total depuis le
    // tarif moyen. Si ce test tombait, c'est que l'arrondi a disparu — et
    // qu'un tarif moyen à décimales est stocké dans `pricePerSeatFcfa`.
    const quote = quoteSubscription(101);
    expect(quote.pricePerSeatFcfa * quote.seatsBilled).not.toBe(
      quote.totalFcfa,
    );
  });
});
