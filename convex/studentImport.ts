import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { callerAdminProfile } from "./access";
import { pluralCount, seatStateForSchool } from "./schools";
import {
  IMPORT_ROWS_LIMIT,
  PARSE_ERROR_MESSAGES,
  normalizeCode,
  parseImportPaste,
  type ParsedImportRow,
} from "./importCodes";

// ---------------------------------------------------------------------------
// IMPORT EN MASSE D'ÉLÈVES — spec §6.1.
//
// TROIS CONTRAINTES S'EMPILENT, et c'est ce qui dicte la forme du module :
//   1. `createAccount` n'existe que dans une `action` (cf. `createChildAccount`).
//   2. Une action n'est PAS transactionnelle : elle peut mourir à mi-parcours.
//   3. Une mutation a un plafond de documents lus et écrits que quatre cents
//      élèves × quatre documents dépassent.
//
// D'où le découpage prescrit par les guidelines : une MUTATION ouvre le
// travail et écrit toutes les lignes d'un coup, une ACTION les consomme par
// lots de vingt-cinq et se replanifie.
//
// L'IDEMPOTENCE VIT DANS LE STATUT DE LA LIGNE, PAS DANS UN CURSEUR. Une ligne
// `created` n'est jamais retraitée ; si l'action meurt à la 213ᵉ, la reprise
// repart exactement de là sans qu'aucun compteur n'ait à être juste. Un curseur
// serait faux dès la première reprise partielle — et une reprise partielle est
// le cas NORMAL ici, pas l'exception.
//
// LE PLAFOND DE SIÈGES SE VÉRIFIE UNE SEULE FOIS, SUR LE LOT ENTIER, AVANT
// TOUTE CRÉATION. Un import à moitié fait laisserait une école avec des comptes
// d'enfants qu'elle n'a pas commandés, qu'elle ne sait pas retrouver, et dont
// certains occupent des sièges qu'elle n'a pas payés.
//
// Tout est réservé à l'`admin`, comme le reste de `schools.ts` : la spec §6.5
// veut que le DIRECTEUR importe, mais aucune console directeur n'existe dans ce
// dépôt. `admin` est strictement plus étroit que `directeur` — s'aligner dessus
// ne desserre rien, cela retarde une délégation.
// ---------------------------------------------------------------------------

/** Lignes traitées par lot. Spec §6.1 : vingt-cinq. */
const BATCH_SIZE = 25;

/** Erreurs de collage listées dans un refus — au-delà, le message est illisible. */
const REPORTED_ERRORS = 10;

/** Classes lues pour une école : `CLASSES_LIMIT` (50) par niveau, six niveaux. */
const SCHOOL_CLASSES_LIMIT = 300;

/** Un trimestre : la durée que le dépôt emploie déjà pour la péremption. */
const PARENT_CODE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Ouverture
// ---------------------------------------------------------------------------

type ResolvedRow = ParsedImportRow & { schoolClassId: Id<"schoolClasses"> };

/**
 * Résout chaque ligne contre les classes RÉELLES de l'école.
 *
 * Le collage donne un niveau et parfois un libellé ; `studentImportRows` exige
 * une classe concrète. C'est ici que les deux se rencontrent, et ici qu'on
 * REFUSE plutôt que de deviner : mettre un enfant dans la mauvaise classe n'est
 * rattrapable par aucun message, et le directeur est à deux secondes de
 * corriger sa liste.
 */
function resolveRows(
  rows: ParsedImportRow[],
  classes: Doc<"schoolClasses">[],
): { resolved: ResolvedRow[]; refusals: string[] } {
  const resolved: ResolvedRow[] = [];
  const refusals: string[] = [];

  for (const row of rows) {
    const atLevel = classes.filter((c) => c.class === row.class);
    if (atLevel.length === 0) {
      refusals.push(
        `ligne ${row.line} : l'école n'a aucune classe de ${row.class}`,
      );
      continue;
    }

    if (row.label === "") {
      if (atLevel.length > 1) {
        const labels = atLevel.map((c) => c.label).join(", ");
        refusals.push(
          `ligne ${row.line} : l'école a plusieurs ${row.class} (${labels}) — ` +
            `précisez laquelle, par exemple « ${row.name}, ${row.class} ${atLevel[0].label} »`,
        );
        continue;
      }
      resolved.push({ ...row, schoolClassId: atLevel[0]._id });
      continue;
    }

    const match = atLevel.find(
      (c) => c.label.replace(/\s+/g, "").toUpperCase() === row.label,
    );
    if (!match) {
      const labels = atLevel.map((c) => c.label).join(", ");
      refusals.push(
        `ligne ${row.line} : pas de ${row.class} « ${row.label} » dans cette ` +
          `école — classes existantes à ce niveau : ${labels}`,
      );
      continue;
    }
    resolved.push({ ...row, schoolClassId: match._id });
  }

  return { resolved, refusals };
}

/**
 * Ouvre un import : valide le collage, pèse les sièges, écrit le travail.
 *
 * ELLE NE CRÉE AUCUN COMPTE — elle écrit le job et ses lignes, puis planifie
 * l'action qui fera le travail. C'est ce qui permet au refus d'être total :
 * tant qu'on est dans cette mutation, rien n'est encore sorti de la
 * transaction, donc un refus ne laisse rien derrière lui.
 */
export const openImport = mutation({
  args: {
    schoolId: v.id("schools"),
    paste: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await callerAdminProfile(ctx);
    if (!actor) throw new ConvexError("Rôle non autorisé");

    const school = await ctx.db.get(args.schoolId);
    if (!school) throw new ConvexError("École introuvable");

    // UN SEUL IMPORT À LA FOIS PAR ÉCOLE. Deux imports concurrents pèseraient
    // chacun les sièges sans voir les élèves que l'autre est en train de créer,
    // et l'école dépasserait son contrat sans qu'aucun des deux n'ait tort.
    // `.order("desc").take(5)` et non `.collect()` : les guidelines du dépôt
    // l'interdisent, et un import en cours est forcément récent — il vient
    // d'être ouvert, ou il tourne encore.
    const recent = await ctx.db
      .query("studentImportJobs")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .order("desc")
      .take(5);
    const inFlight = recent.find(
      (j) => j.status === "pending" || j.status === "running",
    );
    if (inFlight) {
      throw new ConvexError(
        "Un import est déjà en cours pour cette école. Attendez qu'il " +
          "se termine avant d'en lancer un autre.",
      );
    }

    const parsed = parseImportPaste(args.paste);

    if (parsed.toolong) {
      throw new ConvexError(
        `Ce collage dépasse ${IMPORT_ROWS_LIMIT} élèves. Importez-le en ` +
          `plusieurs fois : le plafond protège la transaction, pas l'école.`,
      );
    }

    if (parsed.errors.length > 0) {
      const shown = parsed.errors
        .slice(0, REPORTED_ERRORS)
        .map((e) => `ligne ${e.line} : ${PARSE_ERROR_MESSAGES[e.reason]}`)
        .join(" ; ");
      const rest =
        parsed.errors.length > REPORTED_ERRORS
          ? ` (et ${parsed.errors.length - REPORTED_ERRORS} autre(s))`
          : "";
      throw new ConvexError(
        `Ce collage a ${pluralCount(parsed.errors.length, "ligne illisible", "lignes illisibles")}` +
          `, rien n'a été importé — ${shown}${rest}`,
      );
    }

    if (parsed.rows.length === 0) {
      throw new ConvexError("Ce collage ne contient aucun élève.");
    }

    // 300 ET NON 200 : `schools.createClass` autorise 50 classes PAR NIVEAU sur
    // six niveaux. Une borne plus basse tronquerait la liste d'une grande
    // école, et des lignes parfaitement valides seraient refusées au motif que
    // « l'école n'a aucune classe de CM1 » — un refus faux, impossible à
    // comprendre depuis l'écran.
    const classes = await ctx.db
      .query("schoolClasses")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .take(SCHOOL_CLASSES_LIMIT);

    const { resolved, refusals } = resolveRows(parsed.rows, classes);
    if (refusals.length > 0) {
      const shown = refusals.slice(0, REPORTED_ERRORS).join(" ; ");
      const rest =
        refusals.length > REPORTED_ERRORS
          ? ` (et ${refusals.length - REPORTED_ERRORS} autre(s))`
          : "";
      throw new ConvexError(
        `Des classes de ce collage n'existent pas dans l'école, rien n'a été ` +
          `importé — ${shown}${rest}`,
      );
    }

    const now = Date.now();

    // LE PLAFOND, UNE FOIS, SUR LE LOT ENTIER (spec §6.1 étape 3). Même
    // décompte que celui d'`enrollStudent`, par le même point d'entrée : deux
    // façons de compter les sièges finiraient par se contredire.
    const seats = await seatStateForSchool(ctx, args.schoolId, now);
    if (seats) {
      const free = Math.max(0, seats.purchased - seats.used);
      if (resolved.length > free) {
        const occupied = seats.atLeast
          ? `au moins ${pluralCount(seats.used, "siège occupé", "sièges occupés")}`
          : pluralCount(seats.used, "siège occupé", "sièges occupés");
        throw new ConvexError(
          `Cet import demande ${pluralCount(resolved.length, "siège", "sièges")} ` +
            `alors qu'il en reste ${pluralCount(free, "libre", "libres")} : ` +
            `${occupied} pour ${pluralCount(seats.purchased, "siège", "sièges")} ` +
            `au contrat. Rien n'a été importé — augmentez le nombre de sièges ` +
            `de l'abonnement, ou retirez des élèves de la liste.`,
        );
      }
    }

    const jobId = await ctx.db.insert("studentImportJobs", {
      schoolId: args.schoolId,
      createdBy: actor._id,
      totalRows: resolved.length,
      processedRows: 0,
      status: "pending",
      startedAt: now,
    });

    for (const row of resolved) {
      await ctx.db.insert("studentImportRows", {
        jobId,
        schoolClassId: row.schoolClassId,
        name: row.name,
        status: "pending",
      });
    }

    await ctx.scheduler.runAfter(0, internal.studentImportRun.processBatch, {
      jobId,
    });

    return { jobId, totalRows: resolved.length };
  },
});

// ---------------------------------------------------------------------------
// Lectures d'écran
// ---------------------------------------------------------------------------

/**
 * Le dernier import d'une école, avec sa progression.
 *
 * Une requête ne lève jamais : `null` pour un appelant sans droit, comme
 * partout dans ce parcours.
 */
export const latestJob = query({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, args) => {
    if (!(await callerAdminProfile(ctx))) return null;

    const jobs = await ctx.db
      .query("studentImportJobs")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .order("desc")
      .take(1);

    return jobs[0] ?? null;
  },
});

/**
 * Les billets d'un import — nom, classe, code de connexion, code parent.
 *
 * C'EST LA SEULE LECTURE QUI REND DES CODES, et elle est réservée à l'`admin`.
 * Un code de connexion EST le mot de passe initial (voir `initialPassword`
 * dans `studentImportRun.ts`) :
 * qui lit cette liste peut entrer dans chacun de ces comptes. Elle ne s'ouvre
 * donc pas aux professeurs, et le jour où une console directeur existera, elle
 * ne s'y ouvrira qu'à l'école concernée.
 */
export const jobTickets = query({
  args: { jobId: v.id("studentImportJobs") },
  handler: async (ctx, args) => {
    if (!(await callerAdminProfile(ctx))) return [];

    const job = await ctx.db.get(args.jobId);
    if (!job) return [];

    const rows = await ctx.db
      .query("studentImportRows")
      .withIndex("by_job_status", (q) => q.eq("jobId", args.jobId))
      .take(IMPORT_ROWS_LIMIT + 1);

    const tickets = await Promise.all(
      rows.map(async (row) => {
        const schoolClass = await ctx.db.get(row.schoolClassId);
        let parentCode: string | null = null;
        if (row.studentId) {
          const codes = await ctx.db
            .query("parentLinkCodes")
            .withIndex("by_student", (q) => q.eq("studentId", row.studentId!))
            .take(1);
          // L'alphabet du code est fait de majuscules et de chiffres : la
          // remise en majuscules restitue exactement la forme imprimable.
          parentCode = codes[0] ? codes[0].code.toUpperCase() : null;
        }
        return {
          _id: row._id,
          name: row.name,
          status: row.status,
          className: schoolClass
            ? `${schoolClass.class} ${schoolClass.label}`
            : "Classe inconnue",
          loginCode: row.loginCode ?? null,
          parentCode,
          failureReason: row.failureReason ?? null,
        };
      }),
    );

    return tickets;
  },
});

// ---------------------------------------------------------------------------
// Fonctions internes du traitement par lots
// ---------------------------------------------------------------------------

export const getJob = internalQuery({
  args: { jobId: v.id("studentImportJobs") },
  handler: async (ctx, args) => await ctx.db.get(args.jobId),
});

/** Le prochain lot de lignes à traiter, avec la classe de chacune. */
export const nextBatch = internalQuery({
  args: { jobId: v.id("studentImportJobs") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("studentImportRows")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "pending"),
      )
      .take(BATCH_SIZE);

    return await Promise.all(
      rows.map(async (row) => {
        const schoolClass = await ctx.db.get(row.schoolClassId);
        return {
          rowId: row._id,
          name: row.name,
          schoolClassId: row.schoolClassId,
          schoolId: schoolClass?.schoolId ?? null,
          level: schoolClass?.class ?? "",
          label: schoolClass?.label ?? "",
        };
      }),
    );
  },
});

/** Ce code de connexion est-il déjà pris ? Question de base, pas de logique. */
export const loginCodeTaken = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.code))
      .first();
    return existing !== null;
  },
});

export const parentCodeTaken = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("parentLinkCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    return existing !== null;
  },
});

/**
 * Scelle une ligne réussie — profil, inscription, code parent — EN UNE SEULE
 * TRANSACTION.
 *
 * C'est ce qui rend la reprise sûre. L'action, elle, n'est pas
 * transactionnelle : si elle meurt entre la création du compte et
 * l'inscription, la ligne reste `pending` et sera reprise. Le compte orphelin
 * qui subsiste alors est sans conséquence — il n'a ni inscription ni code, donc
 * aucun accès, et sa seule trace est un `users` inutilisable.
 */
export const commitRow = internalMutation({
  args: {
    rowId: v.id("studentImportRows"),
    studentUserId: v.id("users"),
    schoolClassId: v.id("schoolClasses"),
    loginCode: v.string(),
    parentCode: v.string(),
    actorProfileId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return;
    // Déjà scellée : une reprise ne redouble pas ce qui est fait.
    if (row.status !== "pending") return;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.studentUserId))
      .unique();
    if (!profile) {
      await ctx.db.patch(args.rowId, {
        status: "failed",
        failureReason: "Profil introuvable après création du compte",
      });
      return;
    }

    const schoolClass = await ctx.db.get(args.schoolClassId);
    if (!schoolClass) {
      await ctx.db.patch(args.rowId, {
        status: "failed",
        failureReason: "Classe supprimée pendant l'import",
      });
      return;
    }

    const now = Date.now();

    // Le niveau de l'élève suit sa classe d'inscription, comme dans
    // `schools.enrollStudent`.
    if (profile.class !== schoolClass.class) {
      await ctx.db.patch(profile._id, { class: schoolClass.class });
    }
    if (profile.name !== row.name) {
      await ctx.db.patch(profile._id, { name: row.name });
    }

    const membershipId = await ctx.db.insert("schoolMemberships", {
      schoolId: schoolClass.schoolId,
      studentId: profile._id,
      schoolClassId: schoolClass._id,
      status: "active",
      enrolledAt: now,
    });

    await ctx.db.insert("schoolMembershipEvents", {
      membershipId,
      studentId: profile._id,
      schoolId: schoolClass.schoolId,
      kind: "enrolled",
      actorProfileId: args.actorProfileId,
      at: now,
      toSchoolClassId: schoolClass._id,
    });

    // STOCKÉ NORMALISÉ, AFFICHÉ EN MAJUSCULES. `parentLinkCodes.code` est la clé
    // de comparaison : `parentLink.redeemCode` cherche par `normalizeCode` de ce
    // que le parent tape, et `parentCodeTaken` a vérifié l'unicité sur cette
    // même forme. Y ranger la forme imprimée rendrait tout code introuvable.
    await ctx.db.insert("parentLinkCodes", {
      studentId: profile._id,
      schoolId: schoolClass.schoolId,
      code: normalizeCode(args.parentCode),
      expiresAt: now + PARENT_CODE_TTL_MS,
    });

    await ctx.db.patch(args.rowId, {
      status: "created",
      studentId: profile._id,
      loginCode: args.loginCode,
    });
  },
});

export const failRow = internalMutation({
  args: {
    rowId: v.id("studentImportRows"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    if (!row || row.status !== "pending") return;
    await ctx.db.patch(args.rowId, {
      status: "failed",
      failureReason: args.reason,
    });
  },
});

/**
 * Avance le travail après un lot.
 *
 * `processedRows` se RECOMPTE au lieu de s'incrémenter : un incrément suppose
 * que chaque lot s'est exécuté exactement une fois, ce qu'une action qui peut
 * mourir et reprendre ne garantit pas. Le compte par index est juste quoi qu'il
 * arrive — même raisonnement que `readSeatState`, qui refuse de maintenir
 * `schoolSeatUsage` pour cette raison exacte.
 */
export const advanceJob = internalMutation({
  args: { jobId: v.id("studentImportJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return { remaining: 0 };

    const failed = await ctx.db
      .query("studentImportRows")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "failed"),
      )
      .take(IMPORT_ROWS_LIMIT + 1);

    // LES LIGNES `created` NE SE COMPTENT PAS : elles se déduisent. Une ligne
    // est `pending`, `created` ou `failed`, et `totalRows` est figé à
    // l'ouverture — une troisième lecture de jusqu'à 400 documents par lot ne
    // rendrait rien que cette soustraction ne donne déjà.
    const pending = await ctx.db
      .query("studentImportRows")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "pending"),
      )
      .take(IMPORT_ROWS_LIMIT + 1);
    const remaining = pending.length;
    const processedRows = job.totalRows - remaining;

    if (remaining > 0) {
      await ctx.db.patch(args.jobId, {
        status: "running",
        processedRows,
      });
      return { remaining };
    }

    await ctx.db.patch(args.jobId, {
      status: failed.length === 0 ? "completed" : "partial",
      processedRows,
      finishedAt: Date.now(),
      ...(failed.length > 0
        ? {
            errorMessage: `${pluralCount(failed.length, "élève n'a pas pu être créé", "élèves n'ont pas pu être créés")}.`,
          }
        : {}),
    });
    return { remaining: 0 };
  },
});
