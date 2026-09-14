import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  query,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  decideAccess,
  type AccessInput,
  type AccessState,
  type SubscriptionStatus,
} from "./accessRules";

/**
 * Construit l'entrée de decideAccess depuis un profil DÉJÀ lu.
 *
 * Passer le profil plutôt que de le relire évite une seconde lecture de la
 * table profiles dans chacune des fonctions instrumentées : elles ont toutes
 * déjà fait ce travail pour leur propre contrôle de rôle.
 */
export async function loadAccessInput(
  ctx: QueryCtx | MutationCtx,
  profile: Doc<"profiles"> | null,
): Promise<AccessInput> {
  const now = Date.now();

  const empty: AccessInput = {
    now,
    role: null,
    activeMembership: null,
    hasReleasedMembership: false,
    subscription: null,
    oldestOverdueDueAt: null,
  };

  if (!profile) return empty;
  if (profile.role !== "student") return { ...empty, role: profile.role };

  const active = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_student_status", (q) =>
      q.eq("studentId", profile._id).eq("status", "active"),
    )
    .first();

  let hasReleased = false;
  if (!active) {
    const released = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_student_status", (q) =>
        q.eq("studentId", profile._id).eq("status", "released"),
      )
      .first();
    hasReleased = released !== null;
  }

  if (!active) {
    return {
      ...empty,
      role: "student",
      hasReleasedMembership: hasReleased,
    };
  }

  // Abonnement le PLUS RÉCENT, sans filtrer sur la couverture temporelle :
  // c'est decideAccess qui juge l'expiration via endsAt. Filtrer ici ferait
  // remonter "no_subscription" au lieu de "expired" pour une école échue.
  const latest = await ctx.db
    .query("subscriptions")
    .withIndex("by_owner_startsAt", (q) =>
      q.eq("ownerType", "school").eq("ownerId", active.schoolId as string),
    )
    .order("desc")
    .first();

  if (!latest) {
    return {
      ...empty,
      role: "student",
      activeMembership: { schoolId: active.schoolId as string },
      hasReleasedMembership: hasReleased,
    };
  }

  // Lecture des tranches seulement dans la branche past_due : le chemin
  // courant reste à trois lectures de documents.
  let oldestOverdueDueAt: number | null = null;
  if (latest.status === "past_due") {
    const rows = await ctx.db
      .query("installments")
      .withIndex("by_subscription", (q) => q.eq("subscriptionId", latest._id))
      .take(12);
    const dues = rows
      .filter((r) => r.status === "overdue")
      .map((r) => r.dueAt);
    oldestOverdueDueAt = dues.length > 0 ? Math.min(...dues) : null;
  }

  return {
    now,
    role: "student",
    activeMembership: { schoolId: active.schoolId as string },
    hasReleasedMembership: hasReleased,
    subscription: {
      status: latest.status as SubscriptionStatus,
      endsAt: latest.endsAt,
    },
    oldestOverdueDueAt,
  };
}

/** Résout le profil de la session courante. */
async function currentProfile(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"profiles"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId as string))
    .unique();
}

/** Pour les REQUÊTES : retourne un statut, ne lève jamais (spec §5.4). */
export async function checkAccess(
  ctx: QueryCtx | MutationCtx,
  profile: Doc<"profiles"> | null,
): Promise<AccessState> {
  return decideAccess(await loadAccessInput(ctx, profile));
}

/**
 * Vrai seulement si l'appelant est un ÉLÈVE sans droit valide.
 *
 * Destiné aux lectures partagées (subjects, topics, badges) qui servent aussi
 * l'administration et les professeurs : eux ne doivent jamais être bloqués
 * (spec §5.6 et §5.8). Un visiteur non authentifié renvoie false — c'est le
 * garde-fou propre à chaque fonction qui s'en occupe, pas le paywall.
 *
 * Exporté ici plutôt que recopié dans chaque fichier : trois copies
 * verbatim de la même logique d'autorisation, c'est trois endroits où la
 * corriger.
 */
export async function blockedStudent(ctx: QueryCtx): Promise<boolean> {
  const profile = await currentProfile(ctx);
  if (!profile || profile.role !== "student") return false;
  const access = await checkAccess(ctx, profile);
  return !access.ok;
}

/** Rôle de l'appelant, ou null s'il n'est pas authentifié ou n'a pas de profil. */
async function callerRole(
  ctx: QueryCtx,
): Promise<Doc<"profiles">["role"] | null> {
  const profile = await currentProfile(ctx);
  return profile?.role ?? null;
}

/**
 * Vrai si l'appelant a un PROFIL — pas seulement une session ouverte.
 *
 * Garde d'IDENTITÉ, le plus faible de la famille : il ne demande aucun rôle
 * particulier, seulement que l'appelant existe dans `profiles`. Un compte
 * authentifié sans profil n'a rien à lire non plus, d'où le profil et non le
 * simple jeton.
 *
 * Sa raison d'être : `blockedStudent` rend `false` pour un appelant NON
 * authentifié, par conception — il ne doit bloquer ni un adulte ni un
 * visiteur. Seul, il laisse donc lire les catalogues partagés à qui retire
 * simplement son jeton de session. Les deux gardes se cumulent sans se
 * remplacer : celui-ci établit l'identité, `blockedStudent` le droit d'accès
 * (un élève impayé a bien un profil).
 *
 * Bâti sur le même `callerRole` que `callerIsStaff` et `callerIsAdmin` :
 * `profiles.role` est un champ obligatoire, donc un rôle nul signifie
 * exactement « pas de profil ».
 */
export async function callerHasProfile(ctx: QueryCtx): Promise<boolean> {
  return (await callerRole(ctx)) !== null;
}

/**
 * Vrai si l'appelant est un professeur ou un admin.
 *
 * Garde de RÔLE, pas garde de paywall : il répond « cette personne fait-elle
 * partie du personnel ? », jamais « son école est-elle à jour ? ». Les deux se
 * cumulent sans se remplacer — ne pas le confondre avec `blockedStudent` ni
 * `requireAccess` ci-dessus.
 *
 * Vit ici plutôt que dans chacun des fichiers qui s'en sert (`exercises.ts`
 * pour les corrigés bruts, `students.ts` pour les écrans du personnel) : une
 * seule copie de la règle, un seul endroit où la corriger.
 */
export async function callerIsStaff(ctx: QueryCtx): Promise<boolean> {
  const role = await callerRole(ctx);
  return role === "professeur" || role === "admin";
}

/**
 * Vrai si l'appelant est un admin — garde de rôle, voir `callerIsStaff`.
 *
 * Distinct de `callerIsStaff` pour les lectures qui ne sont pas des écrans de
 * professeur : lister TOUS les élèves de la plateforme n'est pas la même
 * autorisation que consulter le détail d'un élève depuis un écran enseignant.
 */
export async function callerIsAdmin(ctx: QueryCtx): Promise<boolean> {
  return (await callerRole(ctx)) === "admin";
}

/**
 * Pour les MUTATIONS : lève si l'accès n'est pas ouvert.
 *
 * Les actions n'ont pas de ctx.db et ne peuvent pas appeler cette fonction ;
 * elles passent par getAccessStateForProfile.
 */
export async function requireAccess(
  ctx: QueryCtx | MutationCtx,
  profile: Doc<"profiles"> | null,
): Promise<{ schoolId: string; endsAt: number }> {
  const state = await checkAccess(ctx, profile);
  if (!state.ok) {
    throw new ConvexError({ code: "ACCESS_DENIED", reason: state.reason });
  }
  return { schoolId: state.schoolId, endsAt: state.endsAt };
}

/** Consommée par l'UI pour afficher le bon écran de blocage. */
export const getAccessState = query({
  args: {},
  handler: async (ctx): Promise<AccessState> => {
    return await checkAccess(ctx, await currentProfile(ctx));
  },
});

/**
 * Consommée par les actions, qui n'ont pas de ctx.db.
 *
 * Prendre profileId en argument est sans danger ici : la fonction ne fait
 * qu'évaluer un droit, elle n'autorise rien et n'expose aucune donnée. Elle
 * est internalQuery, donc inatteignable depuis le réseau public.
 */
export const getAccessStateForProfile = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args): Promise<AccessState> => {
    return await checkAccess(ctx, await ctx.db.get(args.profileId));
  },
});
