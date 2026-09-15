import { describe, it, expect } from "vitest";
import { decideSignupRole } from "../roleRules";

describe("decideSignupRole", () => {
  it("accepte les deux rôles sans autorité", () => {
    expect(decideSignupRole("parent")).toBe("parent");
    expect(decideSignupRole("student")).toBe("student");
  });

  it("REFUSE les trois rôles qui confèrent une autorité", () => {
    // `professeur` est le cas qui motive ce module : il était accepté, et
    // `callerIsStaff` le reconnaît comme « membre du personnel » partout dans
    // le dépôt. Les deux autres ne l'ont jamais été, mais la règle vaut pour
    // les trois — et une règle qui ne vaut que pour un cas se périme.
    for (const role of ["professeur", "directeur", "admin"]) {
      expect(() => decideSignupRole(role)).toThrow("Rôle non autorisé");
    }
  });

  it("refuse aussi ce qui ne ressemble à aucun rôle", () => {
    for (const value of ["", "PARENT", "Professeur", "teacher", "{}"]) {
      expect(() => decideSignupRole(value)).toThrow("Rôle non autorisé");
    }
  });

  it("ne retombe sur `student` QUE pour un rôle absent", () => {
    // La nuance qui porte tout : un formulaire sans rôle est une inscription
    // incomplète, pas une demande refusée. Un rôle PRÉSENT mais interdit doit
    // lever, sans quoi une demande de compte professeur deviendrait un compte
    // élève sans un mot.
    expect(decideSignupRole(undefined)).toBe("student");
    expect(() => decideSignupRole("professeur")).toThrow();
  });
});
