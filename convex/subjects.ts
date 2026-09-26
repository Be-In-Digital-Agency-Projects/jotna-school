import {
  query,
  mutation,
  internalMutation,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { catalogAccess, callerIsAdmin } from "./access";
import { isHiddenClass } from "./curriculum";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Queries — IDENTITÉ ET DROIT D'ACCÈS, en une seule décision.
//
// `catalogReadable` (`access.ts`) réunit les deux, et c'est bien DEUX
// questions qu'il pose, pas une :
//
// 1. L'IDENTITÉ. Le paywall seul ne suffit pas : `blockedStudent` rend false
//    pour un appelant NON authentifié, par conception — il ne doit bloquer ni
//    un adulte ni un visiteur. Sans exigence de profil, il se contournait en
//    RETIRANT simplement le jeton de session.
// 2. Le DROIT D'ACCÈS (paywall, spec §5.4). Lecture partagée avec
//    l'administration et les professeurs : seul un élève sans droit valide est
//    bloqué, jamais un adulte.
//
// La première ne remplace pas la seconde — un élève impayé a bien un profil.
// Tous les appelants sont des écrans authentifiés, donc exiger un profil n'en
// casse aucun.
//
// LES DEUX SE POSAIENT EN DEUX APPELS, donc en DEUX résolutions du profil pour
// chaque abonnement au catalogue — et en deux fois la surface d'invalidation,
// `profiles.preferences` étant réécrit à chaque série, badge ou réglage de son.
// Une lecture, deux questions, même réponse qu'avant.
//
// Une requête ne lève jamais : même valeur vide que le chemin nominal.
// ---------------------------------------------------------------------------

/**
 * Les matières dont TOUTES les thématiques sont masquées.
 *
 * TROIS MATIÈRES N'EXISTENT QUE POUR LE LYCÉE sur ce déploiement — Philosophie,
 * SVT, Physique-Chimie. Masquer leurs thématiques sans masquer la matière
 * laisserait à l'élève trois cartes qui s'ouvrent sur rien : le contenu de
 * collège transparaîtrait par son absence.
 *
 * UNE MATIÈRE SANS AUCUNE THÉMATIQUE N'EST PAS CONCERNÉE. Six autres sont vides
 * depuis toujours et s'affichent déjà ainsi ; les faire disparaître ici serait
 * un autre changement, qui ne regarde pas le masquage.
 */
async function subjectsHiddenWhole(
  ctx: QueryCtx,
): Promise<ReadonlySet<Id<"subjects">>> {
  const topics = await ctx.db.query("topics").take(1000);

  const withVisible = new Set<Id<"subjects">>();
  const withHidden = new Set<Id<"subjects">>();
  for (const topic of topics) {
    (isHiddenClass(topic.class) ? withHidden : withVisible).add(
      topic.subjectId,
    );
  }

  for (const subjectId of withVisible) withHidden.delete(subjectId);
  return withHidden;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Identité, paywall ET niveaux masqués en une lecture — voir `catalogAccess`.
    const access = await catalogAccess(ctx);
    if (!access.readable) return [];

    const subjects = await ctx.db.query("subjects").take(50);
    if (access.hiddenClasses) return subjects.sort((a, b) => a.order - b.order);

    const hidden = await subjectsHiddenWhole(ctx);
    return subjects
      .filter((subject) => !hidden.has(subject._id))
      .sort((a, b) => a.order - b.order);
  },
});

export const getById = query({
  args: { id: v.id("subjects") },
  handler: async (ctx, args) => {
    // Identité, paywall ET niveaux masqués en une lecture — voir `catalogAccess`.
    const access = await catalogAccess(ctx);
    if (!access.readable) return null;

    // Même règle que la liste : une matière entièrement masquée répond comme
    // une matière absente, sinon son identifiant rouvrirait la porte.
    if (
      !access.hiddenClasses &&
      (await subjectsHiddenWhole(ctx)).has(args.id)
    ) {
      return null;
    }

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
// refus de rôle, comme `profiles.linkChild`.
//
// CES REFUS SONT DES `ConvexError`, PARCE QU'UN LECTEUR LES AFFICHE. La règle
// se juge au LECTEUR, jamais au module : hors développement Convex occulte le
// `message` d'une erreur, et seul `data` est transmis TEL QUEL, donc un refus
// qu'un écran montre doit voyager par là. Les écrans le lisent avec
// `refusalMessage` (`lib/refusalMessage.ts`). Sans cette bascule leur repli
// serait INATTEIGNABLE — ils attrapent en `err instanceof Error`, test que
// toute erreur passe puisque `ConvexError` étend `Error` — et l'administrateur
// lirait un message enveloppé et vidé à la place de la phrase écrite ici.
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    name: v.string(),
    icon: v.string(),
    color: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");

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
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");

    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new ConvexError("Matière introuvable");
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
/**
 * LES MATIÈRES SEMÉES PAR DÉFAUT — sorties de la fonction pour être LUES.
 *
 * `icon` porte un nom d'icône Lucide, que web et mobile traduisent en emoji
 * (`lib/subject-icons.ts`). Les deux traductions avaient oublié `Users`, et
 * l'EMC s'affichait « US » sur l'accueil d'un enfant. Cette liste est
 * désormais confrontée à la table par `lib/__tests__/subjectIcons.test.ts` :
 * ajouter une matière avec une icône inconnue fait rougir la CI, au lieu
 * d'attendre qu'un enfant la voie.
 */
export const DEFAULT_SUBJECTS = [
  { name: "Mathématiques", icon: "Calculator", color: "#4f46e5", order: 1 },
  { name: "Français", icon: "Book", color: "#db2777", order: 2 },
  { name: "Sciences", icon: "Flask", color: "#10b981", order: 3 },
  { name: "Histoire-Géographie", icon: "Globe", color: "#f59e0b", order: 4 },
  { name: "Anglais", icon: "Globe", color: "#0ea5e9", order: 5 },
  { name: "Arts plastiques", icon: "Palette", color: "#ec4899", order: 6 },
  { name: "Éducation musicale", icon: "Music", color: "#8b5cf6", order: 7 },
  { name: "EMC", icon: "Users", color: "#6b7280", order: 8 },
] as const;

export const seedDefaults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const defaults = DEFAULT_SUBJECTS;

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
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");

    // Check if any topics reference this subject
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", args.id))
      .first();
    if (topics) {
      throw new ConvexError(
        "Impossible de supprimer cette matière car elle contient des thématiques.",
      );
    }
    await ctx.db.delete(args.id);
  },
});
