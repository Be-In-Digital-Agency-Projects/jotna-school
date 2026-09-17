"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Resend } from "resend";

import {
  checkIssuer,
  formatFcfa,
  formatInvoiceDate,
  invoiceLineLabel,
  issuerMissingMessage,
} from "./invoiceRules";
import { generateInvoiceEmailHtml } from "../lib/invoice-email-template";

// ---------------------------------------------------------------------------
// L'ENVOI DE LA FACTURE — le canal, pas la pièce comptable.
//
// SÉPARÉ DE `billing.ts` POUR DEUX RAISONS. `"use node"` fait basculer tout le
// module dans le runtime Node, et rien de ce qui décide de l'encaissement ne
// doit en dépendre. Et la facture EXISTE déjà quand ce module s'exécute :
// `billing.creditInstallment` l'a écrite dans la transaction qui a soldé la
// tranche. Ici on ne fait que la porter jusqu'à l'école.
//
// IL NE CONTIENT QU'UNE ACTION, ET IL N'A PAS LE CHOIX : Convex refuse une
// requête ou une mutation dans un module Node — « Only actions can be defined
// in Node.js ». Les lectures et le marquage de l'envoi vivent donc dans
// `convex/invoices.ts`.
//
// UN ÉCHEC D'ENVOI N'EFFACE PAS LA FACTURE. Il s'écrit sur sa ligne
// (`failureReason`) et se journalise. Une pièce comptable ne dépend pas de la
// disponibilité d'un service de messagerie, et une école qui n'a pas reçu son
// courriel doit pouvoir se le faire renvoyer plutôt que de voir sa facture
// disparaître.
// ---------------------------------------------------------------------------

/**
 * Envoie la facture à l'école.
 *
 * REFUSE D'ENVOYER SANS IDENTITÉ D'ÉMETTEUR, et c'est le point le plus
 * important de ce module. Une facture porte la raison sociale et le NINEA de
 * celui qui l'émet ; sans eux, le document n'est pas une facture mais un
 * courriel qui en a l'air, et l'école ne pourra ni le comptabiliser ni le
 * produire à un contrôle. Lui envoyer quand même serait pire que ne rien
 * envoyer : elle croirait tenir une pièce valable.
 *
 * Le motif s'écrit alors sur la facture et dans le journal, avec le nom des
 * variables à poser. La facture, elle, reste émise : son numéro est déjà
 * consommé dans une suite qui doit rester sans trou.
 *
 * N'ENVOIE PAS DEUX FOIS. `alreadySent` garde le rejeu, qu'il vienne du
 * planificateur ou d'un renvoi manuel : une école qui reçoit deux fois la même
 * facture ne sait plus si elle doit deux fois.
 */
export const sendInvoice = internalAction({
  args: { invoiceId: v.id("invoices") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.invoices.invoiceContext, {
      invoiceId: args.invoiceId,
    });
    if (!data) {
      console.error("[facture] facture introuvable", args.invoiceId);
      return null;
    }
    if (data.alreadySent) return null;

    const issuer = checkIssuer({
      name: process.env.INVOICE_ISSUER_NAME,
      ninea: process.env.INVOICE_ISSUER_NINEA,
      address: process.env.INVOICE_ISSUER_ADDRESS,
      email: process.env.INVOICE_ISSUER_EMAIL,
    });
    if (!issuer.ok) {
      const reason = issuerMissingMessage(issuer.missing);
      console.error("[facture]", data.number, reason);
      await ctx.runMutation(internal.invoices.recordDelivery, {
        invoiceId: args.invoiceId,
        failureReason: reason,
      });
      return null;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      const reason =
        "Facture non envoyée : RESEND_API_KEY absente de ce déploiement.";
      console.error("[facture]", data.number, reason);
      await ctx.runMutation(internal.invoices.recordDelivery, {
        invoiceId: args.invoiceId,
        failureReason: reason,
      });
      return null;
    }

    const html = generateInvoiceEmailHtml({
      issuer: issuer.issuer,
      number: data.number,
      issuedAt: formatInvoiceDate(data.issuedAt),
      school: {
        name: data.schoolName,
        city: data.schoolCity,
        contactName: data.schoolContactName,
        ninea: data.schoolNinea,
      },
      lineLabel: invoiceLineLabel({
        index: data.installmentIndex,
        total: data.installmentCount,
        seats: data.seats,
        periodStart: formatInvoiceDate(data.periodStart),
        periodEnd: formatInvoiceDate(data.periodEnd),
      }),
      amount: formatFcfa(data.amountFcfa),
      contractTotal: formatFcfa(data.contractTotalFcfa),
    });

    try {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: `${issuer.issuer.name} <onboarding@resend.dev>`,
        replyTo: issuer.issuer.email,
        to: data.recipientEmail,
        subject: `Facture ${data.number} — ${data.schoolName}`,
        html,
      });
      await ctx.runMutation(internal.invoices.recordDelivery, {
        invoiceId: args.invoiceId,
        sentAt: Date.now(),
      });
    } catch (err: unknown) {
      const reason = `Envoi impossible : ${
        err instanceof Error ? err.message : "erreur inconnue"
      }`;
      console.error("[facture]", data.number, reason);
      await ctx.runMutation(internal.invoices.recordDelivery, {
        invoiceId: args.invoiceId,
        failureReason: reason.slice(0, 300),
      });
    }

    return null;
  },
});
