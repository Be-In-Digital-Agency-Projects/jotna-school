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
import {
  decideActivation,
  type ActivationDenyReason,
} from "./subscriptionRules";
import {
  PRICING_SCALE,
  quoteSeatAmendment,
  quoteSubscription,
} from "./pricing";

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
 * compte autant d'inscriptions actives cesserait d'être plafonnée. Ce
 * commentaire affirmait qu'aucune écriture du dépôt ne créait de
 * `subscriptions` ; c'est FAUX depuis `recordSubscription`, et `amendSeats`
 * fait désormais monter `seatsPurchased` sans borne supérieure. La conséquence
 * n'est donc plus théorique — seul l'effectif la tient hors d'atteinte : 3 000
 * sièges, qu'une école primaire n'approche pas. Le jour où une école les
 * atteindra, c'est ici qu'il faudra revenir, et le plafond comme l'alerte
 * s'éteindront ensemble.
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
 * Avenants lus pour UN contrat.
 *
 * Un contrat dure une année scolaire, et un avenant est un acte commercial :
 * une école qui grossit en cours d'année en signe un, deux, rarement plus.
 * 20 couvre largement l'école qui ajouterait des sièges tous les mois.
 *
 * Borne franchie : ce sont les avenants les PLUS ANCIENS qui tombent, la
 * lecture étant décroissante — l'écran montre donc toujours les actes récents.
 * Même raisonnement que `MEMBERSHIP_EVENTS_LIMIT`, et même absence de
 * `truncated` : sur un journal daté et complet par le haut, la dernière ligne
 * affichée dit elle-même où s'arrête ce qui est lu. Le total du contrat, lui,
 * ne dépend jamais de cette lecture : il est écrit sur la ligne d'abonnement.
 */
const SEAT_AMENDMENTS_LIMIT = 20;

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
 * DEUX — et c'est délibéré.
 *
 * Un validateur à deux littéraux refuserait bien les quatre autres, mais par
 * une erreur de validation générique. Ce ne sont pas des valeurs invalides :
 * ce sont des statuts valides qu'une PERSONNE ne pose pas, chacun pour une
 * raison différente — `past_due` et `expired` appartiennent à une machine,
 * `cancelled` dit la fin d'un contrat que rien ne sait prononcer, et `draft`
 * fabriquerait une ligne que rien ne pourrait plus faire avancer. Celui qui
 * les choisit a besoin de l'apprendre, pas d'un message de type. Le refus vit
 * donc dans le handler, avec sa raison ; le validateur reste la forme du
 * champ, et le handler reste le seul juge.
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

/**
 * Le contrat qu'un AVENANT ferait grossir : celui EN VIGUEUR, ou à défaut le
 * PROCHAIN à commencer.
 *
 * POURQUOI PAS SIMPLEMENT CELUI DU PAYWALL. `currentSchoolSubscription` rend
 * le contrat le plus récemment COMMENCÉ — donc un contrat ÉCHU quand l'école
 * n'en a plus en cours, ce qui est exactement ce qu'il faut pour dire
 * `expired` plutôt que `no_subscription` à un enfant, et ce qu'il ne faut
 * surtout pas changer. Mais l'école qui a signé son année suivante pendant
 * l'été — ce que `recordSubscription` encourage — se retrouvait dans un
 * cul-de-sac : `schools.amendSeats` refusait pour échéance et conseillait un
 * contrat NEUF, que `recordSubscription` refuse à son tour puisqu'il
 * chevaucherait celui qu'elle vient de signer. Un contrat échu ne décide plus
 * rien, ni l'accès ni le plafond ; c'est le contrat À VENIR qui décidera, et
 * c'est donc lui qu'il faut agrandir.
 *
 * LA LECTURE EST EXACTE ET BORNÉE PAR L'INDEX. `by_owner_startsAt` porte
 * `startsAt` en dernière position : `gt("startsAt", now)` en ordre CROISSANT
 * rend la ligne de plus PETIT `startsAt` strictement supérieur à `now` — UN
 * document, quel que soit l'historique de contrats de l'école. Que ce document
 * soit LE prochain contrat — celui que le paywall retiendra dès son premier
 * jour — tient à la disjointness de §4.5 : aucun contrat ne le chevauche, et
 * aucun ne s'intercale entre `now` et son début, faute de quoi il commencerait
 * avant lui et serait celui-ci.
 *
 * LES DEUX BRANCHES NE SE RECOUVRENT NI NE LAISSENT DE TROU. La première ne
 * retient `current` que s'il COUVRE `now` (`startsAt <= now < endsAt`) ; la
 * seconde ne lit que `startsAt > now`. Aucun contrat COMMENCÉ n'est écarté à
 * tort : sous disjointness, un contrat commencé qui n'est pas `current` s'est
 * achevé avant le début de `current`, donc avant `now` — il est échu lui aussi.
 *
 * MAIS UN CONTRAT À VENIR AU-DELÀ DU PROCHAIN L'EST, et il faut le dire. Cette
 * règle n'atteint que deux contrats : celui en vigueur, et le suivant. Une
 * école dont le contrat de cette année court encore et qui a déjà signé celui
 * de l'an prochain ne peut donc pas agrandir celui de l'an prochain. La limite
 * est TEMPORAIRE — le contrat lointain devient la cible dès que le plus proche
 * s'achève — et elle ne ment jamais : le formulaire affiche les dates et les
 * chiffres du contrat qu'il vise réellement. La lever demanderait de désigner
 * le contrat par son identifiant, ce que le design refuse (aucun écran n'a à
 * désigner un contrat) : c'est une décision de produit, pas un oubli.
 *
 * À SAVOIR AUSSI : quand l'école n'a AUCUN contrat commencé, `current` est le
 * repli de `currentSchoolSubscription`, donc le contrat de plus GRAND
 * `startsAt`. La cible, elle, est le plus PROCHE. Les deux peuvent différer,
 * et c'est voulu — c'est le plus proche qui décidera en premier.
 *
 * NE REND JAMAIS UN CONTRAT ÉCHU : la première branche exige `now < endsAt`,
 * la seconde `now < startsAt < endsAt`. C'est ce qui garde la borne BASSE de
 * `pricing.remainingPeriodShare` dans son rôle de seconde ligne. La borne
 * HAUTE, elle, devient un chemin de production : un contrat à venir vaut une
 * part de 1, et l'école paie ses sièges au plein tarif d'une période qu'elle a
 * tout entière devant elle.
 *
 * Prend le contrat du paywall DÉJÀ LU, comme `readSeatState` prend ses sièges
 * plutôt que le document : ses deux appelants l'ont lu pour leur propre
 * compte, et une seconde lecture ici, sur une autre horloge, pourrait désigner
 * un autre contrat que celui dont l'écran montre les chiffres.
 */
async function amendableSubscription(
  ctx: QueryCtx | MutationCtx,
  schoolId: Id<"schools">,
  current: Doc<"subscriptions"> | null,
  now: number,
): Promise<Doc<"subscriptions"> | null> {
  if (current !== null && current.startsAt <= now && now < current.endsAt) {
    return current;
  }

  return await ctx.db
    .query("subscriptions")
    .withIndex("by_owner_startsAt", (q) =>
      q.eq("ownerType", "school").eq("ownerId", schoolId).gt("startsAt", now),
    )
    .order("asc")
    .first();
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
  /**
   * Vrai quand ce contrat attend d'être activé ET peut l'être aujourd'hui.
   *
   * Décidé ICI, par `subscriptionRules.decideActivation` — la fonction même
   * qu'exécute `activateSubscription` — et non recalculé par l'écran, pour la
   * raison qui vaut déjà pour `AmendableContract.hasStarted` : l'horloge du
   * navigateur est figée au montage et répondrait autrement que le serveur au
   * jour près de l'entrée en vigueur. Un bouton qui s'affiche quand la
   * mutation refuserait, ou qui manque quand elle accepterait, serait un
   * mensonge d'écran sur le seul geste qui ouvre l'accès d'une école.
   */
  canActivate: boolean;
};

/**
 * Le contrat qu'un AVENANT ferait grossir, tel que l'écran doit le montrer.
 *
 * DISTINCT de `ContractSummary`, et pas par goût du type : ce n'est pas
 * toujours le même document. Quand le contrat du paywall est ÉCHU et qu'un
 * contrat à venir est déjà signé, la fiche montre le premier — c'est lui qui
 * dit pourquoi les élèves n'ont pas l'accès — pendant que l'avenant porte sur
 * le second. Un seul champ pour les deux ferait afficher les chiffres de l'un
 * sous le formulaire qui engage l'autre.
 *
 * PORTE SES PROPRES SIÈGES, là où `ContractSummary` s'en abstient. Le nombre
 * de `SeatState.purchased` est celui du contrat du PAYWALL, normalisé par
 * `contractSeats` pour le PLAFOND ; celui-ci est la valeur BRUTE de la ligne
 * visée, celle-là même que `schools.amendSeats` passe à
 * `pricing.quoteSeatAmendment`. L'aperçu part donc du nombre exact dont la
 * facture est tirée, sans normalisation intercalée qui pourrait l'en écarter.
 * Deux usages, deux conventions — et aucun écart possible entre elles sur ce
 * qu'écrivent `recordSubscription` et `amendSeats`, qui n'écrivent que des
 * entiers.
 */
type AmendableContract = {
  startsAt: number;
  endsAt: number;
  status: Doc<"subscriptions">["status"];
  /** Fait foi pour la facturation (spec §7.2), et sert de base au prorata. */
  totalFcfa: number;
  /** Sièges que CE contrat ouvre, bruts — voir ci-dessus. */
  seatsPurchased: number;
  /**
   * Faux quand ce contrat n'a pas encore commencé. L'écran doit alors dire que
   * l'avenant n'ouvrira les sièges qu'à `startsAt` : le plafond d'inscription
   * lit le contrat du paywall, donc l'ancien tant que celui-ci n'a pas démarré.
   * Décidé ici plutôt que recalculé sur l'horloge du navigateur, figée au
   * montage de l'écran, qui répondrait autrement que le serveur au jour près
   * de l'entrée en vigueur.
   */
  hasStarted: boolean;
};

/**
 * Ce que `getEnrollmentOutlook` rend — `reason` absente quand l'accès
 * s'ouvre, `seats` et `contract` absentes quand l'école n'a aucun abonnement,
 * donc aucun plafond, et `amendable` absente quand aucun contrat n'est en
 * vigueur ni à venir : il n'y a alors rien à agrandir.
 */
type EnrollmentOutlook = {
  opensAccess: boolean;
  reason: AccessReason | null;
  seats: SeatState | null;
  contract: ContractSummary | null;
  amendable: AmendableContract | null;
};

/**
 * Ce qu'une inscription dans CETTE école ouvre vraiment, aujourd'hui.
 *
 * L'écran d'inscription affirmait qu'inscrire un élève « lui ouvre l'accès à
 * l'application ». C'est faux : l'inscription est NÉCESSAIRE à l'accès, jamais
 * suffisante. `decideAccess` juge ensuite l'abonnement de l'école, et tant
 * qu'aucune fonction du dépôt n'inscrivait de ligne `subscriptions` — avant
 * `recordSubscription`, quelques centaines de lignes plus bas — l'élève
 * inscrit tombait sur le paywall pour 100 % des inscriptions que ce code
 * pouvait produire, après qu'un administrateur eut prévenu la famille.
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
 * `currentSchoolSubscription` existe. Le contrat porte `canActivate`, décidé
 * par la règle qu'exécute `activateSubscription` : c'est le même document, le
 * même instant et la même fonction qui décident de montrer le bouton et de
 * l'honorer.
 *
 * Rend ENFIN le contrat AMENDABLE (`amendable`), pour la même raison portée à
 * l'argent : l'écran calcule l'aperçu d'un avenant, `schools.amendSeats` le
 * facture, et les deux doivent viser le MÊME document. Sinon l'administrateur
 * validerait un montant qu'il n'a pas vu — un aperçu trompeur, pire que le
 * message trompeur qu'il remplace. Une requête séparée les laisserait diverger
 * entre deux enregistrements ; ici, une seule transaction et un seul `now`
 * choisissent le contrat pour les deux. Ce n'est PAS toujours `contract` :
 * voir `amendableSubscription`.
 *
 * Lectures : le chemin de `access.loadAccessInput`, à l'identique —
 * l'abonnement que `currentSchoolSubscription` tient pour courant, les
 * tranches seulement en `past_due` — plus le décompte des sièges, borné par le
 * contrat. Une lecture de plus par école affichée, jamais par classe : l'écran
 * hisse la requête au niveau de l'école. Le contrat amendable n'en coûte une
 * de plus que lorsque celui du paywall ne couvre pas `now` : tant qu'un
 * contrat court, c'est le même document, déjà lu.
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

    const amendable = await amendableSubscription(
      ctx,
      args.schoolId,
      current,
      now,
    );

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
            // Le MÊME `now` que le verdict d'accès et que la sélection du
            // contrat : l'écran ne peut pas proposer d'activer un contrat que
            // la mutation jugerait non commencé sur un autre instant.
            canActivate: decideActivation({
              status: current.status,
              startsAt: current.startsAt,
              endsAt: current.endsAt,
              now,
            }).ok,
          }
        : null,
      amendable: amendable
        ? {
            startsAt: amendable.startsAt,
            endsAt: amendable.endsAt,
            status: amendable.status,
            totalFcfa: amendable.totalFcfa,
            seatsPurchased: amendable.seatsPurchased,
            hasStarted: amendable.startsAt <= now,
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

/**
 * Les avenants du contrat COURANT d'une école — qui a ajouté des sièges,
 * combien, et pour quel montant.
 *
 * Prend une école et non un contrat, comme `getEnrollmentOutlook` : l'écran
 * n'a pas à désigner une ligne d'abonnement, et le contrat retenu ici est
 * exactement celui que retient le paywall (`currentSchoolSubscription`). Une
 * requête qui prendrait un `subscriptionId` obligerait à sortir cet
 * identifiant sur le réseau pour un écran qui n'en a aucun usage.
 *
 * NE MONTRE QUE LE CONTRAT COURANT, et c'est voulu : les avenants d'un contrat
 * échu ont amendé un contrat que l'école ne paie plus, et les afficher sous le
 * contrat en vigueur donnerait à lire une somme qui n'est pas la sienne. Ils
 * ne sont pas perdus pour autant — `subscriptionAmendments` ne supprime rien,
 * et la ligne garde son `subscriptionId`.
 *
 * SUIT DONC LA FICHE, ET NON LE FORMULAIRE D'AVENANT. Les deux visent le même
 * contrat tant qu'il en court un ; quand celui du paywall est échu, l'avenant
 * porte sur le contrat À VENIR (`amendableSubscription`) et ce journal reste
 * sur celui que la fiche affiche au-dessus de lui — un journal qui sauterait
 * d'un contrat à l'autre sous un encart qui n'en nomme qu'un se lirait de
 * travers. Les avenants d'un contrat à venir se lisent dès qu'il commence,
 * sans qu'aucune ligne soit perdue entre-temps ; l'écran, lui, montre déjà les
 * sièges et le total du contrat visé dans le formulaire.
 *
 * Requête SÉPARÉE de `getEnrollmentOutlook` plutôt qu'un champ de plus dans sa
 * réponse : ce verdict-là est lu à chaque ouverture de fiche d'école et sa
 * consultation est documentée à la lecture près, alors que l'historique
 * n'entre dans aucune décision — ni l'accès, ni le plafond, ni le total, qui
 * est écrit sur le contrat. Le faire porter par le verdict ferait payer ces
 * lectures à tout le monde pour un encart que personne ne lit deux fois.
 *
 * Les NOMS sont résolus ici, comme dans `listMembershipEvents` :
 * « Profil #j57x… a ajouté 20 sièges » ne dit rien à l'administrateur qui
 * demande des comptes. Un auteur introuvable vaut `UNKNOWN_NAME` et ne fait
 * disparaître ni la ligne, ni le montant, ni la date — l'acte lui-même ne
 * dépend d'aucune autre table.
 *
 * Réservée à l'`admin` comme tout ce module, et ne lève pas : `[]` pour tout
 * autre appelant comme pour une école sans contrat.
 */
export const listSeatAmendments = query({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) return [];

    const current = await currentSchoolSubscription(
      ctx,
      args.schoolId,
      Date.now(),
    );
    if (!current) return [];

    const amendments = await ctx.db
      .query("subscriptionAmendments")
      .withIndex("by_subscription", (q) => q.eq("subscriptionId", current._id))
      .order("desc")
      .take(SEAT_AMENDMENTS_LIMIT);

    return await Promise.all(
      amendments.map(async (amendment) => {
        const actor = await ctx.db.get(amendment.actorProfileId);
        return {
          _id: amendment._id,
          seatsBefore: amendment.seatsBefore,
          seatsAfter: amendment.seatsAfter,
          amountFcfa: amendment.amountFcfa,
          at: amendment.at,
          actorName: actor?.name ?? UNKNOWN_NAME,
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
 * nombre brut reçu : une demande sous le plancher de `PRICING_SCALE` s'y
 * remonte, parce que l'école paie le plancher (spec §7.1) et qu'une école qui
 * paie des sièges les reçoit. Le plafond d'`enrollStudent` lit ce champ : il
 * doit lire le nombre payé, sans quoi l'école paierait des sièges qu'elle ne
 * pourrait pas occuper.
 *
 * SEPT REFUS, et la raison de chacun :
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
 *     faire passer un contrat existant à « résilié » — les deux `patch` de la
 *     table sont l'avenant de sièges d'`amendSeats`, qui ne touche JAMAIS au
 *     statut, et `activateSubscription`, qui n'écrit que `active` — donc une
 *     ligne saisie résiliée d'emblée ne décrit aucun contrat qui aurait eu
 *     lieu. Elle coûterait cher : elle n'ouvre aucun accès, mais
 *     `access.currentSchoolSubscription` la retiendrait comme contrat COURANT
 *     dès sa date de début, puisque cette sélection ne compare que les
 *     `startsAt` — et couperait une école qu'un contrat actif couvre. La
 *     résiliation viendra avec la facturation, à qui appartient la question du
 *     montant déjà facturé.
 *   - `draft` : le REFUS LE PLUS RÉCENT, et celui qui referme un piège.
 *     « Brouillon » n'ouvre aucun accès, comme « en attente de paiement », et
 *     les deux se ressemblaient assez pour qu'on laisse le choix. Mais
 *     `activateSubscription` ne fait avancer qu'un contrat « en attente de
 *     paiement » — activer, c'est ouvrir l'accès de toute une école, et un
 *     brouillon n'atteste d'aucun accord. Une ligne `draft` serait donc
 *     IMMOBILE : rien ne la fait avancer, rien ne la supprime, rien ne la
 *     redate, et elle OCCUPE sa période — le contrôle de chevauchement
 *     ci-dessous ne regarde pas le statut, donc le vrai contrat de ces dates
 *     serait refusé pour toujours. Une école à qui un brouillon aurait été
 *     saisi par erreur n'aurait plus jamais d'accès sur cette période. Le
 *     refuser à la saisie est ce qui rend vraie la propriété dont tout le
 *     reste dépend : TOUT CONTRAT ENREGISTRABLE PEUT AVANCER.
 *   - `active` daté du futur : voir juste en dessous.
 *   - CHEVAUCHEMENT d'une période déjà contractée : voir le refus lui-même,
 *     c'est celui dont dépend la justesse de la lecture du paywall.
 *
 * CE QU'IL MANQUE, ET QUI SE VOIT ICI : rien ne RÉSILIE un contrat en cours,
 * et rien n'en déplace les dates ni n'en réduit les sièges. Ce qui manquait
 * aussi — une école qui voulait plus de sièges en février ne pouvait pas en
 * obtenir avant la fin du contrat courant — ne manque plus : `amendSeats`, en
 * dessous, agrandit un contrat DÉJÀ SIGNÉ — celui en vigueur au prorata de la
 * période restante, ou à défaut le prochain à commencer, au plein tarif —
 * sans créer le second contrat que le refus de chevauchement interdit ici. Ce
 * qui reste hors de portée l'est pour la raison d'origine : réduire, résilier
 * ou redater, c'est décider ce qu'il advient du montant déjà facturé, et cette
 * question appartient au plan de facturation. Le refus, lui, le dit en face,
 * là où un empilement silencieux de contrats aurait rendu l'accès et le
 * plafond de sièges indécidables.
 *
 * POURQUOI UN CONTRAT FUTUR NE PEUT PAS ÊTRE `active` : `decideAccess` ne lit
 * jamais `startsAt` (`accessRules.ts` ne reçoit que `status` et `endsAt`). Un
 * contrat de l'an prochain marqué `active` passerait donc le test
 * `now < endsAt` et ouvrirait l'accès AUJOURD'HUI, pour une année que l'école
 * n'a pas encore commencé à payer. `access.currentSchoolSubscription` ferme la
 * moitié du trou en ne se repliant que sur les contrats déjà commencés ; ce
 * refus ferme l'autre moitié, en garantissant qu'un contrat à venir ne porte
 * jamais qu'un statut qui refuse. Le contrat signé d'avance n'est plus pour
 * autant une impasse : `activateSubscription`, plus bas, l'active le jour où
 * il commence — c'est exactement ce que ce refus-ci demande d'attendre.
 *
 * UN RENOUVELLEMENT EST UNE LIGNE NEUVE, et cette mutation n'écrit que des
 * lignes neuves : le schéma indexe par `startsAt`, l'historique des contrats a
 * de la valeur, et déplacer les dates de la ligne en cours ferait disparaître
 * le contrat sous les élèves qu'il couvre.
 *
 * LES DEUX `PATCH` DE LA TABLE sont étroits par construction, et c'est d'eux
 * que ce refus-ci dépend. `amendSeats`, juste en dessous, fait grossir un
 * contrat déjà signé — celui en vigueur, ou à défaut le prochain à commencer —
 * `seatsPurchased`, `totalFcfa` et le tarif moyen d'affichage qui s'en déduit,
 * sans jamais toucher au statut ni aux dates. `activateSubscription` n'écrit
 * QUE `status`, et une seule valeur : `active`, depuis `pending_payment`, sur
 * un contrat qui a commencé et n'est pas fini. Les deux propriétés dont ce
 * refus-ci dépend restent donc entières : une période n'est jamais déplacée,
 * donc aucun chevauchement ne peut naître après coup, et aucune ligne ne peut
 * DEVENIR `cancelled`.
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
          "en attente de paiement, ou actif s'il a déjà commencé.",
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
          "contrat en attente de paiement, ou actif s'il a déjà commencé.",
      );
    }

    // `draft` : le refus qui garantit qu'aucune ligne ne reste IMMOBILE. Voir
    // l'en-tête — un brouillon ne peut ni être activé (il n'atteste d'aucun
    // accord), ni supprimé, ni redaté, et il occupe sa période contre tout
    // autre contrat.
    if (args.status === "draft") {
      throw new Error(
        "« Brouillon » n'est plus enregistrable, et c'est pour protéger " +
          "l'école : un contrat en brouillon serait IMMOBILE. Il n'ouvre aucun " +
          "accès, rien ne sait le faire avancer — l'activation ne part que " +
          "d'un contrat « en attente de paiement », parce qu'activer ouvre " +
          "l'application à tous les élèves inscrits et qu'un brouillon " +
          "n'atteste d'aucun accord — et aucune mutation ne supprime ni ne " +
          "redate une ligne d'abonnement. Il OCCUPERAIT pourtant sa période : " +
          "le vrai contrat de ces dates serait ensuite refusé pour " +
          "chevauchement, et l'école n'aurait jamais d'accès sur cette " +
          "année-là. Enregistrez ce contrat en attente de paiement dès qu'un " +
          "accord existe : il pourra être activé le jour où il commencera.",
      );
    }

    const now = Date.now();

    if (args.status === "active" && args.startsAt > now) {
      throw new Error(
        "Un contrat ne se déclare pas en vigueur avant d'avoir commencé : " +
          `celui-ci débute le ${formatDay(args.startsAt)}. Marqué actif dès ` +
          "aujourd'hui, il ouvrirait l'accès pour une année qui n'a pas " +
          "commencé — le paywall ne juge que la date de FIN. Enregistrez-le " +
          "en attente de paiement : le contrat est réservé, sa période est " +
          `tenue, et le ${formatDay(args.startsAt)} le bouton « Activer ce ` +
          "contrat » apparaîtra sur la fiche de l'école. C'est lui qui " +
          "ouvrira l'accès, le jour où le contrat commence et pas avant.",
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
    // DEVENIR résiliée. Or la table n'a que trois écrivains : l'insertion
    // ci-dessous, qui refuse `cancelled` à la saisie ; le `patch`
    // d'`amendSeats`, qui n'écrit ni le statut ni les dates ; et celui
    // d'`activateSubscription`, qui n'écrit que le statut et une seule valeur,
    // `active`. Aucun chemin ne fait donc passer un contrat existant à
    // « résilié », ni ne déplace une période après coup. L'invariant est
    // entier : les contrats d'une école sont disjoints, quel que soit leur
    // statut.
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
    // (un `patch` du STATUT d'un contrat en cours vers `cancelled`, que les
    // deux `patch` d'aujourd'hui s'interdisent précisément pour ne pas
    // l'ouvrir : l'un n'écrit pas le statut, l'autre n'en écrit qu'`active`),
    // cet
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
 * AVENANT — ajouter des sièges à un contrat déjà signé, au prorata.
 *
 * Une école qui recrute vingt élèves en février ne pouvait rien faire :
 * `recordSubscription` refuse tout contrat chevauchant, et rien n'amendait un
 * contrat existant. C'était une limite de produit assumée (spec §10) ; cette
 * mutation la lève, sans toucher à ce qui la fondait.
 *
 * POURQUOI PAS UN SECOND CONTRAT — la solution évidente, enregistrer une
 * rallonge de février à juillet, est exactement ce que l'invariant de §4.5
 * interdit, et ce refus n'est pas négociable : un contrat court niché dans un
 * contrat long gagne la sélection du paywall, puis expire, et COUPE une école
 * qui a payé. La table est faite de contrats DISJOINTS, et c'est cette
 * propriété-là qui rend exacte la lecture en UN document dont dépend l'accès
 * de chaque enfant.
 *
 * QUEL CONTRAT — celui en VIGUEUR, ou à défaut le PROCHAIN à commencer
 * (`amendableSubscription`). Une école qui a signé son année suivante pendant
 * l'été — ce que `recordSubscription` encourage — n'avait aucun moyen de
 * l'agrandir : son contrat du paywall était échu, l'avenant refusait pour
 * échéance, et le contrat NEUF que ce refus conseillait chevauchait celui
 * qu'elle venait de signer. L'écran vise le MÊME contrat, que
 * `getEnrollmentOutlook` expose sous `amendable` : le montant montré avant
 * validation est celui que cette mutation facture.
 *
 * CE QUI EST ÉCRIT, ET RIEN D'AUTRE — un `patch` de trois champs sur la ligne
 * du contrat VISÉ :
 *
 *   - `seatsPurchased`, à la hausse seulement ;
 *   - `totalFcfa`, l'ancien PLUS le prorata — il reste ce qui fait foi pour la
 *     facturation (§7.2), et il n'est jamais recalculé depuis un devis neuf,
 *     ce qui effacerait les avenants précédents ;
 *   - `pricePerSeatFcfa`, qui n'est pas une décision mais une CONSÉQUENCE :
 *     le schéma le définit comme `totalFcfa / seatsPurchased`, à usage
 *     d'affichage seul. Le laisser tel quel après avoir bougé ses deux termes
 *     en ferait une valeur que sa propre définition contredit, et l'écran
 *     annoncerait « 5 000 FCFA par siège en moyenne » pour un contrat qui n'en
 *     coûte plus autant. Il devient un tarif moyen MIXTE — des sièges payés
 *     sur une année pleine, d'autres sur une fraction — ce qu'il est
 *     réellement. Aucune décision du dépôt ne le lit : ni `decideAccess`, ni
 *     le plafond de sièges, ni la facturation, à qui §7.2 interdit de
 *     reconstituer un total à partir de lui.
 *
 * JAMAIS `status`, JAMAIS `startsAt`, JAMAIS `endsAt`. C'est cette étroitesse
 * qui rend l'avenant sûr, et elle se paie en deux propriétés préservées :
 *
 *   - LES DATES NE BOUGENT PAS, donc la disjointness de §4.5 est INCHANGÉE.
 *     Un avenant ne peut pas créer de chevauchement : il ne déplace aucune
 *     borne de période. La sélection en une lecture reste exacte, et le
 *     contrôle de chevauchement de `recordSubscription` garde sa preuve ;
 *   - LE STATUT NE BOUGE PAS ICI, et il ne bouge ailleurs que d'UNE façon :
 *     `activateSubscription` écrit `active`, depuis `pending_payment`, sur un
 *     contrat commencé et non fini. AUCUNE LIGNE NE PEUT DONC DEVENIR
 *     `cancelled`, ni `past_due`. Deux raisonnements de cette branche en
 *     dépendent : le refus de `cancelled` à la saisie (§4.5) et la branche
 *     `past_due` de `decideAccess` (§8.5).
 *
 * LE PRIX N'EST PAS UN ARGUMENT, comme dans `recordSubscription` : il se
 * calcule par `pricing.quoteSeatAmendment`, module pur, à partir des seuls
 * sièges et des dates DÉJÀ EN BASE. Le montant est proratisé sur la période
 * restante — une école qui ajoute un élève à deux mois de la fin ne paie pas
 * une année pleine — et le delta passe par un devis des deux côtés plutôt que
 * par une multiplication, pour que le calcul reste juste si une remise au
 * volume revient un jour : le coût marginal de vingt sièges dépend de la
 * tranche où ils tombent.
 *
 * TROIS REFUS, et la raison de chacun :
 *
 *   - sièges : entier strictement positif, comme `recordSubscription` — et
 *     c'est le nombre TOTAL visé, jamais le nombre ajouté ; la mutation et
 *     l'écran comptent dans la même unité ;
 *   - aucun contrat À AMENDER : ni contrat en vigueur, ni contrat à venir.
 *     Agrandir un contrat terminé n'ouvrirait aucun accès — `decideAccess`
 *     juge l'expiration par `endsAt` — coûterait zéro franc, la période
 *     restante étant nulle, et réécrirait les sièges d'une année révolue :
 *     le contrat cesserait de dire ce qui avait été vendu pour cette
 *     année-là. C'est un contrat NEUF qu'il faut, et le refus peut enfin le
 *     dire sans mentir : plus rien ne court ni ne commence, donc rien ne
 *     chevauche la période à venir et `recordSubscription` l'acceptera ;
 *   - une BAISSE de sièges, ou une demande qui n'ajoute rien. Réduire en cours
 *     d'année pose la question du remboursement du montant déjà facturé, qui
 *     appartient à la facturation (§10) — et un avenant qui saurait réduire
 *     pourrait passer sous l'effectif inscrit, ce que le paragraphe suivant
 *     exclut par construction.
 *
 * AUCUNE GARDE D'EFFECTIF, et ce n'est pas un oubli. `recordSubscription`
 * refuse un contrat qui laisserait l'école au-delà de son droit
 * (`used > purchased`) ; ici elle serait inutile ET NUISIBLE. Inutile parce
 * que `used` ne bouge pas et que `purchased` ne peut que monter — le refus de
 * baisse ci-dessus l'y oblige — donc `used <= purchased` se conserve. Nuisible
 * parce qu'une école qui serait déjà au-delà de son contrat n'en est
 * RAPPROCHÉE que par un avenant : c'est le remède même que le message de
 * `enrollStudent` et l'écran d'école recommandent (« augmentez le nombre de
 * sièges de l'abonnement »), et une garde d'effectif refuserait ici le seul
 * geste qui répare.
 *
 * ET QUAND LE CONTRAT VISÉ N'A PAS ENCORE COMMENCÉ, l'avenant ne touche à rien
 * de tout cela : le plafond lit le contrat du PAYWALL, donc ni `used` ni le
 * `purchased` qui plafonne aujourd'hui ne bougent. Les sièges achetés
 * n'ouvriront qu'à la date de début du contrat amendé, et l'écran le dit —
 * sans quoi un administrateur attendrait des places le jour même.
 *
 * DEUX AVENANTS CONCURRENTS ne peuvent pas se perdre. Une mutation Convex est
 * une transaction sérialisable : les deux lisent la même ligne, l'une commite,
 * l'autre voit son ensemble de lecture invalidé et REJOUE depuis le début, sur
 * la ligne déjà amendée. Le second delta se calcule donc contre les sièges
 * issus du premier, et les deux prorata s'additionnent — le total reste juste,
 * et le journal porte deux lignes dont les sièges s'enchaînent.
 *
 * LA TRACE — une ligne `subscriptionAmendments` dans la même transaction. Un
 * `patch` écrase : sans elle, plus rien ne dirait ce qui avait été signé, ni
 * qui a engagé l'école pour ce montant. Mêmes principes que
 * `schoolMembershipEvents` : l'auteur copié et jamais relu pour autoriser,
 * `at` qui date l'ACTE.
 */
export const amendSeats = mutation({
  args: {
    schoolId: v.id("schools"),
    /** Le nouveau nombre TOTAL de sièges du contrat, jamais le nombre ajouté. */
    seatsPurchased: v.number(),
  },
  handler: async (ctx, args) => {
    // `callerAdminProfile` et non `callerIsAdmin` : cette mutation NOMME celui
    // qui engage l'école, comme les trois actes sur l'inscription d'un élève.
    // Un seul appel sert de garde et de source de l'auteur.
    const actor = await callerAdminProfile(ctx);
    if (!actor) throw new Error("Rôle non autorisé");

    const school = await ctx.db.get(args.schoolId);
    if (!school) throw new Error("École introuvable");

    if (!Number.isInteger(args.seatsPurchased) || args.seatsPurchased <= 0) {
      throw new Error(
        "Le nombre de sièges doit être un entier strictement positif",
      );
    }

    // Un seul `now` pour les TROIS usages : choisir le contrat, calculer la
    // part de période restante, dater l'acte et sa trace. Trois appels à
    // `Date.now()` pourraient amender un contrat choisi sur un instant, au
    // prix d'un autre, et le dater d'un troisième.
    const now = Date.now();

    // LE CONTRAT VISÉ — celui EN VIGUEUR, ou à défaut le PROCHAIN à commencer.
    //
    // Ce commentaire disait qu'amender un autre contrat que celui du paywall
    // « ajouterait des sièges là où personne ne les regarde ». Le raisonnement
    // vaut pour un contrat EN VIGUEUR : celui-là décide de l'accès et du
    // plafond, et lui seul. Il cesse de valoir quand le contrat du paywall est
    // ÉCHU — il ne décide alors plus rien, et c'est le contrat À VENIR qui
    // décidera. Refuser au motif de l'échéance envoyait dans un MUR l'école
    // qui avait signé son année suivante pendant l'été : le contrat NEUF que
    // le refus conseille, `recordSubscription` le refuse à son tour, puisqu'il
    // chevaucherait celui qu'elle vient de signer.
    //
    // L'ÉCRAN VISE LE MÊME CONTRAT : `getEnrollmentOutlook` l'expose sous
    // `amendable`, par cette même `amendableSubscription`, et l'aperçu du
    // formulaire se calcule dessus. Deux sélections divergentes remplaceraient
    // un message trompeur par un MONTANT trompeur — un administrateur qui
    // valide une somme qu'il n'a pas vue.
    const current = await currentSchoolSubscription(ctx, args.schoolId, now);
    const target = await amendableSubscription(
      ctx,
      args.schoolId,
      current,
      now,
    );

    if (target === null) {
      // `current` nul signifie qu'aucune ligne n'existe pour cette école : le
      // repli de `currentSchoolSubscription` rend un contrat dès qu'il en
      // existe un, commencé ou non.
      if (current === null) {
        throw new Error(
          "Cette école n'a aucun contrat à amender : un avenant agrandit un " +
            "contrat existant, il n'en crée pas. Enregistrez d'abord un contrat.",
        );
      }

      // Sinon `current` est le dernier contrat COMMENCÉ et il est échu — sans
      // quoi il serait la cible — et aucun contrat ne commence après `now`.
      // Le message d'origine devient donc VRAI : rien ne court ni ne
      // commencera, donc rien ne chevauche la période à venir, et
      // `recordSubscription` acceptera le contrat neuf qu'il conseille.
      throw new Error(
        `Le dernier contrat de cette école s'est achevé le ` +
          `${formatDay(current.endsAt)} : il n'y a plus rien à amender. ` +
          "Agrandir un contrat terminé n'ouvrirait aucun accès — le paywall " +
          "juge l'expiration sur la date de fin — et réécrirait les sièges " +
          "d'une année révolue. Enregistrez un contrat NEUF pour la période " +
          "à venir.",
      );
    }

    const amendment = quoteSeatAmendment({
      currentSeats: target.seatsPurchased,
      currentTotalFcfa: target.totalFcfa,
      newSeats: args.seatsPurchased,
      now,
      startsAt: target.startsAt,
      endsAt: target.endsAt,
    });

    // `seatsAdded` et non une comparaison des nombres bruts : le plancher de
    // `PRICING_SCALE` peut remonter une demande, et c'est le nombre de sièges
    // RÉELLEMENT ouverts qui doit augmenter. Une école au plancher à qui on
    // demanderait moins verrait sa demande remontée à ce qu'elle a déjà — pas
    // une hausse, et sûrement pas une baisse silencieuse.
    if (amendment.seatsAdded <= 0) {
      const held = pluralCount(target.seatsPurchased, "siège", "sièges");
      throw new Error(
        `Un avenant ne fait qu'AJOUTER des sièges : ce contrat en ouvre déjà ` +
          `${held}, et vous en demandez ${args.seatsPurchased} au total — il ` +
          "n'y a rien à ajouter. Réduire le nombre de sièges en cours de " +
          "période pose la question du remboursement du montant déjà " +
          "facturé, qui appartient à la facturation : libérez le siège des " +
          "élèves concernés si le contrat est trop grand, ou enregistrez un " +
          "contrat au nombre voulu à la fin de celui-ci.",
      );
    }

    // LE `PATCH` — trois champs, et aucun autre. Ni `status`, ni `startsAt`,
    // ni `endsAt` : voir l'en-tête, c'est ce qui préserve la disjointness de
    // §4.5 et la propriété « aucune ligne ne devient `cancelled` ».
    await ctx.db.patch(target._id, {
      seatsPurchased: amendment.seatsBilled,
      totalFcfa: amendment.totalFcfa,
      pricePerSeatFcfa: amendment.pricePerSeatFcfa,
    });

    await ctx.db.insert("subscriptionAmendments", {
      subscriptionId: target._id,
      schoolId: args.schoolId,
      seatsBefore: target.seatsPurchased,
      seatsAfter: amendment.seatsBilled,
      amountFcfa: amendment.amountFcfa,
      actorProfileId: actor._id,
      at: now,
    });

    return {
      seatsAdded: amendment.seatsAdded,
      seatsAfter: amendment.seatsBilled,
      amountFcfa: amendment.amountFcfa,
      totalFcfa: amendment.totalFcfa,
    };
  },
});

/**
 * Les phrases des refus d'activation — les motifs viennent de la RÈGLE
 * (`subscriptionRules.decideActivation`), les mots sont ici.
 *
 * Même découpage que `decideAccess` et `lib/accessCopy.ts` : une fonction pure
 * décide, un appelant met les phrases. Chaque motif appelle une conduite
 * différente, et aucun ne conseille quelque chose d'impossible — c'est la
 * faute que cette branche a déjà eu à corriger une fois, quand un refus
 * conseillait un réenregistrement que le contrôle de chevauchement refusait à
 * son tour.
 */
function activationRefusal(
  reason: ActivationDenyReason,
  contract: Doc<"subscriptions">,
): string {
  switch (reason) {
    case "already_active":
      return (
        "Ce contrat est déjà actif : il n'y a rien à activer. Si les élèves " +
        "n'ont pas l'accès, la cause est ailleurs — la fiche de l'école la " +
        "nomme sous le contrat."
      );

    case "status_draft":
      return (
        "Ce contrat est un BROUILLON, et rien ne sait le faire avancer : " +
        "l'activation ne part que d'un contrat « en attente de paiement », " +
        "parce qu'elle ouvre l'application à tous les élèves inscrits et " +
        "qu'un brouillon n'atteste d'aucun accord. Enregistrer un brouillon " +
        "n'est d'ailleurs plus possible, précisément pour qu'aucune ligne ne " +
        "reste immobile : celle-ci est antérieure à ce refus, ou vient " +
        "d'ailleurs. En l'état elle ne peut ni s'activer, ni changer de " +
        "dates, ni disparaître, et elle occupe sa période — le sort d'un " +
        "devis appartient au plan de facturation."
      );

    case "status_past_due":
      return (
        "Ce contrat est marqué impayé : une activation ne solde aucune " +
        "tranche. Ce statut-là est posé, et levé, par le suivi des tranches, " +
        "jamais à la main — et l'accès des élèves y suit le délai de grâce, " +
        "pas un bouton."
      );

    case "status_expired":
      return (
        "Ce contrat porte le statut « échu » : l'activer ne rouvrirait rien, " +
        "le paywall jugeant l'expiration sur la date de fin. Enregistrez un " +
        "contrat NEUF pour la période à venir."
      );

    case "status_cancelled":
      return (
        "Ce contrat est résilié : l'activer ne le ferait pas revivre, et ce " +
        "qu'il advient du montant déjà facturé appartient à la facturation. " +
        "Enregistrez un contrat NEUF pour la période à venir."
      );

    case "not_started":
      return (
        `Ce contrat ne commence que le ${formatDay(contract.startsAt)} : ` +
        "l'activer aujourd'hui ouvrirait l'accès pour une période que " +
        "l'école n'a pas encore commencée — le paywall ne juge que la date " +
        "de FIN, jamais celle de début. Revenez le " +
        `${formatDay(contract.startsAt)} : le bouton d'activation ` +
        "apparaîtra sur cette fiche ce jour-là."
      );

    case "period_over":
      return (
        "Le dernier contrat commencé de cette école s'est achevé le " +
        `${formatDay(contract.endsAt)} : l'activer n'ouvrirait aucun accès, ` +
        "le paywall jugeant l'expiration sur la date de fin. Si un contrat a " +
        "déjà été signé pour la suite, il s'activera à SA date de début ; " +
        "sinon, enregistrez un contrat neuf."
      );
  }
}

/**
 * ACTIVER un contrat — la seule écriture du dépôt qui change `status`.
 *
 * Une école qui signe son année en juillet enregistre son contrat « en attente
 * de paiement » : `recordSubscription` refuse `active` sur un contrat qui n'a
 * pas commencé, à raison — `decideAccess` ne lit jamais `startsAt`, donc la
 * ligne ouvrirait l'accès dès sa saisie. Restait à savoir qui l'activerait le
 * jour venu. Personne, jusqu'ici : aucune mutation n'écrivait `status`, et
 * réenregistrer le contrat en actif était refusé pour chevauchement avec
 * lui-même. L'école n'avait jamais l'accès de l'année qu'elle avait payée.
 * C'est ce trou-là, et rien d'autre, que cette mutation ferme.
 *
 * L'ÉTROITESSE EST CE QUI AUTORISE CETTE MUTATION À EXISTER. C'est le PREMIER
 * `patch` du dépôt qui écrit `subscriptions.status`, et deux raisonnements de
 * cette branche reposaient sur le fait qu'il n'y en avait aucun :
 *
 *   - le REFUS DE `cancelled` À LA SAISIE (spec §4.5), dont toute la preuve
 *     est « aucune ligne ne peut DEVENIR résiliée, puisque rien ne patche le
 *     statut » — c'est lui qui garantit que les contrats d'une école restent
 *     disjoints quel que soit leur statut, donc que la lecture en UN document
 *     du paywall est exacte ;
 *   - la BRANCHE `past_due` de `decideAccess` (spec §8.5), qui tient un
 *     `past_due` sans tranche échue pour une incohérence de données, au motif
 *     que ce statut est posé par une machine — celle qui marque la tranche.
 *
 * Les deux survivent parce que la transition est enfermée :
 *
 *   - STATUT DE DÉPART : `pending_payment`, et lui seul. Pas `draft` :
 *     « brouillon » veut dire non conclu, et activer ouvre l'accès de toute
 *     une école sans que rien ne sache le refermer. `recordSubscription` ne
 *     l'accepte d'ailleurs plus à la saisie, pour qu'aucune ligne ne reste
 *     immobile — les deux décisions vont ensemble ;
 *   - STATUT D'ARRIVÉE : `active`, littéral dans le code. Jamais reçu en
 *     argument : un statut d'arrivée paramétrable serait exactement le `patch`
 *     générique que les deux raisonnements ci-dessus interdisent ;
 *   - PÉRIODE : `startsAt <= now < endsAt`. Un contrat à venir activé
 *     d'avance rouvrirait le trou que `recordSubscription` ferme ; un contrat
 *     échu n'ouvrirait rien et laisserait en base un « actif » que la lecture
 *     suivante contredit ;
 *   - CHAMPS ÉCRITS : `status`, et lui seul. Ni les dates — la disjointness de
 *     §4.5 reste donc intacte, aucune borne de période ne bougeant — ni les
 *     sièges, ni les montants : activer n'est pas vendre.
 *
 * La règle elle-même vit dans `convex/subscriptionRules.ts`, module PUR et
 * testé : c'est le seul endroit du dépôt où cette étroitesse est vérifiable,
 * le reste vivant dans une mutation que le repo n'a pas de quoi appeler en
 * test. L'écran lit la même règle par `getEnrollmentOutlook.contract
 * .canActivate`, donc le bouton s'affiche exactement quand la mutation
 * accepte.
 *
 * QUEL CONTRAT — celui qui couvre `now`, et l'école n'en a qu'un : c'est la
 * disjointness. `access.currentSchoolSubscription` le rend déjà — le même
 * helper que le paywall, que le plafond de sièges et que l'avenant — et cette
 * mutation n'écrit pas une seconde lecture qui lui ressemblerait : deux
 * sélections divergentes activeraient un autre contrat que celui dont l'écran
 * montre les dates. Quand le contrat rendu ne couvre pas `now` — il est échu,
 * ou l'école n'a que des contrats à venir — il n'y a rien à activer, et les
 * deux refus de période le disent.
 *
 * CE QUE ÇA OUVRE, ET QUI EST SANS RETOUR : tous les élèves inscrits de
 * l'école obtiennent l'application, d'un coup. Rien ne DÉSACTIVE un contrat —
 * aucune mutation ne fait redescendre un statut, et c'est voulu : couper une
 * école est une décision commerciale qui appartient à la facturation, avec la
 * question du montant déjà facturé. L'écran doit donc le dire avant le clic,
 * et il le dit.
 *
 * LA TRACE — une ligne `subscriptionActivations` dans la même transaction. Un
 * `patch` écrase : sans elle, plus rien ne dirait qui a ouvert l'accès de
 * cette école, ni quand. Mêmes principes que `schoolMembershipEvents` et
 * `subscriptionAmendments` : l'auteur copié et jamais relu pour autoriser,
 * `at` qui date l'ACTE.
 *
 * DEUX ACTIVATIONS CONCURRENTES ne produisent pas deux lignes de journal. Une
 * mutation Convex est une transaction sérialisable : la seconde voit son
 * ensemble de lecture invalidé, rejoue sur la ligne déjà activée, et se heurte
 * au refus « déjà actif ». Le `patch` est idempotent, le journal ne l'est pas,
 * et c'est le rejeu qui le garde exact.
 */
export const activateSubscription = mutation({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, args) => {
    // `callerAdminProfile` et non `callerIsAdmin` : cette mutation NOMME celui
    // qui ouvre l'accès d'une école, comme l'avenant et les trois actes sur
    // l'inscription d'un élève. Un seul appel sert de garde et de source de
    // l'auteur.
    const actor = await callerAdminProfile(ctx);
    if (!actor) throw new Error("Rôle non autorisé");

    const school = await ctx.db.get(args.schoolId);
    if (!school) throw new Error("École introuvable");

    // Un seul `now` pour les TROIS usages : choisir le contrat, juger qu'il a
    // commencé et n'est pas fini, dater l'acte et sa trace.
    const now = Date.now();

    const current = await currentSchoolSubscription(ctx, args.schoolId, now);
    if (current === null) {
      throw new Error(
        "Cette école n'a aucun contrat : il n'y a rien à activer. " +
          "Enregistrez d'abord un contrat — il s'activera le jour où il " +
          "commencera, ou tout de suite s'il a déjà commencé.",
      );
    }

    const decision = decideActivation({
      status: current.status,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      now,
    });
    if (!decision.ok) {
      throw new Error(activationRefusal(decision.reason, current));
    }

    // LE `PATCH` — un champ, et aucun autre. Ni les dates, ni les sièges, ni
    // les montants : voir l'en-tête, c'est ce qui préserve la disjointness de
    // §4.5 et la propriété « aucune ligne ne devient `cancelled` ni
    // `past_due` ». Le statut d'arrivée est un LITTÉRAL, jamais un argument.
    await ctx.db.patch(current._id, { status: "active" });

    // `decision.from` et non `current.status` : la ligne de trace recopie ce
    // que la RÈGLE a établi, et le schéma n'accepte que cette valeur-là. Un
    // élargissement de la transition ne pourra donc pas laisser le journal
    // derrière lui — il ne compilera pas.
    await ctx.db.insert("subscriptionActivations", {
      subscriptionId: current._id,
      schoolId: args.schoolId,
      statusBefore: decision.from,
      actorProfileId: actor._id,
      at: now,
    });

    // `null`, comme `releaseStudent` — l'autre acte qui patche et journalise
    // sans rien avoir à rendre. L'écran n'a pas besoin d'une réponse : le
    // verdict de `getEnrollmentOutlook` est réactif, donc la fiche repasse
    // d'elle-même en « Actif » et le bouton disparaît. Une valeur de retour
    // que personne ne lit finirait par être lue de travers.
    return null;
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
