import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  verifyDragDrop,
  verifyMatch,
  verifyOrder,
  verifyQcm,
  verifyShortAnswer,
} from "../answerRules";

// ---------------------------------------------------------------------------
// These tests validate the answer verification logic for each exercise type
// and the progress update behavior when an answer is correct.
//
// Les vérificateurs étaient RÉÉCRITS ici, en copie de `convex/attempts.ts` :
// la suite notait donc du code que la production n'exécutait pas, et les deux
// pouvaient diverger en silence. Ils sont maintenant importés d'`answerRules`,
// module pur appelé par les mutations. Les cas de refus ajoutés par la
// correction des laxismes vivent dans `answerRules.test.ts`.
// ---------------------------------------------------------------------------

// ---- Mock Convex context ----

function createMockCtx(data: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = { ...data };

  return {
    db: {
      query: (table: string) => {
        const rows = tables[table] ?? [];
        return {
          collect: async () => [...rows],
          withIndex: (_name: string, filter: (q: any) => any) => {
            let filters: Record<string, any> = {};
            const q = {
              eq: (field: string, value: any) => {
                filters[field] = value;
                return q;
              },
            };
            filter(q);
            const filtered = rows.filter((row) =>
              Object.entries(filters).every(
                ([field, value]) => row[field] === value,
              ),
            );
            return {
              first: async () => filtered[0] ?? null,
              collect: async () => filtered,
            };
          },
          filter: (_fn: any) => ({
            first: async () => null,
            collect: async () => [],
          }),
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
        const id = `${table}_${Date.now()}_${Math.random()}`;
        const row = { _id: id, ...doc };
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
      delete: vi.fn(async (id: string) => {
        for (const table of Object.values(tables)) {
          const idx = table.findIndex((row) => row._id === id);
          if (idx !== -1) {
            table.splice(idx, 1);
            return;
          }
        }
      }),
    },
  };
}

// ---- Tests ----

describe("Answer verification", () => {
  describe("QCM", () => {
    const payload = { correctIndex: 2, options: ["A", "B", "C", "D"] };

    it("should return true when the correct index is submitted", () => {
      expect(verifyQcm("2", payload)).toBe(true);
    });

    it("should return false when a wrong index is submitted", () => {
      expect(verifyQcm("0", payload)).toBe(false);
      expect(verifyQcm("1", payload)).toBe(false);
      expect(verifyQcm("3", payload)).toBe(false);
    });

    it("should return false for non-numeric input", () => {
      expect(verifyQcm("abc", payload)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(verifyQcm("", payload)).toBe(false);
    });
  });

  describe("Match", () => {
    const payload = {
      pairs: [
        { left: "Cat", right: "Chat" },
        { left: "Dog", right: "Chien" },
        { left: "Bird", right: "Oiseau" },
      ],
    };

    it("should return true when all pairs are correctly matched", () => {
      const answer = JSON.stringify([
        { left: "Cat", right: "Chat" },
        { left: "Dog", right: "Chien" },
        { left: "Bird", right: "Oiseau" },
      ]);
      expect(verifyMatch(answer, payload)).toBe(true);
    });

    it("should return true regardless of pair order", () => {
      const answer = JSON.stringify([
        { left: "Bird", right: "Oiseau" },
        { left: "Cat", right: "Chat" },
        { left: "Dog", right: "Chien" },
      ]);
      expect(verifyMatch(answer, payload)).toBe(true);
    });

    it("should return false when a pair is incorrect", () => {
      const answer = JSON.stringify([
        { left: "Cat", right: "Chien" },
        { left: "Dog", right: "Chat" },
        { left: "Bird", right: "Oiseau" },
      ]);
      expect(verifyMatch(answer, payload)).toBe(false);
    });

    it("should return false when pairs count differs", () => {
      const answer = JSON.stringify([{ left: "Cat", right: "Chat" }]);
      expect(verifyMatch(answer, payload)).toBe(false);
    });

    it("should return false for invalid JSON", () => {
      expect(verifyMatch("not json", payload)).toBe(false);
    });
  });

  describe("Order", () => {
    const payload = { correctSequence: ["First", "Second", "Third", "Fourth"] };

    it("should return true when the sequence matches exactly", () => {
      const answer = JSON.stringify(["First", "Second", "Third", "Fourth"]);
      expect(verifyOrder(answer, payload)).toBe(true);
    });

    it("should return false when the order is wrong", () => {
      const answer = JSON.stringify(["Second", "First", "Third", "Fourth"]);
      expect(verifyOrder(answer, payload)).toBe(false);
    });

    it("should return false when items are missing", () => {
      const answer = JSON.stringify(["First", "Second"]);
      expect(verifyOrder(answer, payload)).toBe(false);
    });

    it("should return false for invalid JSON", () => {
      expect(verifyOrder("not json", payload)).toBe(false);
    });
  });

  describe("Drag-drop", () => {
    const payload = {
      items: [
        { text: "Apple", correctZone: "Fruits" },
        { text: "Carrot", correctZone: "Vegetables" },
        { text: "Banana", correctZone: "Fruits" },
      ],
    };

    it("should return true when all items are in the correct zones", () => {
      const answer = JSON.stringify({
        Apple: "Fruits",
        Carrot: "Vegetables",
        Banana: "Fruits",
      });
      expect(verifyDragDrop(answer, payload)).toBe(true);
    });

    it("should return false when an item is in the wrong zone", () => {
      const answer = JSON.stringify({
        Apple: "Vegetables",
        Carrot: "Vegetables",
        Banana: "Fruits",
      });
      expect(verifyDragDrop(answer, payload)).toBe(false);
    });

    it("should return false when an item is missing", () => {
      const answer = JSON.stringify({
        Apple: "Fruits",
        Carrot: "Vegetables",
      });
      expect(verifyDragDrop(answer, payload)).toBe(false);
    });

    it("should return false for invalid JSON", () => {
      expect(verifyDragDrop("not json", payload)).toBe(false);
    });
  });

  describe("Short answer", () => {
    const payload = {
      acceptedAnswers: ["Paris", "paris", "PARIS"],
    };

    it("should return true for an exact match", () => {
      expect(verifyShortAnswer("Paris", payload)).toBe(true);
    });

    it("should return true for case-insensitive match", () => {
      expect(verifyShortAnswer("pArIs", payload)).toBe(true);
    });

    it("should return true when the answer has leading/trailing spaces", () => {
      expect(verifyShortAnswer("  Paris  ", payload)).toBe(true);
    });

    it("should return false for a wrong answer", () => {
      expect(verifyShortAnswer("Lyon", payload)).toBe(false);
    });

    it("should return false for an empty string", () => {
      expect(verifyShortAnswer("", payload)).toBe(false);
    });

    it("should handle accepted answers with spaces", () => {
      const payloadWithSpaces = {
        acceptedAnswers: ["New York", " new york "],
      };
      expect(verifyShortAnswer("New York", payloadWithSpaces)).toBe(true);
      expect(verifyShortAnswer("new york", payloadWithSpaces)).toBe(true);
    });
  });
});

describe("Progress update on correct answer", () => {
  it("should create new progress when none exists", async () => {
    const ctx = createMockCtx({
      exercises: [
        {
          _id: "ex1",
          topicId: "topic1",
          type: "qcm",
          payload: { correctIndex: 1, options: ["A", "B"] },
        },
      ],
      studentTopicProgress: [],
      attempts: [],
    });

    // Simulate: check for existing progress
    const progress = await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId_topicId", (q: any) =>
        q.eq("studentId", "student1").eq("topicId", "topic1"),
      )
      .first();

    expect(progress).toBeNull();

    // Insert new progress
    await ctx.db.insert("studentTopicProgress", {
      studentId: "student1",
      topicId: "topic1",
      completedExercises: 1,
      correctExercises: 1,
      totalHintsUsed: 0,
      masteryLevel: 0,
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "studentTopicProgress",
      expect.objectContaining({
        studentId: "student1",
        completedExercises: 1,
        correctExercises: 1,
      }),
    );
  });

  it("should increment existing progress on correct answer", async () => {
    const ctx = createMockCtx({
      exercises: [
        {
          _id: "ex1",
          topicId: "topic1",
          type: "qcm",
          payload: { correctIndex: 1, options: ["A", "B"] },
        },
      ],
      studentTopicProgress: [
        {
          _id: "prog1",
          studentId: "student1",
          topicId: "topic1",
          completedExercises: 3,
          correctExercises: 2,
          totalHintsUsed: 1,
          masteryLevel: 50,
        },
      ],
      attempts: [],
    });

    const progress = await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId_topicId", (q: any) =>
        q.eq("studentId", "student1").eq("topicId", "topic1"),
      )
      .first();

    expect(progress).not.toBeNull();

    // Patch existing progress
    await ctx.db.patch(progress!._id, {
      completedExercises: progress!.completedExercises + 1,
      correctExercises: progress!.correctExercises + 1,
      totalHintsUsed: progress!.totalHintsUsed + 2,
    });

    const updated = await ctx.db.get("prog1");
    expect(updated?.completedExercises).toBe(4);
    expect(updated?.correctExercises).toBe(3);
    expect(updated?.totalHintsUsed).toBe(3);
  });

  it("should create an attempt record", async () => {
    const ctx = createMockCtx({
      attempts: [],
    });

    await ctx.db.insert("attempts", {
      studentId: "student1",
      exerciseId: "ex1",
      submittedAnswer: "1",
      isCorrect: true,
      attemptNumber: 1,
      hintsUsedCount: 0,
      timeSpentMs: 5000,
      submittedAt: Date.now(),
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "attempts",
      expect.objectContaining({
        studentId: "student1",
        exerciseId: "ex1",
        isCorrect: true,
      }),
    );
  });
});
