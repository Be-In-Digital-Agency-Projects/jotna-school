import { describe, expect, it } from "vitest";

import { decideProfileRole, SELF_SIGNUP_CLOSED } from "../roleRules";

describe("decideProfileRole — inscription libre", () => {
  it("refuse tout compte qui se crée tout seul, quel que soit le rôle", () => {
    for (const role of [
      "student",
      "parent",
      "professeur",
      "directeur",
      "admin",
      undefined,
    ]) {
      expect(() =>
        decideProfileRole({ rawRole: role, schoolCreated: false }),
      ).toThrow(SELF_SIGNUP_CLOSED);
    }
  });
});

describe("decideProfileRole — création par une école", () => {
  it("accepte les quatre rôles qu'une école pose", () => {
    for (const role of ["directeur", "professeur", "parent", "student"]) {
      expect(decideProfileRole({ rawRole: role, schoolCreated: true })).toBe(
        role,
      );
    }
  });

  it("refuse `admin`, qui se pose hors de l'application", () => {
    expect(() =>
      decideProfileRole({ rawRole: "admin", schoolCreated: true }),
    ).toThrow("Rôle non autorisé");
  });

  it("refuse un rôle inventé", () => {
    for (const value of ["", "  ", "Parent", "eleve", "teacher"]) {
      expect(() =>
        decideProfileRole({ rawRole: value, schoolCreated: true }),
      ).toThrow("Rôle non autorisé");
    }
  });

  it("refuse plutôt que de retomber sur un rôle par défaut", () => {
    expect(() =>
      decideProfileRole({ rawRole: undefined, schoolCreated: true }),
    ).toThrow("Rôle manquant");
  });
});
