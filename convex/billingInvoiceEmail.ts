"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Resend } from "resend";
import { generateInvoiceEmailHtml } from "../lib/invoice-email-template";

// ---------------------------------------------------------------------------
// LE REÇU D'UNE TRANCHE SOLDÉE — un courriel, et rien d'autre.
//
// UN SEUL DÉCLENCHEUR : `billing.creditInstallment`, qui est le seul endroit du
// dépôt où une tranche passe à « réglée ». Le webhook du prestataire et le
// règlement constaté à la main y passent tous les deux, donc les deux donnent
// lieu au même reçu — c'est voulu, et c'est la règle D18.
//
// ELLE NE LÈVE JAMAIS. Un reçu qui n'est pas parti est ennuyeux ; une exception
// ici ferait réessayer l'ordonnanceur sans fin sur une tranche pourtant bien
// encaissée. On journalise et on s'arrête.
// ---------------------------------------------------------------------------

/** Le moyen de paiement, dit à un comptable plutôt qu'à une machine. */
const METHOD_LABEL: Record<string, string> = {
  bictorys: "Paiement en ligne",
  paydunya: "Paiement en ligne",
  manual: "Règlement constaté hors ligne",
};

export const sendInvoiceEmail = internalAction({
  args: { installmentId: v.id("installments") },
  handler: async (ctx, args): Promise<{ sent: boolean; reason?: string }> => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      // Déploiement sans messagerie : la tranche reste soldée, l'accès ouvert.
      console.error("[billing] RESEND_API_KEY absente, reçu non envoyé");
      return { sent: false, reason: "resend_not_configured" };
    }

    const data = await ctx.runQuery(internal.billing.invoiceEmailData, {
      installmentId: args.installmentId,
    });
    if (!data) {
      console.error(
        "[billing] reçu impossible à composer",
        args.installmentId,
      );
      return { sent: false, reason: "data_missing" };
    }

    if (!data.contactEmail) {
      return { sent: false, reason: "no_contact_email" };
    }

    const html = generateInvoiceEmailHtml({
      schoolName: data.schoolName,
      contactName: data.contactName,
      ...(data.ninea ? { ninea: data.ninea } : {}),
      installmentIndex: data.installmentIndex,
      amountFcfa: data.amountFcfa,
      paidAt: data.paidAt,
      seatsPurchased: data.seatsPurchased,
      activeStudents: data.activeStudents,
      methodLabel: METHOD_LABEL[data.provider] ?? "Paiement",
      reference: data.providerToken,
    });

    try {
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from: "Jotna School <noreply@jotnaschool.app>",
        to: data.contactEmail,
        subject: `[Jotna School] Reçu de paiement - tranche ${data.installmentIndex}`,
        html,
      });
      if (error) {
        console.error("[billing] Resend a refusé le reçu", error.message);
        return { sent: false, reason: error.message };
      }
      return { sent: true };
    } catch (e) {
      console.error("[billing] envoi du reçu impossible", String(e));
      return { sent: false, reason: "send_failed" };
    }
  },
});
