import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { decideLinkChild } from "./linkRules";
import { normalizeCode } from "./importCodes";

// ---------------------------------------------------------------------------
// RATTACHEMENT D'UN PARENT PAR CODE — spec §6.3.
//
// POURQUOI PAS `linkRequests`. Le mécanisme existant part du PARENT, cherche
// l'élève par son adresse de courriel, et lui envoie un jeton de 48 h. Rien de
// cela ne marche ici : un élève créé par une école n'a pas d'adresse — son
// identifiant est un code de connexion — et le SENS est inversé. C'est l'école
// qui pré-autorise, en imprimant un code sur le billet remis à la famille ; le
// parent ne demande pas, il consomme.
//
// CE QU'ON N'A PAS EU À ÉCRIRE. La consommation insère un `studentGuardians`
// de relation `parent` — le lien que tout l'espace parent lit déjà. Tableau de
// bord, bulletins, sélecteur d'enfant : rien n'a besoin d'être touché.
//
// L'AUTORISATION EST LE CODE LUI-MÊME, et c'est ce qui distingue ce chemin de
// `profiles.linkChild`, resté interne au plan 1/3 faute de preuve de droit.
// Ici la preuve existe : un secret de 148 millions de valeurs, remis en main
// propre par l'école, à usage unique et daté. `decideLinkChild` reste consulté
// par-dessus — elle dit QUI peut déclarer QUELLE relation, question que le code
// ne tranche pas.
// ---------------------------------------------------------------------------

/** Liens lus pour un tuteur — au-delà, la question du doublon change d'échelle. */
const GUARDIAN_LINKS_LIMIT = 200;

/**
 * Regarde un code sans le consommer, pour que l'écran confirme AVANT d'agir.
 *
 * Un parent qui tape un code veut voir le prénom de son enfant s'afficher avant
 * de valider : c'est ce qui rattrape une faute de frappe qui tomberait par
 * malchance sur un code valide d'un autre élève. Le rattachement est
 * difficilement réversible — rien dans le dépôt ne défait un `studentGuardians`
 * — donc la confirmation n'est pas du confort.
 *
 * ELLE NE REND QUE LE PRÉNOM, jamais l'identifiant de l'élève ni sa classe : un
 * code juste suffit à lire ce nom, et il n'y a pas de raison d'en dire plus à
 * qui n'a pas encore prouvé qu'il est le bon parent. Une requête ne lève
 * jamais : `null` couvre l'inconnu comme le périmé.
 */
export const previewCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const normalized = normalizeCode(args.code);
    if (normalized === "") return null;

    // `.first()` ET NON `.unique()` : une REQUÊTE ne lève jamais (convention du
    // dépôt), et `.unique()` lève sur un doublon. L'unicité est vérifiée à
    // l'émission ; si elle était malgré tout violée, mieux vaut un écran qui
    // montre un enfant qu'un écran qui casse. La mutation, elle, garde
    // `.unique()` — c'est là que l'invariant doit se faire entendre.
    const link = await ctx.db
      .query("parentLinkCodes")
      .withIndex("by_code", (q) => q.eq("code", normalized))
      .first();
    if (!link) return null;
    if (link.redeemedBy) return { status: "redeemed" as const, name: null };
    if (link.expiresAt <= Date.now()) {
      return { status: "expired" as const, name: null };
    }

    const student = await ctx.db.get(link.studentId);
    if (!student) return null;

    return { status: "ready" as const, name: student.name };
  },
});

/**
 * Consomme un code et crée le lien — usage unique, dans UNE transaction.
 *
 * `redeemedBy` et `redeemedAt` sont posés dans la même transaction que
 * l'insertion du lien, jamais après : les écrire ensuite ouvrirait la fenêtre
 * où deux parents consomment le même code, et Convex sérialise les
 * transactions précisément pour qu'on n'ait pas à y penser.
 *
 * LES REFUS SE DISTINGUENT, à dessein. « Code inconnu », « déjà utilisé » et
 * « expiré » appellent trois gestes différents — retaper, demander à l'autre
 * parent, en redemander un à l'école — et les confondre en un « code invalide »
 * laisserait la famille sans savoir quoi faire. Rien n'est divulgué pour
 * autant : ces réponses ne valent que pour qui tient déjà un code, et l'espace
 * de codes se compte en centaines de millions.
 */
export const redeemCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Non authentifié");

    const guardian = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!guardian) throw new ConvexError("Profil introuvable");

    const normalized = normalizeCode(args.code);
    if (normalized === "") {
      throw new ConvexError("Saisissez le code inscrit sur le billet.");
    }

    const link = await ctx.db
      .query("parentLinkCodes")
      .withIndex("by_code", (q) => q.eq("code", normalized))
      .unique();
    if (!link) {
      throw new ConvexError(
        "Ce code n'existe pas. Vérifiez les caractères du billet — il ne " +
          "contient ni O ni I ni zéro, que des lettres et des chiffres nets.",
      );
    }

    if (link.redeemedBy) {
      throw new ConvexError(
        link.redeemedBy === guardian._id
          ? "Vous avez déjà utilisé ce code : cet enfant figure dans votre espace."
          : "Ce code a déjà été utilisé par un autre adulte de la famille. " +
            "Demandez-en un nouveau à l'école si vous devez y accéder aussi.",
      );
    }

    const now = Date.now();
    if (link.expiresAt <= now) {
      throw new ConvexError(
        "Ce code a expiré. L'école peut en imprimer un nouveau.",
      );
    }

    const student = await ctx.db.get(link.studentId);

    // La règle de rattachement reste celle du dépôt : elle dit qui peut
    // déclarer quelle relation, question que la possession du code ne tranche
    // pas. Un compte élève qui taperait le code de son voisin est refusé ici.
    const decision = decideLinkChild({
      guardianRole: guardian.role,
      relation: "parent",
      targetRole: student?.role ?? null,
    });
    if (!decision.ok) {
      throw new ConvexError(
        decision.reason === "target_not_student"
          ? "Ce code ne désigne plus un élève."
          : "Seul un compte parent peut rattacher un enfant.",
      );
    }

    const existing = await ctx.db
      .query("studentGuardians")
      .withIndex("by_guardianId", (q) => q.eq("guardianId", guardian._id))
      .take(GUARDIAN_LINKS_LIMIT);
    if (existing.some((l) => l.studentId === link.studentId)) {
      // Le code est bon et le lien existe déjà : on le consomme quand même,
      // sinon il resterait utilisable par un tiers alors qu'il a servi.
      await ctx.db.patch(link._id, {
        redeemedBy: guardian._id,
        redeemedAt: now,
      });
      throw new ConvexError(
        "Cet enfant figure déjà dans votre espace — rien n'a été modifié.",
      );
    }

    await ctx.db.insert("studentGuardians", {
      studentId: link.studentId,
      guardianId: guardian._id,
      relation: "parent",
    });

    await ctx.db.patch(link._id, {
      redeemedBy: guardian._id,
      redeemedAt: now,
    });

    return { studentName: student?.name ?? "" };
  },
});
