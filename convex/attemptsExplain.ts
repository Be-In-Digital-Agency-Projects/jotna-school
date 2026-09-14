"use node";

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

/** Message servi quand l'IA ne peut pas expliquer. Jamais de page vide. */
const FALLBACK_EXPLANATION =
  "Pas d'inquiétude ! Regarde bien la bonne réponse, essaie de comprendre pourquoi, et tu réussiras la prochaine fois.";

/**
 * Public action: generate a kid-friendly explanation when a student has
 * exhausted their attempts on an exercise. Passe par la passerelle IA
 * (`explain_mistake`) pour produire une explication pédagogique à partir des
 * réponses fausses.
 *
 * Returns { explanation, correctAnswer }.
 *
 * ## Pourquoi passer par la passerelle
 *
 * Cette action appelait OpenAI en direct : hors plafond et hors mesure. Elle
 * est moins fréquente que la vérification (cinq tentatives ratées la
 * déclenchent) mais plafonne à 800 jetons de sortie, donc elle coûte.
 *
 * Un refus budgétaire ne laisse pas l'enfant sans rien : la bonne réponse est
 * déjà révélée par `attempts.submit` au bout des cinq essais, et on renvoie un
 * message d'encouragement au lieu de lever. C'est le même repli que le client
 * appliquait déjà dans son `.catch` quand l'appel OpenAI échouait — on le
 * remonte simplement côté serveur, où la bonne réponse est disponible.
 */
export const generateExplanation = action({
  args: {
    exerciseId: v.id("exercises"),
    studentId: v.id("profiles"),
  },
  handler: async (ctx, { exerciseId, studentId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Non authentifié");
    }

    // Paywall (spec §5.4) — contrôle le droit de L'APPELANT, pas celui de
    // args.studentId : un utilisateur authentifié pourrait sinon passer
    // l'identifiant d'un autre élève couvert et se servir de son abonnement.
    // Avant toute lecture de contexte et tout appel IA (cette action appelle
    // OpenAI directement, sans passer par aiGateway.generate — il n'y a donc
    // pas de verrou de tâche 4 en aval ici). Même motif que
    // paliers.index.getBucket : résoudre le profil de l'appelant via la
    // requête interne existante, puis interroger getAccessStateForProfile
    // (tâche 3). Une action n'a pas de ctx.db.
    const callerProfile = await ctx.runQuery(
      internal.paliers.index.getProfileByUserId,
      { userId: userId as string },
    );
    if (!callerProfile) {
      throw new Error("Profil introuvable");
    }
    const access = await ctx.runQuery(internal.access.getAccessStateForProfile, {
      profileId: callerProfile._id,
    });
    if (!access.ok) {
      throw new ConvexError({ code: "ACCESS_DENIED", reason: access.reason });
    }

    type AttemptsData = {
      exercise: {
        prompt: string;
        type: string;
        answerKey: string;
        hints: string[];
      };
      attempts: { submittedAnswer: string; isCorrect: boolean }[];
    };

    const data = (await ctx.runQuery(
      internal.attempts.getExerciseAndAttempts,
      { exerciseId, studentId },
    )) as AttemptsData | null;
    if (!data) {
      throw new Error("Exercice introuvable");
    }

    const wrongAnswers = data.attempts
      .filter((a: { isCorrect: boolean }) => !a.isCorrect)
      .map((a: { submittedAnswer: string }) => a.submittedAnswer);

    const prompt = `Un élève de CE2-CM2 (8-11 ans) n'a pas réussi cet exercice après plusieurs essais.

Énoncé : ${data.exercise.prompt}

Bonne réponse : ${data.exercise.answerKey}

Réponses tentées par l'élève (${wrongAnswers.length} erreurs) :
${wrongAnswers.map((a, i) => `${i + 1}. "${a}"`).join("\n") || "(aucune réponse soumise)"}

Écris une explication courte (4-6 phrases maximum), bienveillante et adaptée à un enfant de 8-11 ans :
- Identifie l'erreur principale dans ses tentatives
- Explique simplement pourquoi sa réponse n'était pas correcte
- Donne la bonne méthode/raisonnement pour trouver la bonne réponse
- Termine par un encouragement positif

N'utilise pas de jargon technique. Écris comme un professeur patient qui parle directement à l'enfant. Tutoie l'enfant.`;

    // `userId` porte le profil de L'APPELANT, pas `args.studentId` : c'est son
    // droit qu'on a vérifié plus haut, et c'est lui qui déclenche la dépense.
    // L'élève concerné reste traçable via `metadata`.
    const gen: {
      ok: boolean;
      result?: unknown;
      traceId: string;
      reason?: string;
    } = await ctx.runAction(internal.aiGateway.index.generate, {
      purpose: "explain_mistake",
      prompt,
      systemPrompt:
        "Tu es un professeur bienveillant qui aide les élèves de primaire francophone (Sénégal/France).",
      userId: callerProfile._id,
      metadata: { exerciseId, studentId, kind: "explain_mistake" },
    });

    const generated =
      gen.ok && typeof gen.result === "string" ? gen.result.trim() : "";

    return {
      explanation: generated.length > 0 ? generated : FALLBACK_EXPLANATION,
      correctAnswer: data.exercise.answerKey,
    };
  },
});
