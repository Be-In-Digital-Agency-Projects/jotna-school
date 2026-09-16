import { describe, it, expect } from "vitest";
import {
  AMENDMENT_DUE_DELAY_MS,
  INSTALLMENT_COUNT,
  INSTALLMENT_STEP_MS,
  amendmentDueAt,
  bictorysOutcome,
  constantTimeEquals,
  decideOverdue,
  decidePaymentApplication,
  decidePostPayment,
  installmentDueDates,
  paydunyaOutcome,
  planInstallments,
  sha512Hex,
  splitInstallmentAmounts,
  type PaymentApplicationInput,
} from "../billingRules";
import type { SubscriptionStatus } from "../accessRules";

const DAY = 24 * 60 * 60 * 1000;

/** Un contrat d'année scolaire ordinaire : 1ᵉʳ octobre → 30 juin. */
const START = Date.UTC(2026, 9, 1);
const END = Date.UTC(2027, 5, 30);

describe("splitInstallmentAmounts", () => {
  it("met le reste de division sur la PREMIÈRE tranche", () => {
    // 1 250 000 / 3 = 416 666 reste 2. Les deux francs qui ne tombent pas
    // juste vont au versement qui arrive quand le budget est le plus frais.
    expect(splitInstallmentAmounts(1_250_000, 3)).toEqual([
      416_668, 416_666, 416_666,
    ]);
  });

  it("découpe exactement un total divisible", () => {
    expect(splitInstallmentAmounts(150_000, 3)).toEqual([50_000, 50_000, 50_000]);
  });

  it("SOMME EXACTE sur tout un balayage — l'invariante du plan", () => {
    // Trois arrondis indépendants ne redonnent le total que par chance. Cette
    // propriété-là est ce qui permet de lire un échéancier et de savoir, sans
    // calcul, que l'école paiera exactement ce que le contrat dit.
    for (let total = 0; total <= 2000; total++) {
      const parts = splitInstallmentAmounts(total, 3);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      for (const part of parts) expect(Number.isInteger(part)).toBe(true);
      expect(parts[0]).toBeGreaterThanOrEqual(parts[1]);
      expect(parts[1]).toBe(parts[2]);
    }
  });

  it("ne surfacture jamais sur une entrée absurde", () => {
    for (const bad of [-1, 0.5, NaN, Number.POSITIVE_INFINITY]) {
      expect(splitInstallmentAmounts(bad, 3)).toEqual([0, 0, 0]);
    }
  });

  it("rend une liste vide pour un nombre de tranches illisible", () => {
    for (const bad of [0, -3, 2.5, NaN]) {
      expect(splitInstallmentAmounts(300, bad)).toEqual([]);
    }
  });
});

describe("installmentDueDates", () => {
  it("part de la date de début — la première tranche est exigible tout de suite", () => {
    // L'école n'y perd rien : sans tranche encaissée, le contrat reste « en
    // attente de paiement » et n'ouvre AUCUN accès.
    expect(installmentDueDates(START, END, 3)[0]).toBe(START);
  });

  it("espace les échéances d'un trimestre sur une année scolaire", () => {
    const dues = installmentDueDates(START, END, 3);
    expect(dues[1] - dues[0]).toBe(INSTALLMENT_STEP_MS);
    expect(dues[2] - dues[1]).toBe(INSTALLMENT_STEP_MS);
    // Octobre, fin décembre, fin mars — soit octobre, janvier, avril à
    // quelques jours près, sans arithmétique de calendrier (§8.1, D36).
    expect(new Date(dues[1]).getUTCMonth()).toBe(11);
    expect(new Date(dues[2]).getUTCMonth()).toBe(2);
  });

  it("RESSERRE le pas sur un contrat trop court pour trois trimestres", () => {
    // Un contrat de six mois : trois échéances d'un trimestre déborderaient de
    // la période, et la troisième ne serait JAMAIS réclamée.
    const shortEnd = START + 180 * DAY;
    const dues = installmentDueDates(START, shortEnd, 3);
    expect(dues[1] - dues[0]).toBe(60 * DAY);
    expect(dues[2]).toBeLessThan(shortEnd);
  });

  it("garde toutes les échéances DANS la période, quelle que soit sa durée", () => {
    // Une échéance postérieure à `endsAt` ne serait jamais marquée impayée —
    // le cron ne regarde que des dates passées — donc jamais réclamée. Le
    // balayage descend jusqu'à des périodes absurdement courtes, là où un pas
    // fractionnaire mal arrondi ferait tomber la dernière échéance SUR la fin
    // du contrat.
    for (const ms of [1, 2, 5, 1000, DAY, 7 * DAY, 90 * DAY, 365 * DAY]) {
      const end = START + ms;
      const dues = installmentDueDates(START, end, 3);
      expect(dues).toHaveLength(3);
      for (const due of dues) {
        expect(due).toBeGreaterThanOrEqual(START);
        expect(due).toBeLessThan(end);
        expect(Number.isInteger(due)).toBe(true);
      }
    }
  });

  it("ne rend pas de NaN sur une période illisible", () => {
    expect(installmentDueDates(START, START, 3)).toEqual([START, START, START]);
    expect(installmentDueDates(START, START - DAY, 3)).toEqual([
      START,
      START,
      START,
    ]);
    expect(installmentDueDates(START, NaN, 3)).toEqual([START, START, START]);
  });
});

describe("planInstallments", () => {
  it("numérote les tranches à partir de 1 et conserve le total", () => {
    const plan = planInstallments({
      totalFcfa: 1_250_000,
      startsAt: START,
      endsAt: END,
    });
    expect(plan.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(plan.reduce((sum, p) => sum + p.amountFcfa, 0)).toBe(1_250_000);
    expect(plan).toHaveLength(INSTALLMENT_COUNT);
    expect(plan[0].dueAt).toBe(START);
  });
});

describe("amendmentDueAt", () => {
  it("laisse trente jours à l'école", () => {
    const now = START + 30 * DAY;
    expect(amendmentDueAt(now, END)).toBe(now + AMENDMENT_DUE_DELAY_MS);
  });

  it("ne dépasse JAMAIS la fin du contrat", () => {
    // Une échéance postérieure à `endsAt` ne serait jamais réclamée : l'école
    // garderait des sièges que personne ne lui facture.
    const now = END - 5 * DAY;
    expect(amendmentDueAt(now, END)).toBe(END);
  });
});

describe("constantTimeEquals", () => {
  it("reconnaît deux chaînes identiques", () => {
    expect(constantTimeEquals("abc123", "abc123")).toBe(true);
  });

  it("refuse une chaîne qui diffère, y compris au DERNIER caractère", () => {
    expect(constantTimeEquals("abc123", "abc124")).toBe(false);
    expect(constantTimeEquals("abc123", "zbc123")).toBe(false);
  });

  it("refuse une longueur différente", () => {
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
    expect(constantTimeEquals("", "a")).toBe(false);
  });
});

describe("sha512Hex", () => {
  it("rend le vecteur connu de SHA-512", async () => {
    // Éprouve le NOM de l'algorithme autant que la fonction : « SHA-256 » à la
    // place de « SHA-512 » compilerait, s'exécuterait, et refuserait tous les
    // webhooks de PayDunya sans qu'on sache pourquoi.
    expect(await sha512Hex("abc")).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a" +
        "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
  });

  it("rend 128 caractères hexadécimaux minuscules", async () => {
    const hex = await sha512Hex("une clé maîtresse quelconque");
    expect(hex).toMatch(/^[0-9a-f]{128}$/);
  });
});

describe("decidePaymentApplication", () => {
  const base: PaymentApplicationInput = {
    existingPaymentStatus: "initiated",
    providerOutcome: "completed",
    confirmedAmountFcfa: 416_668,
    dueAmountFcfa: 416_668,
    installmentStatus: "pending",
  };

  it("solde la tranche quand tout concorde", () => {
    expect(decidePaymentApplication(base)).toEqual({
      outcome: "credited",
      paymentStatus: "completed",
      creditsInstallment: true,
    });
  });

  it("solde aussi une tranche déjà marquée impayée", () => {
    // C'est le cas NOMINAL de la sortie de grâce : la tranche en retard est
    // `overdue`, et c'est son paiement qui referme la parenthèse.
    expect(
      decidePaymentApplication({ ...base, installmentStatus: "overdue" })
        .creditsInstallment,
    ).toBe(true);
  });

  it("NE FAIT RIEN sur un jeton déjà traité — et ce test passe avant tous les autres", () => {
    // Règle 3 de §8.3. PayDunya rejoue ; deux crédits pour un paiement sont une
    // perte sèche. Le rejeu est testé le premier dans la fonction, donc même un
    // rejeu au montant faux ou au statut changé ne peut rien écrire.
    for (const twisted of [
      { ...base, existingPaymentStatus: "completed" as const },
      {
        ...base,
        existingPaymentStatus: "completed" as const,
        confirmedAmountFcfa: 1,
      },
      {
        ...base,
        existingPaymentStatus: "completed" as const,
        providerOutcome: "cancelled" as const,
      },
    ]) {
      expect(decidePaymentApplication(twisted)).toEqual({
        outcome: "replayed",
        paymentStatus: null,
        creditsInstallment: false,
      });
    }
  });

  it("n'acquitte RIEN sur un paiement partiel", () => {
    // Règle 2 de §8.3 : un payload annonçant 100 FCFA ne solde pas une tranche
    // de 416 668.
    expect(
      decidePaymentApplication({ ...base, confirmedAmountFcfa: 100 }),
    ).toEqual({
      outcome: "amount_short",
      paymentStatus: "failed",
      creditsInstallment: false,
    });
  });

  it("ACQUITTE un trop-perçu", () => {
    // Refuser laisserait sans accès une école qui a payé PLUS que son dû.
    expect(
      decidePaymentApplication({ ...base, confirmedAmountFcfa: 500_000 })
        .creditsInstallment,
    ).toBe(true);
  });

  it("laisse la ligne intacte quand PayDunya dit « en attente »", () => {
    // La facture vit encore : marquer `failed` ferait croire à un paiement
    // perdu, et PayDunya rappellera.
    expect(
      decidePaymentApplication({ ...base, providerOutcome: "pending" }),
    ).toEqual({
      outcome: "not_completed",
      paymentStatus: null,
      creditsInstallment: false,
    });
  });

  it("recopie les fins — annulé, échoué", () => {
    expect(
      decidePaymentApplication({ ...base, providerOutcome: "cancelled" })
        .paymentStatus,
    ).toBe("cancelled");
    expect(
      decidePaymentApplication({ ...base, providerOutcome: "failed" })
        .paymentStatus,
    ).toBe("failed");
  });

  it("n'attribue rien quand la tranche est introuvable", () => {
    expect(
      decidePaymentApplication({
        ...base,
        dueAmountFcfa: null,
        installmentStatus: null,
      }),
    ).toEqual({
      outcome: "unknown_installment",
      paymentStatus: null,
      creditsInstallment: false,
    });
  });

  it("enregistre le versement sans re-solder une tranche déjà payée", () => {
    expect(
      decidePaymentApplication({ ...base, installmentStatus: "paid" }),
    ).toEqual({
      outcome: "already_paid",
      paymentStatus: "completed",
      creditsInstallment: false,
    });
  });
});

describe("traducteurs de statut prestataire", () => {
  it("PayDunya : « completed » est le seul succès", () => {
    expect(paydunyaOutcome("completed")).toBe("completed");
    expect(paydunyaOutcome("cancelled")).toBe("cancelled");
    expect(paydunyaOutcome("failed")).toBe("failed");
    expect(paydunyaOutcome("pending")).toBe("pending");
  });

  it("Bictorys : « succeeded » est le seul succès", () => {
    // C'est LE piège de la bascule : PayDunya dit « completed », Bictorys dit
    // « succeeded ». Une règle qui comparerait des chaînes brutes n'aurait
    // jamais crédité un seul paiement Bictorys — silencieusement.
    expect(bictorysOutcome("succeeded")).toBe("completed");
    expect(bictorysOutcome("completed")).toBe("pending");
  });

  it("Bictorys : toute l'énumération de leur OpenAPI est couverte", () => {
    const mapping: Record<string, string> = {
      succeeded: "completed",
      failed: "failed",
      cancelled: "cancelled",
      pending: "pending",
      processing: "pending",
      reversed: "failed",
      authorized: "pending",
    };
    for (const [status, expected] of Object.entries(mapping)) {
      expect(bictorysOutcome(status)).toBe(expected);
    }
  });

  it("« autorisé » N'EST PAS un encaissement", () => {
    // Un montant réservé sur une carte n'est pas un montant reçu : une
    // autorisation non capturée expire, et l'école aurait eu l'accès sans
    // qu'un franc arrive. Leur propre exemple d'intégration l'accepte ; nous
    // non.
    expect(bictorysOutcome("authorized")).toBe("pending");
  });

  it("un statut inconnu vaut ATTENTE, jamais un succès ni une fin", () => {
    // Leur documentation demande explicitement de ne pas valider strictement
    // les champs inconnus : un statut ajouté sans préavis ne doit ni créditer
    // une tranche, ni marquer un paiement perdu.
    for (const unknown of ["", "weird", "SETTLED", "en_cours"]) {
      expect(bictorysOutcome(unknown)).toBe("pending");
      expect(paydunyaOutcome(unknown)).toBe("pending");
    }
  });

  it("la casse et les espaces ne changent rien", () => {
    expect(paydunyaOutcome(" Completed ")).toBe("completed");
    expect(bictorysOutcome(" SUCCEEDED ")).toBe("completed");
  });
});

describe("decidePostPayment", () => {
  const running = { startsAt: START, endsAt: END, now: START + 10 * DAY };

  it("ouvre l'accès quand la première tranche d'un contrat en cours est payée", () => {
    expect(
      decidePostPayment({
        ...running,
        status: "pending_payment",
        hasRemainingOverdue: false,
      }),
    ).toEqual({ activate: true });
  });

  it("referme la parenthèse d'un impayé soldé", () => {
    expect(
      decidePostPayment({
        ...running,
        status: "past_due",
        hasRemainingOverdue: false,
      }),
    ).toEqual({ activate: true });
  });

  it("LAISSE en impayé tant qu'une autre tranche est en retard", () => {
    // Sortir de `past_due` effacerait l'ancre de la grâce, et la seconde
    // tranche impayée ne serait plus comptée à partir de rien.
    expect(
      decidePostPayment({
        ...running,
        status: "past_due",
        hasRemainingOverdue: true,
      }),
    ).toEqual({ activate: false, reason: "still_overdue" });
  });

  it("N'OUVRE RIEN avant le début du contrat", () => {
    // Une école qui paie en août la première tranche d'un contrat d'octobre :
    // `decideAccess` ne lit pas `startsAt`, donc un « actif » posé maintenant
    // donnerait l'accès deux mois trop tôt.
    expect(
      decidePostPayment({
        startsAt: START,
        endsAt: END,
        now: START - 60 * DAY,
        status: "pending_payment",
        hasRemainingOverdue: false,
      }),
    ).toEqual({ activate: false, reason: "not_started" });
  });

  it("n'ouvre rien sur un contrat terminé", () => {
    expect(
      decidePostPayment({
        startsAt: START,
        endsAt: END,
        now: END,
        status: "pending_payment",
        hasRemainingOverdue: false,
      }),
    ).toEqual({ activate: false, reason: "period_over" });
  });

  it("ne touche à aucun autre statut", () => {
    const cases: [SubscriptionStatus, string][] = [
      ["active", "already_active"],
      ["draft", "status_draft"],
      ["cancelled", "status_cancelled"],
      ["expired", "status_expired"],
    ];
    for (const [status, reason] of cases) {
      expect(
        decidePostPayment({ ...running, status, hasRemainingOverdue: false }),
      ).toEqual({ activate: false, reason });
    }
  });
});

describe("decideOverdue", () => {
  const base = {
    installmentStatus: "pending" as const,
    dueAt: START,
    now: START + DAY,
    subscriptionStatus: "active" as SubscriptionStatus,
    subscriptionStartsAt: START,
    subscriptionEndsAt: END,
  };

  it("marque la tranche ET le contrat d'une école active en retard", () => {
    expect(decideOverdue(base)).toEqual({
      marksInstallment: true,
      marksSubscription: true,
    });
  });

  it("ne marque rien avant l'échéance", () => {
    expect(decideOverdue({ ...base, now: START - DAY })).toEqual({
      marksInstallment: false,
      marksSubscription: false,
    });
  });

  it("marque à l'instant EXACT de l'échéance", () => {
    expect(decideOverdue({ ...base, now: START }).marksInstallment).toBe(true);
  });

  it("ne remarque pas une tranche déjà payée, impayée ou échouée", () => {
    for (const status of ["paid", "overdue", "failed"] as const) {
      expect(decideOverdue({ ...base, installmentStatus: status })).toEqual({
        marksInstallment: false,
        marksSubscription: false,
      });
    }
  });

  it("NE FAIT JAMAIS BASCULER un contrat en attente de paiement", () => {
    // `past_due` OUVRE l'accès pendant vingt et un jours : le poser sur un
    // contrat qui n'a rien encaissé donnerait trois semaines gratuites à une
    // école qui n'a pas payé un franc.
    const decision = decideOverdue({
      ...base,
      subscriptionStatus: "pending_payment",
    });
    expect(decision.marksInstallment).toBe(true);
    expect(decision.marksSubscription).toBe(false);
  });

  it("ne touche pas au statut d'un contrat qui n'est pas actif", () => {
    for (const status of [
      "draft",
      "past_due",
      "expired",
      "cancelled",
    ] as SubscriptionStatus[]) {
      expect(
        decideOverdue({ ...base, subscriptionStatus: status }).marksSubscription,
      ).toBe(false);
    }
  });

  it("ne touche pas au statut d'un contrat fini", () => {
    // `decideAccess` juge l'expiration sur `endsAt` : un « impayé » posé après
    // coup ne changerait aucun accès et laisserait un statut que la lecture
    // suivante contredit.
    expect(
      decideOverdue({ ...base, now: END + DAY }).marksSubscription,
    ).toBe(false);
  });

  it("INVARIANTE : jamais de statut sans son ancre", () => {
    // C'est mot pour mot ce que la spec §8.5 lègue à ce plan. Un `past_due`
    // sans tranche échue coupe l'école immédiatement au lieu de lui laisser ses
    // vingt et un jours, parce que `decideAccess` n'a rien à quoi rattacher la
    // grâce.
    const statuses: SubscriptionStatus[] = [
      "draft",
      "pending_payment",
      "active",
      "past_due",
      "expired",
      "cancelled",
    ];
    for (const subscriptionStatus of statuses) {
      for (const installmentStatus of [
        "pending",
        "paid",
        "overdue",
        "failed",
      ] as const) {
        for (const now of [START - DAY, START, START + DAY, END, END + DAY]) {
          const decision = decideOverdue({
            ...base,
            installmentStatus,
            subscriptionStatus,
            now,
          });
          if (decision.marksSubscription) {
            expect(decision.marksInstallment).toBe(true);
          }
        }
      }
    }
  });
});
