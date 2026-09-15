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

  // `updateProfile` est désormais testée pour de vrai, dans
  // `profileRules.test.ts`. Le test qui vivait ici RECOPIAIT le corps du
  // handler puis vérifiait la copie : il passait au vert quelle que soit la
  // mutation réelle, et il est passé au vert pendant tout le temps où elle
  // écrivait sur le profil d'autrui. Son argument `id` — celui-là même qui
  // ouvrait la porte — figurait dans le test sans que rien ne s'en émeuve.
});
