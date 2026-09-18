import { describe, expect, it } from "vitest";

import {
  checkIssuer,
  THOUSANDS_SEPARATOR,
  UNIT_SEPARATOR,
  formatFcfa,
  formatInvoiceDate,
  formatInvoiceNumber,
  invoiceLineLabel,
  issuerMissingMessage,
  nextSequence,
} from "../invoiceRules";

describe("formatInvoiceNumber", () => {
  it("compose l'année et le rang sur quatre chiffres", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("FAC-2026-0001");
    expect(formatInvoiceNumber(2026, 42)).toBe("FAC-2026-0042");
    expect(formatInvoiceNumber(2027, 9999)).toBe("FAC-2027-9999");
  });

  it("ne tronque pas au-delà de quatre chiffres", () => {
    expect(formatInvoiceNumber(2026, 10000)).toBe("FAC-2026-10000");
  });

  it("garde l'ordre lexicographique dans une même année", () => {
    const numbers = [3, 1, 20, 2].map((n) => formatInvoiceNumber(2026, n));
    expect([...numbers].sort()).toEqual([
      "FAC-2026-0001",
      "FAC-2026-0002",
      "FAC-2026-0003",
      "FAC-2026-0020",
    ]);
  });
});

describe("nextSequence", () => {
  it("repart à 1 quand l'année n'a rien émis", () => {
    expect(nextSequence(null)).toBe(1);
    expect(nextSequence(undefined)).toBe(1);
  });

  it("incrémente sans trou", () => {
    expect(nextSequence(1)).toBe(2);
    expect(nextSequence(9998)).toBe(9999);
  });
});

describe("checkIssuer", () => {
  const complet = {
    name: "  Jotna SARL ",
    ninea: " 001234567 ",
    address: "Dakar, Sénégal",
    email: "facturation@jotna.sn",
  };

  it("accepte une identité complète et resserre les espaces", () => {
    expect(checkIssuer(complet)).toEqual({
      ok: true,
      issuer: {
        name: "Jotna SARL",
        ninea: "001234567",
        address: "Dakar, Sénégal",
        email: "facturation@jotna.sn",
      },
    });
  });

  it("nomme chaque variable manquante", () => {
    expect(checkIssuer({})).toEqual({
      ok: false,
      missing: [
        "INVOICE_ISSUER_NAME",
        "INVOICE_ISSUER_NINEA",
        "INVOICE_ISSUER_ADDRESS",
        "INVOICE_ISSUER_EMAIL",
      ],
    });
  });

  it("traite une chaîne vide ou blanche comme absente", () => {
    const check = checkIssuer({ ...complet, ninea: "   " });
    expect(check).toEqual({ ok: false, missing: ["INVOICE_ISSUER_NINEA"] });
  });

  it("le message du journal nomme ce qu'il faut poser", () => {
    const message = issuerMissingMessage(["INVOICE_ISSUER_NINEA"]);
    expect(message).toContain("INVOICE_ISSUER_NINEA");
    expect(message).toContain("convex env set");
  });
});

describe("formatFcfa", () => {
  // Les séparateurs sont invisibles : les nommer rend l'attente lisible, et
  // évite d'écrire dans ce test un caractère qu'un reformatage remplacerait.
  const M = THOUSANDS_SEPARATOR;
  const U = UNIT_SEPARATOR;

  it("emploie une fine insécable pour les milliers et une insécable avant l'unité", () => {
    expect(THOUSANDS_SEPARATOR).toBe("\u202f");
    expect(UNIT_SEPARATOR).toBe("\u00a0");
  });

  it("groupe par milliers", () => {
    expect(formatFcfa(50000)).toBe(`50${M}000${U}FCFA`);
    expect(formatFcfa(150000)).toBe(`150${M}000${U}FCFA`);
    expect(formatFcfa(1000000)).toBe(`1${M}000${M}000${U}FCFA`);
  });

  it("n'écrit pas de décimale", () => {
    expect(formatFcfa(50000.7)).toBe(`50${M}000${U}FCFA`);
  });

  it("garde le signe d'un montant négatif", () => {
    expect(formatFcfa(-1500)).toBe(`-1${M}500${U}FCFA`);
  });

  it("écrit zéro sans groupe", () => {
    expect(formatFcfa(0)).toBe(`0${U}FCFA`);
  });

  it("ne laisse aucune espace ordinaire, qui autoriserait une coupure de ligne", () => {
    expect(formatFcfa(1234567)).not.toContain(" ");
  });
});

describe("invoiceLineLabel", () => {
  it("dit la tranche, les sièges et la période", () => {
    expect(
      invoiceLineLabel({
        index: 2,
        total: 3,
        seats: 30,
        periodStart: "17/09/2026",
        periodEnd: "17/09/2027",
      }),
    ).toBe(
      "Abonnement Jotna School — tranche 2 sur 3, 30 sièges, période du 17/09/2026 au 17/09/2027",
    );
  });
});

describe("formatInvoiceDate", () => {
  it("écrit la date en jour/mois/année", () => {
    expect(formatInvoiceDate(Date.UTC(2026, 8, 17, 12, 0, 0))).toBe(
      "17/09/2026",
    );
  });

  it("complète le jour et le mois sur deux chiffres", () => {
    expect(formatInvoiceDate(Date.UTC(2027, 0, 3, 12, 0, 0))).toBe(
      "03/01/2027",
    );
  });
});
