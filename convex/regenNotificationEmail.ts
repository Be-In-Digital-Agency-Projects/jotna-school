"use node";

import { internalAction } from "./_generated/server";
import { EMAIL_FROM } from "../lib/email-brand";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Resend } from "resend";
import { generateRegenNotificationEmailHtml } from "../lib/regen-notification-email-template";

export const sendRegenCapEmail = internalAction({
  args: {
    studentId: v.id("profiles"),
    studentName: v.string(),
    topicName: v.string(),
    subjectName: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.RESEND_API_KEY) {
      console.warn("RESEND_API_KEY not set, skipping regen notification");
      return { sent: false, reason: "no_api_key" };
    }

    const guardians = await ctx.runQuery(internal.reports.getGuardians, {
      studentId: args.studentId,
    });

    if (guardians.length === 0) {
      return { sent: false, reason: "no_guardians" };
    }

    const html = generateRegenNotificationEmailHtml({
      logoUrl: process.env.EMAIL_LOGO_URL,
      studentName: args.studentName,
      topicName: args.topicName,
      subjectName: args.subjectName,
    });

    const resend = new Resend(process.env.RESEND_API_KEY);
    let sentCount = 0;

    for (const guardian of guardians) {
      if (!guardian.email) continue;

      const settings = await ctx.runQuery(
        internal.paliers.index.getParentNotifSetting,
        { parentId: guardian._id, kidId: args.studentId },
      );
      if (settings?.parentLowScoreNotifEnabled === false) continue;

      try {
        await resend.emails.send({
          from: EMAIL_FROM,
          to: guardian.email,
          subject: `[Jotna School] ${args.studentName} a besoin d'un coup de pouce en ${args.subjectName}`,
          html,
        });
        sentCount++;
      } catch (err) {
        console.error(`Failed to send regen notification to ${guardian.email}:`, err);
      }
    }

    if (sentCount > 0) {
      await ctx.runMutation(internal.paliers.index.markParentNotified, {
        studentId: args.studentId,
      });
    }

    return { sent: sentCount > 0, sentCount };
  },
});
