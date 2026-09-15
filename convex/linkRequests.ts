import {
  query,
  mutation,
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

const TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const searchStudentByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const parentUserId = await getAuthUserId(ctx);
    if (!parentUserId) return null;

    const parentProfile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", parentUserId))
      .unique();
    if (!parentProfile || parentProfile.role !== "parent") return null;

    const normalizedEmail = args.email.trim().toLowerCase();
    if (!normalizedEmail) return null;

    const users = await ctx.db.query("users").take(10000);
    const matchedUser = users.find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );
    if (!matchedUser) return null;

    const studentProfile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", matchedUser._id))
      .unique();
    if (!studentProfile || studentProfile.role !== "student") return null;

    const existingLink = await ctx.db
      .query("studentGuardians")
      .withIndex("by_guardianId", (q) => q.eq("guardianId", parentProfile._id))
      .take(200);
    if (existingLink.some((l) => l.studentId === studentProfile._id)) {
      return { alreadyLinked: true as const };
    }

    const pendingRequest = await ctx.db
      .query("linkRequests")
      .withIndex("by_parentId", (q) => q.eq("parentId", parentProfile._id))
      .take(100);
    const hasPending = pendingRequest.some(
      (r) => r.studentId === studentProfile._id && r.status === "pending",
    );
    if (hasPending) {
      return { pendingRequest: true as const };
    }

    return {
      studentId: studentProfile._id,
      name: studentProfile.name,
      avatar: studentProfile.avatar ?? null,
    };
  },
});

export const getPendingForParent = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile || profile.role !== "parent") return [];

    const requests = await ctx.db
      .query("linkRequests")
      .withIndex("by_parentId", (q) => q.eq("parentId", profile._id))
      .take(100);

    const pending = requests.filter((r) => r.status === "pending");

    return Promise.all(
      pending.map(async (r) => {
        const student = await ctx.db.get(r.studentId);
        return {
          _id: r._id,
          studentName: student?.name ?? "Inconnu",
          status: r.status,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
        };
      }),
    );
  },
});

// ---------------------------------------------------------------------------
// Internal queries (for actions)
// ---------------------------------------------------------------------------

export const internalGetByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("linkRequests")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
  },
});

export const internalGetById = internalQuery({
  args: { id: v.id("linkRequests") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const internalGetStudentEmail = internalQuery({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.studentId);
    if (!profile) return null;
    // Use ctx.db.get directly instead of scanning the entire users table
    const user = await ctx.db.get(profile.userId as Id<"users">);
    return (user as { email?: string } | null)?.email ?? null;
  },
});

export const internalGetParentName = internalQuery({
  args: { parentId: v.id("profiles") },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.parentId);
    return profile?.name ?? "Un parent";
  },
});

export const internalGetStudentName = internalQuery({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.studentId);
    return profile?.name ?? null;
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const createRequest = mutation({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Non authentifie");

    const parentProfile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!parentProfile || parentProfile.role !== "parent") {
      throw new ConvexError("Seuls les parents peuvent envoyer une demande");
    }

    const student = await ctx.db.get(args.studentId);
    if (!student || student.role !== "student") {
      throw new ConvexError("Profil eleve introuvable");
    }

    const existing = await ctx.db
      .query("linkRequests")
      .withIndex("by_parentId", (q) => q.eq("parentId", parentProfile._id))
      .take(100);
    if (
      existing.some(
        (r) => r.studentId === args.studentId && r.status === "pending",
      )
    ) {
      throw new ConvexError("Une demande est deja en attente pour cet eleve");
    }

    const alreadyLinked = await ctx.db
      .query("studentGuardians")
      .withIndex("by_guardianId", (q) =>
        q.eq("guardianId", parentProfile._id),
      )
      .take(200);
    if (alreadyLinked.some((l) => l.studentId === args.studentId)) {
      throw new Error("Cet enfant est deja lie a votre compte");
    }

    const now = Date.now();
    const token = generateToken();

    const requestId = await ctx.db.insert("linkRequests", {
      parentId: parentProfile._id,
      studentId: args.studentId,
      token,
      status: "pending",
      expiresAt: now + TOKEN_TTL_MS,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.linkRequestsEmail.sendLinkRequestEmail,
      { requestId },
    );

    return requestId;
  },
});

export const resolveByToken = internalMutation({
  args: {
    token: v.string(),
    action: v.union(v.literal("accept"), v.literal("reject")),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("linkRequests")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!request) return { error: "Demande introuvable" };
    if (request.status !== "pending") return { error: "Demande deja traitee" };
    if (Date.now() > request.expiresAt) {
      await ctx.db.patch(request._id, { status: "expired" });
      return { error: "Demande expiree" };
    }

    if (args.action === "accept") {
      const existing = await ctx.db
        .query("studentGuardians")
        .withIndex("by_guardianId", (q) =>
          q.eq("guardianId", request.parentId),
        )
        .take(200);
      if (!existing.some((l) => l.studentId === request.studentId)) {
        await ctx.db.insert("studentGuardians", {
          studentId: request.studentId,
          guardianId: request.parentId,
          relation: "parent",
        });
      }
      await ctx.db.patch(request._id, { status: "accepted" });
      return { success: true, action: "accepted" as const };
    } else {
      await ctx.db.patch(request._id, { status: "rejected" });
      return { success: true, action: "rejected" as const };
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 48; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}
