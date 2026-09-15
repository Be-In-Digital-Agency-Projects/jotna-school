/**
 * Convex cron jobs.
 *
 * Decision 77: weekly purge of `palierAttemptHistory` rows older than 30 days.
 */

import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

export const purgeOldHistory = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    deleted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const result = await ctx.db
      .query("palierAttemptHistory")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .paginate({
        numItems: BATCH_SIZE,
        cursor: args.cursor ?? null,
      });

    let deleted = args.deleted ?? 0;
    for (const row of result.page) {
      await ctx.db.delete(row._id);
      deleted++;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.crons.purgeOldHistory, {
        cursor: result.continueCursor,
        deleted,
      });
    }
    return { deleted, isDone: result.isDone };
  },
});

const crons = cronJobs();

// Run every Monday at 03:00 UTC.
crons.cron(
  "purge palierAttemptHistory > 30d",
  "0 3 * * 1",
  internal.crons.purgeOldHistory,
  {},
);

// D7b — daily streak rollover at 00:05 Africa/Dakar (UTC+0).
// Resets streaks for kids who skipped a day (and have no freeze available).
crons.cron(
  "daily streak rollover",
  "5 0 * * *",
  internal.streak.dailyStreakRollover,
  {},
);

// Spec §8.6 — les tranches échues, une fois par jour.
//
// 02:30 UTC : une heure creuse au Sénégal (UTC+0), et à l'écart des deux autres
// tâches pour qu'aucune ne se dispute une transaction avec les suivantes.
//
// UNE FOIS PAR JOUR SUFFIT, et plus serait faux : la grâce se compte en jours
// (vingt et un), et une école qui passe en retard à 2 h 30 plutôt qu'à l'instant
// exact de son échéance ne perd rien — c'est même dans son sens.
//
// `crons.cron` et non les helpers `daily`/`weekly`, que les guidelines
// interdisent et que ce fichier évite déjà.
crons.cron(
  "mark overdue installments",
  "30 2 * * *",
  internal.billing.markOverdueInstallments,
  {},
);

export default crons;
