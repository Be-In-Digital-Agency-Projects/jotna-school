import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { callerIsAdmin } from "./access";

/**
 * Administration des écoles : écoles, personnel, classes, inscriptions.
 *
 * Un seul module pour ces quatre tables parce qu'elles forment un seul
 * parcours — créer une école, y rattacher un professeur, créer une classe, lui
 * affecter un professeur DU PERSONNEL de cette école, y inscrire des élèves —
 * et que chaque étape se valide contre la précédente. Les séparer obligerait à
 * importer l'une depuis l'autre pour ces vérifications croisées.
 *
 * TOUT ici est réservé à l'`admin` (`callerIsAdmin`). Les requêtes ne lèvent
 * jamais et rendent `[]` ou `null` ; les mutations lèvent
 * `new Error("Rôle non autorisé")` — pas de `ConvexError`, que le client
 * réserve au refus de paywall (`accessRules.ts`).
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
 */
const PROFILE_SCAN_LIMIT = 500;

/** Candidats rendus au plus, pour un menu déroulant qui reste utilisable. */
const CANDIDATES_LIMIT = 100;

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
 */
export const listStaffCandidates = query({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) return [];

    const rows = await ctx.db
      .query("schoolStaff")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .take(STAFF_LIMIT);
    const alreadyStaff = new Set(
      rows.filter((row) => row.status === "active").map((row) => row.profileId),
    );

    const profiles = await ctx.db.query("profiles").take(PROFILE_SCAN_LIMIT);

    return profiles
      .filter(
        (profile) =>
          (profile.role === "professeur" || profile.role === "directeur") &&
          !alreadyStaff.has(profile._id),
      )
      .slice(0, CANDIDATES_LIMIT)
      .map((profile) => ({
        _id: profile._id,
        name: profile.name,
        role: profile.role,
      }));
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
 */
export const listEnrollableStudents = query({
  args: {},
  handler: async (ctx) => {
    if (!(await callerIsAdmin(ctx))) return [];

    const profiles = await ctx.db.query("profiles").take(PROFILE_SCAN_LIMIT);

    const enrollable: Array<{
      _id: Id<"profiles">;
      name: string;
      class: Doc<"profiles">["class"] | null;
    }> = [];

    for (const profile of profiles) {
      if (enrollable.length >= CANDIDATES_LIMIT) break;
      if (profile.role !== "student") continue;

      const active = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_student_status", (q) =>
          q.eq("studentId", profile._id).eq("status", "active"),
        )
        .first();
      if (active) continue;

      enrollable.push({
        _id: profile._id,
        name: profile.name,
        class: profile.class ?? null,
      });
    }

    return enrollable.sort((a, b) => a.name.localeCompare(b.name));
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
 * Bornée aux classes de CETTE école : un enseignant rattaché à deux écoles ne
 * perd que les classes de celle qu'il quitte, et l'index `by_school` fait ce
 * cadrage lui-même.
 */
export const removeStaff = mutation({
  args: { staffId: v.id("schoolStaff") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    const staff = await ctx.db.get(args.staffId);
    if (!staff) throw new Error("Membre du personnel introuvable");

    const classes = await ctx.db
      .query("schoolClasses")
      .withIndex("by_school", (q) => q.eq("schoolId", staff.schoolId))
      .take(CLASSES_LIMIT);

    let unassigned = 0;
    for (const schoolClass of classes) {
      if (schoolClass.teacherId !== staff.profileId) continue;
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
 * Trois invariants tiennent dans cette mutation :
 *
 * - UNE SEULE inscription active par élève. `access.loadAccessInput` résout le
 *   droit par `by_student_status` puis `.first()` : deux lignes actives
 *   rendraient ce droit arbitraire, dépendant de l'ordre de lecture, et le
 *   paywall non déterministe. C'est le refus le plus important du module.
 * - `schoolId` se LIT SUR LA CLASSE, il n'est pas reçu en argument : une
 *   inscription dont l'école ne serait pas celle de sa classe placerait
 *   l'élève sous le mauvais abonnement.
 * - Le niveau du profil s'aligne sur celui de la classe — voir plus bas.
 *
 * Sur l'alignement du niveau : `profiles.class` n'est aujourd'hui lu par AUCUNE
 * fonction du dépôt (le niveau d'une session de palier vient de `topic.class`,
 * pas du profil). Ce champ existe pour le filtrage de contenu à venir, décrit
 * par le commentaire de `convex/schema.ts:51`, et cette inscription est la
 * seule écriture qui en connaisse la valeur vraie. L'écrire ici ne change donc
 * rien au comportement actuel et rend le champ honnête le jour où il servira.
 */
export const enrollStudent = mutation({
  args: {
    studentId: v.id("profiles"),
    schoolClassId: v.id("schoolClasses"),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

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

    const membershipId = await ctx.db.insert("schoolMemberships", {
      schoolId: schoolClass.schoolId,
      studentId: args.studentId,
      schoolClassId: schoolClass._id,
      status: "active",
      enrolledAt: Date.now(),
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
 */
export const releaseStudent = mutation({
  args: { membershipId: v.id("schoolMemberships") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new Error("Rôle non autorisé");

    const membership = await ctx.db.get(args.membershipId);
    if (!membership) throw new Error("Inscription introuvable");
    if (membership.status !== "active") return null;

    await ctx.db.patch(membership._id, {
      status: "released",
      releasedAt: Date.now(),
    });
    return null;
  },
});
