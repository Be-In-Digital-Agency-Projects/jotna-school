/**
 * CE QUE LES ACTIONS DE VOIX NE PEUVENT PAS FAIRE ELLES-MÊMES.
 *
 * Une action n'a pas de `ctx.db` (guidelines du dépôt) : tout ce que
 * `voice.ts` doit lire ou écrire passe par ici. Le découpage n'est pas
 * cosmétique — `voice.ts` porte `"use node"`, et une même unité ne peut pas
 * tenir à la fois des actions Node et des requêtes ou mutations.
 *
 * TOUT EST INTERNE. Aucune de ces fonctions n'est atteignable depuis le
 * réseau public : elles reçoivent des identifiants déjà établis par l'action
 * qui les appelle, et n'ont donc pas à poser de garde elles-mêmes — c'est
 * `voice.ts` qui la pose, une fois, avant de les toucher. La seule exception
 * est `callerContext`, dont c'est précisément le rôle : établir QUI appelle.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { moduleAccessForProfile } from "../modules";
import { dayKey } from "../aiGateway/quota";

const MODULE_KEY = "arabe_coran" as const;

/**
 * LE PLAFOND QUOTIDIEN DE TRANSCRIPTIONS, PAR ENFANT.
 *
 * Chaque « je répète » est un appel facturé chez le fournisseur de voix — le
 * seul geste du module qui ne peut pas être mis en cache, puisque l'audio est
 * différent à chaque fois. Sans plafond, un enfant qui garde le doigt sur le
 * bouton, ou un écran qui boucle sur une erreur, dépense sans fin.
 *
 * 80 est haut DÉLIBÉRÉMENT : une séance d'alphabet, c'est quatre lettres
 * répétées trois ou quatre fois, soit une quinzaine d'appels ; une séance de
 * lecture de sourate, une trentaine. Le plafond doit arrêter la boucle, jamais
 * l'élève appliqué — un enfant qui bute sur le ع et recommence vingt fois est
 * exactement ce que ce module cherche à provoquer.
 */
export const STT_DAILY_LIMIT = 80;

/**
 * Qui appelle, et le module lui est-il ouvert ?
 *
 * Rend le profil ET le verdict en une lecture. `voice.ts` en a besoin des
 * deux : le verdict pour refuser, l'identifiant pour compter le quota et
 * écrire la tentative.
 */
export const callerContext = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const access = await moduleAccessForProfile(ctx, profile, MODULE_KEY);
    if (!profile) return { ...access, profileId: null, isStudent: false };

    return {
      ...access,
      profileId: profile._id,
      isStudent: profile.role === "student",
    };
  },
});

// ---------------------------------------------------------------------------
// Cache audio
// ---------------------------------------------------------------------------

/** Le clip déjà synthétisé pour cette clé, ou `null`. */
export const findClip = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("arabicAudioClips")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();
    return row ? { storageId: row.storageId } : null;
  },
});

/**
 * Range un clip fraîchement synthétisé.
 *
 * IDEMPOTENTE PAR PRUDENCE : deux enfants qui demandent le même son à la même
 * seconde produisent deux synthèses, et la seconde arriverait sur une clé déjà
 * prise. On garde la première et on EFFACE le fichier en trop, sinon le
 * stockage accumule des orphelins que plus rien ne référence.
 */
export const saveClip = internalMutation({
  args: {
    cacheKey: v.string(),
    text: v.string(),
    voiceId: v.string(),
    modelId: v.string(),
    storageId: v.id("_storage"),
    bytes: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("arabicAudioClips")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();

    if (existing) {
      if (existing.storageId !== args.storageId) {
        await ctx.storage.delete(args.storageId);
      }
      return { storageId: existing.storageId };
    }

    await ctx.db.insert("arabicAudioClips", {
      cacheKey: args.cacheKey,
      text: args.text,
      voiceId: args.voiceId,
      modelId: args.modelId,
      storageId: args.storageId,
      bytes: args.bytes,
      createdAt: Date.now(),
    });
    return { storageId: args.storageId };
  },
});

// ---------------------------------------------------------------------------
// Compteurs de dépense
// ---------------------------------------------------------------------------

/**
 * Consomme une transcription du quota du jour, ou refuse.
 *
 * COMPTE AVANT D'APPELER, et non après : compter après laisserait passer une
 * rafale d'appels concurrents, tous partis avant que le premier ne revienne.
 * Le prix d'un appel qui échouera ensuite est un jeton perdu sur quatre-vingts
 * — le prix d'un compteur posé trop tard est une facture.
 */
export const consumeSttQuota = internalMutation({
  args: { studentId: v.id("profiles") },
  handler: async (ctx, args) => {
    const key = dayKey();
    const now = Date.now();

    const row = await ctx.db
      .query("arabicVoiceUsage")
      .withIndex("by_student_day", (q) =>
        q.eq("studentId", args.studentId).eq("dayKey", key),
      )
      .unique();

    if (!row) {
      await ctx.db.insert("arabicVoiceUsage", {
        studentId: args.studentId,
        dayKey: key,
        sttCalls: 1,
        ttsChars: 0,
        updatedAt: now,
      });
      return { allowed: true, remaining: STT_DAILY_LIMIT - 1 };
    }

    if (row.sttCalls >= STT_DAILY_LIMIT) {
      return { allowed: false, remaining: 0 };
    }

    await ctx.db.patch(row._id, { sttCalls: row.sttCalls + 1, updatedAt: now });
    return { allowed: true, remaining: STT_DAILY_LIMIT - row.sttCalls - 1 };
  },
});

/**
 * Note des caractères RÉELLEMENT synthétisés — ceux qui ont manqué le cache.
 *
 * Aucun plafond ici, et c'est un choix : le texte du module est fini, donc la
 * synthèse s'épuise d'elle-même une fois le cache chaud. Le compteur existe
 * pour qu'on VOIE cette extinction, et qu'un cache qui ne prendrait pas se
 * remarque avant la facture.
 */
export const addTtsChars = internalMutation({
  args: { studentId: v.id("profiles"), chars: v.number() },
  handler: async (ctx, args) => {
    const key = dayKey();
    const now = Date.now();

    const row = await ctx.db
      .query("arabicVoiceUsage")
      .withIndex("by_student_day", (q) =>
        q.eq("studentId", args.studentId).eq("dayKey", key),
      )
      .unique();

    if (!row) {
      await ctx.db.insert("arabicVoiceUsage", {
        studentId: args.studentId,
        dayKey: key,
        sttCalls: 0,
        ttsChars: args.chars,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.patch(row._id, {
      ttsChars: row.ttsChars + args.chars,
      updatedAt: now,
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Tentatives jugées par le serveur
// ---------------------------------------------------------------------------

/**
 * Écrit une tentative de PRONONCIATION.
 *
 * `source: "server"` en dur, et la fonction est interne : c'est ce couple qui
 * donne son sens à la distinction. Une note « server » ne peut être écrite que
 * par le chemin qui a réellement entendu l'enfant et jugé sa transcription.
 */
export const recordServerAttempt = internalMutation({
  args: {
    studentId: v.id("profiles"),
    lessonKey: v.string(),
    drill: v.union(v.literal("pronounce"), v.literal("read")),
    itemKey: v.string(),
    correct: v.boolean(),
    score: v.number(),
    verdict: v.union(
      v.literal("ok"),
      v.literal("close"),
      v.literal("retry"),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("arabicAttempts", {
      studentId: args.studentId,
      lessonKey: args.lessonKey,
      drill: args.drill,
      itemKey: args.itemKey,
      correct: args.correct,
      score: Math.min(1, Math.max(0, args.score)),
      verdict: args.verdict,
      source: "server",
      at: now,
    });

    await touchLessonProgress(
      ctx,
      args.studentId,
      args.lessonKey,
      args.drill,
      now,
    );
    return null;
  },
});

/**
 * Crée ou rafraîchit la ligne de progression d'une leçon.
 *
 * Copie volontairement courte de ce que fait `lessons.touchProgress` : les
 * deux chemins d'écriture d'une tentative — l'appareil et le serveur — doivent
 * laisser la même trace. Elle ne touche NI aux étoiles NI au statut
 * « terminé » : `lessons.completeLesson` seule les décerne.
 */
async function touchLessonProgress(
  ctx: MutationCtx,
  studentId: Id<"profiles">,
  lessonKey: string,
  drill: string,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("arabicLessonProgress")
    .withIndex("by_student_lesson", (q) =>
      q.eq("studentId", studentId).eq("lessonKey", lessonKey),
    )
    .unique();

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
