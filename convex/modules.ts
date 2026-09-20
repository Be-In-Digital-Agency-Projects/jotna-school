/**
 * LES MODULES OPTIONNELS D'UNE ÉCOLE — qui les allume, et qui les voit.
 *
 * Le catalogue et la règle du « éteint par défaut » vivent dans
 * `convex/moduleCatalog.ts` ; ce fichier ne porte que les fonctions.
 *
 * DEUX GARDES, ET ELLES NE SE RESSEMBLENT PAS :
 *
 *   - ÉCRIRE (`setForSchool`) demande d'administrer CETTE école : un `admin`,
 *     ou le `directeur` qui y est rattaché en `schoolStaff` actif. Pas un
 *     professeur — allumer un enseignement religieux pour toute une école
 *     n'est pas une décision d'enseignant — et surtout pas un directeur d'une
 *     AUTRE école, ce qu'une simple garde de rôle laisserait passer ;
 *   - LIRE (`getMine`) est la question de l'espace élève : « cet enfant
 *     a-t-il ce module ? ». Elle se tranche sur l'école où il est INSCRIT, et
 *     sous le même paywall que le reste du catalogue — un élève sans droit
 *     d'accès ne reçoit rien, module allumé ou non.
 *
 * UNE REQUÊTE NE LÈVE JAMAIS (spec §5.4) : elle rend une liste vide ou un
 * module éteint. Une mutation lève des `ConvexError` porteuses de phrases,
 * parce qu'un écran les affiche (`lib/refusalMessage.ts`).
 */

import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { callerProfile, checkAccess } from "./access";
import { MODULES, moduleKeyValidator, type ModuleKey } from "./moduleCatalog";

/** Plafond de lecture du personnel d'un profil — une personne sert une école, deux au pire. */
const STAFF_SCHOOLS_LIMIT = 20;

/**
 * Ce module est-il allumé pour cette école ?
 *
 * L'ABSENCE DE LIGNE VAUT « NON » — c'est la règle du catalogue, et elle est
 * écrite ici une seule fois pour que personne n'ait à s'en souvenir.
 *
 * PRIVÉE, et elle doit le rester : elle répond sur une ÉCOLE, pas sur un
 * appelant. Qui la prendrait pour une garde ouvrirait le module à un élève
 * d'une autre école, ou à un élève dont l'abonnement est suspendu — deux
 * questions que seule `moduleAccessForProfile` pose.
 */
async function schoolModuleEnabled(
  ctx: QueryCtx | MutationCtx,
  schoolId: Id<"schools">,
  moduleKey: ModuleKey,
): Promise<boolean> {
  const row = await ctx.db
    .query("schoolModules")
    .withIndex("by_school_module", (q) =>
      q.eq("schoolId", schoolId).eq("moduleKey", moduleKey),
    )
    .unique();
  return row?.enabled === true;
}

export interface ModuleAccess {
  enabled: boolean;
  reason: "ok" | "not_authenticated" | "no_access" | "not_enabled";
}

/**
 * Ce module est-il ouvert à cet appelant ?
 *
 * Rend aussi POURQUOI, parce que l'écran en a besoin pour dire autre chose
 * qu'une page blanche : un enfant dont l'école n'a pas pris l'arabe ne lit pas
 * le même message qu'un enfant dont l'abonnement est suspendu.
 *
 * TROIS LECTEURS, TROIS CHEMINS :
 *   - l'ÉLÈVE : son inscription active, puis le paywall, puis le module ;
 *   - le PERSONNEL (`professeur`, `directeur`) : allumé dès qu'UNE de ses
 *     écoles l'a allumé, pour qu'un maître puisse préparer sa classe ;
 *   - l'`admin` : toujours ouvert, comme partout ailleurs dans ce dépôt — il
 *     traverse les espaces pour dépanner.
 *
 * ELLE PREND LE PROFIL, ELLE NE LE RÉSOUT PAS, pour deux raisons qui pointent
 * dans le même sens :
 *   - les ACTIONS n'ont pas de `ctx.db` et résolvent leur appelant par une
 *     requête interne (`arabic/db.ts`) avant de pouvoir juger quoi que ce
 *     soit — c'est le motif que `access.getAccessStateForProfile` suit déjà ;
 *   - les requêtes qui posent la question ont DÉJÀ besoin du profil pour la
 *     suite. Le résoudre ici en plus relirait `profiles` deux fois par
 *     souscription, et doublerait d'autant la surface d'invalidation,
 *     `profiles.preferences` étant réécrit à chaque série, badge ou réglage
 *     de son.
 *
 * Recevoir un profil n'autorise rien : la fonction ÉVALUE un droit, elle ne
 * l'accorde pas, et son appelant reste tenu de sa propre garde.
 */
export async function moduleAccessForProfile(
  ctx: QueryCtx,
  profile: Doc<"profiles"> | null,
  moduleKey: ModuleKey,
): Promise<ModuleAccess> {
  if (!profile) return { enabled: false, reason: "not_authenticated" };

  if (profile.role === "admin") return { enabled: true, reason: "ok" };

  if (profile.role === "professeur" || profile.role === "directeur") {
    const enabled = await staffSeesModule(ctx, profile._id, moduleKey);
    return {
      enabled,
      reason: enabled ? "ok" : "not_enabled",
    };
  }

  if (profile.role !== "student") {
    // Un parent n'a pas d'espace de leçons : rien à ouvrir, rien à expliquer.
    return { enabled: false, reason: "no_access" };
  }

  const access = await checkAccess(ctx, profile);
  if (!access.ok) return { enabled: false, reason: "no_access" };

  const enabled = await schoolModuleEnabled(
    ctx,
    access.schoolId as Id<"schools">,
    moduleKey,
  );
  return { enabled, reason: enabled ? "ok" : "not_enabled" };
}

/** Vrai si l'une des écoles de ce membre du personnel a allumé le module. */
async function staffSeesModule(
  ctx: QueryCtx,
  profileId: Id<"profiles">,
  moduleKey: ModuleKey,
): Promise<boolean> {
  const rows = await ctx.db
    .query("schoolStaff")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .take(STAFF_SCHOOLS_LIMIT);

  for (const row of rows) {
    if (row.status !== "active") continue;
    if (await schoolModuleEnabled(ctx, row.schoolId, moduleKey)) return true;
  }
  return false;
}

/**
 * Le profil de l'appelant s'il peut ADMINISTRER cette école, `null` sinon.
 *
 * `admin` partout ; `directeur` seulement là où `schoolStaff` le dit ACTIF.
 * La vérification porte sur le lien, pas sur le rôle : sans elle, le directeur
 * d'une école allumerait des modules chez sa voisine.
 */
async function callerAdministersSchool(
  ctx: QueryCtx | MutationCtx,
  schoolId: Id<"schools">,
): Promise<Doc<"profiles"> | null> {
  const profile = await callerProfile(ctx);
  if (!profile) return null;
  if (profile.role === "admin") return profile;
  if (profile.role !== "directeur") return null;

  const rows = await ctx.db
    .query("schoolStaff")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .take(STAFF_SCHOOLS_LIMIT);

  const member = rows.some(
    (row) => row.schoolId === schoolId && row.status === "active",
  );
  return member ? profile : null;
}

// ---------------------------------------------------------------------------
// Requêtes
// ---------------------------------------------------------------------------

/**
 * Le catalogue des modules et leur état pour une école.
 *
 * Rend TOUS les modules, éteints compris : l'écran d'école doit montrer ce qui
 * EXISTE, sans quoi une école ne peut pas demander ce qu'elle ignore.
 */
export const listForSchool = query({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, args) => {
    if (!(await callerAdministersSchool(ctx, args.schoolId))) return [];

    const rows = await ctx.db
      .query("schoolModules")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .take(MODULES.length + 10);

    const byKey = new Map(rows.map((row) => [row.moduleKey, row]));

    return MODULES.map((descriptor) => {
      const row = byKey.get(descriptor.key);
      return {
        key: descriptor.key,
        title: descriptor.title,
        summary: descriptor.summary,
        emoji: descriptor.emoji,
        enabled: row?.enabled === true,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  },
});

/**
 * Les modules ouverts à l'appelant — ce que l'espace élève interroge.
 *
 * Une liste, pas un booléen : le deuxième module ne devra pas obliger à écrire
 * une deuxième requête, ni l'accueil à s'abonner deux fois.
 */
export const getMine = query({
  args: {},
  handler: async (ctx) => {
    const out: {
      key: ModuleKey;
      title: string;
      summary: string;
      emoji: string;
      color: string;
      href: string;
      enabled: boolean;
    }[] = [];

    // UNE SEULE résolution de profil pour tout le catalogue. Repasser par
    // `moduleAccessForCaller` à chaque module relirait `profiles` autant de
    // fois qu'il y a de modules — et doublerait d'autant la surface
    // d'invalidation de cette souscription, `profiles.preferences` étant
    // réécrit à chaque série, badge ou réglage de son.
    const profile = await callerProfile(ctx);

    for (const descriptor of MODULES) {
      const access = await moduleAccessForProfile(ctx, profile, descriptor.key);
      out.push({
        key: descriptor.key,
        title: descriptor.title,
        summary: descriptor.summary,
        emoji: descriptor.emoji,
        color: descriptor.color,
        href: descriptor.studentHref,
        enabled: access.enabled,
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

/**
 * Allume ou éteint un module pour une école.
 *
 * IDEMPOTENTE : rallumer un module déjà allumé ne fait que redater la ligne.
 * Elle n'efface jamais — éteindre écrit `enabled: false`, pour que la ligne
 * garde QUI a éteint et QUAND. Effacer perdrait cette trace, et une école qui
 * découvre un module éteint doit pouvoir savoir d'où ça vient.
 *
 * ÉTEINDRE NE DÉTRUIT AUCUNE PROGRESSION. Les lignes `arabicLessonProgress`
 * d'un élève restent : une école qui suspend le module en cours d'année, ou
 * qui l'éteint par erreur, ne doit pas effacer le travail des enfants. Elles
 * redeviennent visibles le jour où le module se rallume.
 */
export const setForSchool = mutation({
  args: {
    schoolId: v.id("schools"),
    moduleKey: moduleKeyValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await callerAdministersSchool(ctx, args.schoolId);
    if (!actor) throw new ConvexError("Rôle non autorisé");

    const school = await ctx.db.get(args.schoolId);
    if (!school) throw new ConvexError("École introuvable");

    const now = Date.now();
    const existing = await ctx.db
      .query("schoolModules")
      .withIndex("by_school_module", (q) =>
        q.eq("schoolId", args.schoolId).eq("moduleKey", args.moduleKey),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updatedBy: actor._id,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.insert("schoolModules", {
      schoolId: args.schoolId,
      moduleKey: args.moduleKey,
      enabled: args.enabled,
      updatedBy: actor._id,
      updatedAt: now,
    });
    return null;
  },
});
