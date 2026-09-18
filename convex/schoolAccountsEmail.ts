"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { Resend } from "resend";
import { generateActivationEmailHtml } from "../lib/activation-email-template";

// ---------------------------------------------------------------------------
// L'E-MAIL D'ACTIVATION — le canal, pas la décision.
//
// SÉPARÉ DE `schoolAccounts.ts` POUR LA MÊME RAISON QUE `linkRequestsEmail.ts`
// l'est de `linkRequests.ts` : `"use node"` fait basculer tout le module dans le
// runtime Node, et rien de ce qui décide ne doit en dépendre.
//
// IL NE FAIT PAS ÉCHOUER LA CRÉATION. Il est appelé par le planificateur, après
// que le compte et son code sont en base et que l'école les a sous les yeux. Une
// adresse mal saisie, une boîte pleine ou un filtre ne doivent pas effacer un
// travail déjà fait : l'école dicte le code au téléphone.
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<string, string> = {
  directeur: "directeur",
  professeur: "professeur",
  parent: "parent",
};

export const sendActivationEmail = internalAction({
  args: {
    to: v.string(),
    recipientName: v.string(),
    schoolName: v.string(),
    loginId: v.string(),
    activationCode: v.string(),
    role: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      // Journalisé, pas levé : le code est en base et l'école le voit.
      console.error(
        "[schoolAccounts] RESEND_API_KEY absente, activation non envoyée",
        args.to,
      );
      return null;
    }

    const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
    const activationUrl = `${siteUrl}/activation?code=${encodeURIComponent(args.activationCode)}`;

    const html = generateActivationEmailHtml({
      recipientName: args.recipientName,
      schoolName: args.schoolName,
      roleLabel: ROLE_LABEL[args.role] ?? args.role,
      loginId: args.loginId,
      activationCode: args.activationCode,
      activationUrl,
    });

    try {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: "Jotna School <onboarding@resend.dev>",
        to: args.to,
        subject: `${args.schoolName} vous a créé un compte Jotna School`,
        html,
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : "erreur inconnue";
      console.error(
        "[schoolAccounts] envoi de l'activation impossible",
        args.to,
        reason.slice(0, 200),
      );
    }

    return null;
  },
});
