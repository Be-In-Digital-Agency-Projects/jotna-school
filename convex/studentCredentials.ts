import { ConvexError, v } from "convex/values";
import { action, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getAuthUserId,
  invalidateSessions,
  modifyAccountCredentials,
} from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { buildLoginCode, normalizeCode } from "./importCodes";

// ---------------------------------------------------------------------------
// RÉINITIALISATION DU CODE D'UN ÉLÈVE — spec §6.2.
//
// UN ÉLÈVE À CODE NE PEUT PAS SE DÉPANNER SEUL, et c'est voulu. Son identifiant
// n'est pas une adresse : `ResendOTPPasswordReset` n'a nulle part où envoyer
// son courriel, donc « mot de passe oublié » échouera pour lui — comportement
// souhaitable à huit ans. C'est un adulte de son école qui le dépanne, ici.
//
// GARDE DE LIEN, PAS DE RÔLE (règle D17). Un `professeur` ne réinitialise que
// les élèves DE SES CLASSES, un `directeur` que ceux de SON école.
// Réinitialiser, c'est prendre la main sur le compte d'un enfant : le rôle seul
// laisserait tout le personnel de la plateforme le faire sur n'importe lequel.
// La branche TUTEUR de `callerMayReadStudent` est volontairement absente — un
// parent lit la progression de son enfant, il ne reprend pas la main sur son
// compte, sans quoi il pourrait l'en verrouiller dehors.
//
// ---------------------------------------------------------------------------
// COUPLAGE ASSUMÉ À `authAccounts`, ET VOICI POURQUOI IL EST NÉCESSAIRE
//
// `modifyAccountCredentials` NE SAIT PAS RENOMMER UN COMPTE. Vérifié dans
// `node_modules/@convex-dev/auth/dist/server/implementation/mutations/modifyAccount.js` :
// il cherche `authAccounts` par `providerAndAccountId`, LÈVE si le compte
// n'existe pas, et ne patche que `secret`. Il change donc le mot de passe d'un
// identifiant existant, jamais l'identifiant lui-même.
//
// Or chez ces élèves l'identifiant EST le secret : un seul code, sur un seul
// billet, parce qu'un enfant de huit ans ne retient pas deux choses. Ne
// remplacer que le secret laisserait circuler des billets dont la première
// ligne reste juste et la seconde fausse — l'enfant tape ce qu'il lit et
// n'entre pas, sans que personne comprenne pourquoi.
//
// On renomme donc `authAccounts.providerAccountId` à la main. C'est une table
// que le dépôt déclare lui-même (`authTables` dans `convex/schema.ts`), pas une
// base étrangère, mais son FORMAT appartient à la bibliothèque : si une montée
// de version change ce champ, c'est ici qu'il faudra revenir. Aucun autre
// endroit du dépôt n'y touche.
// ---------------------------------------------------------------------------

/** Inscriptions actives lues pour un élève — voir `access.callerMayReadStudent`. */
const STUDENT_MEMBERSHIPS_LIMIT = 4;

/** Lignes `schoolStaff` lues pour une école : direction plus corps enseignant. */
const STAFF_LIMIT = 100;

/** Essais de tirage avant d'abandonner — même borne que l'import. */
const CODE_ATTEMPTS = 12;

type ResetTarget = {
  studentName: string;
  level: string;
  label: string;
  /** `profiles.userId` — l'identifiant du COMPTE, pas celui du profil. */
  userId: string;
};

/**
 * L'élève sur lequel l'appelant a la main, ou `null`.
 *
 * Rend aussi le niveau et le libellé de sa classe : le nouveau code doit porter
 * le même préfixe que l'ancien, sans quoi les billets d'une classe cesseraient
 * de se ranger ensemble.
 */
export const resetTarget = internalQuery({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args): Promise<ResetTarget | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const caller = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!caller) return null;

    const student = await ctx.db.get(args.studentId);
    if (!student || student.role !== "student") return null;

    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_student_status", (q) =>
        q.eq("studentId", args.studentId).eq("status", "active"),
      )
      .take(STUDENT_MEMBERSHIPS_LIMIT);

    for (const membership of memberships) {
      const schoolClass = await ctx.db.get(membership.schoolClassId);
      if (!schoolClass) continue;

      let allowed =
        caller.role === "admin" || schoolClass.teacherId === caller._id;

      if (!allowed && caller.role === "directeur") {
        const staff = await ctx.db
          .query("schoolStaff")
          .withIndex("by_school", (q) => q.eq("schoolId", schoolClass.schoolId))
          .take(STAFF_LIMIT);
        allowed = staff.some(
          (row) =>
            row.profileId === caller._id &&
            row.staffRole === "directeur" &&
            row.status === "active",
        );
      }

      if (allowed) {
        return {
          studentName: student.name,
          level: schoolClass.class,
          label: schoolClass.label,
          userId: student.userId,
        };
      }
    }

    return null;
  },
});

/** Ce code de connexion est-il déjà pris ? Question de base, pas de logique. */
export const codeTaken = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.code))
      .first();
    return existing !== null;
  },
});

/**
 * Renomme le compte, EN UNE TRANSACTION, partout où l'identifiant est écrit.
 *
 * TROIS ENDROITS, ET LES TROIS COMPTENT. `authAccounts.providerAccountId` est
 * ce que la connexion compare ; `users.email` est ce que `profile()` écrit et
 * que le dépôt lit pour retrouver un compte ; la ligne d'import porte le code
 * IMPRIMÉ, que l'écran des billets relit. En oublier un laisserait un élève
 * introuvable, ou un écran proposant de réimprimer un billet mort.
 *
 * Elle rend l'ANCIEN identifiant : l'action en a besoin pour savoir sur quel
 * compte poser le nouveau secret si le renommage a déjà eu lieu.
 */
export const renameAccount = internalMutation({
  args: {
    studentId: v.id("profiles"),
    userId: v.id("users"),
    normalized: v.string(),
    printable: v.string(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", args.userId).eq("provider", "password"),
      )
      .unique();
    if (!account) {
      throw new ConvexError(
        "Ce compte n'a pas d'identifiant par code : rien à réinitialiser.",
      );
    }

    // Personne d'autre ne doit porter ce code. Le tirage l'a déjà vérifié
    // contre `users`, mais entre le tirage et ici, une transaction a pu passer.
    const clash = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", args.normalized),
      )
      .unique();
    if (clash && clash._id !== account._id) {
      throw new ConvexError("Ce code vient d'être attribué. Réessayez.");
    }

    await ctx.db.patch(account._id, { providerAccountId: args.normalized });
    await ctx.db.patch(args.userId, { email: args.normalized });

    const rows = await ctx.db
      .query("studentImportRows")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .take(5);
    for (const row of rows) {
      await ctx.db.patch(row._id, { loginCode: args.printable });
    }
  },
});

/**
 * Donne un nouveau code de connexion à un élève, et coupe ses sessions.
 *
 * Une ACTION parce que `modifyAccountCredentials` et `invalidateSessions`
 * n'existent que là — même contrainte que `createAccount`, pour la même raison.
 *
 * ELLE REND LE CODE EN CLAIR, UNE FOIS. C'est le seul moment où il est lisible :
 * le secret est haché à l'enregistrement, donc personne, pas même un
 * administrateur, ne pourra le relire. L'écran doit le montrer jusqu'à ce que
 * l'adulte l'ait noté.
 *
 * FENÊTRE CONNUE : le renommage et le nouveau secret sont deux écritures, et une
 * action n'est pas transactionnelle. Si la seconde échoue, le compte porte le
 * nouvel identifiant et l'ANCIEN secret — l'enfant ne peut entrer avec aucun des
 * deux billets. RELANCER LA RÉINITIALISATION RÉPARE : le renommage retombe sur
 * le même compte (la garde de collision l'autorise explicitement), et le secret
 * est reposé. C'est pourquoi l'échec ne laisse jamais de compte inaccessible
 * DÉFINITIVEMENT — seulement jusqu'au prochain clic.
 *
 * LES SESSIONS OUVERTES SONT COUPÉES EN DERNIER. On réinitialise parce qu'un
 * code a fuité ou qu'un enfant l'a perdu : laisser vivre les sessions déjà
 * ouvertes laisserait entrer celui à qui on retire l'accès.
 */
export const resetStudentLoginCode = action({
  args: { studentId: v.id("profiles") },
  handler: async (
    ctx,
    args,
  ): Promise<{ studentName: string; loginCode: string }> => {
    const target = await ctx.runQuery(internal.studentCredentials.resetTarget, {
      studentId: args.studentId,
    });
    if (!target) {
      // Un élève hors de portée est INTROUVABLE, jamais « non autorisé » :
      // distinguer les deux renseignerait sur qui est inscrit où.
      throw new ConvexError(
        "Élève introuvable, ou hors des classes dont vous avez la charge.",
      );
    }

    let printable: string | null = null;
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const candidate = buildLoginCode(
        target.level,
        target.label,
        (min, max) => min + Math.floor(Math.random() * (max - min + 1)),
      );
      const taken = await ctx.runQuery(internal.studentCredentials.codeTaken, {
        code: normalizeCode(candidate),
      });
      if (!taken) {
        printable = candidate;
        break;
      }
    }
    if (printable === null) {
      throw new ConvexError(
        "Aucun code libre n'a pu être tiré pour cette classe. Réessayez.",
      );
    }

    const normalized = normalizeCode(printable);
    const userId = target.userId as Id<"users">;

    // RENOMMER D'ABORD, POSER LE SECRET ENSUITE. `modifyAccountCredentials`
    // cherche le compte par son identifiant : appelé avant le renommage, il
    // écrirait le nouveau secret sur l'ANCIEN identifiant, et le renommage qui
    // suivrait laisserait un billet dont les deux lignes sont fausses au lieu
    // d'une. Dans cet ordre-ci, l'échec intermédiaire est réparable d'un clic.
    await ctx.runMutation(internal.studentCredentials.renameAccount, {
      studentId: args.studentId,
      userId,
      normalized,
      printable,
    });

    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: normalized, secret: printable },
    });

    await invalidateSessions(ctx, { userId });

    return { studentName: target.studentName, loginCode: printable };
  },
});
