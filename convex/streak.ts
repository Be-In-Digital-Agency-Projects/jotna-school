/**
 * Student streak module — Decisions D7, D7b, D7c (zero-shame copy is UI-side).
 *
 * Definitions:
 *   - "Activité" = at least one palierAttempt submitted in the day (validated
 *     or failed; "starting" alone doesn't count).
 *   - Day = calendar day in Africa/Dakar (UTC+0). Stored as YYYY-MM-DD.
 *   - Freeze = automatic 1-per-7-days. If a day passes with no activity but
 *     a freeze is available, the streak is preserved and freeze expires.
 *   - "Streak Enabled" = at least one parentSettings.streaksEnabled === true.
 *
 * Storage: under profiles.preferences.streak (no separate table, no schema
 * migration required — preferences is already v.optional(v.any()) per
 * schema.ts:46). See `students.ts` for the StudentStreakState type.
 */

import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import {
  readStudentPreferences,
  type StudentPreferences,
  type StudentStreakState,
} from "./students";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAccess } from "./access";

// ---------------------------------------------------------------------------
// Date helpers — Africa/Dakar timezone (UTC+0, no DST).
// ---------------------------------------------------------------------------

/** Convert a unix timestamp to a YYYY-MM-DD string in Africa/Dakar. */
export function timestampToYmd(ts: number): string {
  // Africa/Dakar is UTC+0 with no DST, so the UTC date IS the local date.
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function todayYmd(): string {
  return timestampToYmd(Date.now());
}

/** Days from `from` to `to` (both YYYY-MM-DD). Negative if `to` is before. */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const fromTs = Date.UTC(fy, fm - 1, fd);
  const toTs = Date.UTC(ty, tm - 1, td);
  return Math.round((toTs - fromTs) / (24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------------------
// Streak transition logic (pure function, exported for tests).
// ---------------------------------------------------------------------------

const FREEZE_INTERVAL_DAYS = 7;

export type StreakTransition = {
  prev: StudentStreakState | undefined;
  next: StudentStreakState;
  freezeUsed: boolean;
};

/**
 * Compute the next streak state given an activity on `todayYmd`.
 * - If today === lastActivityYmd: noop.
 * - If today === lastActivityYmd + 1: increment current.
 * - If a single day was skipped AND freeze is available: freeze, increment.
 * - Otherwise: reset to 1.
 */
export function applyActivity(
  prev: StudentStreakState | undefined,
  todayYmd: string,
): StreakTransition {
  if (!prev || prev.lastActivityYmd === undefined) {
    return {
      prev,
      next: {
        current: 1,
        longest: 1,
        lastActivityYmd: todayYmd,
        freezeAvailableUntilYmd: addDaysYmd(todayYmd, FREEZE_INTERVAL_DAYS),
      },
      freezeUsed: false,
    };
  }
  const gap = daysBetween(prev.lastActivityYmd, todayYmd);
  if (gap <= 0) {
    return { prev, next: prev, freezeUsed: false };
  }
  if (gap === 1) {
    const current = prev.current + 1;
    return {
      prev,
      next: {
        current,
        longest: Math.max(prev.longest, current),
        lastActivityYmd: todayYmd,
        freezeAvailableUntilYmd:
          prev.freezeAvailableUntilYmd ??
          addDaysYmd(todayYmd, FREEZE_INTERVAL_DAYS),
      },
      freezeUsed: false,
    };
  }
  // gap >= 2 — at least one day was skipped.
  const freezeAvailable =
    prev.freezeAvailableUntilYmd !== undefined &&
    daysBetween(prev.freezeAvailableUntilYmd, todayYmd) <= 0;
  if (gap === 2 && freezeAvailable) {
    const current = prev.current + 1;
    return {
      prev,
      next: {
        current,
        longest: Math.max(prev.longest, current),
        lastActivityYmd: todayYmd,
        // Freeze consumed; new freeze only available after FREEZE_INTERVAL_DAYS.
        freezeAvailableUntilYmd: addDaysYmd(todayYmd, FREEZE_INTERVAL_DAYS),
      },
      freezeUsed: true,
    };
  }
  // Streak broken — reset to 1.
  return {
    prev,
    next: {
      current: 1,
      longest: prev.longest,
      lastActivityYmd: todayYmd,
      freezeAvailableUntilYmd: addDaysYmd(todayYmd, FREEZE_INTERVAL_DAYS),
    },
    freezeUsed: false,
  };
}

/**
 * Compute the next streak state given that today is `todayYmd` and no
 * activity occurred (rollover check). Used by the daily cron.
 * - If lastActivityYmd is today or yesterday: noop (still alive).
 * - If 2-day gap and freeze available: freeze-protected, mark as active.
 *   (We can't actually mark today as "active" without activity; instead we
 *   leave lastActivityYmd intact and just don't reset.)
 * - Otherwise: reset to 0 (preserves longest).
 */
export function applyRollover(
  prev: StudentStreakState | undefined,
  todayYmd: string,
): StreakTransition {
  if (!prev || prev.lastActivityYmd === undefined) {
    return { prev, next: prev ?? { current: 0, longest: 0 }, freezeUsed: false };
  }
  const gap = daysBetween(prev.lastActivityYmd, todayYmd);
  if (gap <= 1) {
    return { prev, next: prev, freezeUsed: false };
  }
  // Streak is at risk. The cron is just a safeguard — actual freeze use only
  // happens on the next applyActivity. So here we only RESET if too much time
  // has passed (gap > 2 with freeze, or gap > 1 without freeze).
  const freezeAvailable =
    prev.freezeAvailableUntilYmd !== undefined &&
    daysBetween(prev.freezeAvailableUntilYmd, todayYmd) <= 0;
  const tolerance = freezeAvailable ? 2 : 1;
  if (gap <= tolerance) {
    return { prev, next: prev, freezeUsed: false };
  }
  return {
    prev,
    next: {
      current: 0,
      longest: prev.longest,
      lastActivityYmd: prev.lastActivityYmd,
      freezeAvailableUntilYmd: prev.freezeAvailableUntilYmd,
    },
    freezeUsed: false,
  };
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const ts = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  return timestampToYmd(ts);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Persist sound preference. Called from the kid UI after the first-run
 * dialog accepts/declines audio. D31 — idempotent: if the value matches what
 * is already stored, skip the patch entirely. Avoids cascading the heavy
 * getMyStats subscription invalidation on rage-clicks of the toggle.
 */
export const setSoundEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Non authentifié");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) throw new Error("Profil introuvable");

    // Paywall (spec §5.4) — mutation : lève si l'accès n'est pas ouvert.
    await requireAccess(ctx, profile);

    const prefs = readStudentPreferences(profile);
    if (prefs.soundEnabled === args.enabled) return; // Idempotent
    const next: StudentPreferences = { ...prefs, soundEnabled: args.enabled };
    await ctx.db.patch(profile._id, { preferences: next });
  },
});

/**
 * Internal: record a kid's daily activity (called from submitPalier).
 * D7 (revised) — streaks default ON. Skipped only if a linked parent has
 * explicitly opted out via parentSettings.streaksEnabled = false.
 */
export const recordKidActivity = internalMutation({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.studentId);
    if (!profile || profile.role !== "student") return;

    const parentSettings = await ctx.db
      .query("parentSettings")
      .withIndex("by_kid", (q) => q.eq("kidId", args.studentId))
      .take(10);
    const streaksEnabled = !parentSettings.some(
      (s) => s.streaksEnabled === false,
    );
    if (!streaksEnabled) return;

    const prefs = readStudentPreferences(profile);
    const transition = applyActivity(prefs.streak, todayYmd());
    if (transition.next === transition.prev) return;
    const nextPrefs: StudentPreferences = {
      ...prefs,
      streak: transition.next,
    };
    await ctx.db.patch(args.studentId, { preferences: nextPrefs });
  },
});

/**
 * Internal: daily streak rollover. Iterates students and resets streaks
 * whose lastActivityYmd is too old. Bounded — resumes via scheduler if
 * processing exceeds transaction limits.
 */
export const dailyStreakRollover = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    processed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const today = todayYmd();
    const result = await ctx.db
      .query("profiles")
      .paginate({ numItems: 200, cursor: args.cursor ?? null });

    let processed = args.processed ?? 0;
    for (const profile of result.page) {
      if (profile.role !== "student") continue;
      // D7 (revised) — default ON; only an explicit parent opt-out skips.
      const parentSettings = await ctx.db
        .query("parentSettings")
        .withIndex("by_kid", (q) => q.eq("kidId", profile._id))
        .take(10);
      const streaksEnabled = !parentSettings.some(
        (s) => s.streaksEnabled === false,
      );
      if (!streaksEnabled) continue;

      const prefs = readStudentPreferences(profile);
      if (!prefs.streak) continue;

      const transition = applyRollover(prefs.streak, today);
      if (transition.next === transition.prev) continue;
      const nextPrefs: StudentPreferences = {
        ...prefs,
        streak: transition.next,
      };
      await ctx.db.patch(profile._id, { preferences: nextPrefs });
      processed += 1;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.streak.dailyStreakRollover, {
        cursor: result.continueCursor,
        processed,
      });
    }
    return { processed, isDone: result.isDone };
  },
});

// Export internal helper type signature for hand-off from submitPalier.
export type RecordKidActivityArgs = { studentId: Id<"profiles"> };
export type _StudentDoc = Doc<"profiles">;
