/**
 * LE PARCOURS D'UN ÉLÈVE DANS LE MODULE « ARABE & CORAN ».
 *
 * CE QUE CES FONCTIONS SERVENT, ET CE QU'ELLES NE SERVENT PAS. Elles ne
 * renvoient AUCUN contenu : ni lettre, ni syllabe, ni verset. Le contenu est
 * du code (`alphabet.ts`, `curriculum.ts`, `quran.ts`), donc déjà dans le
 * paquet de l'écran — le renvoyer serait le transmettre deux fois, et
 * l'exposer au risque que les deux versions divergent. Ce qui vit en base, et
 * seulement ça : la PROGRESSION de l'enfant.
 *
 * LES GARDES, DANS L'ORDRE OÙ ELLES TOMBENT :
 *   1. identité — pas de profil, rien ;
 *   2. paywall (spec §5.4) — un élève sans droit d'accès ne lit rien, module
 *      allumé ou non. C'est `moduleAccessForProfile` qui les pose toutes deux ;
 *   3. module — l'école doit l'avoir allumé ;
 *   4. RÔLE, pour les écritures seulement : seul un `student` a une
 *      progression. Un professeur qui regarde le module pour préparer sa
 *      classe le PARCOURT sans rien écrire.
 *
 * Une requête ne lève jamais (spec §5.4) ; une mutation lève des
 * `ConvexError` porteuses de phrases, que l'écran affiche.
 */

import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { callerProfile } from "../access";
import { moduleAccessForProfile } from "../modules";
import { getLesson, type ArabicLesson } from "./curriculum";
import { lessonScore, starsFor, type AttemptValue } from "./progressRules";

const MODULE_KEY = "arabe_coran" as const;

/** Tentatives lues pour juger UNE leçon. Une leçon en compte au plus ~120. */
const ATTEMPTS_PER_LESSON_LIMIT = 500;

/** Le parcours compte 24 leçons ; 100 laisse la place à un niveau de plus. */
const PROGRESS_ROWS_LIMIT = 100;

const drillValidator = v.union(
  v.literal("recognizeGlyph"),
  v.literal("recognizeName"),
  v.literal("dots"),
  v.literal("forms"),
  v.literal("pronounce"),
  v.literal("write"),
  v.literal("read"),
);

const verdictValidator = v.union(
  v.literal("ok"),
  v.literal("close"),
  v.literal("retry"),
);

/**
 * L'élève de la session, si le module lui est ouvert. `null` sinon.
 *
 * Réunit les quatre gardes de l'en-tête en UNE lecture de profil pour les
 * écritures. Les requêtes posent les trois premières elles-mêmes, sans la
 * quatrième : elles servent aussi le personnel, qui parcourt le module sans
 * jamais rien y écrire.
 */
async function studentForModule(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"profiles"> | null> {
  const profile = await callerProfile(ctx);
  if (!profile || profile.role !== "student") return null;

  // `moduleAccessForProfile` attend un `QueryCtx` ; un `MutationCtx` en offre
  // toutes les lectures — c'est la conversion que fait déjà `checkAccess`
  // dans `access.ts`, et pour la même raison. Le profil est passé plutôt que
  // relu : une seule lecture de `profiles` par écriture.
  const access = await moduleAccessForProfile(
    ctx as QueryCtx,
    profile,
    MODULE_KEY,
  );
  return access.enabled ? profile : null;
}

/** La ligne de progression d'une leçon, ou `null`. */
async function progressRow(
  ctx: QueryCtx | MutationCtx,
  studentId: Id<"profiles">,
  lessonKey: string,
): Promise<Doc<"arabicLessonProgress"> | null> {
  return await ctx.db
    .query("arabicLessonProgress")
    .withIndex("by_student_lesson", (q) =>
      q.eq("studentId", studentId).eq("lessonKey", lessonKey),
    )
    .unique();
}

/**
 * L'item visé appartient-il bien à cette leçon ?
 *
 * PAS UNE FORMALITÉ. `itemKey` vient du client : sans ce contrôle, n'importe
 * quelle chaîne s'écrirait dans `arabicAttempts`, et la note de la leçon se
 * gonflerait d'exercices qui n'existent pas — `lessonScore` moyenne sur les
 * items RENCONTRÉS, donc ajouter des items imaginaires tous réussis ferait
 * monter les étoiles. Le contrôle est ici, à l'écriture, une fois.
 */
function lessonHasItem(lesson: ArabicLesson, itemKey: string): boolean {
  if ((lesson.letters as readonly string[]).includes(itemKey)) return true;
  return lesson.items.some((item) => item.key === itemKey);
}

// ---------------------------------------------------------------------------
// Requêtes
// ---------------------------------------------------------------------------

/**
 * L'état du parcours : le module est-il ouvert, et où en est l'enfant ?
 *
 * Le DÉVERROUILLAGE n'est pas calculé ici : il se déduit des leçons terminées
 * par `isLessonUnlocked` (`progressRules.ts`), que l'écran applique au
 * curriculum qu'il porte déjà. Une seule règle, écrite une fois.
 */
export const getPath = query({
  args: {},
  handler: async (ctx) => {
    // Le profil D'ABORD, et une seule fois : le verdict de module s'en déduit,
    // et le reste de la requête en a besoin. L'ordre inverse relisait
    // `profiles` deux fois par souscription au parcours.
    const profile = await callerProfile(ctx);
    const access = await moduleAccessForProfile(ctx, profile, MODULE_KEY);

    if (!access.enabled || !profile || profile.role !== "student") {
      return {
        enabled: access.enabled,
        reason: access.reason,
        isStudent: profile?.role === "student",
        progress: [],
      };
    }

    const rows = await ctx.db
      .query("arabicLessonProgress")
      .withIndex("by_student", (q) => q.eq("studentId", profile._id))
      .take(PROGRESS_ROWS_LIMIT);

    return {
      enabled: true,
      reason: access.reason,
      isStudent: true,
      progress: rows.map((row) => ({
        lessonKey: row.lessonKey,
        status: row.status,
        stars: row.stars,
        bestScore: row.bestScore,
        completedAt: row.completedAt ?? null,
      })),
    };
  },
});

/**
 * Ce que l'enfant a déjà réussi DANS une leçon, exercice par exercice.
 *
 * `mastery` est indexé par « famille:item » — la même clé que
 * `lessonScore` — pour que l'écran puisse colorier la lettre déjà prononcée
 * juste, et ne pas la redemander en boucle.
 */
export const getLessonState = query({
  args: { lessonKey: v.string() },
  handler: async (ctx, args) => {
    const empty = {
      enabled: false,
      status: null as "in_progress" | "completed" | null,
      stars: 0,
      bestScore: 0,
      drillsDone: [] as string[],
      mastery: {} as Record<string, number>,
    };

    const profile = await callerProfile(ctx);
    const access = await moduleAccessForProfile(ctx, profile, MODULE_KEY);
    if (!access.enabled) return empty;
    if (!getLesson(args.lessonKey)) return empty;

    if (!profile || profile.role !== "student") {
      // Le personnel parcourt le module sans progression : la leçon s'ouvre,
      // elle est simplement vierge.
      return { ...empty, enabled: true };
    }

    const row = await progressRow(ctx, profile._id, args.lessonKey);
    const attempts = await ctx.db
      .query("arabicAttempts")
      .withIndex("by_student_lesson", (q) =>
        q.eq("studentId", profile._id).eq("lessonKey", args.lessonKey),
      )
      .take(ATTEMPTS_PER_LESSON_LIMIT);

    const mastery: Record<string, number> = {};
    for (const attempt of attempts) {
      const key = `${attempt.drill}:${attempt.itemKey}`;
      const value =
        typeof attempt.score === "number"
          ? attempt.score
          : attempt.correct
            ? 1
            : 0;
      if (mastery[key] === undefined || value > mastery[key]) {
        mastery[key] = value;
      }
    }

    return {
      enabled: true,
      status: row?.status ?? null,
      stars: row?.stars ?? 0,
      bestScore: row?.bestScore ?? 0,
      drillsDone: row?.drillsDone ?? [],
      mastery,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Enregistre une tentative faite SUR L'APPAREIL — QCM, points, formes, tracé.
 *
 * `source: "device"` EST ÉCRIT EN DUR, jamais reçu : c'est la seule chose que
 * cette mutation sait de l'origine de la note. La prononciation, elle, est
 * jugée par le serveur après transcription et s'écrit par
 * `db.recordServerAttempt` — une fonction INTERNE, donc hors de portée d'un
 * client qui voudrait se décerner un « server ».
 *
 * La ligne de progression naît ici, en `in_progress` : ouvrir une leçon ne
 * crée rien, le premier exercice tenté si.
 */
export const recordAttempt = mutation({
  args: {
    lessonKey: v.string(),
    drill: drillValidator,
    itemKey: v.string(),
    correct: v.boolean(),
    score: v.optional(v.number()),
    verdict: v.optional(verdictValidator),
  },
  handler: async (ctx, args) => {
    const student = await studentForModule(ctx);
    if (!student) throw new ConvexError("Module non disponible");

    const lesson = getLesson(args.lessonKey);
    if (!lesson) throw new ConvexError("Leçon introuvable");
    if (!lessonHasItem(lesson, args.itemKey)) {
      throw new ConvexError("Exercice introuvable dans cette leçon");
    }

    const now = Date.now();
    await ctx.db.insert("arabicAttempts", {
      studentId: student._id,
      lessonKey: args.lessonKey,
      drill: args.drill,
      itemKey: args.itemKey,
      correct: args.correct,
      // Borné à l'écriture : une note hors de [0,1] fausserait toutes les
      // moyennes de la leçon, et elle vient du client.
      ...(args.score !== undefined
        ? { score: Math.min(1, Math.max(0, args.score)) }
        : {}),
      ...(args.verdict !== undefined ? { verdict: args.verdict } : {}),
      source: "device",
      at: now,
    });

    await touchProgress(ctx, student._id, args.lessonKey, args.drill, now);
    return null;
  },
});

/**
 * Clôt une leçon et accorde ses étoiles.
 *
 * LES ÉTOILES SE CALCULENT ICI, DEPUIS LES TENTATIVES ÉCRITES — jamais depuis
 * un score envoyé par l'écran. Non par méfiance envers l'enfant (il n'y a rien
 * à gagner), mais parce qu'une note doit vouloir dire quelque chose de
 * vérifiable quand un parent ou un maître la lit.
 *
 * ON NE REDESCEND JAMAIS : refaire une leçon ne peut qu'améliorer ses étoiles.
 * Une révision ratée un soir de fatigue n'efface pas ce qui a été appris.
 */
export const completeLesson = mutation({
  args: { lessonKey: v.string() },
  handler: async (ctx, args) => {
    const student = await studentForModule(ctx);
    if (!student) throw new ConvexError("Module non disponible");

    const lesson = getLesson(args.lessonKey);
    if (!lesson) throw new ConvexError("Leçon introuvable");

    const attempts = await ctx.db
      .query("arabicAttempts")
      .withIndex("by_student_lesson", (q) =>
        q.eq("studentId", student._id).eq("lessonKey", args.lessonKey),
      )
      .take(ATTEMPTS_PER_LESSON_LIMIT);

    if (attempts.length === 0) {
      throw new ConvexError("Termine au moins un exercice avant de valider.");
    }

    const values: AttemptValue[] = attempts.map((attempt) => ({
      drill: attempt.drill,
      itemKey: attempt.itemKey,
      correct: attempt.correct,
      ...(attempt.score !== undefined ? { score: attempt.score } : {}),
    }));

    const score = lessonScore(values);
    const stars = starsFor(score);
    const now = Date.now();

    const existing = await progressRow(ctx, student._id, args.lessonKey);
    const drillsDone = [...new Set(attempts.map((a) => a.drill))];

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "completed",
        stars: Math.max(existing.stars, stars),
        bestScore: Math.max(existing.bestScore, score),
        drillsDone,
        completedAt: existing.completedAt ?? now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("arabicLessonProgress", {
        studentId: student._id,
        lessonKey: args.lessonKey,
        status: "completed",
        stars,
        bestScore: score,
        drillsDone,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
      });
    }

    return { stars, score };
  },
});

/**
 * Crée ou rafraîchit la ligne de progression après une tentative.
 *
 * Elle ne touche NI aux étoiles NI au statut « terminé » : seule
 * `completeLesson` les décerne, et une tentative de plus ne doit pas rouvrir
 * une leçon que l'enfant a finie.
 */
async function touchProgress(
  ctx: MutationCtx,
  studentId: Id<"profiles">,
  lessonKey: string,
  drill: string,
  now: number,
): Promise<void> {
  const existing = await progressRow(ctx, studentId, lessonKey);
  if (!existing) {
    await ctx.db.insert("arabicLessonProgress", {
      studentId,
      lessonKey,
      status: "in_progress",
      stars: 0,
      bestScore: 0,
      drillsDone: [drill],
      startedAt: now,
      updatedAt: now,
    });
    return;
  }

  const drillsDone = existing.drillsDone.includes(drill)
    ? existing.drillsDone
    : [...existing.drillsDone, drill];

  await ctx.db.patch(existing._id, { drillsDone, updatedAt: now });
}
