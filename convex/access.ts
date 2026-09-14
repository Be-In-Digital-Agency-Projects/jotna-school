import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  query,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
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
 * Le PROFIL de l'appelant s'il est `admin`, `null` sinon.
 *
 * Même garde que `callerIsAdmin` — mêmes refus, exactement — mais qui rend
 * l'auteur au lieu de le jeter. Destiné aux mutations qui doivent NOMMER
 * celui qui agit : les trois actes sur l'inscription d'un élève
 * (`schools.enrollStudent`, `releaseStudent`, `transferStudent`) écrivent une
 * ligne `schoolMembershipEvents` portant `actorProfileId`.
 *
 * Il REMPLACE `callerIsAdmin` dans ces mutations-là, il ne s'y ajoute pas :
 * `callerIsAdmin` résout le profil puis n'en garde que le rôle, donc l'appeler
 * en plus relirait `profiles` une seconde fois pour une réponse déjà connue.
 * Un seul appel sert ici à la fois de garde et de source de l'auteur.
 *
 * `callerIsAdmin` reste en place et INCHANGÉ : les onze autres fonctions de
 * `schools.ts` n'ont besoin que du booléen, et un profil complet là où une
 * réponse par oui ou non suffit invite à s'en servir pour autre chose que la
 * garde.
 *
 * Le rôle est toujours le seul critère — un `admin` administre toutes les
 * écoles, ce module ne connaît pas d'admin d'école.
 */
export async function callerAdminProfile(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"profiles"> | null> {
  const profile = await currentProfile(ctx);
  return profile?.role === "admin" ? profile : null;
}

/**
 * Nombre maximum de classes lues pour un professeur.
 *
 * Le dépôt ne modélise que six niveaux (CI → CM2) et une classe est une
 * section réelle ("CM1 A"), pas un niveau : un enseignant en porte une ou
 * deux. 20 couvre largement le cas extrême d'un professeur affecté à toutes
 * les sections d'une école, sans jamais laisser la lecture grandir avec la
 * table.
 */
const TEACHER_CLASSES_LIMIT = 20;

/**
 * Nombre maximum d'élèves lus par classe.
 *
 * Une classe de primaire sénégalaise compte couramment cinquante à soixante
 * élèves ; 60 les prend tous. Plafond agrégé : 20 × 60 = 1200 identifiants,
 * du même ordre que le `.take(200)` sur `studentGuardians` qu'il remplace pour
 * un professeur d'une ou deux classes.
 */
const CLASS_STUDENTS_LIMIT = 60;

/**
 * Les élèves qu'un professeur enseigne, par ses CLASSES et non par un lien de
 * tutelle.
 *
 * Le lien historique était une ligne `studentGuardians` de relation
 * "professeur" — qu'aucun flux atteignable ne crée : les deux seules écritures
 * de cette table codent "parent" en dur, et `profiles.linkChild`, qui
 * accepterait "professeur", est interne et sans appelant. L'espace professeur
 * était donc structurellement vide. Le vrai mécanisme est
 * `schoolClasses.teacherId` : une classe porte un enseignant, les élèves y sont
 * rattachés par `schoolMemberships` en statut "active".
 *
 * Vit ici, et non dans un module neuf, pour trois raisons :
 *   - c'est l'arête que `callerMayReadStudent` vérifie juste en dessous, prise
 *     dans l'autre sens (énumérer plutôt que vérifier). Les séparer, c'est
 *     rouvrir l'écart que cet addendum ferme : une liste et un détail qui ne
 *     répondent pas la même chose ;
 *   - `access.ts` n'est pas un fichier de prédicats booléens — `checkAccess`,
 *     `loadAccessInput` et `requireAccess` y rendent déjà des objets. Son
 *     contrat réel est « qui a droit à quoi », et cette liste en fait partie ;
 *   - ses trois appelants sont déjà des clients de ce module (ou le
 *     deviennent d'un seul import), là où un module neuf imposerait une
 *     retouche manuelle de `_generated/api.d.ts`.
 *
 * Renvoie des identifiants DÉDUPLIQUÉS : rien n'interdit à un élève de porter
 * deux inscriptions actives, et un même élève compté deux fois dupliquerait
 * ses bilans dans `reports.listByTeacher`.
 *
 * Ne lève jamais et ne juge aucun rôle : le garde de rôle reste chez
 * l'appelant, qui seul sait ce qu'il rend à un `admin`.
 */
export async function studentIdsTaughtBy(
  ctx: QueryCtx,
  teacherProfileId: Id<"profiles">,
): Promise<Id<"profiles">[]> {
  const classes = await ctx.db
    .query("schoolClasses")
    .withIndex("by_teacher", (q) => q.eq("teacherId", teacherProfileId))
    .take(TEACHER_CLASSES_LIMIT);

  const seen = new Set<string>();
  const studentIds: Id<"profiles">[] = [];

  for (const schoolClass of classes) {
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_class_status", (q) =>
        q.eq("schoolClassId", schoolClass._id).eq("status", "active"),
      )
      .take(CLASS_STUDENTS_LIMIT);

    for (const membership of memberships) {
      if (seen.has(membership.studentId)) continue;
      seen.add(membership.studentId);
      studentIds.push(membership.studentId);
    }
  }

  return studentIds;
}

/**
 * Vrai si l'appelant a le droit de lire les données de CET élève-là.
 *
 * Garde de LIEN, et non de rôle. Les trois gardes ci-dessus répondent « quelle
 * sorte de personne appelle ? » ; celle-ci répond « quel rapport cette
 * personne a-t-elle avec cet élève ? ». C'est la seule question qui vaille
 * pour une fonction qui reçoit un `studentId` en argument : un garde de rôle y
 * laisse tout le personnel lire le dossier de n'importe quel élève, et
 * l'absence de garde y laisse le faire à qui détient l'identifiant, sans même
 * de compte.
 *
 * Quatre façons d'y avoir droit, pas une de plus :
 *   - être `admin` — l'écran `app/(admin)/admin/eleves/[id]` voit tout,
 *     comme avant ;
 *   - être cet élève soi-même ;
 *   - porter une ligne `studentGuardians` vers lui ;
 *   - enseigner une classe où il est inscrit en "active".
 *
 * La quatrième branche est ce qui rend le détail cohérent avec la liste :
 * `studentIdsTaughtBy` ci-dessus énumère les élèves d'un professeur par ses
 * classes, et sans elle ce professeur les verrait en liste pour se faire
 * refuser leur page de détail — la porte à demi close. Elle prend le chemin
 * INVERSE de l'énumération, parce qu'il est beaucoup moins cher : depuis
 * l'élève, son inscription active, puis sa classe, plutôt que toutes les
 * classes du professeur et tous leurs inscrits.
 *
 * La branche `studentGuardians`, elle, n'exige AUCUNE relation particulière,
 * et c'est délibéré : filtrer sur "professeur" casserait les quatre écrans
 * parents de `reports.listByStudent` — un parent porte la relation "parent",
 * un tuteur légal "tuteur". La question n'est pas à quel titre le lien
 * existe, seulement s'il existe. Elle reste en place telle quelle.
 *
 * Lecture par `by_studentId` et non `by_guardianId` : un élève a quelques
 * tuteurs, un enseignant peut avoir des centaines d'élèves. Le dépôt lit
 * ailleurs par `by_guardianId` avec `.take(200)` — la bonne forme pour
 * énumérer, la mauvaise pour vérifier UN lien. Borné à 50 comme
 * `reports.getGuardians`, qui lit la même arête dans le même sens.
 *
 * Un appelant non authentifié, ou authentifié sans profil, est refusé :
 * `currentProfile` rend null et la fonction s'arrête là.
 *
 * Cette règle n'est pas nouvelle — elle existait côté CLIENT seulement, dans
 * `app/(teacher)/teacher/students/[id]/page.tsx`, qui compare le `studentId`
 * à `getTeacherStudents` et redirige sinon. Cette vérification-là reste en
 * place et ne fait pas doublon avec celle-ci : elle offre une redirection
 * propre plutôt qu'une page vide, là où celle-ci est le verrou. Un client
 * n'exécute que le code qu'il veut bien exécuter ; le serveur, lui, décide.
 */
export async function callerMayReadStudent(
  ctx: QueryCtx,
  studentId: Id<"profiles">,
): Promise<boolean> {
  const profile = await currentProfile(ctx);
  if (!profile) return false;
  if (profile.role === "admin") return true;
  if (profile._id === studentId) return true;

  const links = await ctx.db
    .query("studentGuardians")
    .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
    .take(50);

  if (links.some((link) => link.guardianId === profile._id)) return true;

  // Le professeur de la classe de cet élève. `.take(4)` et non `.first()` :
  // rien n'interdit deux inscriptions actives, et `studentIdsTaughtBy`
  // énumère TOUS les inscrits actifs d'une classe. S'arrêter à la première
  // inscription rendrait la liste et le détail incohérents dans ce cas —
  // exactement ce que cette branche existe pour empêcher. Le coût reste
  // constant, sur le même index et dans le même sens.
  const memberships = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_student_status", (q) =>
      q.eq("studentId", studentId).eq("status", "active"),
    )
    .take(4);

  for (const membership of memberships) {
    const schoolClass = await ctx.db.get(membership.schoolClassId);
    if (schoolClass && schoolClass.teacherId === profile._id) return true;
  }

  return false;
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
