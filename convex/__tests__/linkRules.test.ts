import { describe, it, expect } from "vitest";
import {
  decideLinkChild,
  type LinkInput,
  type LinkRelation,
} from "../linkRules";

/** Entrée de base : un parent rattache un élève existant. */
function base(overrides: Partial<LinkInput> = {}): LinkInput {
  return {
    guardianRole: "parent",
    relation: "parent",
    targetRole: "student",
    ...overrides,
  };
}

/** Tous les rôles que `profiles.role` peut contenir (convex/schema.ts). */
const ALL_ROLES: string[] = [
  "admin",
  "parent",
  "student",
  "professeur",
  "directeur",
];

/** Toutes les relations que `studentGuardians.relation` peut contenir. */
const ALL_RELATIONS: LinkRelation[] = ["parent", "tuteur", "professeur"];

/** Les deux relations qu'un tuteur légal peut déclarer. */
const GUARDIAN_RELATIONS: LinkRelation[] = ["parent", "tuteur"];

describe("decideLinkChild — correspondance relation / rôle", () => {
  it("autorise un parent à déclarer les relations parent et tuteur", () => {
    for (const relation of GUARDIAN_RELATIONS) {
      expect(
        decideLinkChild(base({ guardianRole: "parent", relation })),
      ).toEqual({ ok: true });
    }
  });

  it("autorise un professeur à déclarer la relation professeur", () => {
    expect(
      decideLinkChild(
        base({ guardianRole: "professeur", relation: "professeur" }),
      ),
    ).toEqual({ ok: true });
  });

  it("refuse un parent qui se déclare professeur", () => {
    expect(
      decideLinkChild(base({ guardianRole: "parent", relation: "professeur" })),
    ).toEqual({ ok: false, reason: "relation_role_mismatch" });
  });

  it("refuse un professeur qui se déclare parent ou tuteur", () => {
    for (const relation of GUARDIAN_RELATIONS) {
      expect(
        decideLinkChild(base({ guardianRole: "professeur", relation })),
      ).toEqual({ ok: false, reason: "relation_role_mismatch" });
    }
  });

  it("refuse un directeur et un admin sur les trois relations", () => {
    for (const guardianRole of ["directeur", "admin"]) {
      for (const relation of ALL_RELATIONS) {
        expect(decideLinkChild(base({ guardianRole, relation }))).toEqual({
          ok: false,
          reason: "relation_role_mismatch",
        });
      }
    }
  });

  it("refuse un élève qui tenterait de se rattacher un tuteur", () => {
    for (const relation of ALL_RELATIONS) {
      expect(
        decideLinkChild(base({ guardianRole: "student", relation })),
      ).toEqual({ ok: false, reason: "relation_role_mismatch" });
    }
  });

  it("n'autorise, pour chaque relation, qu'un seul rôle appelant", () => {
    const expectedCaller: Record<LinkRelation, string> = {
      parent: "parent",
      tuteur: "parent",
      professeur: "professeur",
    };
    for (const relation of ALL_RELATIONS) {
      const accepted = ALL_ROLES.filter(
        (guardianRole) => decideLinkChild(base({ guardianRole, relation })).ok,
      );
      expect(accepted).toEqual([expectedCaller[relation]]);
    }
  });

  it("refuse un rôle inconnu, pas seulement les rôles du schéma", () => {
    for (const guardianRole of ["", "Parent", "parent ", "tuteur"]) {
      expect(decideLinkChild(base({ guardianRole }))).toEqual({
        ok: false,
        reason: "relation_role_mismatch",
      });
    }
  });
});

describe("decideLinkChild — nature de la cible", () => {
  it("refuse une cible introuvable", () => {
    expect(decideLinkChild(base({ targetRole: null }))).toEqual({
      ok: false,
      reason: "target_not_student",
    });
  });

  it("refuse toute cible qui n'est pas un élève", () => {
    for (const targetRole of ALL_ROLES.filter((r) => r !== "student")) {
      expect(decideLinkChild(base({ targetRole }))).toEqual({
        ok: false,
        reason: "target_not_student",
      });
    }
  });

  it("refuse un appelant qui se désigne lui-même comme élève", () => {
    // Se rattacher à soi-même revient à viser un profil dont le rôle est celui
    // de l'appelant : parent ou professeur, jamais student. La règle sur la
    // cible absorbe le cas, aucun contrôle d'identité séparé n'est nécessaire.
    expect(
      decideLinkChild(base({ guardianRole: "parent", targetRole: "parent" })),
    ).toEqual({ ok: false, reason: "target_not_student" });
    expect(
      decideLinkChild(
        base({
          guardianRole: "professeur",
          relation: "professeur",
          targetRole: "professeur",
        }),
      ),
    ).toEqual({ ok: false, reason: "target_not_student" });
  });
});

describe("decideLinkChild — ordre des règles", () => {
  it("annonce le refus de rôle avant de juger la cible", () => {
    // Un appelant non autorisé ne doit rien apprendre sur l'existence du
    // profil visé : le refus est identique, cible présente ou non.
    for (const targetRole of [null, "admin", "student"]) {
      expect(
        decideLinkChild(base({ guardianRole: "directeur", targetRole })),
      ).toEqual({ ok: false, reason: "relation_role_mismatch" });
    }
  });
});
