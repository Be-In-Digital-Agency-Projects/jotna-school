import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { blockedStudent, callerHasProfile, callerIsAdmin } from "./access";

// ---------------------------------------------------------------------------
// Queries — DEUX gardes qui se cumulent, dans cet ordre.
//
// 1. `callerHasProfile` établit l'IDENTITÉ. Nécessaire parce que
//    `blockedStudent` rend false pour un appelant NON authentifié, par
//    conception : il ne doit bloquer ni un adulte ni un visiteur. Seul, il se
//    contournait en retirant simplement le jeton de session.
// 2. `blockedStudent` établit le DROIT D'ACCÈS (paywall, spec §5.4). Lecture
//    partagée avec l'administration et les professeurs : il ne bloque qu'un
//    élève sans droit valide, jamais un adulte.
//
// Le premier ne remplace pas le second — un élève impayé a bien un profil.
// Tous les appelants sont des écrans authentifiés (élève, parent, professeur,
// admin), donc exiger un profil n'en casse aucun.
//
// Une requête ne lève jamais : même valeur vide que le chemin nominal.
// ---------------------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Identité puis paywall — voir l'en-tête : les deux se cumulent.
    if (!(await callerHasProfile(ctx))) return [];
    if (await blockedStudent(ctx)) return [];

    const subjects = await ctx.db.query("subjects").take(50);
    return subjects.sort((a, b) => a.order - b.order);
  },
});

export const getById = query({
  args: { id: v.id("subjects") },
  handler: async (ctx, args) => {
    // Identité puis paywall — voir l'en-tête : les deux se cumulent.
    if (!(await callerHasProfile(ctx))) return null;
    if (await blockedStudent(ctx)) return null;

    return await ctx.db.get(args.id);
  },
});

// ---------------------------------------------------------------------------
// Mutations — garde de RÔLE, pas garde de paywall.
//
// Les écritures ci-dessous créent, modifient et suppriment le curriculum
// lui-même. Elles n'ont rien à voir avec le droit d'accès d'un élève :
// `blockedStudent` et `requireAccess` jugent un abonnement, pas la qualité de
// l'appelant. `admin` seul pour `create`, `update` et `remove` — leurs
// appelants sont les écrans `app/(admin)/admin/subjects/*`.
//
// `seedDefaults` fait exception et n'est PAS gardée ici : elle est interne,
// donc hors de l'API publique, et un ensemencement n'a pas d'appelant porteur
// de session à qui demander un rôle. Voir son commentaire.
//
// Une mutation peut lever, et le garde est la toute première instruction :
// rien n'est lu avant d'avoir établi le rôle. Un seul message pour tous les
// refus de rôle, comme `profiles.linkChild` — et une `Error` ordinaire, non
// une `ConvexError` : ce module ne promet aucun texte à l'écran, qui a déjà
// son repli. `ConvexError` sert à ce qui doit y ARRIVER, puisque son champ
// `data` est le seul transmis au client : le CODE d'un refus de paywall
// (`accessRules.ts`), et le TEXTE des refus d'administration de
// `convex/schools.ts`.
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    name: v.string(),
    icon: v.string(),
    color: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    return await ctx.db.insert("subjects", {
      name: args.name,
      icon: args.icon,
      color: args.color,
      order: args.order,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("subjects"),
    name: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Matière introuvable");
    }
    // Filter out undefined fields
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
 * Sème les matières par défaut (curriculum CE2-CM2, contexte francophone).
 * Idempotent : ignore les matières déjà présentes, par nom.
 *
 * INTERNE. Elle était publique et n'exigeait rien — huit insertions dans
 * `subjects` offertes au réseau public, sans le moindre compte. Un garde de
 * rôle ne convenait pas non plus : un ensemencement n'a pas d'appelant porteur
 * de session, donc exiger un profil `admin` l'aurait rendue inutilisable par
 * les chemins mêmes qui la justifient.
 *
 * Conséquence assumée : elle n'a aujourd'hui AUCUN appelant, et une fonction
 * interne ne s'appelle que depuis une autre fonction Convex (`internal.…`).
 * Tant que personne ne la câble — un cron d'amorçage, une action
 * d'administration — elle ne s'exécute pas. C'est voulu : mieux vaut un
 * ensemencement à rebrancher explicitement qu'un ensemencement que n'importe
 * qui déclenche.
 */
export const seedDefaults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const defaults = [
      { name: "Mathématiques", icon: "Calculator", color: "#4f46e5", order: 1 },
      { name: "Français", icon: "Book", color: "#db2777", order: 2 },
      { name: "Sciences", icon: "Flask", color: "#10b981", order: 3 },
      { name: "Histoire-Géographie", icon: "Globe", color: "#f59e0b", order: 4 },
      { name: "Anglais", icon: "Globe", color: "#0ea5e9", order: 5 },
      { name: "Arts plastiques", icon: "Palette", color: "#ec4899", order: 6 },
      { name: "Éducation musicale", icon: "Music", color: "#8b5cf6", order: 7 },
      { name: "EMC", icon: "Users", color: "#6b7280", order: 8 },
    ];

    const existing = await ctx.db.query("subjects").take(50);
    const existingNames = new Set(existing.map((s) => s.name));

    const created: string[] = [];
    for (const subject of defaults) {
      if (!existingNames.has(subject.name)) {
        await ctx.db.insert("subjects", subject);
        created.push(subject.name);
      }
    }
    return { created, skipped: defaults.length - created.length };
  },
});

export const remove = mutation({
  args: { id: v.id("subjects") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    // Check if any topics reference this subject
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", args.id))
      .first();
    if (topics) {
      throw new Error(
        "Impossible de supprimer cette matière car elle contient des thématiques.",
      );
    }
    await ctx.db.delete(args.id);
  },
});
