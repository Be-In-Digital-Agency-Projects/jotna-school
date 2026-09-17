import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  query,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
// `SubscriptionStatus` n'est plus importé : `subscriptions.status` porte au
// schéma exactement la même union, et le transtypage qui les rapprochait
// masquait une divergence éventuelle au lieu de la faire échouer.
import {
  decideAccess,
  type AccessInput,
  type AccessState,
} from "./accessRules";

/**
 * L'abonnement d'une école que le paywall tient pour COURANT.
 *
 * Le contrat le plus récemment COMMENCÉ (`startsAt <= now`), et à défaut
 * seulement — aucun n'a commencé — le plus récent tout court.
 *
 * Pourquoi pas « le plus récent », qui était la règle jusqu'ici :
 * `decideAccess` ne lit JAMAIS `startsAt` (`accessRules.ts` ne reçoit que
 * `status` et `endsAt`). Un contrat à venir est donc jugé exactement comme un
 * contrat en cours, et le jour où un administrateur enregistre celui de
 * l'année suivante, deux défauts SYMÉTRIQUES s'ouvrent : en `draft` ou
 * `pending_payment`, ce contrat futur devient « le plus récent » et coupe
 * l'école entière séance tenante ; en `active`, `now < endsAt` est vrai et
 * l'école obtient l'accès AVANT le début du contrat, pour une année qu'elle
 * n'a pas commencé à payer. Ne regarder que les contrats COMMENCÉS ferme les
 * deux ; `schools.recordSubscription` verrouille le second en refusant
 * d'enregistrer `active` un contrat qui n'a pas commencé.
 *
 * Pourquoi pas non plus « celui qui couvre `now` », filtré sur la couverture :
 * une école ÉCHUE n'aurait alors plus aucun contrat et lirait
 * `no_subscription` quand la vérité est `expired` — l'enfant recevrait le
 * mauvais motif. Le contrat le plus récemment commencé, lui, le dit
 * correctement : s'il est fini, `decideAccess` rend `expired` par `endsAt`,
 * ce qu'il fait déjà.
 *
 * POURQUOI UN SEUL DOCUMENT SUFFIT — et c'est une propriété des DONNÉES, pas
 * de cette requête. Le contrat le plus récemment commencé est celui en vigueur
 * si `now < endsAt` ; s'il est échu, aucun contrat plus ancien ne peut couvrir
 * `now`, parce que les contrats d'une école ne se CHEVAUCHENT PAS. Cet
 * invariant n'est pas un pari : la table est partie de vide et n'a que TROIS
 * écrivains, dont un seul crée des périodes. `schools.recordSubscription`
 * insère, et refuse tout contrat dont la période en croise une autre.
 * `schools.amendSeats` fait grossir un contrat DÉJÀ SIGNÉ — celui en vigueur,
 * ou à défaut le prochain à commencer — sièges et montant, et ne touche NI
 * `startsAt` NI `endsAt`. `schools.activateSubscription` n'écrit QUE `status`,
 * et une seule valeur : `active`, depuis `pending_payment`, sur un contrat qui
 * a commencé et n'est pas fini. Aucun des deux `patch` ne peut donc créer de
 * chevauchement, puisqu'aucun ne déplace une borne de période. Que l'avenant
 * puisse viser un contrat
 * À VENIR n'y change rien, et ne change rien non plus à CETTE lecture : elle
 * ignore les contrats non commencés, sauf quand il n'en existe aucun d'autre.
 * Qui relâchera cette étroitesse devra revenir ici — la lecture redeviendrait
 * fausse pour une école dont un contrat COURT chevaucherait un long : le
 * court, plus récemment commencé, gagnerait puis expirerait, coupant une école
 * que le long couvre encore.
 *
 * AUCUNE EXCEPTION, `cancelled` compris. Cette lecture ne regarde PAS le
 * statut : elle compare des `startsAt`. Un contrat résilié qu'on laisserait
 * croiser un contrat actif gagnerait donc ici le jour où il commence, et
 * couperait l'école entière — `cancelled` tant qu'il dure, puis `expired` —
 * pendant que le contrat actif la couvre encore. Ce n'est pas un motif inexact
 * rendu à un enfant, c'est un droit REFUSÉ à une école qui paie.
 * `recordSubscription` ferme les deux bouts : il refuse les chevauchements
 * sans regarder le statut, et refuse d'écrire `cancelled` — aucune mutation ne
 * sait aujourd'hui faire passer un contrat existant à « résilié ». Les QUATRE
 * `patch` de la table le garantissent, et la liste est exhaustive : l'avenant
 * de sièges d'`amendSeats` n'écrit jamais le statut ; `activateSubscription` et
 * `billing.applyPayment` n'en écrivent qu'UNE valeur, `active` ;
 * `billing.markOverdueInstallments` n'en écrit qu'une autre, `past_due`, et
 * seulement depuis `active`. Aucune période résiliée n'attend donc d'être
 * recontractée. (`past_due` ne change rien à cette lecture-ci, qui ne regarde
 * pas le statut ; il change le VERDICT, et `decideAccess` s'en charge.)
 *
 * POUR LE PLAN DE FACTURATION : le jour où la résiliation existera (un `patch`
 * du STATUT vers `cancelled`), un contrat résilié devra pouvoir être croisé
 * par celui qui le remplace, et CETTE lecture devra alors ignorer les contrats
 * résiliés — sans quoi le défaut décrit ci-dessus se rouvre exactement.
 * `schools.recordSubscription` demandera la même chose de son côté, par un
 * index portant `status`.
 *
 * Le repli sur « le plus récent tout court » ne coûte un second document que
 * si l'école n'a AUCUN contrat commencé. Il existe pour celle dont le tout
 * premier contrat est daté de la rentrée prochaine : elle doit lire
 * `pending_payment`, pas `no_subscription`. C'est l'ancienne règle, réduite au
 * seul cas où elle ne peut pas nuire — il n'y a alors aucun droit en cours
 * qu'elle pourrait contredire.
 *
 * UNE SEULE règle pour ses lecteurs — le verdict d'accès ici, le plafond de
 * sièges et `getEnrollmentOutlook` dans `schools.ts` : un plafond assis sur un
 * autre contrat que le paywall surveillerait le mauvais.
 *
 * `decideAccess` reste INCHANGÉ : on change quel abonnement lui est présenté,
 * jamais comment il le juge.
 */
export async function currentSchoolSubscription(
  ctx: QueryCtx | MutationCtx,
  schoolId: Id<"schools">,
  now: number,
): Promise<Doc<"subscriptions"> | null> {
  // La plage est bornée par l'INDEX lui-même, `by_owner_startsAt` portant
  // `startsAt` en dernière position : UN document lu, quel que soit
  // l'historique de contrats de l'école. Le paywall passe ici à chaque lecture
  // d'un élève — c'est le chemin le plus chaud du dépôt.
  const started = await ctx.db
    .query("subscriptions")
    .withIndex("by_owner_startsAt", (q) =>
      q.eq("ownerType", "school").eq("ownerId", schoolId).lte("startsAt", now),
    )
    .order("desc")
    .first();
  if (started) return started;

  return await ctx.db
    .query("subscriptions")
    .withIndex("by_owner_startsAt", (q) =>
      q.eq("ownerType", "school").eq("ownerId", schoolId),
    )
    .order("desc")
    .first();
}

/**
 * L'ANCRE DE LA GRÂCE — le `dueAt` de la tranche échue la PLUS ANCIENNE.
 *
 * C'est la date à partir de laquelle `decideAccess` compte les vingt et un
 * jours (spec §8.5). Sans elle, un contrat « impayé » est une incohérence de
 * données et le paywall refuse — une grâce se compte à partir de quelque chose.
 *
 * UN SEUL DOCUMENT LU, ET LA RÉPONSE EST EXACTE. L'index
 * `by_subscription_status_dueAt` range les tranches d'un contrat par statut
 * puis par date : la première ligne `overdue` dans l'ordre croissant EST la
 * plus ancienne échue. La version précédente lisait douze lignes par
 * `by_subscription` et filtrait en mémoire, ce qui laissait à tenir
 * l'invariante que §8.5 léguait au plan 3 — « jamais plus de douze tranches
 * pour un abonnement » — invariante que l'avenant de sièges (§7.6, D44)
 * s'apprête justement à faire grossir sans compter. Rendue exacte, la lecture
 * n'a plus d'invariante à casser.
 *
 * UNE SEULE DÉFINITION POUR SES DEUX LECTEURS : le verdict d'accès ici, et
 * `schools.getEnrollmentOutlook` qui montre le même verdict à
 * l'administrateur. Deux lectures qui répondraient différemment à la même
 * question finiraient par se contredire — c'est la règle qui a déjà servi pour
 * la sélection du contrat et pour le plafond de sièges.
 *
 * C'est le chemin le plus chaud du dépôt pour une école en retard : le paywall
 * passe ici à chaque lecture d'un de ses élèves.
 */
export async function graceAnchorFor(
  ctx: QueryCtx | MutationCtx,
  subscriptionId: Id<"subscriptions">,
): Promise<number | null> {
  const oldest = await ctx.db
    .query("installments")
    .withIndex("by_subscription_status_dueAt", (q) =>
      q.eq("subscriptionId", subscriptionId).eq("status", "overdue"),
    )
    .order("asc")
    .first();
  return oldest ? oldest.dueAt : null;
}

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

  // Le contrat le plus récemment COMMENCÉ, et non le plus récent : voir
  // `currentSchoolSubscription`. C'est toujours `decideAccess` qui juge
  // l'expiration via `endsAt` — cette lecture ne fait que lui présenter le bon
  // contrat.
  const current = await currentSchoolSubscription(ctx, active.schoolId, now);

  if (!current) {
    return {
      ...empty,
      role: "student",
      activeMembership: { schoolId: active.schoolId as string },
      hasReleasedMembership: hasReleased,
    };
  }

  // Lecture des tranches seulement dans la branche past_due : le chemin
  // courant reste à trois lectures de documents.
  const oldestOverdueDueAt =
    current.status === "past_due"
      ? await graceAnchorFor(ctx, current._id)
      : null;

  return {
    now,
    role: "student",
    activeMembership: { schoolId: active.schoolId as string },
    hasReleasedMembership: hasReleased,
    subscription: {
      status: current.status,
      endsAt: current.endsAt,
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

/**
 * L'appelant peut-il lire le CATALOGUE partagé — matières, thématiques, badges ?
 *
 * Réunit en une seule lecture de profil les deux gardes que ces sept requêtes
 * posaient l'une après l'autre : `callerHasProfile` puis `blockedStudent`.
 * Chacune appelait `currentProfile`, donc chaque abonnement au catalogue
 * résolvait le profil DEUX FOIS — et doublait aussi sa surface
 * d'invalidation, `profiles.preferences` étant réécrit à chaque série, badge ou
 * réglage de son.
 *
 * La décision est identique, branche pour branche : pas de profil → non ;
 * personnel → oui, jamais bloqué par le paywall (spec §5.6 et §5.8) ; élève →
 * son droit d'accès tranche. Les deux gardes d'origine restent exportées, elles
 * servent ailleurs.
 */
export async function catalogReadable(ctx: QueryCtx): Promise<boolean> {
  return (await catalogAccess(ctx)).readable;
}

/**
 * Ce que l'appelant a le droit de lire du catalogue, en UNE lecture de profil.
 *
 * DEUX RÉPONSES PARCE QU'IL Y A DEUX QUESTIONS, et qu'elles se tranchent avec
 * le même profil :
 *
 * - `readable` — le droit d'accès, exactement `catalogReadable` ci-dessus ;
 * - `hiddenClasses` — le droit de voir le collège et le lycée, que
 *   `convex/curriculum.ts` masque à tout le monde sauf à un `admin`, parce que
 *   c'est lui qui les prépare.
 *
 * LES POSER SÉPARÉMENT RELIRAIT `profiles`. C'est précisément le doublon que
 * `catalogReadable` avait supprimé — et il coûtait double aussi en surface
 * d'invalidation, `profiles.preferences` étant réécrit à chaque série, badge ou
 * réglage de son.
 */
export async function catalogAccess(
  ctx: QueryCtx,
): Promise<{ readable: boolean; hiddenClasses: boolean }> {
  const profile = await currentProfile(ctx);
  if (!profile) return { readable: false, hiddenClasses: false };
  if (profile.role !== "student") {
    return { readable: true, hiddenClasses: profile.role === "admin" };
  }
  return {
    readable: (await checkAccess(ctx, profile)).ok,
    hiddenClasses: false,
  };
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
 * celui qui agit. CINQ mutations de `schools.ts` l'appellent, et chacune écrit
 * une ligne de journal portant `actorProfileId` : les trois actes sur
 * l'inscription d'un élève (`enrollStudent`, `releaseStudent`,
 * `transferStudent` → `schoolMembershipEvents`), l'avenant de sièges
 * (`amendSeats` → `subscriptionAmendments`) et l'activation d'un contrat
 * (`activateSubscription` → `subscriptionActivations`). Le compte a bougé deux
 * fois sans que ce commentaire suive ; il dit désormais la RÈGLE — qui nomme
 * un auteur appelle cette garde — plutôt qu'un nombre qui se périme.
 *
 * Il REMPLACE `callerIsAdmin` dans ces mutations-là, il ne s'y ajoute pas :
 * `callerIsAdmin` résout le profil puis n'en garde que le rôle, donc l'appeler
 * en plus relirait `profiles` une seconde fois pour une réponse déjà connue.
 * Un seul appel sert ici à la fois de garde et de source de l'auteur.
 *
 * `callerIsAdmin` reste en place et INCHANGÉ : toutes les autres fonctions de
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
 * Le PROFIL de l'appelant s'il est `professeur` ou `admin`, `null` sinon.
 *
 * Même garde que `callerIsStaff` — mêmes refus, exactement — mais qui rend
 * l'auteur au lieu de le jeter, sur le modèle de `callerAdminProfile`
 * ci-dessus. Destiné aux mutations qui doivent ensuite juger d'un LIEN et non
 * d'un rôle : l'identité de l'appelant sert à décider s'il a quelque chose à
 * voir avec le document qu'il désigne.
 *
 * C'est la doctrine que ce fichier énonce déjà plus haut pour toute fonction
 * qui reçoit un identifiant en argument — un garde de rôle y laisse tout le
 * personnel agir sur le document de n'importe qui.
 *
 * UNE VERSION ANTÉRIEURE DE CE BLOC L'APPUYAIT SUR UNE PRÉMISSE QUI N'EST PLUS
 * VRAIE : que `professeur` s'obtient par auto-inscription, si bien que
 * « membre du personnel » voudrait dire « a coché Professeur ». Cette branche a
 * fermé cette porte. La doctrine tient sans elle, et c'est le point : deux
 * professeurs légitimes d'une même école portent le même rôle, donc le rôle ne
 * peut pas dire lequel des deux a le droit d'agir sur un document donné.
 *
 * Le remplace, ne s'y ajoute pas : appeler `callerIsStaff` en plus relirait
 * `profiles` pour une réponse déjà connue.
 */
export async function callerStaffProfile(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"profiles"> | null> {
  const profile = await currentProfile(ctx);
  return profile?.role === "professeur" || profile?.role === "admin"
    ? profile
    : null;
}

/**
 * Nombre maximum d'écoles qu'un membre du personnel dirige.
 *
 * Un directeur en porte une, deux quand un groupe scolaire a deux
 * établissements. La borne existe pour que la lecture ne grandisse pas avec la
 * table, pas pour contraindre un cas réel.
 */
const SCHOOLS_PER_DIRECTEUR_LIMIT = 4;

/** Ce qu'un appelant a le droit d'administrer, et à quel titre. */
export type SchoolAuthority = {
  profile: Doc<"profiles">;
  /** Vrai pour un `admin` : il administre TOUTES les écoles. */
  platformWide: boolean;
  /** Les écoles qu'il dirige. Vide pour un `admin`, qui n'en a pas besoin. */
  schoolIds: Id<"schools">[];
};

/**
 * À quel titre l'appelant peut administrer une école — ou `null`.
 *
 * DEUX TITRES, PAS UN. L'`admin` de la plateforme administre toutes les écoles ;
 * un `directeur` administre les siennes, et seulement les siennes. Les deux
 * écrivent par les mêmes mutations, donc le cadrage doit vivre en un seul
 * endroit : deux copies de cette règle auraient fini par diverger, et la copie
 * la plus permissive aurait décidé.
 *
 * LE RÔLE NE SUFFIT PAS POUR UN DIRECTEUR. `profiles.role === "directeur"` dit
 * ce qu'une personne EST, pas ce qu'elle dirige : c'est `schoolStaff`, en statut
 * `active`, qui porte le lien. Un directeur retiré de son école garde son rôle
 * et ne doit plus rien pouvoir y écrire.
 *
 * Ne lève jamais : les requêtes rendent un statut, et seules les mutations
 * transforment `null` en refus (spec §5.4).
 */
export async function callerSchoolAuthority(
  ctx: QueryCtx | MutationCtx,
): Promise<SchoolAuthority | null> {
  const profile = await currentProfile(ctx);
  if (!profile) return null;

  if (profile.role === "admin") {
    return { profile, platformWide: true, schoolIds: [] };
  }
  if (profile.role !== "directeur") return null;

  const rows = await ctx.db
    .query("schoolStaff")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .take(SCHOOLS_PER_DIRECTEUR_LIMIT);

  const schoolIds = rows
    .filter((row) => row.staffRole === "directeur" && row.status === "active")
    .map((row) => row.schoolId);

  if (schoolIds.length === 0) return null;
  return { profile, platformWide: false, schoolIds };
}

/**
 * L'autorité de l'appelant sur CETTE école, ou `null`.
 *
 * C'est la question que posent toutes les écritures d'un espace directeur, et
 * elle n'est pas la même que « est-il directeur ? » : un directeur de l'école A
 * qui reçoit l'identifiant de l'école B ne doit rien pouvoir y faire. Sans ce
 * cadrage, l'espace directeur serait une console d'administration de toute la
 * plateforme déguisée.
 */
export async function callerAuthorityOverSchool(
  ctx: QueryCtx | MutationCtx,
  schoolId: Id<"schools">,
): Promise<SchoolAuthority | null> {
  const authority = await callerSchoolAuthority(ctx);
  if (!authority) return null;
  if (authority.platformWide) return authority;
  return authority.schoolIds.includes(schoolId) ? authority : null;
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
