import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  callerAdminProfile,
  callerIsAdmin,
  currentSchoolSubscription,
} from "./access";
import { decideAccess, type AccessReason } from "./accessRules";
import { PRICING_SCALE, quoteSubscription } from "./pricing";

/**
 * Administration des écoles : écoles, personnel, classes, inscriptions.
 *
 * Un seul module pour ces quatre tables parce qu'elles forment un seul
 * parcours — créer une école, y rattacher un professeur, créer une classe, lui
 * affecter un professeur DU PERSONNEL de cette école, y inscrire des élèves —
 * et que chaque étape se valide contre la précédente. Les séparer obligerait à
 * importer l'une depuis l'autre pour ces vérifications croisées.
 *
 * TOUT ici est réservé à l'`admin` (`callerIsAdmin`, ou `callerAdminProfile`
 * là où l'auteur de l'acte doit être nommé : même garde, mêmes refus). Les
 * requêtes ne lèvent jamais et rendent leur valeur vide — `[]`, `null`, ou
 * `{ items: [] }` pour les deux listes qui signalent leur troncature ; les
 * mutations lèvent `new Error("Rôle non autorisé")` — pas de `ConvexError`,
 * que le client réserve au refus de paywall (`accessRules.ts`).
 *
 * Ce module est le PREMIER écrivain de ces tables : rien d'autre dans le dépôt
 * n'y insère une ligne. Ses invariants sont donc les seules garanties dont
 * `access.ts` dispose.
 */

/** Écoles lues d'un coup — une plateforme nationale en compte des centaines. */
const SCHOOLS_LIMIT = 200;

/** Membres du personnel lus par école : direction plus corps enseignant. */
const STAFF_LIMIT = 100;

/** Lignes `schoolStaff` lues pour UN profil — il n'enseigne pas dans dix écoles. */
const STAFF_PER_PROFILE_LIMIT = 20;

/** Classes lues par école : six niveaux, quelques sections chacun. */
const CLASSES_LIMIT = 50;

/**
 * Classes lues pour UN professeur — il en enseigne quelques-unes.
 *
 * Même valeur que `TEACHER_CLASSES_LIMIT` dans `access.ts`, délibérément :
 * `removeStaff` doit vider exactement l'ensemble de classes que
 * `studentIdsTaughtBy` énumère pour ouvrir la vue d'un enseignant. Une borne
 * plus basse ici laisserait une classe affectée — donc un accès — hors de
 * portée du retrait.
 */
const CLASSES_PER_TEACHER_LIMIT = 20;

/**
 * Élèves lus par classe.
 *
 * Même valeur que `CLASS_STUDENTS_LIMIT` dans `access.ts`, délibérément : le
 * nombre affiché par `listClasses` est exactement celui que le chemin
 * professeur sert. Un effectif affiché plus grand que la liste réellement
 * énumérable serait un mensonge d'écran.
 */
const CLASS_STUDENTS_LIMIT = 60;

/**
 * Profils parcourus pour construire les listes de candidats.
 *
 * `profiles` n'a pas d'index par rôle (`convex/schema.ts`, index `by_userId`
 * seul) et le schéma est hors de portée de cette tâche : le filtrage par rôle
 * se fait donc en mémoire, sur une tranche bornée. `students.listStudents` lit
 * déjà cette table avec `.take(1000)` ; 500 suffit ici et coûte moitié moins.
 *
 * Un balayage rend les documents les PLUS ANCIENS : passé cette borne, les
 * comptes récemment ouverts — ceux, précisément, qu'on vient de créer pour les
 * rattacher — sortent de la fenêtre. Les deux listes rendent donc `truncated`,
 * et l'écran l'affiche : l'administrateur doit savoir que la liste est
 * partielle plutôt que de conclure qu'un profil n'existe pas. Le vrai
 * correctif est un index `by_role`, qui relève d'une tâche de schéma.
 */
const PROFILE_SCAN_LIMIT = 500;

/**
 * Candidats rendus au plus, pour un menu déroulant qui reste utilisable.
 *
 * Atteindre cette borne-ci tronque aussi la liste : `truncated` couvre les
 * deux troncatures, l'écran n'a pas à les distinguer.
 */
const CANDIDATES_LIMIT = 100;

/**
 * Tranches lues pour dater l'impayé le plus ancien.
 *
 * Même valeur que la lecture équivalente de `access.loadAccessInput`, qui
 * répond à la même question : un abonnement se règle en trois tranches
 * (`convex/schema.ts`), douze couvre largement.
 */
const OVERDUE_INSTALLMENTS_LIMIT = 12;

/**
 * Inscriptions actives lues au plus pour juger du plafond de sièges.
 *
 * Le décompte est borné par le CONTRAT et non par la taille de l'école (voir
 * `readSeatState`) ; cette constante n'est que le garde-fou du contrat
 * invraisemblable — `.take()` exige un entier non négatif, et une transaction
 * Convex a un plafond de documents lus. Sa valeur est l'effectif maximal que
 * le reste du module sait déjà énumérer pour une école,
 * `CLASSES_LIMIT × CLASS_STUDENTS_LIMIT` : au-delà, aucun écran de ce dépôt ne
 * saurait de toute façon montrer les élèves concernés.
 *
 * Conséquence assumée : une école dont le contrat dépasse cette borne ET qui
 * compte autant d'inscriptions actives cesserait d'être plafonnée. Aucune
 * écriture du dépôt ne crée aujourd'hui de `subscriptions`, et une école
 * primaire n'atteint pas cet effectif ; le jour où la facturation en créera,
 * c'est ici qu'il faudra revenir.
 */
const SEAT_SCAN_LIMIT = CLASSES_LIMIT * CLASS_STUDENTS_LIMIT;

/**
 * Événements lus pour UNE inscription.
 *
 * Une inscription porte au plus une entrée et une libération ; tout le reste
 * est fait de transferts, et une école qui redistribue ses sections à chaque
 * trimestre en produit une poignée par année. 50 couvre une scolarité entière
 * sans laisser la lecture grandir avec la table.
 *
 * Borne franchie : ce sont les événements les PLUS ANCIENS qui tombent, la
 * lecture étant décroissante. L'écran montre donc toujours les actes récents,
 * jamais une fenêtre arbitraire. Le contraire d'un balayage de `profiles`,
 * d'où l'absence de `truncated` ici : sur un journal daté et complet par le
 * haut, la dernière ligne affichée dit elle-même où s'arrête ce qui est lu.
 */
const MEMBERSHIP_EVENTS_LIMIT = 50;

/**
 * Niveaux, dans l'ordre scolaire — recopié de `classEnum`
 * (`convex/schema.ts:10`), que le schéma n'exporte pas. `paliers/index.ts:32`
 * porte déjà la même copie pour la même raison. Le type vient du schéma, lui :
 * un niveau inventé ne compilerait pas.
 */
const CLASS_ORDER: Doc<"schoolClasses">["class"][] = [
  "CI",
  "CP",
  "CE1",
  "CE2",
  "CM1",
  "CM2",
];

const classValidator = v.union(
  v.literal("CI"),
  v.literal("CP"),
  v.literal("CE1"),
  v.literal("CE2"),
  v.literal("CM1"),
  v.literal("CM2"),
);

/**
 * Les SIX statuts du schéma, alors que `recordSubscription` n'en accepte que
 * quatre — et c'est délibéré.
 *
 * Un validateur à quatre littéraux refuserait bien `past_due` et `expired`,
 * mais par une erreur de validation générique. Ces deux-là ne sont pas des
 * valeurs invalides : ce sont des statuts valides qu'une PERSONNE ne pose pas.
 * L'administrateur qui les choisit a besoin de l'apprendre, pas d'un message de
 * type. Le refus vit donc dans le handler, avec sa raison ; le validateur reste
 * la forme du champ, et le handler reste le seul juge.
 */
const subscriptionStatusValidator = v.union(
  v.literal("draft"),
  v.literal("pending_payment"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("expired"),
  v.literal("cancelled"),
);

/** Affichage d'un profil supprimé ou introuvable — jamais une ligne muette. */
const UNKNOWN_NAME = "Profil introuvable";

// ---------------------------------------------------------------------------
// Requêtes — garde de RÔLE (`admin`), jamais de paywall.
//
// Ces écrans servent l'administration : `blockedStudent` y jugerait
// l'abonnement d'un élève, ce qui n'a aucun sens pour un admin. Une requête ne
// lève jamais : valeur vide pour tout autre appelant, comme `subjects.list`.
// ---------------------------------------------------------------------------

export const listSchools = query({
  args: {},
  handler: async (ctx) => {
    if (!(await callerIsAdmin(ctx))) return [];

    const schools = await ctx.db.query("schools").take(SCHOOLS_LIMIT);
    return schools.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Une école par son identifiant, reçu en `string` et NON en `v.id`.
 *
 * Seul endroit du module qui prend un identifiant non typé, et c'est
 * délibéré : son appelant est `app/(admin)/admin/ecoles/[id]/page.tsx`, dont
 * le segment d'URL est une chaîne quelconque — un visiteur peut y écrire
 * n'importe quoi. `v.id("schools")` forcerait le client à affirmer un type
 * qu'il ne connaît pas (`id as Id<"schools">`, motif employé ailleurs dans le
 * dépôt) ; `normalizeId` fait la même conversion côté SERVEUR, en la
 * vérifiant, et rend null si la chaîne n'est pas un identifiant de cette
 * table.
 *
 * Toutes les autres fonctions gardent `v.id(...)` : leurs identifiants
 * viennent des valeurs rendues par ces requêtes, donc déjà typés de bout en
 * bout.
 */
export const getSchool = query({
  args: { schoolId: v.string() },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) return null;

    const schoolId = ctx.db.normalizeId("schools", args.schoolId);
    if (!schoolId) return null;
    return await ctx.db.get(schoolId);
  },
});

/**
 * Le personnel ACTIF d'une école, nom du profil résolu.
 *
 * Rend aussi `staffRole` : l'écran d'affectation y filtre les professeurs.
 * C'est pourquoi il n'existe pas de `listAssignableTeachers` séparée — elle
 * lirait exactement les mêmes lignes pour n'en rendre qu'un sous-ensemble,
 * soit une seconde souscription Convex sur les mêmes documents. Le garde qui
 * compte est de toute façon côté écriture, dans `assignTeacher`.
 */
export const listStaff = query({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) return [];

    const rows = await ctx.db
      .query("schoolStaff")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .take(STAFF_LIMIT);

    const active = rows.filter((row) => row.status === "active");

    return await Promise.all(
      active.map(async (row) => {
        const profile = await ctx.db.get(row.profileId);
        return {
          _id: row._id,
          profileId: row.profileId,
          staffRole: row.staffRole,
          name: profile?.name ?? UNKNOWN_NAME,
        };
      }),
    );
  },
});

/** Une ligne de `listStaffCandidates` — `role` tel que `schoolStaff` l'accepte. */
type StaffCandidate = {
  _id: Id<"profiles">;
  name: string;
  role: Doc<"schoolStaff">["staffRole"];
};

/**
 * Les profils rattachables au personnel de cette école.
 *
 * Symétrique de `listEnrollableStudents` : sans elle, l'étape 2 du parcours
 * (« y rattacher un professeur ») n'aurait aucune façon de désigner un profil
 * autrement qu'en collant un identifiant à la main.
 *
 * Rôles retenus : `professeur` et `directeur`, les deux valeurs que
 * `schoolStaff.staffRole` accepte. Les profils déjà membres actifs sont
 * retirés — les proposer mènerait droit à un doublon.
 *
 * Rend `{ items, truncated }` et non un simple tableau : voir
 * `PROFILE_SCAN_LIMIT`. `truncated` dit « il PEUT manquer des profils ici »,
 * jamais « il en manque » — on ne distingue pas, sans une lecture de plus, une
 * table de 500 profils d'une table qui en compte davantage. Le doute penche du
 * côté de l'avertissement : sur-avertir fait vérifier, sous-avertir fait
 * conclure à tort qu'un profil n'existe pas.
 */
export const listStaffCandidates = query({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) return { items: [], truncated: false };

    const rows = await ctx.db
      .query("schoolStaff")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .take(STAFF_LIMIT);
    const alreadyStaff = new Set(
      rows.filter((row) => row.status === "active").map((row) => row.profileId),
    );

    const profiles = await ctx.db.query("profiles").take(PROFILE_SCAN_LIMIT);

    // Le balayage a-t-il buté sur sa borne ? Alors des profils plus récents
    // existent peut-être au-delà, et cette liste n'est pas la réponse
    // complète à « qui puis-je rattacher ? ».
    let truncated = profiles.length === PROFILE_SCAN_LIMIT;

    const items: StaffCandidate[] = [];
    for (const profile of profiles) {
      if (profile.role !== "professeur" && profile.role !== "directeur") {
        continue;
      }
      if (alreadyStaff.has(profile._id)) continue;
      // Après les deux filtres : on ne signale la coupe que si un candidat
      // RÉEL a été laissé de côté, pas sur la simple longueur du balayage.
      if (items.length >= CANDIDATES_LIMIT) {
        truncated = true;
        break;
      }
      items.push({
        _id: profile._id,
        name: profile.name,
        role: profile.role,
      });
    }

    return { items, truncated };
  },
});

/** Les classes d'une école, avec le professeur affecté et l'effectif actif. */
export const listClasses = query({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) return [];

    const classes = await ctx.db
      .query("schoolClasses")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .take(CLASSES_LIMIT);

    const rows = await Promise.all(
      classes.map(async (schoolClass) => {
        const teacher = schoolClass.teacherId
          ? await ctx.db.get(schoolClass.teacherId)
          : null;

        const students = await ctx.db
          .query("schoolMemberships")
          .withIndex("by_class_status", (q) =>
            q.eq("schoolClassId", schoolClass._id).eq("status", "active"),
          )
          .take(CLASS_STUDENTS_LIMIT);

        return {
          _id: schoolClass._id,
          class: schoolClass.class,
          label: schoolClass.label,
          teacherId: schoolClass.teacherId ?? null,
          teacherName: teacher?.name ?? null,
          studentCount: students.length,
        };
      }),
    );

    return rows.sort(
      (a, b) =>
        CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class) ||
        a.label.localeCompare(b.label),
    );
  },
});

/** Les élèves inscrits en `active` dans une classe. */
export const listClassStudents = query({
  args: { schoolClassId: v.id("schoolClasses") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) return [];

    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_class_status", (q) =>
        q.eq("schoolClassId", args.schoolClassId).eq("status", "active"),
      )
      .take(CLASS_STUDENTS_LIMIT);

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const student = await ctx.db.get(membership.studentId);
        return {
          membershipId: membership._id,
          studentId: membership.studentId,
          name: student?.name ?? UNKNOWN_NAME,
          enrolledAt: membership.enrolledAt,
        };
      }),
    );

    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Une ligne de `listEnrollableStudents`. */
type EnrollableStudent = {
  _id: Id<"profiles">;
  name: string;
  class: Doc<"profiles">["class"] | null;
};

/**
 * Les élèves SANS inscription active — les seuls qu'on puisse inscrire.
 *
 * Le filtre est la règle « une seule inscription active par élève » prise par
 * l'autre bout : un élève déjà inscrit quelque part ne doit pas figurer dans
 * la liste, sinon l'admin choisit un nom pour se faire refuser l'écriture.
 * `enrollStudent` refait la vérification — cette liste est du confort, le
 * verrou est côté mutation.
 *
 * Lecture par `by_student_status` puis `.first()` : exactement celle que
 * `access.ts` fait pour résoudre le droit d'accès d'un élève.
 *
 * Rend `{ items, truncated }` pour la même raison que `listStaffCandidates` :
 * un écran qui affiche « Aucun élève sans inscription » alors qu'il n'a
 * regardé qu'une fenêtre ment à l'administrateur.
 */
export const listEnrollableStudents = query({
  args: {},
  handler: async (ctx) => {
    if (!(await callerIsAdmin(ctx))) return { items: [], truncated: false };

    const profiles = await ctx.db.query("profiles").take(PROFILE_SCAN_LIMIT);

    let truncated = profiles.length === PROFILE_SCAN_LIMIT;

    const items: EnrollableStudent[] = [];

    for (const profile of profiles) {
      if (profile.role !== "student") continue;
      // La coupe se teste après le filtre de rôle mais AVANT la lecture de
      // l'inscription : inutile de payer une lecture pour un candidat qu'on
      // ne rendra pas. Le prix de cet ordre est un `truncated` légèrement
      // pessimiste — un élève déjà inscrit le déclenche sans avoir été omis.
      // Avertir de trop est le bon sens du signal.
      if (items.length >= CANDIDATES_LIMIT) {
        truncated = true;
        break;
      }

      const active = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_student_status", (q) =>
          q.eq("studentId", profile._id).eq("status", "active"),
        )
        .first();
      if (active) continue;

      items.push({
        _id: profile._id,
        name: profile.name,
        class: profile.class ?? null,
      });
    }

    return {
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
      truncated,
    };
  },
});

/**
 * L'état des sièges d'une école au regard de son contrat.
 *
 * `used` est BORNÉ : quand `atLeast` est vrai, il se lit « au moins `used` »
 * et jamais comme un total. Qui l'affiche doit dire « au moins », sous peine
 * de montrer un chiffre faux — c'est précisément le cas d'une école dont le
 * contrat a été réduit sous son effectif déjà inscrit.
 */
type SeatState = {
  /** Sièges ouverts par le contrat courant. */
  purchased: number;
  /** Inscriptions actives comptées — voir `atLeast`. */
  used: number;
  /** Le décompte a buté sur sa borne : il y en a AU MOINS `used`. */
  atLeast: boolean;
  /** `used` atteint `purchased` : la prochaine inscription est refusée. */
  full: boolean;
};

/**
 * Les sièges qu'ouvre un contrat, ramenés à un entier exploitable.
 *
 * `subscriptions.seatsPurchased` est un `v.number()` — un flottant, que rien
 * ne valide et qu'aucune écriture du dépôt ne produit à ce jour. Une valeur
 * absurde (négative, fractionnaire, NaN) ne doit ni faire lever une requête
 * (`.take()` exige un entier non négatif) ni ouvrir le plafond en silence :
 * elle vaut zéro siège, et l'école n'inscrit personne sous ce contrat-là.
 */
function contractSeats(seatsPurchased: number): number {
  if (!Number.isFinite(seatsPurchased) || seatsPurchased <= 0) return 0;
  return Math.floor(seatsPurchased);
}

/**
 * L'état des sièges d'une école, compté À L'APPEL.
 *
 * `schoolSeatUsage` existe au schéma et pas une ligne du dépôt ne la lit ni ne
 * l'écrit : ce décompte NE LA MAINTIENT PAS, délibérément. La décision D7 de
 * la spec pose que les droits se dérivent à l'appel et ne se matérialisent
 * jamais, et un compteur dérive dès qu'une écriture échoue à mi-chemin — une
 * inscription insérée sans son incrément, et l'école porte un siège fantôme
 * jusqu'à ce que quelqu'un s'en aperçoive. Un décompte par index est juste par
 * construction, et `by_school_status` existe exactement pour ça. Que personne
 * n'aille « réparer » cette table plus tard : elle n'a pas de lecteur parce
 * qu'elle n'a pas lieu d'être.
 *
 * Le décompte est borné par le CONTRAT, jamais par la taille de l'école :
 * `purchased + 1` lignes suffisent. `purchased` lignes répondraient déjà à la
 * seule question du plafond (`used >= purchased`) ; la ligne de plus est celle
 * qui distingue « exactement plein » de « au-delà du contrat », le cas où
 * l'écran doit dire « au moins » plutôt qu'un chiffre. Une école à 40 sièges
 * lit donc 41 documents, qu'elle compte 40 élèves ou 4000.
 *
 * Rend `null` quand l'école n'a AUCUN abonnement : aucun contrat, aucun
 * plafond. Une école peut légitimement inscrire avant de payer ; l'élève
 * n'aura simplement pas d'accès, ce que `getEnrollmentOutlook` annonce déjà.
 *
 * Prend les sièges du contrat et NON le contrat lui-même, pour que
 * `recordSubscription` puisse peser un contrat qui n'est pas encore écrit
 * contre l'effectif déjà inscrit. C'est la condition pour qu'il n'existe qu'UN
 * décompte : un second, écrit dans la mutation pour la seule raison qu'elle
 * n'a pas de document à passer, divergerait de celui-ci au premier
 * changement — et les deux répondent à la même question.
 */
async function readSeatState(
  ctx: QueryCtx | MutationCtx,
  schoolId: Id<"schools">,
  contractedSeats: number | null,
): Promise<SeatState | null> {
  if (contractedSeats === null) return null;

  const purchased = contractSeats(contractedSeats);
  const bound = Math.min(purchased + 1, SEAT_SCAN_LIMIT);

  const active = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_school_status", (q) =>
      q.eq("schoolId", schoolId).eq("status", "active"),
    )
    .take(bound);

  return {
    purchased,
    used: active.length,
    atLeast: active.length === bound,
    full: active.length >= purchased,
  };
}

/** Accord du pluriel : les refus de ce module sont lus par un adulte. */
function pluralCount(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Une date en clair dans un message de refus, jamais un horodatage nu.
 *
 * Format ISO et non `toLocaleDateString` : le runtime Convex ne garantit pas
 * `Intl`, et « 2026-09-01 » ne s'interprète de travers dans aucune langue.
 */
function formatDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Le contrat courant tel que l'écran l'affiche.
 *
 * Ne porte PAS les sièges : ils sont déjà dans `SeatState.purchased`, normalisés
 * par `contractSeats`, et deux nombres de sièges dans la même réponse finiraient
 * par différer. Ne porte pas non plus l'identifiant de la ligne : aucun écran
 * n'a à désigner un contrat, un renouvellement étant une ligne NEUVE.
 */
type ContractSummary = {
  startsAt: number;
  endsAt: number;
  status: Doc<"subscriptions">["status"];
  /** Fait foi pour la facturation (spec §7.2). */
  totalFcfa: number;
  /** Tarif effectif moyen, affichage seul — jamais remultiplié (spec §7.2). */
  pricePerSeatFcfa: number;
};

/**
 * Ce que `getEnrollmentOutlook` rend — `reason` absente quand l'accès
 * s'ouvre, `seats` et `contract` absentes quand l'école n'a aucun abonnement,
 * donc aucun plafond.
 */
type EnrollmentOutlook = {
  opensAccess: boolean;
  reason: AccessReason | null;
  seats: SeatState | null;
  contract: ContractSummary | null;
};

/**
 * Ce qu'une inscription dans CETTE école ouvre vraiment, aujourd'hui.
 *
 * L'écran d'inscription affirmait qu'inscrire un élève « lui ouvre l'accès à
 * l'application ». C'est faux : l'inscription est NÉCESSAIRE à l'accès, jamais
 * suffisante. `decideAccess` juge ensuite l'abonnement de l'école, et aucune
 * fonction du dépôt n'insère à ce jour de ligne `subscriptions` — l'élève
 * inscrit tombait donc sur le paywall pour 100 % des inscriptions que ce code
 * peut produire, après qu'un administrateur eut prévenu la famille.
 *
 * Le verdict n'est PAS recalculé ici. On construit l'entrée d'un élève
 * hypothétique inscrit dans cette école et on appelle `decideAccess`, la
 * fonction même qu'exécute le paywall. Réécrire la règle rouvrirait l'écart
 * qu'on ferme : un écran qui promet ce que le paywall refuse. Les quatre
 * refus qui précèdent l'abonnement (`not_authenticated`, `not_student`,
 * `no_school`, `seat_released`) sont hors d'atteinte par construction — le
 * verdict ne peut porter que sur l'abonnement.
 *
 * Rend AUSSI l'état des sièges du contrat (`seats`), pour que l'écran montre
 * l'occupation AVANT que l'administrateur remplisse le formulaire, et non
 * seulement en message d'erreur après coup. Le plafond se refuse dans
 * `enrollStudent` ; ici il s'annonce. Les deux lisent le même abonnement et
 * font le même décompte, donc l'écran ne peut pas montrer un siège libre là
 * où l'inscription sera refusée.
 *
 * `seats` à `null` veut dire « aucun abonnement, donc aucun plafond », et non
 * « zéro siège » : un contrat qui n'existe pas ne plafonne rien.
 *
 * Rend AUSSI le contrat lui-même (`contract`), plutôt que de le laisser à une
 * requête séparée : cette fonction lit DÉJÀ ce document-là, et deux requêtes
 * pourraient, entre deux enregistrements, montrer un contrat qui n'est pas
 * celui sur lequel le verdict porte — l'incohérence même contre laquelle
 * `currentSchoolSubscription` existe.
 *
 * Lectures : le chemin de `access.loadAccessInput`, à l'identique —
 * l'abonnement que `currentSchoolSubscription` tient pour courant, les
 * tranches seulement en `past_due` — plus le décompte des sièges, borné par le
 * contrat. Une lecture de plus par école affichée, jamais par classe : l'écran
 * hisse la requête au niveau de l'école.
 *
 * Ne lève pas : `null` pour tout appelant non-`admin` comme pour une école
 * introuvable, et l'écran n'affiche alors rien plutôt qu'une promesse.
 */
export const getEnrollmentOutlook = query({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, args): Promise<EnrollmentOutlook | null> => {
    if (!(await callerIsAdmin(ctx))) return null;

    const school = await ctx.db.get(args.schoolId);
    if (!school) return null;

    // Un seul `now` pour la sélection du contrat et pour le verdict : deux
    // appels à `Date.now()` pourraient choisir un contrat sur un instant et le
    // juger sur un autre.
    const now = Date.now();
    const current = await currentSchoolSubscription(ctx, args.schoolId, now);

    let oldestOverdueDueAt: number | null = null;
    if (current && current.status === "past_due") {
      const rows = await ctx.db
        .query("installments")
        .withIndex("by_subscription", (q) => q.eq("subscriptionId", current._id))
        .take(OVERDUE_INSTALLMENTS_LIMIT);
      const dues = rows
        .filter((row) => row.status === "overdue")
        .map((row) => row.dueAt);
      oldestOverdueDueAt = dues.length > 0 ? Math.min(...dues) : null;
    }

    const verdict = decideAccess({
      now,
      role: "student",
      activeMembership: { schoolId: args.schoolId },
      hasReleasedMembership: false,
      subscription: current
        ? { status: current.status, endsAt: current.endsAt }
        : null,
      oldestOverdueDueAt,
    });

    return {
      opensAccess: verdict.ok,
      reason: verdict.ok ? null : verdict.reason,
      seats: await readSeatState(
        ctx,
        args.schoolId,
        current ? current.seatsPurchased : null,
      ),
      contract: current
        ? {
            startsAt: current.startsAt,
            endsAt: current.endsAt,
            status: current.status,
            totalFcfa: current.totalFcfa,
            pricePerSeatFcfa: current.pricePerSeatFcfa,
          }
        : null,
    };
  },
});

/**
 * Le journal d'une inscription — qui a inscrit, transféré, libéré, et quand.
 *
 * Du PLUS RÉCENT au plus ancien : la question posée devant cette liste est
 * « qu'est-il arrivé en dernier à cet enfant », pas « comment tout a
 * commencé ». L'ordre vient de l'index et non d'un tri en mémoire —
 * `by_membership` range les lignes d'une même inscription par `_creationTime`,
 * et une ligne est insérée à l'instant de son acte, donc l'ordre de l'index
 * EST l'ordre chronologique.
 *
 * Les NOMS sont résolus ici, pas les identifiants : « Profil #j57x… a
 * transféré vers la classe #k39z… » ne dit rien à l'administrateur qui
 * demande des comptes. Un auteur, une classe de départ, une classe
 * d'arrivée — tous trois lus au moment de la lecture et jamais figés dans
 * l'événement, pour qu'un directeur qui change de nom soit nommé
 * correctement partout.
 *
 * Un document introuvable ne fait pas disparaître la ligne ni lever : le nom
 * manquant vaut `UNKNOWN_NAME`, la classe manquante vaut `null`. Une trace
 * amputée reste une trace — l'acte, sa date et son type, eux, sont dans la
 * ligne elle-même et ne dépendent d'aucune autre table. C'est exactement le
 * choix déjà fait par `listClassStudents` pour un profil d'élève absent.
 *
 * Réservée à l'`admin` comme tout ce module, et ne lève pas : `[]` pour tout
 * autre appelant, comme les autres listes.
 */
export const listMembershipEvents = query({
  args: { membershipId: v.id("schoolMemberships") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) return [];

    const events = await ctx.db
      .query("schoolMembershipEvents")
      .withIndex("by_membership", (q) =>
        q.eq("membershipId", args.membershipId),
      )
      .order("desc")
      .take(MEMBERSHIP_EVENTS_LIMIT);

    return await Promise.all(
      events.map(async (event) => {
        const actor = await ctx.db.get(event.actorProfileId);
        const from = event.fromSchoolClassId
          ? await ctx.db.get(event.fromSchoolClassId)
          : null;
        const to = event.toSchoolClassId
          ? await ctx.db.get(event.toSchoolClassId)
          : null;

        return {
          _id: event._id,
          kind: event.kind,
          at: event.at,
          actorName: actor?.name ?? UNKNOWN_NAME,
          fromClassName: from ? `${from.class} ${from.label}` : null,
          toClassName: to ? `${to.class} ${to.label}` : null,
        };
      }),
    );
  },
});

// ---------------------------------------------------------------------------
// Mutations — `admin` seul, garde en PREMIÈRE instruction : rien n'est lu
// avant que le rôle soit établi. Un seul message de refus de rôle, comme
// `subjects.ts` et `topics.ts`.
// ---------------------------------------------------------------------------

/**
 * Crée une école, toujours en `prospect`.
 *
 * Le statut n'est pas un argument : une école qui vient d'être saisie n'a par
 * définition pas encore d'abonnement. Rien ne le fait évoluer dans cette
 * tâche — et rien ne le lit non plus : `decideAccess` juge l'abonnement
 * (`subscriptions`), jamais `schools.status`. Voir le rapport de tâche.
 */
export const createSchool = mutation({
  args: {
    name: v.string(),
    city: v.optional(v.string()),
    contactName: v.string(),
    contactEmail: v.string(),
    contactPhone: v.optional(v.string()),
    ninea: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    return await ctx.db.insert("schools", {
      name: args.name,
      city: args.city,
      contactName: args.contactName,
      contactEmail: args.contactEmail,
      contactPhone: args.contactPhone,
      ninea: args.ninea,
      status: "prospect",
      createdAt: Date.now(),
    });
  },
});

/**
 * Enregistre le contrat d'une école — la PREMIÈRE écriture de `subscriptions`.
 *
 * Ce n'est pas le flux de paiement : aucun appel PayDunya, aucune facture,
 * aucune tranche. Un administrateur saisit un contrat convenu hors ligne. La
 * table `installments` reste vide, et c'est le plan de facturation qui la
 * remplira.
 *
 * Jusqu'ici `subscriptions` avait deux lecteurs et zéro écrivain : le plafond
 * de sièges était correct mais DORMANT, faute de contrat possible, et l'écran
 * d'inscription ne pouvait promettre aucun accès. Cette mutation lui donne sa
 * matière.
 *
 * LE PRIX N'EST PAS UN ARGUMENT. Il se calcule par `pricing.quoteSubscription`
 * à partir des seuls sièges. Un total reçu de l'appelant serait un montant de
 * facturation accepté sans contrôle — la même faute que les identifiants
 * d'autorisation reçus en argument que ce module refuse partout ailleurs.
 *
 * CE QUI EST ÉCRIT DANS `seatsPurchased`, ce sont les sièges FACTURÉS, pas le
 * nombre brut reçu : un contrat de 30 sièges s'enregistre à 50, parce que
 * l'école en paie 50 (plancher, spec §7.1) et qu'une école qui paie 50 sièges
 * en reçoit 50. Le plafond d'`enrollStudent` lit ce champ : il doit lire le
 * nombre payé, sans quoi l'école paierait des sièges qu'elle ne pourrait pas
 * occuper.
 *
 * SIX REFUS, et la raison de chacun :
 *
 *   - sièges : entier strictement positif. `readSeatState` passe ce nombre à
 *     `.take()`, qui LÈVE sur un argument non entier — un contrat à 12,5
 *     sièges casserait ensuite toute lecture de l'école, pas seulement la
 *     sienne.
 *   - période : `endsAt > startsAt`. `decideAccess` juge l'expiration par
 *     `endsAt` seul ; un contrat qui finit avant de commencer serait échu à sa
 *     naissance, sans que rien ne le dise.
 *   - `past_due` et `expired` : une machine les pose, pas une personne. Le
 *     premier viendra du suivi des tranches, le second se DÉDUIT de `endsAt`
 *     dans `decideAccess` — l'écrire en base créerait une seconde vérité sur
 *     la même question.
 *   - `cancelled` : résilier n'est pas enregistrer. Aucune mutation ne sait
 *     faire passer un contrat existant à « résilié » — cette table ne connaît
 *     que l'insertion — donc une ligne saisie résiliée d'emblée ne décrit
 *     aucun contrat qui aurait eu lieu. Elle coûterait cher : elle n'ouvre
 *     aucun accès, mais `access.currentSchoolSubscription` la retiendrait
 *     comme contrat COURANT dès sa date de début, puisque cette sélection ne
 *     compare que les `startsAt` — et couperait une école qu'un contrat actif
 *     couvre. La résiliation viendra avec la facturation, à qui appartient la
 *     question du montant déjà facturé.
 *   - `active` daté du futur : voir juste en dessous.
 *   - CHEVAUCHEMENT d'une période déjà contractée : voir le refus lui-même,
 *     c'est celui dont dépend la justesse de la lecture du paywall.
 *
 * CE QU'IL MANQUE, ET QUI SE VOIT ICI : rien dans cette tâche ne RÉSILIE ni ne
 * modifie un contrat en cours. Une école qui veut plus de sièges en février ne
 * peut donc pas en obtenir avant la fin du contrat courant — le refus de
 * chevauchement le lui dira. C'est un manque assumé, pas un oubli : amender un
 * contrat en cours, c'est décider ce qu'il advient de son montant déjà facturé,
 * et cette question appartient au plan de facturation. Le refus au moins le dit
 * en face, là où un empilement silencieux de contrats aurait rendu l'accès et
 * le plafond de sièges indécidables.
 *
 * POURQUOI UN CONTRAT FUTUR NE PEUT PAS ÊTRE `active` : `decideAccess` ne lit
 * jamais `startsAt` (`accessRules.ts` ne reçoit que `status` et `endsAt`). Un
 * contrat de l'an prochain marqué `active` passerait donc le test
 * `now < endsAt` et ouvrirait l'accès AUJOURD'HUI, pour une année que l'école
 * n'a pas encore commencé à payer. `access.currentSchoolSubscription` ferme la
 * moitié du trou en ne se repliant que sur les contrats déjà commencés ; ce
 * refus ferme l'autre moitié, en garantissant qu'un contrat à venir ne porte
 * jamais qu'un statut qui refuse.
 *
 * UN RENOUVELLEMENT EST UNE LIGNE NEUVE, jamais un `patch` : le schéma indexe
 * par `startsAt`, l'historique des contrats a de la valeur, et modifier la
 * ligne en cours ferait disparaître le contrat sous les élèves qu'il couvre.
 */
export const recordSubscription = mutation({
  args: {
    schoolId: v.id("schools"),
    seatsPurchased: v.number(),
    startsAt: v.number(),
    endsAt: v.number(),
    status: subscriptionStatusValidator,
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    const school = await ctx.db.get(args.schoolId);
    if (!school) throw new Error("École introuvable");

    if (!Number.isInteger(args.seatsPurchased) || args.seatsPurchased <= 0) {
      throw new Error(
        "Le nombre de sièges doit être un entier strictement positif",
      );
    }

    if (args.endsAt <= args.startsAt) {
      throw new Error(
        "La fin du contrat doit tomber après son début : " +
          `${formatDay(args.startsAt)} → ${formatDay(args.endsAt)}`,
      );
    }

    if (args.status === "past_due" || args.status === "expired") {
      throw new Error(
        "Ce statut est posé par une machine, pas par une personne : " +
          "« impayé » viendra du suivi des tranches, et « échu » se déduit de " +
          "la date de fin du contrat à chaque lecture. Enregistrez ce contrat " +
          "en brouillon, en attente de paiement ou actif.",
      );
    }

    if (args.status === "cancelled") {
      throw new Error(
        "Résilier n'est pas enregistrer : « résilié » dit la FIN d'un contrat " +
          "existant, et rien ici ne sait encore la prononcer — cette mutation " +
          "insère, elle ne modifie aucune ligne. Saisi d'emblée, ce statut " +
          "n'ouvrirait aucun accès mais deviendrait le contrat COURANT de " +
          "l'école à sa date de début, coupant les élèves qu'un contrat actif " +
          "couvre encore. La résiliation viendra avec la facturation, qui " +
          "devra dire ce qu'elle fait du montant déjà facturé. Enregistrez ce " +
          "contrat en brouillon, en attente de paiement ou actif.",
      );
    }

    const now = Date.now();

    if (args.status === "active" && args.startsAt > now) {
      throw new Error(
        "Un contrat ne se déclare pas en vigueur avant d'avoir commencé : " +
          `celui-ci débute le ${formatDay(args.startsAt)}. Marqué actif dès ` +
          "aujourd'hui, il ouvrirait l'accès pour une année qui n'a pas " +
          "commencé — le paywall ne juge que la date de FIN. Enregistrez-le " +
          "en brouillon ou en attente de paiement ; il faudra l'enregistrer " +
          "actif le jour de son entrée en vigueur, rien ici ne change un " +
          "statut tout seul.",
      );
    }

    // AUCUN CHEVAUCHEMENT DE PÉRIODES — l'invariant « une école a au plus un
    // contrat en vigueur à la fois ».
    //
    // Ce n'est pas une coquetterie de modélisation : la sélection du contrat
    // courant (`access.currentSchoolSubscription`) ne lit QU'UN document, le
    // plus récemment commencé, et cette lecture n'est juste que si les contrats
    // sont disjoints. Deux contrats qui se croisent — un long de janvier à
    // décembre, une rallonge de mars à avril — et l'école se retrouve coupée
    // en juin : la rallonge, plus récemment commencée, gagne et se trouve
    // échue, pendant que le contrat long la couvre encore. Le refus ici est ce
    // qui rend la lecture là-bas démontrable au lieu d'être un pari sur les
    // données.
    //
    // Le plafond de sièges le veut tout autant : deux contrats simultanés de
    // 40 et 20 sièges ne font pas 60 sièges pour `readSeatState`, qui en lit un
    // seul. Des contrats qui se croisent rendraient le plafond arbitraire
    // quelle que soit la règle de sélection.
    //
    // Bornes STRICTES des deux côtés : un contrat qui commence exactement à la
    // fin du précédent ne le chevauche pas — c'est la forme normale d'un
    // renouvellement, et `decideAccess` traite déjà `endsAt` comme exclu
    // (`now >= endsAt` ⇒ échu).
    //
    // AUCUNE EXCEPTION DE STATUT, `cancelled` compris. La sélection du contrat
    // courant ne lit pas le statut : elle compare des `startsAt`. Un contrat
    // résilié autorisé à croiser un contrat actif deviendrait donc le contrat
    // courant le jour où il commence, et couperait toute l'école — `cancelled`
    // tant qu'il dure, puis `expired` — pendant que le contrat actif la
    // couvre. Cette exemption n'aurait racheté qu'un scénario IMPOSSIBLE :
    // « recontracter une période résiliée » suppose qu'une ligne puisse
    // DEVENIR résiliée, or l'insertion ci-dessous est l'unique écriture de la
    // table et `recordSubscription` refuse désormais `cancelled` à la saisie.
    // L'invariant est donc entier : les contrats d'une école sont disjoints,
    // quel que soit leur statut.
    //
    // UN SEUL DOCUMENT LU, ET LE CONTRÔLE EST EXACT — c'est cet invariant qui
    // le rend exact, pas la taille de la lecture. Le candidat est la ligne de
    // plus grand `startsAt` parmi celles qui commencent avant la fin proposée ;
    // il y a conflit SI ET SEULEMENT SI son `endsAt` dépasse le début proposé.
    // Aucun faux positif : `startsAt_C < endsAt` et `endsAt_C > startsAt` sont
    // exactement le croisement de deux intervalles. Aucun faux négatif, en
    // deux cas. Si une ligne X chevauche [startsAt, endsAt) en commençant
    // dedans, le candidat C vérifie `startsAt_C >= startsAt_X >= startsAt`,
    // donc `endsAt_C > startsAt_C >= startsAt` : le test le voit. Si X
    // chevauche en commençant AVANT, alors X couvre `startsAt` ; soit C = X et
    // le test le voit, soit C s'intercale entre X et `startsAt`, ce qui
    // exigerait `endsAt_X <= startsAt_C < startsAt` quand X couvre `startsAt`
    // (`endsAt_X > startsAt`) — la disjointness l'interdit. Une fenêtre de
    // lecture bornée, elle, ne prouvait RIEN : n'importe quel nombre de lignes
    // intercalées en évinçait le vrai conflit.
    //
    // POUR LE PLAN DE FACTURATION — le jour où une vraie résiliation existera
    // (un `patch` du statut d'un contrat en cours vers `cancelled`), cet
    // invariant changera de NATURE : une période résiliée devra redevenir
    // contractable, donc les lignes `cancelled` cesseront de compter ici, et
    // la disjointness ne vaudra plus que pour les autres. DEUX choses devront
    // suivre ensemble, sans quoi le défaut refermé ici se rouvre. D'abord
    // `access.currentSchoolSubscription` devra ignorer les contrats résiliés,
    // au lieu de retenir le plus récemment commencé quel que soit son statut.
    // Ensuite ce contrôle aura besoin d'un index portant `status` — par
    // exemple `["ownerType", "ownerId", "status", "startsAt"]` — pour rester
    // exact en une lecture : écarter les résiliés APRÈS coup, parmi des lignes
    // lues par `startsAt`, ramènerait la fenêtre bornée et son trou.
    const candidate = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner_startsAt", (q) =>
        q
          .eq("ownerType", "school")
          .eq("ownerId", args.schoolId)
          .lt("startsAt", args.endsAt),
      )
      .order("desc")
      .first();

    if (candidate !== null && candidate.endsAt > args.startsAt) {
      throw new Error(
        "Cette école a déjà un contrat sur cette période : du " +
          `${formatDay(candidate.startsAt)} au ` +
          `${formatDay(candidate.endsAt)}, ` +
          `${pluralCount(candidate.seatsPurchased, "siège", "sièges")}. Un ` +
          "renouvellement commence à la fin du précédent, ou après. Deux " +
          "contrats simultanés rendraient indécidables l'accès des élèves et " +
          "le nombre de sièges de l'école.",
      );
    }

    const quote = quoteSubscription(args.seatsPurchased);

    // L'ALERTE — le contrat couvre-t-il l'effectif DÉJÀ inscrit ?
    //
    // Refus, et non simple avertissement : enregistrer en silence un contrat
    // déjà dépassé produirait une école durablement au-delà de son droit, que
    // rien ne signale ailleurs qu'en ouvrant sa fiche. Le plafond
    // d'`enrollStudent` ne rattraperait pas le mal — il refuse les
    // inscriptions NOUVELLES, jamais celles qui existent déjà — et personne ne
    // couperait l'accès des enfants en trop, qui est justement ce qu'on ne
    // veut pas faire.
    //
    // Le décompte est celui du plafond de sièges, à la ligne près : deux
    // décomptes divergeraient, et l'écran finirait par annoncer un état que la
    // mutation ne reconnaît pas. Il est borné par le contrat qu'on s'apprête à
    // écrire, donc `used` peut valoir « au moins ».
    const seats = await readSeatState(ctx, args.schoolId, quote.seatsBilled);
    if (seats !== null && seats.used > seats.purchased) {
      const counted = pluralCount(
        seats.used,
        "inscription active",
        "inscriptions actives",
      );
      const enrolled = seats.atLeast ? `au moins ${counted}` : counted;
      const asked =
        quote.seatsBilled === args.seatsPurchased
          ? pluralCount(args.seatsPurchased, "siège", "sièges")
          : `${pluralCount(args.seatsPurchased, "siège", "sièges")} ` +
            `(${quote.seatsBilled} facturés, plancher de ` +
            `${PRICING_SCALE.seatFloor} sièges)`;

      throw new Error(
        `Cette école compte ${enrolled} : un contrat de ${asked} la ` +
          "laisserait au-delà de son droit dès son enregistrement. Libérez " +
          "d'abord le siège des élèves en trop, ou enregistrez le contrat au " +
          "nombre de sièges réel.",
      );
    }

    return await ctx.db.insert("subscriptions", {
      ownerType: "school",
      ownerId: args.schoolId,
      seatsPurchased: quote.seatsBilled,
      pricePerSeatFcfa: quote.pricePerSeatFcfa,
      totalFcfa: quote.totalFcfa,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      status: args.status,
      createdAt: now,
    });
  },
});

/**
 * Rattache un profil au personnel d'une école.
 *
 * INVARIANT — `staffRole` doit correspondre au rôle réel du profil : on ne
 * rattache pas un élève comme professeur. Sans cette vérification, `addStaff`
 * fabriquerait le droit qu'`assignTeacher` consulte ensuite, et un profil
 * `student` pourrait se retrouver à la tête d'une classe, donc à lire les
 * dossiers de ses camarades par `access.callerMayReadStudent`.
 *
 * Réactive une ligne `removed` plutôt que d'en insérer une seconde : deux
 * lignes pour le même couple (école, profil) donneraient un doublon dans
 * `listStaff` et un `removeStaff` qui n'en retire qu'une.
 */
export const addStaff = mutation({
  args: {
    schoolId: v.id("schools"),
    profileId: v.id("profiles"),
    staffRole: v.union(v.literal("directeur"), v.literal("professeur")),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    const school = await ctx.db.get(args.schoolId);
    if (!school) throw new Error("École introuvable");

    const profile = await ctx.db.get(args.profileId);
    if (!profile) throw new Error("Profil introuvable");
    if (profile.role !== args.staffRole) {
      throw new Error(
        "Le rôle du profil ne correspond pas au rôle demandé dans l'école",
      );
    }

    // Par `by_profile` et non `by_school` : un profil appartient à une ou deux
    // écoles, une école à des dizaines de membres.
    const existing = await ctx.db
      .query("schoolStaff")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .take(STAFF_PER_PROFILE_LIMIT);
    const row = existing.find((r) => r.schoolId === args.schoolId);

    if (row) {
      await ctx.db.patch(row._id, {
        staffRole: args.staffRole,
        status: "active",
      });
      return row._id;
    }

    return await ctx.db.insert("schoolStaff", {
      schoolId: args.schoolId,
      profileId: args.profileId,
      staffRole: args.staffRole,
      status: "active",
    });
  },
});

/**
 * Retire un membre du personnel ET le désaffecte de ses classes.
 *
 * INVARIANT — les deux écritures ne se séparent pas. Le lien qui donne à un
 * professeur la vue sur ses élèves passe par `schoolClasses.teacherId`
 * (`access.studentIdsTaughtBy` et la quatrième branche de
 * `callerMayReadStudent`), PAS par `schoolStaff` : un membre retiré qui garde
 * ses classes garde l'accès aux dossiers de ses élèves. Retirer sans
 * désaffecter serait un retrait de façade.
 *
 * Énumération par `by_teacher` : LES classes de ce professeur, et non une
 * fenêtre sur celles de l'école. La distinction n'est pas théorique —
 * `schoolClasses` n'a pas de champ année, rien ne supprime ni n'archive une
 * classe, et `createClass` autorise 50 classes PAR NIVEAU, soit 300 par école.
 * Bornée à 50 classes d'école, la boucle laissait la 51e garder son
 * `teacherId` : `studentIdsTaughtBy` et la quatrième branche de
 * `callerMayReadStudent` continuaient de servir les dossiers d'élèves à un
 * membre retiré, et l'invariant se dégradait en silence à mesure que l'école
 * grandissait. Bornée à ce qu'un professeur enseigne, la complétude ne dépend
 * plus de la taille de l'école.
 *
 * Bornée aux classes de CETTE école : un enseignant rattaché à deux écoles ne
 * perd que les classes de celle qu'il quitte. Le cadrage se fait par filtre,
 * l'index portant désormais le professeur.
 */
export const removeStaff = mutation({
  args: { staffId: v.id("schoolStaff") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    const staff = await ctx.db.get(args.staffId);
    if (!staff) throw new Error("Membre du personnel introuvable");

    const classes = await ctx.db
      .query("schoolClasses")
      .withIndex("by_teacher", (q) => q.eq("teacherId", staff.profileId))
      .take(CLASSES_PER_TEACHER_LIMIT);

    let unassigned = 0;
    for (const schoolClass of classes) {
      if (schoolClass.schoolId !== staff.schoolId) continue;
      // `undefined` sur un champ optionnel : Convex RETIRE le champ.
      await ctx.db.patch(schoolClass._id, { teacherId: undefined });
      unassigned += 1;
    }

    await ctx.db.patch(staff._id, { status: "removed" });

    return { unassignedClasses: unassigned };
  },
});

/**
 * Crée une classe dans une école.
 *
 * Refuse un doublon (même niveau, même libellé) : deux « CM1 A » dans la même
 * école ne se distinguent sur aucun écran, et les élèves s'y répartiraient au
 * hasard du clic.
 */
export const createClass = mutation({
  args: {
    schoolId: v.id("schools"),
    class: classValidator,
    label: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    const school = await ctx.db.get(args.schoolId);
    if (!school) throw new Error("École introuvable");

    const label = args.label.trim();
    if (label.length === 0) throw new Error("Le libellé est obligatoire");

    // CONNU — sans année au schéma, ce refus interdit la rentrée suivante.
    //
    // Refuser le triplet (école, niveau, libellé) en double est le bon
    // raisonnement POUR UNE ANNÉE : deux « CM1 A » simultanés ne se
    // distinguent sur aucun écran. Mais `schoolClasses` ne porte AUCUNE année
    // (`convex/schema.ts`) et rien ne supprime ni n'archive une classe : le
    // « CM1 A » de cette année bloque donc à jamais celui de la suivante.
    //
    // La cause est dans le schéma, hors de portée de cette tâche. Le correctif
    // est un champ d'année (ou une archive) porté par l'index, PAS un
    // assouplissement de ce contrôle — le relâcher rouvrirait les doublons
    // simultanés, qui sont le vrai danger.
    const siblings = await ctx.db
      .query("schoolClasses")
      .withIndex("by_school_class", (q) =>
        q.eq("schoolId", args.schoolId).eq("class", args.class),
      )
      .take(CLASSES_LIMIT);
    if (siblings.some((s) => s.label === label)) {
      throw new Error("Cette classe existe déjà dans cette école");
    }

    return await ctx.db.insert("schoolClasses", {
      schoolId: args.schoolId,
      class: args.class,
      label,
    });
  },
});

/**
 * Affecte un professeur à une classe, ou l'en retire (`teacherId` absent).
 *
 * INVARIANT — le professeur doit appartenir au personnel ACTIF de l'école DE
 * LA CLASSE, avec `staffRole: "professeur"`. Sans cette vérification, l'écran
 * choisirait parmi tous les profils `professeur` de la plateforme et rien
 * n'empêcherait de confier une classe de l'école A à un enseignant de
 * l'école B — qui lirait alors les dossiers de ses élèves.
 *
 * L'école n'est pas un argument : elle se lit sur la classe. Ne jamais
 * accepter ce qu'on peut dériver — un `schoolId` reçu du client pourrait
 * désigner l'école où l'enseignant est bien membre, pendant que la classe
 * appartient à une autre.
 */
export const assignTeacher = mutation({
  args: {
    schoolClassId: v.id("schoolClasses"),
    teacherId: v.optional(v.id("profiles")),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    const schoolClass = await ctx.db.get(args.schoolClassId);
    if (!schoolClass) throw new Error("Classe introuvable");

    if (args.teacherId === undefined) {
      await ctx.db.patch(schoolClass._id, { teacherId: undefined });
      return null;
    }

    const teacherId = args.teacherId;
    const staffRows = await ctx.db
      .query("schoolStaff")
      .withIndex("by_profile", (q) => q.eq("profileId", teacherId))
      .take(STAFF_PER_PROFILE_LIMIT);

    const membership = staffRows.find(
      (row) =>
        row.schoolId === schoolClass.schoolId &&
        row.staffRole === "professeur" &&
        row.status === "active",
    );
    if (!membership) {
      throw new Error(
        "Ce professeur ne fait pas partie du personnel actif de cette école",
      );
    }

    await ctx.db.patch(schoolClass._id, { teacherId });
    return null;
  },
});

/**
 * Inscrit un élève dans une classe — acte qui OUVRE son accès.
 *
 * Quatre invariants tiennent dans cette mutation :
 *
 * - UNE SEULE inscription active par élève. `access.loadAccessInput` résout le
 *   droit par `by_student_status` puis `.first()` : deux lignes actives
 *   rendraient ce droit arbitraire, dépendant de l'ordre de lecture, et le
 *   paywall non déterministe. C'est le refus le plus important du module.
 * - `schoolId` se LIT SUR LA CLASSE, il n'est pas reçu en argument : une
 *   inscription dont l'école ne serait pas celle de sa classe placerait
 *   l'élève sous le mauvais abonnement.
 * - Le niveau du profil s'aligne sur celui de la classe — voir plus bas.
 * - Le PLAFOND DE SIÈGES de l'école se refuse ici, et nulle part ailleurs —
 *   voir le commentaire du refus, plus bas.
 *
 * Sur l'alignement du niveau : `profiles.class` n'est aujourd'hui lu par AUCUNE
 * fonction du dépôt (le niveau d'une session de palier vient de `topic.class`,
 * pas du profil). Ce champ existe pour le filtrage de contenu à venir, décrit
 * par le commentaire de `convex/schema.ts:51`, et cette inscription est la
 * seule écriture qui en connaisse la valeur vraie. L'écrire ici ne change donc
 * rien au comportement actuel et rend le champ honnête le jour où il servira.
 *
 * TRACE — une ligne `schoolMembershipEvents` de type `enrolled` s'écrit dans
 * CETTE transaction, portant l'admin qui inscrit et la classe d'inscription.
 * Même transaction que l'acte, toujours : un acte sans sa trace, ou une trace
 * sans son acte, seraient tous deux pires que rien. Le journal n'entre dans
 * aucun des quatre refus ci-dessus — il observe, il ne décide pas.
 */
export const enrollStudent = mutation({
  args: {
    studentId: v.id("profiles"),
    schoolClassId: v.id("schoolClasses"),
  },
  handler: async (ctx, args) => {
    const actor = await callerAdminProfile(ctx);
    if (!actor) throw new Error("Rôle non autorisé");

    const schoolClass = await ctx.db.get(args.schoolClassId);
    if (!schoolClass) throw new Error("Classe introuvable");

    const student = await ctx.db.get(args.studentId);
    if (!student) throw new Error("Profil introuvable");
    if (student.role !== "student") {
      throw new Error("Ce profil n'est pas un élève");
    }

    const active = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_student_status", (q) =>
        q.eq("studentId", args.studentId).eq("status", "active"),
      )
      .first();
    if (active) {
      throw new Error(
        "Cet élève a déjà une inscription active : libérez-la d'abord",
      );
    }

    // Le plafond de sièges est un contrôle d'ADMISSION, pas un contrôle
    // d'accès : il se refuse ICI, devant l'adulte qui inscrit, et jamais dans
    // `decideAccess`. Refuser l'application à un élève « au-delà du quota »
    // supposerait de classer les inscriptions dans un ordre arbitraire : un
    // enfant perdrait son accès parce qu'un AUTRE a été inscrit, sans rien
    // avoir fait, et avec un message qu'on ne saurait pas lui expliquer.
    //
    // L'abonnement lu est celui du paywall — `access.currentSchoolSubscription`
    // elle-même, et non une seconde lecture qui lui ressemblerait : un plafond
    // assis sur un autre contrat surveillerait le mauvais. Aucun abonnement ⇒
    // aucun plafond : l'école peut légitimement inscrire avant de payer,
    // l'élève tombera simplement sur le paywall, ce que l'écran annonce déjà.
    const subscription = await currentSchoolSubscription(
      ctx,
      schoolClass.schoolId,
      Date.now(),
    );
    const seats = await readSeatState(
      ctx,
      schoolClass.schoolId,
      subscription ? subscription.seatsPurchased : null,
    );
    if (seats && seats.full) {
      // « au moins » quand le décompte a buté sur sa borne : l'école dépasse
      // alors son contrat et le total exact n'a pas été lu. Mieux vaut un
      // minimum vrai qu'un chiffre faux dans un message qui demande un acte.
      const counted = pluralCount(seats.used, "siège occupé", "sièges occupés");
      const occupied = seats.atLeast ? `au moins ${counted}` : counted;
      throw new Error(
        `Cette école a atteint son plafond de sièges : ${occupied} pour ` +
          `${pluralCount(seats.purchased, "siège", "sièges")} au contrat. ` +
          `Libérez le siège d'un élève déjà inscrit, ou augmentez le nombre ` +
          `de sièges de l'abonnement, avant d'inscrire celui-ci.`,
      );
    }

    // Un seul `now` pour l'inscription et pour sa trace : `enrolledAt` et
    // l'événement datent le MÊME acte, et deux appels à `Date.now()` les
    // feraient diverger sans raison.
    const now = Date.now();

    const membershipId = await ctx.db.insert("schoolMemberships", {
      schoolId: schoolClass.schoolId,
      studentId: args.studentId,
      schoolClassId: schoolClass._id,
      status: "active",
      enrolledAt: now,
    });

    await ctx.db.insert("schoolMembershipEvents", {
      membershipId,
      studentId: args.studentId,
      schoolId: schoolClass.schoolId,
      kind: "enrolled",
      actorProfileId: actor._id,
      at: now,
      toSchoolClassId: schoolClass._id,
    });

    if (student.class !== schoolClass.class) {
      await ctx.db.patch(student._id, { class: schoolClass.class });
    }

    return membershipId;
  },
});

/**
 * Libère le siège d'un élève — acte qui COUPE son accès.
 *
 * Conséquence exacte : `access.loadAccessInput` ne trouve plus d'inscription
 * active, voit une inscription `released`, et `decideAccess` rend
 * `seat_released`. L'enfant perd l'application dès la libération. L'écran doit
 * le dire en toutes lettres avant que l'administrateur valide.
 *
 * Idempotente : une ligne déjà libérée n'est pas réécrite, sinon un second
 * clic effacerait la date de libération d'origine.
 *
 * TRACE — une ligne `schoolMembershipEvents` de type `released`, dans cette
 * transaction. Le retour idempotent n'en écrit AUCUNE : il n'y a pas eu
 * d'acte, et un journal qui compterait les clics sans conséquence ferait lire
 * deux libérations là où l'accès n'a été coupé qu'une fois.
 */
export const releaseStudent = mutation({
  args: { membershipId: v.id("schoolMemberships") },
  handler: async (ctx, args) => {
    const actor = await callerAdminProfile(ctx);
    if (!actor) throw new Error("Rôle non autorisé");

    const membership = await ctx.db.get(args.membershipId);
    if (!membership) throw new Error("Inscription introuvable");
    // Le retour anticipé de l'idempotence passe AVANT l'écriture du journal,
    // et c'est tout ce qu'il faut pour qu'un second clic n'invente pas un
    // acte : il n'y a pas eu de libération, donc il n'y a rien à journaliser.
    if (membership.status !== "active") return null;

    const now = Date.now();

    await ctx.db.patch(membership._id, {
      status: "released",
      releasedAt: now,
    });

    await ctx.db.insert("schoolMembershipEvents", {
      membershipId: membership._id,
      studentId: membership.studentId,
      schoolId: membership.schoolId,
      kind: "released",
      actorProfileId: actor._id,
      at: now,
    });

    return null;
  },
});

/**
 * Change un élève de classe SANS toucher à son accès.
 *
 * L'opération la plus ordinaire de la vie scolaire — passer un enfant de
 * CM1 A à CM1 B — n'avait jusqu'ici d'autre chemin que `releaseStudent` puis
 * `enrollStudent`. Entre les deux, son inscription n'est plus `active` :
 * `access.loadAccessInput` ne trouve plus rien par `by_student_status`,
 * `decideAccess` rend `seat_released`, et l'enfant voit le message de
 * fermeture de son espace. Pour un changement décidé par son école, sans
 * qu'il ait rien fait.
 *
 * UNE SEULE ÉCRITURE SUR L'INSCRIPTION, JAMAIS DEUX. `schoolClassId` est
 * modifié sur la ligne existante : rien n'est libéré, rien n'est réinséré.
 * C'est ce qui garantit l'absence de coupure — la ligne ne quitte jamais
 * `active`, donc la lecture exacte du paywall (`by_student_status`,
 * `convex/access.ts:42`) trouve toujours une inscription active.
 *
 * Le couple libérer/réinscrire est le trou d'accès d'AUJOURD'HUI parce que
 * l'écran l'enchaîne : deux mutations, donc deux transactions, donc un
 * intervalle bien réel où `decideAccess` rend `seat_released`. Réuni dans
 * une seule mutation, cet intervalle disparaîtrait — une mutation Convex est
 * atomique, aucun lecteur n'en voit l'état intermédiaire — mais trois dégâts
 * resteraient, et ce sont eux qui tranchent : une ligne `released` de plus à
 * chaque changement de classe, datée d'une libération qui n'a pas eu lieu ;
 * un `enrolledAt` remis à zéro, qui efface la date d'entrée dans l'école ; et
 * un passage par le plafond de sièges d'`enrollStudent`, que ce chemin-ci ne
 * doit précisément pas subir. Modifier un champ ne pose aucune de ces
 * questions.
 *
 * `enrolledAt` n'est PAS réécrit : l'élève est inscrit dans cette école
 * depuis cette date-là, et un changement de classe n'est pas une
 * réinscription. Le `patch` ne porte donc qu'un champ — `schoolId` est déjà
 * le bon, la classe cible appartenant à la même école.
 *
 * TRACE — une ligne `schoolMembershipEvents` de type `transferred`, dans cette
 * transaction, avec la classe de DÉPART et celle d'ARRIVÉE. C'était l'acte
 * sans aucune trace : `enrolledAt` n'est pas réécrit — à juste titre — et
 * `releasedAt` reste vide, donc l'inscription elle-même ne garde rien du
 * passage. Et parce qu'un transfert SE RÉPÈTE, c'est un journal et non un
 * champ « dernier transfert par » : le champ écraserait le précédent à chaque
 * changement de classe.
 *
 * AUCUN CONTRÔLE DE SIÈGE ICI, et cette absence est DÉLIBÉRÉE : ce n'est pas
 * un oubli, ne le « réparez » pas. Un transfert n'ajoute personne — une
 * inscription active avant, une inscription active après, dans la même
 * école. Le décompte de `readSeatState` lit le couple (école, statut) par
 * `by_school_status` ; ce transfert ne touche ni l'un ni l'autre, et le
 * nombre de sièges occupés est donc rigoureusement identique avant et après.
 * Réutiliser le plafond d'`enrollStudent` ne protégerait rien et bloquerait
 * précisément l'école pleine — ou passée sous son contrat — qui a le plus
 * besoin de redistribuer ses élèves entre ses classes.
 *
 * Cette exemption tient ENTIÈREMENT au contrôle (4) ci-dessous. Un transfert
 * qui traverserait les écoles vaudrait un siège rendu ici, un siège consommé
 * là — et celui-là échapperait au plafond de l'école d'arrivée, qui n'est
 * vérifié que dans `enrollStudent`. Qui relâchera un jour le contrôle
 * d'école devra donc rétablir ici le plafond de l'école CIBLE : rien en aval
 * ne le rattraperait.
 *
 * ORDRE DES CONTRÔLES — l'inscription d'abord, la classe cible ensuite :
 *
 * 1. L'inscription EXISTE. Elle est le sujet de l'opération, et c'est elle
 *    qui porte l'école contre laquelle la classe cible se juge (4) : le
 *    contrôle d'école ne peut pas se formuler avant de l'avoir lue.
 * 2. Elle est `active`. Une inscription libérée ne se transfère pas : elle
 *    se RÉINSCRIT, et ce chemin-là passe bien par le plafond de sièges,
 *    puisqu'il rend un siège occupé de plus. Ce refus vient avant ceux qui
 *    portent sur la cible parce qu'il vaut QUELLE QUE SOIT la cible :
 *    répondre « cette classe est dans une autre école » à un administrateur
 *    dont le vrai problème est une inscription déjà libérée l'enverrait
 *    corriger ce qui n'est pas cassé.
 * 3. La classe cible existe.
 * 4. Elle appartient à la MÊME école. Comparée à `membership.schoolId` — le
 *    champ que lisent le paywall (`access.ts:74`) et le décompte de sièges —
 *    et non au `schoolId` de la classe actuelle : c'est celui-là qui décide
 *    sous quel abonnement l'élève tombe, donc le seul dont la cohérence
 *    compte. Un changement d'école n'est pas un changement de classe, c'est
 *    un changement de relation financière : un siège rendu d'un côté, un
 *    siège consommé de l'autre, sous le plafond de l'école d'arrivée. Ce
 *    couple-là s'écrit `releaseStudent` puis `enrollStudent`, et le refus le
 *    dit.
 * 5. Elle n'est pas la classe actuelle. (4) et (5) s'excluent — une classe
 *    d'une autre école n'est jamais la classe actuelle — leur ordre est donc
 *    libre ; l'invariant vient avant le confort.
 *
 * Même classe : REFUS explicite, et non non-opération silencieuse.
 * `releaseStudent` est bien idempotente, mais pour une raison qui ne vaut
 * pas ici : un second clic y réécrirait `releasedAt` et effacerait la date
 * de libération d'origine — ne rien faire PRÉSERVE une information. Un
 * transfert vers la classe actuelle n'a rien à préserver, et un succès muet
 * ne serait pas sans effet : il tromperait. L'écran ne propose que les
 * AUTRES classes de l'école, une demande qui nomme la classe actuelle vient
 * donc d'une page périmée ou d'un appel direct ; l'administrateur lirait
 * « c'est fait » et l'enfant serait resté en CM1 A. Il continuerait sa
 * réorganisation sur une carte mentale fausse.
 */
export const transferStudent = mutation({
  args: {
    membershipId: v.id("schoolMemberships"),
    targetSchoolClassId: v.id("schoolClasses"),
  },
  handler: async (ctx, args) => {
    const actor = await callerAdminProfile(ctx);
    if (!actor) throw new Error("Rôle non autorisé");

    const membership = await ctx.db.get(args.membershipId);
    if (!membership) throw new Error("Inscription introuvable");
    if (membership.status !== "active") {
      throw new Error(
        "Cette inscription n'est plus active : réinscrivez cet élève dans " +
          "sa nouvelle classe",
      );
    }

    const target = await ctx.db.get(args.targetSchoolClassId);
    if (!target) throw new Error("Classe introuvable");

    if (target.schoolId !== membership.schoolId) {
      throw new Error(
        "Cette classe appartient à une autre école : libérez le siège de " +
          "cet élève, puis réinscrivez-le dans sa nouvelle école",
      );
    }

    if (target._id === membership.schoolClassId) {
      throw new Error("Cet élève est déjà dans cette classe");
    }

    const student = await ctx.db.get(membership.studentId);

    // La classe de DÉPART, lue avant le `patch` : c'est la moitié de
    // l'information qu'un transfert doit laisser derrière lui, et après
    // l'écriture plus rien ne la porte. Un `patch` ne modifie pas le document
    // déjà en mémoire, mais s'appuyer là-dessus rendrait la trace dépendante
    // de l'ordre des lignes.
    const fromSchoolClassId = membership.schoolClassId;

    await ctx.db.patch(membership._id, { schoolClassId: target._id });

    await ctx.db.insert("schoolMembershipEvents", {
      membershipId: membership._id,
      studentId: membership.studentId,
      schoolId: membership.schoolId,
      kind: "transferred",
      actorProfileId: actor._id,
      at: Date.now(),
      fromSchoolClassId,
      toSchoolClassId: target._id,
    });

    // Le niveau du profil suit la classe, exactement comme `enrollStudent`
    // l'aligne à l'inscription : passer de CM1 A à CM2 B change le niveau de
    // l'élève. L'écriture reste conditionnelle, pour ne pas toucher un
    // document qui porte déjà la bonne valeur — le cas courant, un simple
    // changement de section à niveau égal.
    //
    // Un profil introuvable n'ARRÊTE PAS le transfert, là où `enrollStudent`
    // refuse : le sujet de celle-là est le profil qu'on lui nomme, le sujet
    // d'ici est l'inscription, et elle existe. `listClassStudents` affiche
    // déjà ces lignes orphelines (`UNKNOWN_NAME`) au lieu de les cacher ;
    // les rendre intransférables figerait la classe qui en contient une.
    if (student && student.class !== target.class) {
      await ctx.db.patch(student._id, { class: target.class });
    }

    return null;
  },
});
