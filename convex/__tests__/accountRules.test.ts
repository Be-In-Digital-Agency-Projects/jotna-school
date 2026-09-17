import { describe, expect, it } from "vitest";

import {
  ACTIVATION_TTL_MS,
  buildActivationCode,
  buildLoginId,
  channelFor,
  checkEmail,
  checkName,
  checkPassword,
  normalizeIdentifier,
  verifyActivation,
} from "../accountRules";

/** Tirage déterministe : la suite fournie, en boucle. */
function sequence(values: number[]): (min: number, max: number) => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("buildLoginId", () => {
  it("préfixe par rôle et tire six caractères", () => {
    const pick = sequence([0]);
    expect(buildLoginId("professeur", pick)).toBe("PROF-333333");
    expect(buildLoginId("directeur", sequence([1]))).toBe("DIR-444444");
    expect(buildLoginId("parent", sequence([2]))).toBe("FAM-666666");
  });

  it("n'emploie jamais un symbole que la photocopie confond", () => {
    const ambiguous = ["0", "O", "1", "I", "L", "5", "S", "2", "Z"];
    for (let seed = 0; seed < 26; seed++) {
      const id = buildLoginId("professeur", sequence([seed]));
      const body = id.split("-")[1];
      for (const char of ambiguous) expect(body).not.toContain(char);
    }
  });
});

describe("buildActivationCode", () => {
  it("tire huit caractères, sans préfixe", () => {
    const code = buildActivationCode(sequence([0, 1, 2]));
    expect(code).toHaveLength(8);
    expect(code).not.toContain("-");
  });
});

describe("normalizeIdentifier", () => {
  it("met en minuscules et retire les espaces", () => {
    expect(normalizeIdentifier("  PROF-7C4K2M  ")).toBe("prof-7c4k2m");
    expect(normalizeIdentifier("4C7K 2MQR")).toBe("4c7k2mqr");
  });
});

describe("checkName", () => {
  it("accepte un nom et resserre les espaces", () => {
    expect(checkName("  Awa   Diop ")).toEqual({ ok: true, name: "Awa Diop" });
  });

  it("refuse le vide et le trop long", () => {
    expect(checkName("   ")).toEqual({ ok: false, reason: "empty" });
    expect(checkName("a".repeat(81))).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("checkEmail", () => {
  it("traite l'absence comme un cas normal", () => {
    expect(checkEmail(undefined)).toEqual({ ok: true, email: null });
    expect(checkEmail("")).toEqual({ ok: true, email: null });
    expect(checkEmail("   ")).toEqual({ ok: true, email: null });
  });

  it("normalise en minuscules", () => {
    expect(checkEmail("  Awa.Diop@Ecole.SN ")).toEqual({
      ok: true,
      email: "awa.diop@ecole.sn",
    });
  });

  it("refuse une adresse sans arobase ni point", () => {
    expect(checkEmail("awa.diop")).toEqual({ ok: false, reason: "malformed" });
    expect(checkEmail("awa@ecole")).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("channelFor", () => {
  it("découle de l'e-mail et de lui seul", () => {
    expect(channelFor(null)).toBe("printed");
    expect(channelFor("awa@ecole.sn")).toBe("email");
  });
});

describe("verifyActivation", () => {
  const now = 1_000_000;

  it("accepte un code vivant et jamais utilisé", () => {
    expect(verifyActivation({ expiresAt: now + 1 }, now)).toEqual({ ok: true });
  });

  it("refuse un code absent", () => {
    expect(verifyActivation(null, now)).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("refuse un code expiré", () => {
    expect(verifyActivation({ expiresAt: now }, now)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("dit « déjà utilisé » plutôt qu'« expiré » quand les deux sont vrais", () => {
    expect(
      verifyActivation({ expiresAt: now - 1, activatedAt: now - 2 }, now),
    ).toEqual({ ok: false, reason: "already_used" });
  });

  it("quatorze jours de durée de vie", () => {
    expect(ACTIVATION_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

describe("checkPassword", () => {
  it("accepte six caractères identiques", () => {
    expect(checkPassword("abc123", "abc123")).toEqual({ ok: true });
  });

  it("refuse plus court que la règle de convex/auth.ts", () => {
    expect(checkPassword("abc12", "abc12")).toEqual({
      ok: false,
      reason: "too_short",
    });
  });

  it("refuse une confirmation qui diverge", () => {
    expect(checkPassword("abc123", "abc124")).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });
});
