import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { readStudentPreferences, type StudentPreferences } from "./students";
import { blockedStudent, requireAccess } from "./access";

// ---------------------------------------------------------------------------
// D10 — Rarity tier normalization. The schema currently widens
// `badges.rarity` as `v.optional(v.string())` (legacy free-form). Phase B
// narrows it to a strict enum via the widen-migrate-narrow pattern:
//   1. (already done) Widen accepts any string.
//   2. Run `internal.badges.normalizeRarities` once in production.
//   3. Narrow the validator in schema.ts to the strict union below.
// All read paths use `normalizeRarity()` so the UI always sees the typed value.
// ---------------------------------------------------------------------------

export const RARITY_TIERS = ["common", "rare", "epic", "legendary"] as const;
export type RarityTier = (typeof RARITY_TIERS)[number];
const RARITY_SET = new Set<string>(RARITY_TIERS);

export function normalizeRarity(raw: string | undefined | null): RarityTier {
  if (!raw) return "common";
  const lower = raw.toLowerCase().trim();
  if (RARITY_SET.has(lower)) return lower as RarityTier;
  // Legacy aliases — observed in seeded data and admin UI shorthand.
  if (lower === "uncommon" || lower === "bronze" || lower === "argent") {
    return "rare";
  }
  if (lower === "or" || lower === "gold") return "epic";
  if (lower === "diamond" || lower === "diamant" || lower === "platinum") {
    return "legendary";
  }
  return "common";
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// D10b — Map condition keys to readable French unlock criteria. Anything
// outside this list falls back to the generic encouragement copy.
export function getConditionText(condition: string): string {
  switch (condition) {
    case "complete_topic":
      return "Termine une thématique";
    case "perfect_score":
      return "Termine une thématique sans erreur";
    case "streak_3":
      return "Termine 3 thématiques de suite";
    default:
      return "Continue à apprendre !";
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Paywall (spec §5.4) — lecture partagée avec l'administration et les
    // professeurs : blockedStudent(ctx) ne bloque qu'un élève sans droit
    // valide, jamais un adulte ni un visiteur non authentifié.
    if (await blockedStudent(ctx)) return [];

    const rows = await ctx.db.query("badges").take(100);
    return rows.map((b) => ({
      ...b,
      rarity: normalizeRarity(b.rarity),
      criteriaText: getConditionText(b.condition),
    }));
  },
});

export const getById = query({
  args: { id: v.id("badges") },
  handler: async (ctx, args) => {
    // Paywall (spec §5.4) — lecture partagée avec l'administration et les
    // professeurs : blockedStudent(ctx) ne bloque qu'un élève sans droit
    // valide, jamais un adulte ni un visiteur non authentifié.
    if (await blockedStudent(ctx)) return null;

    return await ctx.db.get(args.id);
  },
});

export const listEarnedByStudent = query({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    // Paywall (spec §5.4) — cette lecture prend `studentId` en argument et
    // ne résout aucun profil ; elle est aussi partagée avec l'administration
    // et les professeurs. blockedStudent(ctx) résout le profil de
    // L'APPELANT et ne bloque que s'il s'agit d'un élève sans droit valide.
    if (await blockedStudent(ctx)) return [];

    const earned = await ctx.db
      .query("earnedBadges")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .take(100);

    // Join with badges table for full info
    const results = [];
    for (const eb of earned) {
      const badge = await ctx.db.get(eb.badgeId);
      if (badge) {
        results.push({
          ...eb,
          badge: {
            ...badge,
            rarity: normalizeRarity(badge.rarity),
            criteriaText: getConditionText(badge.condition),
          },
        });
      }
    }
    return results;
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    icon: v.string(),
    condition: v.string(),
    subjectId: v.optional(v.id("subjects")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("badges", {
      name: args.name,
      description: args.description,
      icon: args.icon,
      condition: args.condition,
      subjectId: args.subjectId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("badges"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    condition: v.optional(v.string()),
    subjectId: v.optional(v.id("subjects")),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Badge introuvable");
    }
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates[key] = value;
      }
    }
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("badges") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("Badge introuvable");
    }

    // Check if any earnedBadges reference this badge
    const earned = await ctx.db
      .query("earnedBadges")
      .filter((q) => q.eq(q.field("badgeId"), args.id))
      .first();
    if (earned) {
      throw new Error(
        "Impossible de supprimer ce badge car des élèves l'ont déjà obtenu.",
      );
    }

    await ctx.db.delete(args.id);
  },
});

// ---------------------------------------------------------------------------
// D25 — Mark earned badges as "seen" by the kid (after the /complete page
// renders the unlock card). Idempotent: re-calls with already-seen IDs are a
// no-op (early return without a db.patch). Caps the rolling list at 100
// entries (Guardian C4) — a student earning 100+ unique badges is far beyond
// MVP scope, but the cap keeps preferences bounded.
// ---------------------------------------------------------------------------

const LAST_SEEN_BADGE_IDS_CAP = 100;

export const markBadgesSeen = mutation({
  args: { badgeIds: v.array(v.id("badges")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Non authentifié");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile || profile.role !== "student") {
      throw new Error("Profil élève introuvable");
    }

    // Paywall (spec §5.4) — mutation : lève si l'accès n'est pas ouvert.
    await requireAccess(ctx, profile);

    if (args.badgeIds.length === 0) return;

    const prefs = readStudentPreferences(profile);
    const current = prefs.lastSeenBadgeIds ?? [];
    const incoming = args.badgeIds.map((id) => id as string);
    const currentSet = new Set(current);
    const additions = incoming.filter((id) => !currentSet.has(id));
    if (additions.length === 0) return; // Idempotent — nothing new to record.

    const merged = [...current, ...additions].slice(-LAST_SEEN_BADGE_IDS_CAP);
    const next: StudentPreferences = { ...prefs, lastSeenBadgeIds: merged };
    await ctx.db.patch(profile._id, { preferences: next });
  },
});

// ---------------------------------------------------------------------------
// D10 step 2 — Migration: normalize all badges.rarity values to the strict
// enum so the schema can be narrowed (step 3) without rejecting any rows.
// Idempotent + paginated. Run once via `npx convex run badges:normalizeRarities`
// before bumping schema.ts to the strict union validator.
// ---------------------------------------------------------------------------
export const normalizeRarities = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    patched: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("badges")
      .paginate({ numItems: 100, cursor: args.cursor ?? null });

    let patched = args.patched ?? 0;
    for (const badge of result.page) {
      const next = normalizeRarity(badge.rarity);
      if (badge.rarity === next) continue; // No-op when already normalized.
      await ctx.db.patch(badge._id, { rarity: next });
      patched += 1;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.badges.normalizeRarities, {
        cursor: result.continueCursor,
        patched,
      });
    }
    return { patched, isDone: result.isDone };
  },
});

// ---------------------------------------------------------------------------
// Internal mutation: check and award badges after exercise/topic completion
// ---------------------------------------------------------------------------

export const checkAndAward = internalMutation({
  args: {
    studentId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const { studentId } = args;

    // Get all badge definitions
    const allBadges = await ctx.db.query("badges").take(100);

    // Get all already-earned badges for this student
    const alreadyEarned = await ctx.db
      .query("earnedBadges")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .take(100);
    const earnedBadgeIds = new Set(alreadyEarned.map((eb) => eb.badgeId));

    // Get student's topic progress
    const allProgress = await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .take(200);

    const newlyAwarded: Array<{
      badgeId: string;
      name: string;
      description: string;
      icon: string;
    }> = [];

    for (const badge of allBadges) {
      // Skip already earned
      if (earnedBadgeIds.has(badge._id)) continue;

      let deserved = false;

      switch (badge.condition) {
        case "complete_topic": {
          // Student has at least one completed topic
          const completed = allProgress.filter((p) => p.completedAt != null);
          if (badge.subjectId) {
            // Check completion in a specific subject
            const topicsInSubject = await ctx.db
              .query("topics")
              .withIndex("by_subjectId", (q) =>
                q.eq("subjectId", badge.subjectId!),
              )
              .take(200);
            const topicIds = new Set(topicsInSubject.map((t) => t._id));
            deserved = completed.some((p) => topicIds.has(p.topicId));
          } else {
            deserved = completed.length > 0;
          }
          break;
        }

        case "perfect_score": {
          // Student completed a topic with correctExercises === completedExercises
          const perfectTopics = allProgress.filter(
            (p) =>
              p.completedAt != null &&
              p.completedExercises > 0 &&
              p.correctExercises === p.completedExercises,
          );
          if (badge.subjectId) {
            const topicsInSubject = await ctx.db
              .query("topics")
              .withIndex("by_subjectId", (q) =>
                q.eq("subjectId", badge.subjectId!),
              )
              .take(200);
            const topicIds = new Set(topicsInSubject.map((t) => t._id));
            deserved = perfectTopics.some((p) => topicIds.has(p.topicId));
          } else {
            deserved = perfectTopics.length > 0;
          }
          break;
        }

        case "streak_3": {
          // Student has 3 consecutive topics completed (by completedAt timestamp)
          const completedSorted = allProgress
            .filter((p) => p.completedAt != null)
            .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));

          if (completedSorted.length >= 3) {
            // Check if any 3 consecutive entries exist
            // "Consecutive" means 3 in a row with no gaps in the sorted list
            deserved = true;
          }
          break;
        }

        default:
          // Unknown condition, skip
          break;
      }

      if (deserved) {
        await ctx.db.insert("earnedBadges", {
          badgeId: badge._id,
          studentId,
          earnedAt: Date.now(),
        });
        newlyAwarded.push({
          badgeId: badge._id as string,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
        });
      }
    }

    return newlyAwarded;
  },
});
