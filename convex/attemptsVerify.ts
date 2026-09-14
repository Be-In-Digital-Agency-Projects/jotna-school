"use node";

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

/** Verdict de l'IA, tel qu'on accepte de le lire. */
function readVerdict(raw: unknown): { correct: boolean; reason: string } {
  if (typeof raw !== "object" || raw === null) {
    return { correct: false, reason: "Réponse IA non parsable" };
  }
  const correct = "correct" in raw && raw.correct === true;
  const rawReason = "reason" in raw ? raw.reason : undefined;
  return { correct, reason: typeof rawReason === "string" ? rawReason : "" };
}

/**
 * Public action: semantically verify a short-answer submission using the AI
 * gateway (`verify_short_answer`).
 *
 * Called by the client after a literal check has failed on a short-answer
 * exercise. The AI receives the exercise prompt, the accepted answers and the
 * student's submitted answer, and returns whether the student's answer is
 * semantically equivalent to one of the expected answers.
 *
 * If the AI decides the answer is correct, we flip the attempt's isCorrect
 * flag to true and bump the student's progress counters — so the student
 * advances exactly as if they had typed the literal answer.
 *
 * ## Pourquoi passer par la passerelle
 *
 * Cette action appelait OpenAI en direct : elle échappait donc au plafond de
 * dépense ET à sa mesure, alors qu'elle tourne à chaque réponse libre fausse —
 * c'est le chemin le plus fréquent du produit, pas un cas marginal.
 *
 * ## Ce que ça risque, et pourquoi c'est tenable
 *
 * Passer par la passerelle soumet la vérification au plafond : le jour où le
 * budget est atteint, l'IA peut refuser. Ce n'est pas laisser l'enfant sans
 * réponse, parce qu'un repli déterministe a DÉJÀ tranché avant qu'on arrive
 * ici : `attempts.submit` compare la réponse aux `acceptedAnswers`
 * (`verifyShortAnswer`, comparaison exacte insensible à la casse et aux
 * espaces) et a déjà écrit son verdict dans la tentative. L'IA n'est qu'un
 * second avis, qui peut faire PASSER une réponse jugée fausse mais jamais
 * l'inverse. Un refus budgétaire laisse donc le verdict littéral en place —
 * exactement ce qui se passe déjà aujourd'hui quand l'appel OpenAI échoue,
 * cas explicitement assumé côté client (`ExercisePlayer.handleSubmit`).
 *
 * Et le refus est rare : l'usage `verify_short_answer` n'est ni « kid
 * initiated » ni génératif au sens de `budget.ts`, donc seul le palier
 * `hard_reject` (>= 110 % du budget) le bloque.
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
      throw new ConvexError({ code: "ACCESS_DENIED", reason: access.reason });
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

    // Pas de `quotaScope` : la vérification ne doit pas consommer le quota
    // quotidien « J'en veux encore » de l'élève, qui borne une envie, pas une
    // correction. L'appel est donc de portée « system » (défaut).
    const gen: {
      ok: boolean;
      result?: unknown;
      traceId: string;
      reason?: string;
    } = await ctx.runAction(internal.aiGateway.index.generate, {
      purpose: "verify_short_answer",
      prompt,
      systemPrompt:
        "Tu es un correcteur pédagogique bienveillant pour des élèves de primaire.",
      expectJson: true,
      userId: callerProfile._id,
      metadata: { attemptId, kind: "verify_short_answer" },
    });

    if (!gen.ok) {
      // Repli déterministe : le verdict littéral d'`attempts.submit` fait foi.
      // On ne lève pas — le client sait lire `isCorrect: false` et garde le
      // sien. L'enfant n'est jamais laissé sans réponse.
      return {
        isCorrect: false,
        reason: "Vérification approfondie indisponible pour le moment",
      };
    }

    const verdict = readVerdict(gen.result);
    const isCorrect = verdict.correct;
    const reason = verdict.reason;

    if (isCorrect) {
      await ctx.runMutation(internal.attempts.markAttemptCorrectByAI, {
        attemptId,
      });
    }

    return { isCorrect, reason };
  },
});
