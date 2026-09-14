"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Public action: semantically verify a short-answer submission using GPT-4o-mini.
 *
 * Called by the client after a literal check has failed on a short-answer
 * exercise. The AI receives the exercise prompt, the accepted answers and the
 * student's submitted answer, and returns whether the student's answer is
 * semantically equivalent to one of the expected answers.
 *
 * If the AI decides the answer is correct, we flip the attempt's isCorrect
 * flag to true and bump the student's progress counters — so the student
 * advances exactly as if they had typed the literal answer.
 */
export const verifyShortAnswerWithAI = action({
  args: {
    attemptId: v.id("attempts"),
  },
  handler: async (ctx, { attemptId }): Promise<{ isCorrect: boolean; reason: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Non authentifié");
    }

    // Paywall (spec §5.4) — cette action appelle OpenAI directement, sans
    // passer par aiGateway.generate : il n'y a donc pas de verrou de tâche 4
    // en aval ici. On contrôle le droit de L'APPELANT (pas un identifiant
    // reçu en argument) avant toute lecture de contexte et tout appel IA.
    // Même motif que attemptsExplain.generateExplanation : résoudre le
    // profil de l'appelant via la requête interne existante, puis
    // interroger getAccessStateForProfile (tâche 3). Une action n'a pas de
    // ctx.db.
    const callerProfile = await ctx.runQuery(
      internal.paliers.index.getProfileByUserId,
      { userId },
    );
    if (!callerProfile) {
      throw new Error("Profil introuvable");
    }
    const access = await ctx.runQuery(
      internal.access.getAccessStateForProfile,
      { profileId: callerProfile._id },
    );
    if (!access.ok) {
      throw new Error(`ACCESS_DENIED:${access.reason}`);
    }

    type AttemptContext = {
      submittedAnswer: string;
      exercise: {
        prompt: string;
        type: string;
        acceptedAnswers: string[];
      };
    } | null;

    const data = (await ctx.runQuery(
      internal.attempts.getAttemptContextForVerification,
      { attemptId },
    )) as AttemptContext;

    if (!data) {
      return { isCorrect: false, reason: "Tentative introuvable" };
    }

    if (data.exercise.type !== "short-answer") {
      return { isCorrect: false, reason: "Type d'exercice non supporté" };
    }

    const openai = new OpenAI();

    const prompt = `Tu aides à corriger un exercice à réponse courte pour un élève de CE2-CM2 (francophone, Sénégal).

Énoncé de l'exercice : ${data.exercise.prompt}

Réponses acceptées (toutes sont considérées correctes) :
${data.exercise.acceptedAnswers.map((a, i) => `${i + 1}. "${a}"`).join("\n")}

Réponse de l'élève : "${data.submittedAnswer}"

La réponse de l'élève est-elle LINGUISTIQUEMENT ou SÉMANTIQUEMENT valide compte tenu de l'énoncé ?

Sois BIENVEILLANT mais rigoureux :
- Accepte les variantes orthographiques légères, les majuscules/minuscules, les accents manquants
- Accepte les chiffres vs lettres ("10" vs "dix")
- Accepte si l'élève a donné la bonne information même formulée différemment
- Accepte si l'élève a donné une sous-partie correcte de la réponse attendue (ex: "Ce matin" pour "Ce matin (temps)")
- Pour la CONJUGAISON : accepte TOUT temps grammaticalement valide dans le contexte de la phrase, même si les acceptedAnswers ne listent qu'un seul temps. Exemple : pour "Hier, elle (dire) ___", accepte "dit" (passé simple), "a dit" (passé composé) ET "disait" (imparfait) car tous sont valides en contexte passé.
- Pour les ACCORDS (genre, nombre) : accepte si l'accord est grammaticalement cohérent avec le sujet/contexte
- REFUSE si la réponse est grammaticalement fausse ou incohérente avec le contexte de l'énoncé
- REFUSE si la réponse donne une information fausse sur le fond

Réponds strictement par un JSON de cette forme exacte :
{"correct": true/false, "reason": "explication en 1 phrase"}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      store: false,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu es un correcteur pédagogique bienveillant pour des élèves de primaire.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 200,
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    let verdict: { correct?: boolean; reason?: string };
    try {
      verdict = JSON.parse(raw);
    } catch {
      verdict = { correct: false, reason: "Réponse IA non parsable" };
    }

    const isCorrect = verdict.correct === true;
    const reason = verdict.reason ?? "";

    if (isCorrect) {
      await ctx.runMutation(internal.attempts.markAttemptCorrectByAI, {
        attemptId,
      });
    }

    return { isCorrect, reason };
  },
});
