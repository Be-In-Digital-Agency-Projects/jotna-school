import { query, mutation, action, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { createAccount, getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get the current user's profile using Convex Auth identity.
 * Returns null if no user is signed in or no profile exists yet.
 * Includes the user's email from the `users` table for UI display.
 */
export const getCurrentProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;
    const user = await ctx.db.get(userId);
    return {
      ...profile,
      email: user?.email ?? null,
    };
  },
});

/**
 * Get students linked to the current signed-in teacher via studentGuardians
 * with relation === "professeur". Returns [] if not a teacher or unauthenticated.
 */
export const getTeacherStudents = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return [];
    if (profile.role !== "professeur" && profile.role !== "admin") return [];

    const links = await ctx.db
      .query("studentGuardians")
      .withIndex("by_guardianId", (q) => q.eq("guardianId", profile._id))
      .take(200);

    const teacherLinks = links.filter((l) => l.relation === "professeur");

    const students = await Promise.all(
      teacherLinks.map(async (link) => {
        const student = await ctx.db.get(link.studentId);
        if (!student) return null;

        // Count completed topics and exercises
        const progress = await ctx.db
          .query("studentTopicProgress")
          .withIndex("by_studentId", (q) => q.eq("studentId", student._id))
          .take(200);

        const completedTopics = progress.filter(
          (p) => p.completedAt != null,
        ).length;
        const completedExercises = progress.reduce(
          (s, p) => s + p.completedExercises,
          0,
        );

        return {
          ...student,
          completedTopics,
          completedExercises,
        };
      }),
    );

    return students.filter((s): s is NonNullable<typeof s> => s !== null);
  },
});

/** Get all student profiles linked to a guardian via studentGuardians. */
export const getChildren = query({
  args: { guardianId: v.id("profiles") },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("studentGuardians")
      .withIndex("by_guardianId", (q) => q.eq("guardianId", args.guardianId))
      .take(50);

    const children = await Promise.all(
      links.map(async (link) => {
        const profile = await ctx.db.get(link.studentId);
        return profile ? { ...profile, relation: link.relation } : null;
      }),
    );

    return children.filter(Boolean);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Create a new student profile and link it to the guardian via studentGuardians. */
export const createChildProfile = mutation({
  args: {
    guardianId: v.id("profiles"),
    name: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Create the student profile
    const studentId = await ctx.db.insert("profiles", {
      userId: args.userId,
      role: "student",
      name: args.name,
    });

    // Create the guardian ↔ student link
    await ctx.db.insert("studentGuardians", {
      studentId,
      guardianId: args.guardianId,
      relation: "parent",
    });

    return studentId;
  },
});

/** Update an existing profile (name, avatar). */
export const updateProfile = mutation({
  args: {
    id: v.id("profiles"),
    name: v.optional(v.string()),
    avatar: v.optional(v.string()),
    preferences: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Profil introuvable");
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

/**
 * Create a child account from the parent's session, without altering that session.
 *
 * Uses Convex Auth's `createAccount` helper to create the child's auth
 * account server-side — this does NOT sign the parent out. The
 * `createOrUpdateUser` callback in convex/auth.ts auto-creates the child's
 * profile row (role=student). We then insert the studentGuardians link.
 */
export const createChildAccount = action({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ childUserId: string }> => {
    const parentUserId = await getAuthUserId(ctx);
    if (!parentUserId) {
      throw new Error("Non authentifié");
    }

    if (args.password.length < 6) {
      throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
    }

    const { user } = await createAccount(ctx, {
      provider: "password",
      account: {
        id: args.email,
        secret: args.password,
      },
      profile: {
        email: args.email,
        name: args.name,
        role: "student",
      } as unknown as Parameters<typeof createAccount>[1]["profile"],
    });

    await ctx.runMutation(internal.profiles.linkChildToParent, {
      childUserId: user._id,
      parentUserId,
    });

    return { childUserId: user._id };
  },
});

/**
 * Internal: link an existing child profile to a parent profile.
 * Called from the `createChildAccount` action after `createAccount` has
 * created both user rows and the child's profile row.
 */
export const linkChildToParent = internalMutation({
  args: {
    childUserId: v.id("users"),
    parentUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const childProfile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.childUserId))
      .unique();
    if (!childProfile) {
      throw new Error("Profil enfant introuvable");
    }

    const parentProfile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.parentUserId))
      .unique();
    if (!parentProfile) {
      throw new Error("Profil parent introuvable");
    }

    const existing = await ctx.db
      .query("studentGuardians")
      .withIndex("by_guardianId", (q) => q.eq("guardianId", parentProfile._id))
      .take(200);
    if (existing.some((l) => l.studentId === childProfile._id)) {
      return;
    }

    await ctx.db.insert("studentGuardians", {
      studentId: childProfile._id,
      guardianId: parentProfile._id,
      relation: "parent",
    });
  },
});

/**
 * Rattache un élève existant au tuteur AUTHENTIFIÉ.
 *
 * `guardianId` n'est plus un argument : il se dérive de la session. La version
 * précédente acceptait n'importe quel couple (élève, tuteur) sans aucun
 * contrôle, ce qui permettait à n'importe qui de s'attribuer l'accès à la
 * progression de n'importe quel élève.
 */
export const linkChild = mutation({
  args: {
    studentId: v.id("profiles"),
    relation: v.union(
      v.literal("parent"),
      v.literal("tuteur"),
      v.literal("professeur"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Non authentifié");
    }

    const guardian = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!guardian) {
      throw new Error("Profil tuteur introuvable");
    }

    // Un élève ne peut pas se rattacher lui-même un tuteur, et un tuteur ne
    // peut pas se rattacher à lui-même.
    if (guardian.role !== "parent" && guardian.role !== "professeur") {
      throw new Error("Rôle non autorisé");
    }
    if (guardian._id === args.studentId) {
      throw new Error("Lien invalide");
    }

    // La relation déclarée doit correspondre au rôle réel de l'appelant.
    if (args.relation === "professeur" && guardian.role !== "professeur") {
      throw new Error("Rôle non autorisé");
    }
    if (args.relation !== "professeur" && guardian.role !== "parent") {
      throw new Error("Rôle non autorisé");
    }

    const student = await ctx.db.get(args.studentId);
    if (!student || student.role !== "student") {
      throw new Error("Profil étudiant introuvable");
    }

    const existing = await ctx.db
      .query("studentGuardians")
      .withIndex("by_guardianId", (q) => q.eq("guardianId", guardian._id))
      .take(200);
    if (existing.some((link) => link.studentId === args.studentId)) {
      throw new Error("Ce lien existe déjà");
    }

    return await ctx.db.insert("studentGuardians", {
      studentId: args.studentId,
      guardianId: guardian._id,
      relation: args.relation,
    });
  },
});
