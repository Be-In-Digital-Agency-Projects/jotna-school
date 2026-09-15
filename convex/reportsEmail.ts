"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Resend } from "resend";
import { generateReportEmailHtml } from "../lib/email-template";
import { wantsReportEmail } from "./profileRules";

// ---------------------------------------------------------------------------
// Internal Action — Send email via Resend (Node.js runtime)
//
// ELLE IGNORAIT LA CASE QUE L'ÉCRAN PARENT PROPOSE. « Recevoir les rapports par
// e-mail » se réglait, se rangeait dans `preferences.receiveReports` — et ne
// commandait rien : la boucle ci-dessous écrivait à TOUS les tuteurs porteurs
// d'une adresse. Décocher ne changeait rien, et le parent n'avait aucun moyen
// de s'en apercevoir autrement qu'en continuant de recevoir des courriels.
//
// LE FILTRE EST POSÉ ICI ET NON DANS `reports.getGuardians`, qui rend les
// tuteurs d'un élève et doit continuer de tous les rendre. La question « qui
// est tuteur » et la question « qui veut CE courriel-ci » sont distinctes, et
// les confondre ferait taire la seconde partout où la première sert. Le dépôt
// tranche d'ailleurs déjà ainsi : l'autre appelant de `getGuardians`,
// `regenNotificationEmail.sendRegenCapEmail`, envoie un courriel différent
// (« a besoin d'un coup de pouce ») et consulte SON PROPRE interrupteur,
// `parentLowScoreNotifEnabled`. Un courriel, une préférence.
//
// `emailSentAt` N'EST PLUS POSÉ QUAND RIEN N'EST PARTI. Deux écrans le lisent —
// bulletin parent et bulletin professeur — et en font un « E-mail : Envoyé le
// … » en vert, contre « Non envoyé » en gris. C'est donc un fait affiché à un
// humain, pas un drapeau de traitement : le poser sans envoi afficherait une
// date d'envoi pour un courriel que personne n'a reçu. Rien ne relit ce champ
// pour réessayer (aucun cron, aucune requête), donc ne pas le poser ne bloque
// aucune reprise — cela dit simplement la vérité.
// ---------------------------------------------------------------------------

export const sendEmail = internalAction({
  args: { reportId: v.id("topicReports") },
  handler: async (ctx, args) => {
    // Fetch the report
    const report = await ctx.runQuery(internal.reports.internalGetById, {
      id: args.reportId,
    });
    if (!report) {
      throw new Error("Rapport introuvable");
    }

    // Fetch the student profile
    const student = await ctx.runQuery(internal.reports.getStudentProfile, {
      id: report.studentId,
    });
    if (!student) {
      throw new Error("Profil étudiant introuvable");
    }

    // Fetch all guardians for the student
    const guardians = await ctx.runQuery(internal.reports.getGuardians, {
      studentId: report.studentId,
    });

    // Un destinataire est un tuteur qui a une adresse ET qui veut ce courriel.
    // Les deux conditions valent un même « non » : pas d'adresse, pas d'envoi ;
    // case décochée, pas d'envoi. Réunies ici, elles laissent un seul endroit
    // où la liste des destinataires se décide.
    type Guardian = (typeof guardians)[number];
    const recipients = guardians.filter(
      (g): g is Guardian & { email: string } =>
        !!g.email && wantsReportEmail(g.preferences),
    );

    if (recipients.length === 0) {
      return;
    }

    const reportDate = new Date().toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const html = generateReportEmailHtml({
      studentName: student.name,
      topicName: report.topicName,
      subjectName: report.subjectName,
      score: report.score,
      strengths: report.strengths,
      weaknesses: report.weaknesses,
      frequentMistakes: report.frequentMistakes,
      date: reportDate,
    });

    const resend = new Resend(process.env.RESEND_API_KEY);

    // Send to each recipient
    for (const guardian of recipients) {
      await resend.emails.send({
        from: "Jotna School <noreply@jotnaschool.app>",
        to: guardian.email,
        subject: `[Jotna School] Rapport - ${student.name} a terminé ${report.topicName}`,
        html,
      });
    }

    // Mark the email as sent
    await ctx.runMutation(internal.reports.markEmailSent, {
      reportId: args.reportId,
    });
  },
});
