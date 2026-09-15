import { query, mutation, action, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { createAccount, getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { decideLinkChild } from "./linkRules";
import { decideProfileUpdate } from "./profileRules";
import type { ProfileUpdateDecision } from "./profileRules";
import { studentIdsTaughtBy } from "./access";

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
 * Les élèves du professeur de la SESSION, par ses classes.
 *
 * Résolus par `schoolClasses.teacherId` → `schoolMemberships` actives, et non
 * plus par un lien `studentGuardians` de relation "professeur" : ce lien-là
 * n'était créé par aucun flux atteignable, donc cette liste était vide par
 * construction (voir `access.studentIdsTaughtBy`).
 *
 * Le garde de rôle et la forme de retour sont inchangés : les trois écrans
 * professeur appelants reçoivent exactement les mêmes champs. Un `admin`
 * traverse le même chemin qu'avant — lister toute la plateforme reste
 * l'affaire de `students.listStudents`.
 *
 * Une requête ne lève jamais : [] si l'appelant n'est ni professeur ni admin.
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

    const studentIds = await studentIdsTaughtBy(ctx, profile._id);

    const students = await Promise.all(
      studentIds.map(async (studentId) => {
        const student = await ctx.db.get(studentId);
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

/**
 * Profils élèves rattachés au tuteur de la SESSION.
 *
 * Le tuteur est dérivé de la session au lieu d'être reçu en argument : la
 * version précédente acceptait n'importe quel `Id<"profiles">` et rendait les
 * profils des élèves qui lui étaient rattachés, sans jamais vérifier
 * l'appelant. Ses trois appelants y passaient déjà l'identifiant de leur
 * propre profil (`getCurrentProfile`), donc l'argument était redondant et son
 * retrait ne change aucun comportement légitime.
 *
 * Une requête ne lève jamais : [] si l'appelant n'est pas authentifié ou n'a
 * pas de profil.
 */
export const getChildren = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const guardian = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!guardian) return [];

    const links = await ctx.db
      .query("studentGuardians")
      .withIndex("by_guardianId", (q) => q.eq("guardianId", guardian._id))
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

/**
 * Crée un profil élève et le lien de tutelle — INTERNE, aucun appelant.
 *
 * Cette mutation quitte la surface publique. Elle y était exposée sans aucune
 * authentification : elle insérait un profil `student` portant le `userId` que
 * l'appelant lui donnait (`v.string()`, une chaîne libre), rattaché au
 * `guardianId` que l'appelant choisissait lui aussi. Rien ne vérifiait qui
 * appelait, ni qu'il avait le moindre droit sur ce tuteur.
 *
 * Au-delà du profil parasite : rien n'impose l'unicité de `profiles.userId`,
 * qui est pourtant lu par `.unique()` (voir `getCurrentProfile` ci-dessus).
 * Insérer un profil portant le `userId` d'un compte existant fait donc lever
 * cette lecture pour cette personne, qui ne peut plus charger son profil.
 *
 * La voie légitime pour un écran est `createChildAccount` ci-dessous : elle
 * authentifie le parent, crée le compte de l'enfant via `createAccount`, et
 * laisse `linkChildToParent` écrire le lien.
 *
 * Le corps est inchangé : seul le mot d'enregistrement a changé.
 */
export const createChildProfile = internalMutation({
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

/**
 * La phrase que lit l'adulte, pour chaque refus de `decideProfileUpdate`.
 *
 * Une TABLE plutôt qu'un `throw` écrit en dur : le jour où la règle gagne un
 * second motif, TypeScript exige sa phrase ici. Un message unique se serait
 * tu et aurait raconté au lecteur le mauvais refus — précisément la panne que
 * cette branche passe son temps à réparer.
 */
const UPDATE_REFUSALS: Record<
  Extract<ProfileUpdateDecision, { ok: false }>["reason"],
  string
> = {
  empty_name: "Le nom est obligatoire",
};

/**
 * Le profil de la SESSION se modifie lui-même — nom, avatar, envoi des
 * rapports par courriel.
 *
 * ELLE ÉCRIVAIT SUR LE PROFIL D'AUTRUI. Mutation publique, aucune garde, cible
 * reçue en argument : il suffisait de tenir un `Id<"profiles">` pour renommer
 * son porteur. Et cet identifiant s'obtient — `linkRequests.searchStudentByEmail`
 * le rend contre une adresse de courriel, à un compte parent que l'inscription
 * délivre en trente secondes. Renommer l'enfant d'un autre était à portée d'un
 * appel.
 *
 * LA CIBLE A DONC DISPARU DES ARGUMENTS au lieu d'être contrôlée. Ses deux
 * appelants — les écrans de paramètres parent et professeur — y passaient déjà
 * `getCurrentProfile()._id`, leur propre profil : l'argument était redondant,
 * et son retrait ne coûte aucun usage légitime. C'est la règle appliquée à
 * `attempts.submit` et à `getChildren` : une écriture qui n'a pas à nommer
 * quelqu'un d'autre cesse de le nommer, et l'autorisation devient structurelle
 * au lieu d'être une vérification qu'on peut oublier.
 *
 * `preferences` N'EST PLUS ÉCRIT EN BLOC, pour deux raisons distinctes.
 *
 * C'est un fourre-tout : `streak.ts`, `badges.ts` et `students.ts` y rangent
 * série, badges et son, et TOUS fusionnent — ils relisent l'objet avant de le
 * réécrire. Cette mutation était la seule à le remplacer entier. L'écran
 * parent envoyait `{ receiveReports }`, ce qui EFFAÇAIT toute autre clé ;
 * inoffensif tant qu'un parent n'en a pas d'autre, mais c'est un piège armé
 * qui se déclenche à la première préférence ajoutée.
 *
 * Et `v.any()` laissait le client nommer N'IMPORTE QUELLE clé, la cible fût-elle
 * devenue soi-même : un élève se décernait ses propres badges et sa propre
 * série en un appel. Série, badges et niveau sont de l'état GAGNÉ, écrit par le
 * moteur ; un formulaire de paramètres n'a pas à pouvoir les nommer. L'argument
 * est donc `receiveReports` — la seule préférence que ces écrans règlent
 * vraiment — fusionnée dans l'objet existant.
 *
 * Les refus sont des `ConvexError` de forme CHAÎNE : leur lecteur est un adulte
 * sur son propre écran de paramètres, le texte est déjà écrit, aucun écran n'a
 * à le reformuler (voir l'en-tête de `convex/schools.ts`). Les deux écrans les
 * avalaient en silence (`catch {}`) ; ils lisent maintenant
 * `lib/refusalMessage.ts`, sans quoi basculer les jets n'aurait rien changé.
 *
 * Le calcul du patch vit dans `convex/profileRules.ts`, pur et testé ; il ne
 * reste ici que l'authentification, la lecture et l'écriture.
 */
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    avatar: v.optional(v.string()),
    receiveReports: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Non authentifié");
    }

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) {
      throw new ConvexError("Profil introuvable");
    }

    // Le `required` du formulaire est une commodité d'écran, pas une garantie :
    // c'est `decideProfileUpdate` qui refuse un nom vide.
    const decision = decideProfileUpdate(args, profile.preferences);
    if (!decision.ok) {
      throw new ConvexError(UPDATE_REFUSALS[decision.reason]);
    }

    // Un patch vide écrirait quand même le document : une révision de plus, un
    // réveil de tous les abonnements qui le lisent, pour rien.
    if (Object.keys(decision.patch).length === 0) return;

    await ctx.db.patch(profile._id, decision.patch);
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
 * Rattache un élève existant au tuteur AUTHENTIFIÉ — INTERNE, aucun appelant.
 *
 * Cette mutation a quitté la surface publique, et n'y reviendra pas telle
 * quelle. Dériver le tuteur de la session ne suffit pas : le rôle est
 * auto-attribuable à l'inscription (`convex/auth.ts` lit `params.role` et
 * accepte "parent"), si bien qu'un compte créé pour l'occasion pouvait
 * rattacher n'importe quel `Id<"profiles">` d'élève et lire toute sa
 * progression via l'espace parent. Les gardes ci-dessous contrôlent QUI
 * appelle et QUELLE relation il déclare — jamais s'il a un droit sur CET
 * élève-là. Ne restait comme obstacle que d'ignorer l'identifiant de la cible :
 * de l'opacité, pas une autorisation.
 *
 * La pièce manquante est une preuve de ce droit — et elle existe déjà,
 * ailleurs : `linkRequests.createRequest` ouvre une demande avec un jeton de
 * 48 h envoyé par courriel, et `linkRequests.resolveByToken`, interne, écrit le
 * lien une fois le jeton résolu. C'est ce consentement que `linkChild`
 * court-circuitait : ni jeton, ni courriel, ni accord. Ajouter ici une
 * vérification de lien préalable serait par ailleurs circulaire — c'est
 * précisément cette mutation qui crée le lien. Faute de contrat public sûr, pas
 * d'export public. Les gardes sont conservées : elles restent justes pour un
 * appelant interne et documentent la règle voulue.
 *
 * La décision d'autorisation vit dans `convex/linkRules.ts`, pure et testée ;
 * il ne reste ici que l'authentification, les lectures et l'écriture.
 */
export const linkChild = internalMutation({
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

    const student = await ctx.db.get(args.studentId);
    const decision = decideLinkChild({
      guardianRole: guardian.role,
      relation: args.relation,
      targetRole: student?.role ?? null,
    });
    if (!decision.ok) {
      // Un seul message pour tous les refus de rôle : l'appelant n'a pas à
      // savoir laquelle des règles l'a arrêté.
      throw new Error(
        decision.reason === "target_not_student"
          ? "Profil étudiant introuvable"
          : "Rôle non autorisé",
      );
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
