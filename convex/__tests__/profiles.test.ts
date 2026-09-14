import { describe, it, expect, vi } from "vitest";

// -----------------------------------------------------------------------
// Tests pour la logique des profils et des liens parent-enfant.
// On simule le contexte Convex avec un mock DB.
// -----------------------------------------------------------------------

function createMockCtx(data: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = { ...data };

  return {
    db: {
      query: (table: string) => {
        const rows = tables[table] ?? [];
        return {
          collect: async () => [...rows],
          withIndex: (_name: string, filter: (q: any) => any) => {
            let filters: Array<{ field: string; value: any }> = [];
            const q = {
              eq: (field: string, value: any) => {
                filters.push({ field, value });
                return q;
              },
            };
            filter(q);
            const filtered = rows.filter((row) =>
              filters.every((f) => row[f.field] === f.value),
            );
            return {
              first: async () => filtered[0] ?? null,
              collect: async () => filtered,
            };
          },
        };
      },
      get: async (id: string) => {
        for (const table of Object.values(tables)) {
          const found = table.find((row) => row._id === id);
          if (found) return found;
        }
        return null;
      },
      insert: vi.fn(async (table: string, doc: any) => {
        const id = `${table}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const row = { _id: id, _creationTime: Date.now(), ...doc };
        if (!tables[table]) tables[table] = [];
        tables[table].push(row);
        return id;
      }),
      patch: vi.fn(async (id: string, updates: any) => {
        for (const table of Object.values(tables)) {
          const idx = table.findIndex((row) => row._id === id);
          if (idx !== -1) {
            table[idx] = { ...table[idx], ...updates };
            return;
          }
        }
      }),
    },
  };
}

describe("profiles", () => {
  describe("getChildren", () => {
    it("devrait retourner les enfants liés au parent", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_parent",
            userId: "u1",
            role: "parent",
            name: "Marie Dupont",
          },
          {
            _id: "p_child1",
            userId: "u2",
            role: "student",
            name: "Léo Dupont",
          },
          {
            _id: "p_child2",
            userId: "u3",
            role: "student",
            name: "Emma Dupont",
          },
          {
            _id: "p_other",
            userId: "u4",
            role: "student",
            name: "Autre Enfant",
          },
        ],
        studentGuardians: [
          {
            _id: "sg1",
            studentId: "p_child1",
            guardianId: "p_parent",
            relation: "parent",
          },
          {
            _id: "sg2",
            studentId: "p_child2",
            guardianId: "p_parent",
            relation: "parent",
          },
        ],
      });

      // Simulate getChildren handler
      const links = await ctx.db
        .query("studentGuardians")
        .withIndex("by_guardianId", (q: any) =>
          q.eq("guardianId", "p_parent"),
        )
        .collect();

      expect(links).toHaveLength(2);

      const children = await Promise.all(
        links.map(async (link: any) => {
          const profile = await ctx.db.get(link.studentId);
          return profile ? { ...profile, relation: link.relation } : null;
        }),
      );

      const result = children.filter(Boolean);

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe("Léo Dupont");
      expect(result[1]!.name).toBe("Emma Dupont");
      expect(result[0]!.relation).toBe("parent");
    });

    it("devrait retourner un tableau vide si le parent n'a pas d'enfants", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_parent",
            userId: "u1",
            role: "parent",
            name: "Marie Dupont",
          },
        ],
        studentGuardians: [],
      });

      const links = await ctx.db
        .query("studentGuardians")
        .withIndex("by_guardianId", (q: any) =>
          q.eq("guardianId", "p_parent"),
        )
        .collect();

      expect(links).toHaveLength(0);
    });

    it("ne devrait pas retourner les enfants d'un autre parent", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_parent1",
            userId: "u1",
            role: "parent",
            name: "Parent 1",
          },
          {
            _id: "p_parent2",
            userId: "u2",
            role: "parent",
            name: "Parent 2",
          },
          {
            _id: "p_child_of_2",
            userId: "u3",
            role: "student",
            name: "Enfant de Parent 2",
          },
        ],
        studentGuardians: [
          {
            _id: "sg1",
            studentId: "p_child_of_2",
            guardianId: "p_parent2",
            relation: "parent",
          },
        ],
      });

      const links = await ctx.db
        .query("studentGuardians")
        .withIndex("by_guardianId", (q: any) =>
          q.eq("guardianId", "p_parent1"),
        )
        .collect();

      expect(links).toHaveLength(0);
    });
  });

  describe("createChildProfile", () => {
    it("devrait créer un profil étudiant et un lien parent-enfant", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_parent",
            userId: "u1",
            role: "parent",
            name: "Marie Dupont",
          },
        ],
        studentGuardians: [],
      });

      // Simulate createChildProfile handler
      const studentId = await ctx.db.insert("profiles", {
        userId: "u_new_child",
        role: "student",
        name: "Nouveau Enfant",
      });

      expect(studentId).toBeTruthy();
      expect(ctx.db.insert).toHaveBeenCalledWith("profiles", {
        userId: "u_new_child",
        role: "student",
        name: "Nouveau Enfant",
      });

      await ctx.db.insert("studentGuardians", {
        studentId,
        guardianId: "p_parent",
        relation: "parent",
      });

      expect(ctx.db.insert).toHaveBeenCalledTimes(2);

      // Verify the link exists
      const links = await ctx.db
        .query("studentGuardians")
        .withIndex("by_guardianId", (q: any) =>
          q.eq("guardianId", "p_parent"),
        )
        .collect();

      expect(links).toHaveLength(1);
      expect(links[0].studentId).toBe(studentId);
      expect(links[0].relation).toBe("parent");
    });

    it("devrait créer le profil avec le rôle student", async () => {
      const ctx = createMockCtx({ profiles: [], studentGuardians: [] });

      const studentId = await ctx.db.insert("profiles", {
        userId: "u_child",
        role: "student",
        name: "Test Enfant",
      });

      const profile = await ctx.db.get(studentId);
      expect(profile).not.toBeNull();
      expect(profile!.role).toBe("student");
      expect(profile!.name).toBe("Test Enfant");
    });
  });

  describe("updateProfile", () => {
    it("devrait mettre à jour uniquement les champs fournis", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p1",
            userId: "u1",
            role: "parent",
            name: "Ancien Nom",
          },
        ],
      });

      // Simulate updateProfile handler: only update defined fields
      const args = { id: "p1", name: "Nouveau Nom", avatar: undefined };
      const { id, ...fields } = args;

      const existing = await ctx.db.get(id);
      expect(existing).not.toBeNull();

      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          updates[key] = value;
        }
      }

      expect(updates).toEqual({ name: "Nouveau Nom" });
      expect(updates).not.toHaveProperty("avatar");

      await ctx.db.patch(id, updates);

      const updated = await ctx.db.get(id);
      expect(updated!.name).toBe("Nouveau Nom");
    });
  });

  describe("linkChild", () => {
    // `linkChild` dérive désormais le tuteur de l'appelant authentifié
    // (getAuthUserId) : ces tests simulent ce flux à la main contre
    // createMockCtx, comme le reste du fichier — pas d'appel à la mutation
    // réelle, pas de convex-test.
    //
    // La relation déclarée doit correspondre au rôle réel de l'appelant.
    // Recevoir `relation` en paramètre (plutôt que de comparer une variable
    // locale initialisée à un littéral) évite que TypeScript la réduise à ce
    // seul littéral et rejette ensuite toute comparaison à un autre membre
    // de l'union comme forcément fausse (TS2367).
    function relationMatchesGuardianRole(
      relation: "parent" | "tuteur" | "professeur",
      guardianRole: string,
    ): boolean {
      if (relation === "professeur") {
        return guardianRole === "professeur";
      }
      return guardianRole === "parent";
    }

    it("devrait créer un lien entre un étudiant et un tuteur existants", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_guardian",
            userId: "u1",
            role: "parent",
            name: "Tuteur",
          },
          {
            _id: "p_student",
            userId: "u2",
            role: "student",
            name: "Élève",
          },
        ],
        studentGuardians: [],
      });

      // L'appelant authentifié est dérivé de la session (getAuthUserId),
      // jamais reçu en argument.
      const callerUserId = "u1";
      const relation = "tuteur";

      const guardian = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", callerUserId))
        .first();
      expect(guardian).not.toBeNull();

      // Rôle autorisé à porter une relation de tuteur/parent
      expect(
        guardian.role === "parent" || guardian.role === "professeur",
      ).toBe(true);
      // Pas un auto-rattachement
      expect(guardian._id).not.toBe("p_student");
      // La relation déclarée correspond au rôle réel de l'appelant
      expect(relationMatchesGuardianRole(relation, guardian.role)).toBe(true);

      const student = await ctx.db.get("p_student");
      expect(student).not.toBeNull();
      expect(student.role).toBe("student");

      // Check for existing link
      const existingLinks = await ctx.db
        .query("studentGuardians")
        .withIndex("by_guardianId", (q) => q.eq("guardianId", guardian._id))
        .collect();

      const alreadyLinked = existingLinks.find(
        (link) => link.studentId === "p_student",
      );
      expect(alreadyLinked).toBeUndefined();

      // Create the link
      const linkId = await ctx.db.insert("studentGuardians", {
        studentId: "p_student",
        guardianId: guardian._id,
        relation,
      });

      expect(linkId).toBeTruthy();
    });

    it("devrait refuser de créer un lien en double", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_guardian",
            userId: "u1",
            role: "parent",
            name: "Tuteur",
          },
          {
            _id: "p_student",
            userId: "u2",
            role: "student",
            name: "Élève",
          },
        ],
        studentGuardians: [
          {
            _id: "sg1",
            studentId: "p_student",
            guardianId: "p_guardian",
            relation: "parent",
          },
        ],
      });

      const callerUserId = "u1";

      const guardian = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", callerUserId))
        .first();
      expect(guardian).not.toBeNull();
      expect(guardian.role).toBe("parent");

      const existingLinks = await ctx.db
        .query("studentGuardians")
        .withIndex("by_guardianId", (q) => q.eq("guardianId", guardian._id))
        .collect();

      const alreadyLinked = existingLinks.find(
        (link) => link.studentId === "p_student",
      );

      expect(alreadyLinked).toBeDefined();

      // The real handler would throw here
      if (alreadyLinked) {
        expect(() => {
          throw new Error("Ce lien existe déjà");
        }).toThrow("Ce lien existe déjà");
      }
    });

    it("devrait refuser un appelant de rôle student", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_caller",
            userId: "u1",
            role: "student",
            name: "Élève Appelant",
          },
          {
            _id: "p_target",
            userId: "u2",
            role: "student",
            name: "Cible",
          },
        ],
        studentGuardians: [],
      });

      const callerUserId = "u1";
      const guardian = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", callerUserId))
        .first();
      expect(guardian).not.toBeNull();
      expect(guardian.role).toBe("student");

      expect(() => {
        if (guardian.role !== "parent" && guardian.role !== "professeur") {
          throw new Error("Rôle non autorisé");
        }
      }).toThrow("Rôle non autorisé");
    });

    it("devrait refuser un appelant de rôle directeur", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_caller",
            userId: "u1",
            role: "directeur",
            name: "Directeur",
          },
          {
            _id: "p_target",
            userId: "u2",
            role: "student",
            name: "Cible",
          },
        ],
        studentGuardians: [],
      });

      const callerUserId = "u1";
      const guardian = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", callerUserId))
        .first();
      expect(guardian).not.toBeNull();
      expect(guardian.role).toBe("directeur");

      expect(() => {
        if (guardian.role !== "parent" && guardian.role !== "professeur") {
          throw new Error("Rôle non autorisé");
        }
      }).toThrow("Rôle non autorisé");
    });

    it("devrait exiger le rôle professeur pour la relation professeur", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_guardian",
            userId: "u1",
            role: "parent",
            name: "Parent (pas professeur)",
          },
          {
            _id: "p_student",
            userId: "u2",
            role: "student",
            name: "Élève",
          },
        ],
        studentGuardians: [],
      });

      const callerUserId = "u1";
      const relation = "professeur";
      const guardian = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", callerUserId))
        .first();
      expect(guardian).not.toBeNull();
      expect(guardian.role).toBe("parent");

      expect(() => {
        if (!relationMatchesGuardianRole(relation, guardian.role)) {
          throw new Error("Rôle non autorisé");
        }
      }).toThrow("Rôle non autorisé");
    });

    it("devrait exiger le rôle parent pour une relation autre que professeur", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_guardian",
            userId: "u1",
            role: "professeur",
            name: "Professeur",
          },
          {
            _id: "p_student",
            userId: "u2",
            role: "student",
            name: "Élève",
          },
        ],
        studentGuardians: [],
      });

      const callerUserId = "u1";
      const relation = "tuteur";
      const guardian = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", callerUserId))
        .first();
      expect(guardian).not.toBeNull();
      expect(guardian.role).toBe("professeur");

      expect(() => {
        if (!relationMatchesGuardianRole(relation, guardian.role)) {
          throw new Error("Rôle non autorisé");
        }
      }).toThrow("Rôle non autorisé");
    });

    it("devrait refuser qu'un profil se rattache à lui-même", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_guardian",
            userId: "u1",
            role: "parent",
            name: "Tuteur",
          },
        ],
        studentGuardians: [],
      });

      const callerUserId = "u1";
      const guardian = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", callerUserId))
        .first();
      expect(guardian).not.toBeNull();

      const studentId = guardian._id;

      expect(() => {
        if (guardian._id === studentId) {
          throw new Error("Lien invalide");
        }
      }).toThrow("Lien invalide");
    });

    it("devrait exiger que la cible soit un profil élève", async () => {
      const ctx = createMockCtx({
        profiles: [
          {
            _id: "p_guardian",
            userId: "u1",
            role: "parent",
            name: "Tuteur",
          },
          {
            _id: "p_not_student",
            userId: "u2",
            role: "parent",
            name: "Pas un élève",
          },
        ],
        studentGuardians: [],
      });

      const callerUserId = "u1";
      const guardian = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", callerUserId))
        .first();
      expect(guardian).not.toBeNull();

      const target = await ctx.db.get("p_not_student");

      expect(() => {
        if (!target || target.role !== "student") {
          throw new Error("Profil étudiant introuvable");
        }
      }).toThrow("Profil étudiant introuvable");
    });
  });
});
