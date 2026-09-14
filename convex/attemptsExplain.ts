"use node";

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Public action: generate a kid-friendly explanation when a student has
 * exhausted their attempts on an exercise. Uses OpenAI to produce a
 * personalised, pedagogical explanation based on the wrong answers given.
 *
 * Returns { explanation, correctAnswer }.
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

    const openai = new OpenAI();

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

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      store: false,
      messages: [
        {
          role: "system",
          content:
            "Tu es un professeur bienveillant qui aide les élèves de primaire francophone (Sénégal/France).",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 350,
      temperature: 0.7,
    });

    const explanation =
      completion.choices[0]?.message?.content?.trim() ??
      "Voici la bonne réponse. Essaie de comprendre pourquoi et tu réussiras la prochaine fois !";

    return {
      explanation,
      correctAnswer: data.exercise.answerKey,
    };
  },
});
