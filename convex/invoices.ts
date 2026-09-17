import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { callerAuthorityOverSchool } from "./access";

// ---------------------------------------------------------------------------
// LES DONNÉES DE LA FACTURE — lectures et écritures, runtime Convex.
//
// SÉPARÉ DE `billingInvoice.ts` PAR UNE CONTRAINTE DE LA PLATEFORME, pas par
// goût : un module `"use node"` ne peut contenir QUE des actions, et Convex
// refuse le déploiement sinon — « Only actions can be defined in Node.js ».
// C'est le même découpage que `linkRequests.ts` et `linkRequestsEmail.ts`.
//
// SÉPARÉ DE `billing.ts` AUSSI, et là c'est un choix : `billing.ts` décide de
// l'encaissement, ce module ne fait que servir la pièce comptable qui en
// découle. La facture y est ÉMISE (`creditInstallment`), elle est lue et
// marquée ici.
// ---------------------------------------------------------------------------

/** Ce qu'il faut savoir pour rédiger la facture, en une seule lecture. */
export const invoiceContext = internalQuery({
  args: { invoiceId: v.id("invoices") },
  returns: v.union(
    v.object({
      number: v.string(),
      issuedAt: v.number(),
      amountFcfa: v.number(),
      recipientEmail: v.string(),
      alreadySent: v.boolean(),
      schoolName: v.string(),
      schoolCity: v.union(v.string(), v.null()),
      schoolContactName: v.string(),
      schoolNinea: v.union(v.string(), v.null()),
      installmentIndex: v.number(),
      installmentCount: v.number(),
      seats: v.number(),
      periodStart: v.number(),
      periodEnd: v.number(),
      contractTotalFcfa: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return null;

    const school = await ctx.db.get(invoice.schoolId);
    const contract = await ctx.db.get(invoice.subscriptionId);
    const installment = await ctx.db.get(invoice.installmentId);
    if (!school || !contract || !installment) return null;

    // Le nombre de tranches du contrat : « tranche 2 sur 3 » n'a de sens que si
    // l'école voit le dénominateur. Trois par contrat aujourd'hui
    // (`billingRules.planInstallments`), la borne laisse de la marge.
    const siblings = await ctx.db
      .query("installments")
      .withIndex("by_subscription_index", (q) =>
        q.eq("subscriptionId", invoice.subscriptionId),
      )
      .take(24);

    return {
      number: invoice.number,
      issuedAt: invoice.issuedAt,
      amountFcfa: invoice.amountFcfa,
      recipientEmail: invoice.recipientEmail,
      alreadySent: invoice.sentAt !== undefined,
      schoolName: school.name,
      schoolCity: school.city ?? null,
      schoolContactName: school.contactName,
      schoolNinea: school.ninea ?? null,
      installmentIndex: installment.index,
      installmentCount: siblings.length,
      seats: contract.seatsPurchased,
      periodStart: contract.startsAt,
      periodEnd: contract.endsAt,
      contractTotalFcfa: contract.totalFcfa,
    };
  },
});

/**
 * Inscrit le sort de l'envoi sur la facture.
 *
 * UN SUCCÈS EFFACE LE MOTIF D'ÉCHEC, et l'oublier était un bug : une facture
 * d'abord refusée faute d'identité d'émetteur, puis renvoyée avec succès,
 * portait à la fois `sentAt` et « Facture non envoyée : … ». La ligne disait
 * deux choses contradictoires, et tout écran qui la lit aurait affiché
 * l'échec périmé à une école dont la facture est bel et bien partie.
 *
 * `failureReason: undefined` RETIRE le champ dans un `patch` Convex — c'est ce
 * qui distingue « ce renvoi a réussi » de « ce renvoi n'a rien dit du passé ».
 * L'inverse, laisser le champ tel quel, ferait dépendre la vérité de l'ordre
 * des tentatives.
 */
export const recordDelivery = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    sentAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.sentAt !== undefined) {
      await ctx.db.patch(args.invoiceId, {
        sentAt: args.sentAt,
        failureReason: undefined,
      });
      return null;
    }

    await ctx.db.patch(args.invoiceId, {
      ...(args.failureReason !== undefined
        ? { failureReason: args.failureReason }
        : {}),
    });
    return null;
  },
});

/** Factures lues pour une école. Trois par contrat, un contrat par an. */
const INVOICES_PER_SCHOOL_LIMIT = 200;

/**
 * Les factures d'une école, de la plus récente à la plus ancienne.
 *
 * MÊME GARDE QUE LE RESTE DE L'ESPACE DIRECTION : `callerAuthorityOverSchool`
 * laisse passer l'`admin` de la plateforme et le directeur de CETTE école, et
 * personne d'autre. Une facture nomme un montant versé et un identifiant
 * fiscal ; elle n'a pas à se lire depuis l'école voisine.
 *
 * LE MOTIF D'ÉCHEC N'EST RENDU QU'À LA PLATEFORME, et ce n'est pas de la
 * pudeur. Quand une facture ne part pas, la cause est chez NOUS — identité
 * d'émetteur non configurée, clé Resend absente, service indisponible — et
 * l'école ne peut rien y faire. Lui afficher « facture non envoyée :
 * INVOICE_ISSUER_NINEA manquante » l'inquiéterait sur une panne qui ne lui
 * appartient pas, et lui ferait lire le nom de nos variables d'environnement.
 * Elle voit donc l'état — envoyée ou en attente — et l'administration voit
 * pourquoi.
 */
export const listForSchool = query({
  args: { schoolId: v.id("schools") },
  returns: v.array(
    v.object({
      invoiceId: v.id("invoices"),
      number: v.string(),
      issuedAt: v.number(),
      amountFcfa: v.number(),
      installmentIndex: v.number(),
      recipientEmail: v.string(),
      delivery: v.union(v.literal("sent"), v.literal("pending")),
      sentAt: v.union(v.number(), v.null()),
      /** Renseigné pour l'`admin` seulement ; `null` pour un directeur. */
      failureReason: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const authority = await callerAuthorityOverSchool(ctx, args.schoolId);
    if (!authority) return [];

    const rows = await ctx.db
      .query("invoices")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .take(INVOICES_PER_SCHOOL_LIMIT);

    const out = await Promise.all(
      rows.map(async (row) => {
        const installment = await ctx.db.get(row.installmentId);
        return {
          invoiceId: row._id,
          number: row.number,
          issuedAt: row.issuedAt,
          amountFcfa: row.amountFcfa,
          installmentIndex: installment?.index ?? 0,
          recipientEmail: row.recipientEmail,
          delivery: (row.sentAt !== undefined ? "sent" : "pending") as
            | "sent"
            | "pending",
          sentAt: row.sentAt ?? null,
          failureReason: authority.platformWide
            ? (row.failureReason ?? null)
            : null,
        };
      }),
    );

    return out.sort((a, b) => b.issuedAt - a.issuedAt);
  },
});
