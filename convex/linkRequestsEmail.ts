"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Resend } from "resend";
import { generateLinkRequestEmailHtml } from "../lib/link-request-email-template";

export const sendLinkRequestEmail = internalAction({
  args: { requestId: v.id("linkRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(
      internal.linkRequests.internalGetById,
      { id: args.requestId },
    );
    if (!request) {
      throw new Error("Demande introuvable");
    }

    const studentEmail: string | null = await ctx.runQuery(
      internal.linkRequests.internalGetStudentEmail,
      { studentId: request.studentId },
    );
    if (!studentEmail) {
      throw new Error("Email de l'eleve introuvable");
    }

    const parentName: string = await ctx.runQuery(
      internal.linkRequests.internalGetParentName,
      { parentId: request.parentId },
    );

    const studentProfile = await ctx.runQuery(
      internal.linkRequests.internalGetStudentName,
      { studentId: request.studentId },
    );

    const siteUrl =
      process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "https://impartial-ermine-150.convex.site";
    const acceptUrl = `${siteUrl}/link-response?token=${request.token}&action=accept`;
    const rejectUrl = `${siteUrl}/link-response?token=${request.token}&action=reject`;

    const html = generateLinkRequestEmailHtml({
      logoUrl: process.env.EMAIL_LOGO_URL,
      parentName,
      studentName: studentProfile ?? "Eleve",
      acceptUrl,
      rejectUrl,
    });

    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: "Jotna School <noreply@jotnaschool.app>",
      to: studentEmail,
      subject: `[Jotna School] ${parentName} souhaite se lier a ton compte`,
      html,
    });
  },
});
