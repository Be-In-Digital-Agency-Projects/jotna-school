import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getConditionText, normalizeRarity } from "./badges";
import { checkAccess, requireAccess } from "./access";

// ---------------------------------------------------------------------------
// Star approximation helper.
//
// Per Decision D3c + scoring.ts: true stars are computed per-exercise (0..3
// each, summed to 0..30 per palier). Recomputing that for every historical
// palierAttempt would require N attempt reads × M exercises = expensive.
//
// For aggregate UI surfaces (topic header, subject map, profile total) we use
// a 1..3 crown-style approximation derived from the palier's averageScore:
//   - average >= 9 → 3 stars
//   - average >= 7 → 2 stars (PALIER_VALIDATION_THRESHOLD)
//   - average  < 7 → 1 star (only when defensively included)
// Actual per-exercise stars are still rendered exactly inside the session UI.
// ---------------------------------------------------------------------------
export function approxStarsForValidatedPalier(averageScore: number): number {
  if (averageScore >= 9) return 3;
  if (averageScore >= 7) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Level helpers (Decision D3b)
// ---------------------------------------------------------------------------
export const EXOS_PER_LEVEL = 50;
export function computeLevel(totalCorrectExercises: number): number {
  return Math.floor(totalCorrectExercises / EXOS_PER_LEVEL) + 1;
}
export function exosToNextLevel(totalCorrectExercises: number): number {
  return EXOS_PER_LEVEL - (totalCorrectExercises % EXOS_PER_LEVEL);
}

// ---------------------------------------------------------------------------
// Student preferences shape (stored under profiles.preferences, v.any()).
// ---------------------------------------------------------------------------
export type StudentStreakState = {
  current: number;
  longest: number;
  lastActivityYmd?: string;
  freezeAvailableUntilYmd?: string;
};
export type StudentPreferences = {
  soundEnabled?: boolean;
  streak?: StudentStreakState;
  // D25/D21 — server-side memo of which earned badges the student has seen on
  // /complete. Diff against earnedBadges → unseenBadges in getMyStats. Capped
  // rolling at 100 entries (Guardian C4) inside markBadgesSeen.
  lastSeenBadgeIds?: string[];
  // D2b/D24 — server-side memo of the highest level the student has been
  // shown the celebration overlay for. Diff against computeLevel(...) →
  // unseenLevelUp in getMyStats. Always monotonically increasing.
  lastSeenLevel?: number;
};
export function readStudentPreferences(
  profile: Doc<"profiles">,
): StudentPreferences {
  return (profile.preferences as StudentPreferences | undefined) ?? {};
}

// ---------------------------------------------------------------------------
// Topic status resolution (D4 — linear unlock chain).
// Extracted as a pure function so the logic is unit-testable.
// ---------------------------------------------------------------------------
export type TopicInput = {
  id: string;
  order: number;
  isCompleted: boolean;
  validatedPaliers: number;
  hasInProgress: boolean;
  completedExercises: number;
};

export type TopicStatus = "locked" | "available" | "in_progress" | "completed";

export function resolveTopicStatuses(
  topics: TopicInput[],
): TopicStatus[] {
  const sorted = [...topics].sort((a, b) => a.order - b.order);
  const statuses: TopicStatus[] = [];
  let prevPassedForUnlock = true;

  for (const topic of sorted) {
    const passedForUnlock =
      topic.isCompleted || topic.validatedPaliers >= 1;

    let status: TopicStatus;
    if (!prevPassedForUnlock) {
      status = "locked";
    } else if (topic.isCompleted) {
      status = "completed";
    } else if (
      topic.hasInProgress ||
      topic.validatedPaliers > 0 ||
      topic.completedExercises > 0
    ) {
      status = "in_progress";
    } else {
      status = "available";
    }

    statuses.push(status);
    prevPassedForUnlock = passedForUnlock;
  }

  return statuses;
}

// ---------------------------------------------------------------------------
// Queries for admin student management
// ---------------------------------------------------------------------------

export const listStudents = query({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query("profiles").take(1000);
    const students = profiles.filter((p) => p.role === "student");

    const results = [];
    for (const student of students) {
      // Count completed topics
      const progress = await ctx.db
        .query("studentTopicProgress")
        .withIndex("by_studentId", (q) => q.eq("studentId", student._id))
        .take(200);
      const completedTopics = progress.filter((p) => p.completedAt != null).length;

      // Count badges
      const earnedBadges = await ctx.db
        .query("earnedBadges")
        .withIndex("by_studentId", (q) => q.eq("studentId", student._id))
        .take(100);

      results.push({
        ...student,
        completedTopics,
        badgeCount: earnedBadges.length,
      });
    }

    return results;
  },
});

export const getStudentDetail = query({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    const student = await ctx.db.get(args.studentId);
    if (!student || student.role !== "student") {
      return null;
    }

    // Get all progress entries
    const progress = await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .take(200);

    // Get subject progress with topic info
    const subjectProgress: Record<
      string,
      {
        subjectId: string;
        subjectName: string;
        subjectColor: string;
        totalTopics: number;
        completedTopics: number;
        totalExercises: number;
        correctExercises: number;
      }
    > = {};

    for (const p of progress) {
      const topic = await ctx.db.get(p.topicId);
      if (!topic) continue;
      const subject = await ctx.db.get(topic.subjectId);
      if (!subject) continue;

      if (!subjectProgress[subject._id]) {
        // Count total topics in subject
        const allTopics = await ctx.db
          .query("topics")
          .withIndex("by_subjectId", (q) => q.eq("subjectId", subject._id))
          .take(200);

        subjectProgress[subject._id] = {
          subjectId: subject._id,
          subjectName: subject.name,
          subjectColor: subject.color,
          totalTopics: allTopics.length,
          completedTopics: 0,
          totalExercises: 0,
          correctExercises: 0,
        };
      }

      subjectProgress[subject._id].totalExercises += p.completedExercises;
      subjectProgress[subject._id].correctExercises += p.correctExercises;
      if (p.completedAt != null) {
        subjectProgress[subject._id].completedTopics += 1;
      }
    }

    // Get earned badges
    const earnedBadges = await ctx.db
      .query("earnedBadges")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .take(100);

    const badgesWithInfo = [];
    for (const eb of earnedBadges) {
      const badge = await ctx.db.get(eb.badgeId);
      if (badge) {
        badgesWithInfo.push({ ...eb, badge });
      }
    }

    // Get recent attempts (last 10) — use desc order + take to avoid loading all
    const sortedAttempts = await ctx.db
      .query("attempts")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .order("desc")
      .take(10);

    const attemptsWithInfo = [];
    for (const attempt of sortedAttempts) {
      const exercise = await ctx.db.get(attempt.exerciseId);
      let topicName = "";
      if (exercise) {
        const topic = await ctx.db.get(exercise.topicId);
        topicName = topic?.name ?? "";
      }
      attemptsWithInfo.push({
        ...attempt,
        exercisePrompt: exercise?.prompt ?? "",
        exerciseType: exercise?.type ?? "",
        topicName,
      });
    }

    return {
      student,
      subjectProgress: Object.values(subjectProgress),
      earnedBadges: badgesWithInfo,
      recentAttempts: attemptsWithInfo,
    };
  },
});

/**
 * Auth-scoped wrapper: returns stats for the currently-logged-in student.
 * Used by the student's profile page and home — the client doesn't have to
 * pass (and possibly spoof) a studentId.
 *
 * Decision D3b — `level` derived from totalCorrectExercises (50 / level).
 * Decision D3c — `totalStars` approximated from validated palierAttempts.
 * Decision D7  — `streaksEnabled` reflects ANY parentSettings.streaksEnabled
 *                = true. Default OFF when no settings exist (wellbeing).
 *                When OFF, streak fields are returned as zeros so the UI
 *                can hide the surface entirely.
 * Decision D6  — `soundEnabled` from profiles.preferences (default false).
 */
export const getMyStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile || profile.role !== "student") return null;

    // Paywall (spec §5.4) — même valeur de retour que le garde-fou de rôle
    // ci-dessus : une requête ne lève jamais.
    const access = await checkAccess(ctx, profile);
    if (!access.ok) return null;

    const studentId = profile._id;

    const progress = await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .take(200);
    const completedTopics = progress.filter((p) => p.completedAt != null).length;
    const totalExercises = progress.reduce(
      (s, p) => s + p.completedExercises,
      0,
    );
    const totalCorrectExercises = progress.reduce(
      (s, p) => s + p.correctExercises,
      0,
    );

    const earnedBadges = await ctx.db
      .query("earnedBadges")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .take(100);
    const badgesWithInfo = [];
    for (const eb of earnedBadges) {
      const badge = await ctx.db.get(eb.badgeId);
      if (badge) {
        // D10 — normalize rarity at the read boundary so the client always
        // receives the typed enum value.
        badgesWithInfo.push({
          ...eb,
          badge: {
            ...badge,
            rarity: normalizeRarity(badge.rarity),
            criteriaText: getConditionText(badge.condition),
          },
        });
      }
    }

    const attempts = await ctx.db
      .query("attempts")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .take(1000);
    const totalTimeMs = attempts.reduce((s, a) => s + a.timeSpentMs, 0);

    // D3c — total stars approximated from validated palierAttempts.
    const palierAttempts = await ctx.db
      .query("palierAttempts")
      .withIndex("by_user", (q) => q.eq("userId", studentId))
      .take(500);
    const totalStars = palierAttempts.reduce((acc, a) => {
      if (a.status !== "validated") return acc;
      return acc + approxStarsForValidatedPalier(a.averageScore ?? 0);
    }, 0);

    const subjectCounts: Record<string, { name: string; count: number }> = {};
    for (const p of progress) {
      if (p.completedAt == null) continue;
      const topic = await ctx.db.get(p.topicId);
      if (!topic) continue;
      const subject = await ctx.db.get(topic.subjectId);
      if (!subject) continue;
      if (!subjectCounts[subject._id]) {
        subjectCounts[subject._id] = { name: subject.name, count: 0 };
      }
      subjectCounts[subject._id].count += 1;
    }
    const favoriteSubject =
      Object.values(subjectCounts).sort((a, b) => b.count - a.count)[0]?.name ??
      null;

    // D7 (revised) — Streaks default ON for everyone (matches Duolingo
    // baseline). Parents can opt OUT via parentSettings.streaksEnabled = false.
    // Strict respect: if ANY linked parent has explicitly set false, streak
    // is disabled (the more conservative parent's wishes win).
    // No parent linked ⇒ default ON (autonomous student case).
    const parentSettings = await ctx.db
      .query("parentSettings")
      .withIndex("by_kid", (q) => q.eq("kidId", studentId))
      .take(10);
    const streaksEnabled = !parentSettings.some(
      (s) => s.streaksEnabled === false,
    );

    const prefs = readStudentPreferences(profile);
    const soundEnabled = prefs.soundEnabled === true;
    const soundOptInDecided = prefs.soundEnabled !== undefined;
    const streak = streaksEnabled
      ? (prefs.streak ?? {
          current: 0,
          longest: 0,
          lastActivityYmd: undefined,
          freezeAvailableUntilYmd: undefined,
        })
      : { current: 0, longest: 0 };

    // D25 — unseenBadges = earnedBadges minus prefs.lastSeenBadgeIds. The
    // /complete page reveals these in a "Nouveau badge !" card and then calls
    // markBadgesSeen so subsequent loads don't replay the celebration.
    const seen = new Set(prefs.lastSeenBadgeIds ?? []);
    const unseenBadges = badgesWithInfo
      .filter((b) => !seen.has(b.badgeId as string))
      .sort((a, b) => b.earnedAt - a.earnedAt);

    // D2b/D24 — unseenLevelUp signals the /complete page to show the level-up
    // overlay + play sound. Once shown, the page calls markLevelSeen and the
    // value resets to null until the kid earns the next level.
    const currentLevel = computeLevel(totalCorrectExercises);
    const unseenLevelUp =
      currentLevel > (prefs.lastSeenLevel ?? 1)
        ? { level: currentLevel }
        : null;

    return {
      student: profile,
      completedTopics,
      totalExercises,
      totalCorrectExercises,
      badgeCount: earnedBadges.length,
      totalTimeMs,
      favoriteSubject,
      recentBadges: badgesWithInfo
        .sort((a, b) => b.earnedAt - a.earnedAt)
        .slice(0, 3),
      // D3b — level
      level: computeLevel(totalCorrectExercises),
      exosToNextLevel: exosToNextLevel(totalCorrectExercises),
      // D3c — total stars
      totalStars,
      // D7 — streak
      streaksEnabled,
      currentStreak: streak.current,
      longestStreak: streak.longest,
      // D6 — sound
      soundEnabled,
      // D20/D21 — drives "should we show the opt-in dialog?" check (false ⇒
      // student has never been asked, regardless of which device they use).
      soundOptInDecided,
      // D25 — unseen badges drive the badge unlock card on /complete
      unseenBadges,
      // D2b/D24 — unseen level-up drives the LevelUpOverlay on /complete
      unseenLevelUp,
    };
  },
});

/**
 * D2b/D24 — Mark a given level as "seen" by the kid (after the LevelUpOverlay
 * has been shown). Idempotent and monotonic: only patches if the incoming
 * level is strictly greater than the stored one. Avoids both useless writes
 * and the regression case where an older overlay re-render would lower the
 * watermark.
 */
export const markLevelSeen = mutation({
  args: { level: v.number() },
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

    const prefs = readStudentPreferences(profile);
    const current = prefs.lastSeenLevel ?? 1;
    if (args.level <= current) return; // Idempotent + monotonic.
    const next: StudentPreferences = { ...prefs, lastSeenLevel: args.level };
    await ctx.db.patch(profile._id, { preferences: next });
  },
});

/**
 * Lightweight version of getMyStats just for the sound preference.
 * Used by the session page to power the quick-mute icon (D22) without
 * subscribing to the heavy ~1810-doc-read getMyStats query during exercises.
 */
export const getMySoundEnabled = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile || profile.role !== "student") return null;

    // Paywall (spec §5.4) — même valeur de retour que le garde-fou de rôle
    // ci-dessus.
    const access = await checkAccess(ctx, profile);
    if (!access.ok) return null;

    const prefs = readStudentPreferences(profile);
    return { soundEnabled: prefs.soundEnabled === true };
  },
});

/**
 * Auth-scoped: return badges earned by the currently-logged-in student.
 */
export const getMyEarnedBadges = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile) return [];

    // Paywall (spec §5.4) — même valeur de retour que le garde-fou
    // ci-dessus. checkAccess renvoie aussi ok:false pour un profil non-élève
    // (reason "not_student"), sans incidence ici : cette lecture n'a de sens
    // que pour un élève.
    const access = await checkAccess(ctx, profile);
    if (!access.ok) return [];

    const earned = await ctx.db
      .query("earnedBadges")
      .withIndex("by_studentId", (q) => q.eq("studentId", profile._id))
      .take(100);
    return earned.map((e) => ({
      _id: e._id,
      badgeId: e.badgeId as string,
      earnedAt: e.earnedAt,
    }));
  },
});

export const getStudentStats = query({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    const student = await ctx.db.get(args.studentId);
    if (!student || student.role !== "student") {
      return null;
    }

    // Get progress
    const progress = await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .take(200);

    const completedTopics = progress.filter((p) => p.completedAt != null).length;
    const totalExercises = progress.reduce((s, p) => s + p.completedExercises, 0);

    // Get badges
    const earnedBadges = await ctx.db
      .query("earnedBadges")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .take(100);

    const badgesWithInfo = [];
    for (const eb of earnedBadges) {
      const badge = await ctx.db.get(eb.badgeId);
      if (badge) {
        badgesWithInfo.push({ ...eb, badge });
      }
    }

    // Get total time spent from attempts
    const attempts = await ctx.db
      .query("attempts")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .take(1000);

    const totalTimeMs = attempts.reduce((s, a) => s + a.timeSpentMs, 0);

    // Find favorite subject (most completed topics)
    const subjectCounts: Record<string, { name: string; count: number }> = {};
    for (const p of progress) {
      if (p.completedAt == null) continue;
      const topic = await ctx.db.get(p.topicId);
      if (!topic) continue;
      const subject = await ctx.db.get(topic.subjectId);
      if (!subject) continue;
      if (!subjectCounts[subject._id]) {
        subjectCounts[subject._id] = { name: subject.name, count: 0 };
      }
      subjectCounts[subject._id].count += 1;
    }

    const favoriteSubject = Object.values(subjectCounts).sort(
      (a, b) => b.count - a.count,
    )[0]?.name ?? null;

    return {
      student,
      completedTopics,
      totalExercises,
      badgeCount: earnedBadges.length,
      totalTimeMs,
      favoriteSubject,
      recentBadges: badgesWithInfo
        .sort((a, b) => b.earnedAt - a.earnedAt)
        .slice(0, 3),
    };
  },
});

/**
 * Auth-scoped: subject "path map" for the current student.
 *
 * Returns the subject + ordered topics with per-topic status:
 *   - locked       — previous topic not yet passed
 *   - available    — unlocked, no progress
 *   - in_progress  — at least one palier started or one validated, not all done
 *   - completed    — studentTopicProgress.completedAt set
 *
 * Linear unlock rule (D4): topic N+1 is reachable as soon as topic N has at
 * least one validated palier OR studentTopicProgress.completedAt set.
 * (`completedAt` is the canonical signal but is rarely set in current data,
 * so the "1 validated palier" heuristic prevents kids from being stuck.)
 *
 * Read amplification: O(topics) + O(unique paliers attempted by this user).
 * For a typical student this is < 50 doc reads per call.
 */
export const getStudentSubjectMap = query({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile || profile.role !== "student") return null;

    // Paywall (spec §5.4) — même valeur de retour que le garde-fou de rôle
    // ci-dessus.
    const access = await checkAccess(ctx, profile);
    if (!access.ok) return null;

    const studentId = profile._id;

    const subject = await ctx.db.get(args.subjectId);
    if (!subject) return null;

    const topics = await ctx.db
      .query("topics")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", args.subjectId))
      .take(200);
    topics.sort((a, b) => a.order - b.order);

    const allProgress = await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .take(500);
    const progressByTopicId = new Map<
      string,
      Doc<"studentTopicProgress">
    >();
    for (const p of allProgress) {
      progressByTopicId.set(p.topicId as string, p);
    }

    const allAttempts = await ctx.db
      .query("palierAttempts")
      .withIndex("by_user", (q) => q.eq("userId", studentId))
      .take(500);

    // Resolve unique palierIds → palier doc once. Bounded by user's distinct paliers.
    const uniquePalierIds = Array.from(
      new Set(allAttempts.map((a) => a.palierId as string)),
    ) as Id<"paliers">[];
    const palierById = new Map<string, Doc<"paliers">>();
    await Promise.all(
      uniquePalierIds.map(async (pid) => {
        const palier = await ctx.db.get(pid);
        if (palier) palierById.set(pid as string, palier);
      }),
    );

    type TopicStats = {
      validatedPaliers: number;
      hasInProgress: boolean;
      starsApprox: number;
      maxValidatedPalierIndex: number;
    };
    const topicStats = new Map<string, TopicStats>();
    for (const t of topics) {
      topicStats.set(t._id as string, {
        validatedPaliers: 0,
        hasInProgress: false,
        starsApprox: 0,
        maxValidatedPalierIndex: 0,
      });
    }
    for (const attempt of allAttempts) {
      const palierDoc = palierById.get(attempt.palierId as string);
      if (!palierDoc) continue;
      const s = topicStats.get(palierDoc.topicId as string);
      if (!s) continue;
      if (attempt.status === "validated") {
        s.validatedPaliers += 1;
        s.starsApprox += approxStarsForValidatedPalier(attempt.averageScore ?? 0);
        if (palierDoc.palierIndex > s.maxValidatedPalierIndex) {
          s.maxValidatedPalierIndex = palierDoc.palierIndex;
        }
      } else if (attempt.status === "in_progress") {
        s.hasInProgress = true;
      }
    }

    const topicInputs: TopicInput[] = topics.map((topic) => {
      const stats = topicStats.get(topic._id as string)!;
      const progress = progressByTopicId.get(topic._id as string);
      return {
        id: topic._id as string,
        order: topic.order,
        isCompleted: progress?.completedAt != null,
        validatedPaliers: stats.validatedPaliers,
        hasInProgress: stats.hasInProgress,
        completedExercises: progress?.completedExercises ?? 0,
      };
    });
    const statuses = resolveTopicStatuses(topicInputs);

    const orderedTopics = topics.map((topic, i) => {
      const stats = topicStats.get(topic._id as string)!;
      const progress = progressByTopicId.get(topic._id as string);
      return {
        _id: topic._id,
        name: topic.name,
        description: topic.description,
        order: topic.order,
        class: topic.class ?? null,
        status: statuses[i],
        validatedPaliers: stats.validatedPaliers,
        nextPalierIndex: Math.min(10, stats.maxValidatedPalierIndex + 1),
        starsApprox: stats.starsApprox,
        completedExercises: progress?.completedExercises ?? 0,
        correctExercises: progress?.correctExercises ?? 0,
      };
    });

    const totalStarsApprox = orderedTopics.reduce(
      (acc, t) => acc + t.starsApprox,
      0,
    );

    return {
      subject: {
        _id: subject._id,
        name: subject.name,
        icon: subject.icon,
        color: subject.color,
      },
      topics: orderedTopics,
      totalStarsApprox,
    };
  },
});
