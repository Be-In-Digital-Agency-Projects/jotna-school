import { describe, it, expect } from "vitest";
import {
  quoteSubscription,
  quoteWithScale,
  PRICING_SCALE,
  type PricingScale,
  type SubscriptionQuote,
} from "../pricing";

/** Le barème en vigueur : 5 000 FCFA par élève et par année scolaire. */
const SEAT_PRICE = 5_000;
/** Plancher plein : 30 × 5 000 = 150 000 FCFA. */
const FLOOR_TOTAL = 30 * SEAT_PRICE;

/**
 * Barème DÉGRESSIF de démonstration — celui de la spec §7.1 avant la décision
 * du prix plat. Il n'est en vigueur nulle part ; il existe pour que le moteur
 * cumulatif reste testé alors que `PRICING_SCALE` n'a plus qu'une tranche à lui
 * donner. Sans lui, le jour où une remise au volume sera consentie, elle
 * arriverait sur un calcul que plus aucun test ne couvre.
 */
const DEGRESSIVE_FIXTURE: PricingScale = {
  seatFloor: 50,
  tiers: [
    { upToSeat: 100, pricePerSeatFcfa: 3_000 },
    { upToSeat: 300, pricePerSeatFcfa: 2_400 },
    { upToSeat: Number.POSITIVE_INFINITY, pricePerSeatFcfa: 1_800 },
  ],
};

describe("PRICING_SCALE — la structure, pas les valeurs", () => {
  // Ces trois propriétés sont ce que la spec §7.2 exige de PROTÉGER ; les
  // montants, eux, sont provisoires et changeront. Un barème qui les violerait
  // ferait mentir le moteur sans qu'aucun autre test ne s'en aperçoive — le
  // calcul cumulatif suppose des bornes croissantes, et la monotonie du tarif
  // moyen suppose des prix non croissants. Elles valent pour une tranche comme
  // pour trois.
  for (const [label, scale] of [
    ["le barème en vigueur", PRICING_SCALE],
    ["le barème dégressif de démonstration", DEGRESSIVE_FIXTURE],
  ] as const) {
    it(`${label} a des bornes strictement croissantes`, () => {
      const bounds = scale.tiers.map((tier) => tier.upToSeat);
      expect(bounds).toEqual([...bounds].sort((a, b) => a - b));
      expect(new Set(bounds).size).toBe(bounds.length);
    });

    it(`${label} a des prix par siège non croissants`, () => {
      const prices = scale.tiers.map((tier) => tier.pricePerSeatFcfa);
      for (let i = 1; i < prices.length; i += 1) {
        expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
      }
    });

    it(`${label} se termine par une tranche sans borne supérieure`, () => {
      const last = scale.tiers[scale.tiers.length - 1];
      expect(last.upToSeat).toBe(Number.POSITIVE_INFINITY);
    });
  }
});

describe("quoteSubscription — le tarif en vigueur, 5 000 FCFA par élève", () => {
  it("facture 80 sièges 400 000 FCFA", () => {
    expect(quoteSubscription(80)).toEqual<SubscriptionQuote>({
      seatsBilled: 80,
      totalFcfa: 400_000,
      pricePerSeatFcfa: SEAT_PRICE,
    });
  });

  it("facture 250 sièges 1 250 000 FCFA", () => {
    expect(quoteSubscription(250)).toEqual<SubscriptionQuote>({
      seatsBilled: 250,
      totalFcfa: 1_250_000,
      pricePerSeatFcfa: SEAT_PRICE,
    });
  });

  it("facture 500 sièges 2 500 000 FCFA", () => {
    expect(quoteSubscription(500)).toEqual<SubscriptionQuote>({
      seatsBilled: 500,
      totalFcfa: 2_500_000,
      pricePerSeatFcfa: SEAT_PRICE,
    });
  });

  it("ne consent AUCUNE remise au volume — le tarif moyen est plat", () => {
    // Ce que le prix plat signifie vraiment, et ce qui le distingue d'un
    // barème dégressif : la 500e école paie le même prix par élève que la
    // première. Si ce test tombe, une tranche a été ajoutée.
    for (const seats of [50, 100, 101, 300, 301, 1_000]) {
      expect(quoteSubscription(seats).pricePerSeatFcfa).toBe(SEAT_PRICE);
    }
  });
});

describe("quoteSubscription — le plancher de 30 sièges", () => {
  it("facture 30 sièges à qui en demande moins", () => {
    for (const requested of [1, 15, 29, 30]) {
      expect(quoteSubscription(requested)).toEqual<SubscriptionQuote>({
        seatsBilled: 30,
        totalFcfa: FLOOR_TOTAL,
        pricePerSeatFcfa: SEAT_PRICE,
      });
    }
  });

  it("OUVRE les sièges qu'il facture : 31 demandés, 31 facturés", () => {
    expect(quoteSubscription(31)).toEqual<SubscriptionQuote>({
      seatsBilled: 31,
      totalFcfa: 31 * SEAT_PRICE,
      pricePerSeatFcfa: SEAT_PRICE,
    });
  });

  it("lit le plancher DU BARÈME, pas un nombre recopié", () => {
    // Les deux barèmes ont maintenant des planchers DIFFÉRENTS — 30 en
    // vigueur, 50 pour la démonstration dégressive. Un 30 ou un 50 écrit en
    // dur dans le moteur ferait donc tomber l'une des deux assertions. Tant
    // qu'ils valaient tous deux 50, aucun test ne pouvait le prouver.
    expect(quoteSubscription(1).seatsBilled).toBe(PRICING_SCALE.seatFloor);
    expect(quoteWithScale(1, DEGRESSIVE_FIXTURE).seatsBilled).toBe(
      DEGRESSIVE_FIXTURE.seatFloor,
    );
  });

  it("rend le minimum d'origine : 30 × 5 000 = 150 000 FCFA", () => {
    // Le plancher valait 50 quand le premier palier valait 3 000 FCFA, soit
    // 150 000 FCFA de contrat minimum. Le passage au tarif plat l'avait porté
    // à 250 000 sans décision ; 30 sièges rétablissent le seuil voulu.
    expect(quoteSubscription(1).totalFcfa).toBe(150_000);
  });
});

describe("quoteWithScale — le moteur cumulatif, sur un barème dégressif", () => {
  // Le barème en vigueur n'a qu'une tranche : plus rien n'y exerce le calcul
  // par tranches. Ces tests le maintiennent couvert, et documentent au passage
  // ce que donnerait une remise au volume.
  it("facture 80 sièges 240 000 FCFA", () => {
    expect(quoteWithScale(80, DEGRESSIVE_FIXTURE)).toEqual<SubscriptionQuote>({
      seatsBilled: 80,
      totalFcfa: 240_000,
      pricePerSeatFcfa: 3_000,
    });
  });

  it("facture 250 sièges 660 000 FCFA — (100 × 3 000) + (150 × 2 400)", () => {
    expect(quoteWithScale(250, DEGRESSIVE_FIXTURE)).toEqual<SubscriptionQuote>({
      seatsBilled: 250,
      totalFcfa: 660_000,
      pricePerSeatFcfa: 2_640,
    });
  });

  it("facture 500 sièges 1 140 000 FCFA", () => {
    expect(quoteWithScale(500, DEGRESSIVE_FIXTURE)).toEqual<SubscriptionQuote>({
      seatsBilled: 500,
      totalFcfa: 1_140_000,
      pricePerSeatFcfa: 2_280,
    });
  });

  it("facture le 100e siège au premier palier", () => {
    expect(quoteWithScale(100, DEGRESSIVE_FIXTURE).totalFcfa).toBe(300_000);
  });

  it("facture le 101e siège au DEUXIÈME palier, et lui seul", () => {
    expect(quoteWithScale(101, DEGRESSIVE_FIXTURE).totalFcfa).toBe(
      300_000 + 2_400,
    );
  });

  it("facture le 300e siège au deuxième palier", () => {
    expect(quoteWithScale(300, DEGRESSIVE_FIXTURE).totalFcfa).toBe(
      300_000 + 200 * 2_400,
    );
  });

  it("facture le 301e siège au TROISIÈME palier, et lui seul", () => {
    expect(quoteWithScale(301, DEGRESSIVE_FIXTURE).totalFcfa).toBe(
      300_000 + 200 * 2_400 + 1_800,
    );
  });

  it("ne facture jamais tout le contrat au prix du dernier palier atteint", () => {
    // Le piège que la spec §7.2 identifie : à prix de tranche unique,
    // 101 × 2 400 = 242 400 serait MOINS cher que 100 × 3 000 = 300 000.
    expect(quoteWithScale(101, DEGRESSIVE_FIXTURE).totalFcfa).toBeGreaterThan(
      quoteWithScale(100, DEGRESSIVE_FIXTURE).totalFcfa,
    );
    expect(quoteWithScale(101, DEGRESSIVE_FIXTURE).totalFcfa).not.toBe(
      101 * 2_400,
    );
    expect(quoteWithScale(301, DEGRESSIVE_FIXTURE).totalFcfa).not.toBe(
      301 * 1_800,
    );
  });
});

describe("entrées absurdes", () => {
  // Zéro, négatif, fractionnaire, NaN, infini : aucun siège, aucun franc, et
  // surtout aucune remontée au plancher — une saisie erronée ne doit pas se
  // transformer en facture. `recordSubscription` les refuse en amont ; ceci est
  // la seconde ligne, et elle doit tenir quel que soit le barème.
  const ABSURD = [
    -1,
    -500,
    0.5,
    49.9,
    120.000001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  const NOTHING: SubscriptionQuote = {
    seatsBilled: 0,
    totalFcfa: 0,
    pricePerSeatFcfa: 0,
  };

  it("ne facture rien pour 0 siège", () => {
    expect(quoteSubscription(0)).toEqual(NOTHING);
  });

  it("ne facture rien pour une entrée illisible, sur les deux barèmes", () => {
    for (const value of ABSURD) {
      expect(quoteSubscription(value)).toEqual(NOTHING);
      expect(quoteWithScale(value, DEGRESSIVE_FIXTURE)).toEqual(NOTHING);
    }
  });

  it("ne rend jamais NaN comme tarif moyen", () => {
    expect(Number.isNaN(quoteSubscription(0).pricePerSeatFcfa)).toBe(false);
  });
});

describe("monotonie (spec §7.2)", () => {
  // La plage traverse le plancher (50), les deux bornes du barème dégressif
  // (100/101 et 300/301) et déborde sa dernière tranche : c'est là, et
  // seulement là, que la propriété peut se casser. Elle est vérifiée sur les
  // DEUX barèmes — le plat ne peut guère la violer, mais c'est le dégressif
  // qui reviendra, et c'est lui qu'il faut protéger.
  const RANGE_END = 420;

  for (const [label, quote] of [
    ["barème en vigueur", (n: number) => quoteSubscription(n)],
    ["barème dégressif", (n: number) => quoteWithScale(n, DEGRESSIVE_FIXTURE)],
  ] as const) {
    it(`${label} : ajouter un siège ne fait jamais baisser le total`, () => {
      for (let seats = 0; seats < RANGE_END; seats += 1) {
        expect(quote(seats + 1).totalFcfa).toBeGreaterThanOrEqual(
          quote(seats).totalFcfa,
        );
      }
    });

    it(`${label} : le tarif moyen par siège facturé ne remonte jamais`, () => {
      // À partir d'un siège : en dessous il n'y a pas de contrat, donc pas de
      // tarif moyen à comparer (0 y vaut « sans objet », pas « gratuit »).
      for (let seats = 1; seats < RANGE_END; seats += 1) {
        expect(quote(seats + 1).pricePerSeatFcfa).toBeLessThanOrEqual(
          quote(seats).pricePerSeatFcfa,
        );
      }
    });

    it(`${label} : le nombre de sièges facturés ne baisse jamais`, () => {
      for (let seats = 0; seats < RANGE_END; seats += 1) {
        expect(quote(seats + 1).seatsBilled).toBeGreaterThanOrEqual(
          quote(seats).seatsBilled,
        );
      }
    });
  }
});

describe("le tarif moyen ne fait pas foi (§7.2)", () => {
  it("est toujours un entier", () => {
    for (const seats of [101, 137, 250, 301, 499]) {
      expect(Number.isInteger(quoteSubscription(seats).pricePerSeatFcfa)).toBe(
        true,
      );
      expect(
        Number.isInteger(
          quoteWithScale(seats, DEGRESSIVE_FIXTURE).pricePerSeatFcfa,
        ),
      ).toBe(true);
    }
  });

  it("ne se reconstitue pas en total dès qu'un barème a plusieurs tranches", () => {
    // La raison pour laquelle §7.2 interdit de recalculer un total depuis le
    // tarif moyen : l'arrondi perd des francs. À prix PLAT la perte est nulle
    // — le produit retombe juste — ce qui rend la règle invisible aujourd'hui
    // et dangereuse demain, puisqu'un seul palier ajouté la réveille. Ce test
    // vit donc sur le barème dégressif, où la perte est réelle.
    const quote = quoteWithScale(101, DEGRESSIVE_FIXTURE);
    expect(quote.pricePerSeatFcfa * quote.seatsBilled).not.toBe(
      quote.totalFcfa,
    );
  });

  it("le prix plat masque la perte d'arrondi, il ne l'abolit pas", () => {
    // Constat, pas garantie : aujourd'hui le produit retombe juste. Ce test
    // existe pour que la règle de §7.2 ne se fasse pas oublier au motif
    // qu'elle ne se voit plus.
    const quote = quoteSubscription(101);
    expect(quote.pricePerSeatFcfa * quote.seatsBilled).toBe(quote.totalFcfa);
  });
});
