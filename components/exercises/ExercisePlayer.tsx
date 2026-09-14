"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useExerciseSessionStore } from "@/stores/exercise-session-store";
import { useGamificationStore } from "@/stores/gamification-store";
import { Lightbulb, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { kidMessages } from "@/lib/kidCopy";
import { isAccessDenied } from "@/lib/accessCopy";
import { StudentAlertDialog } from "@/components/student/student-alert-dialog";
import QcmExercise from "./QcmExercise";
import MatchExercise from "./MatchExercise";
import OrderExercise from "./OrderExercise";
import DragDropExercise from "./DragDropExercise";
import ShortAnswerExercise from "./ShortAnswerExercise";

type ExerciseType = "qcm" | "drag-drop" | "match" | "order" | "short-answer";

interface ExerciseData {
  _id: string;
  type: ExerciseType;
  prompt: string;
  payload: unknown;
  hints: string[];
  order: number;
}

interface ExercisePlayerProps {
  exercises: ExerciseData[];
  topicId: string;
  studentId: string;
  /** 0-based index to start at; useful for resuming an interrupted session. */
  initialIndex?: number;
  onComplete: (stats: {
    correctCount: number;
    totalCount: number;
    totalTimeMs: number;
    totalHintsUsed: number;
  }) => void;
}

const MAX_ATTEMPTS = 5;
const MAX_HINTS = 3;

export default function ExercisePlayer({
  exercises,
  topicId,
  studentId,
  initialIndex,
  onComplete,
}: ExercisePlayerProps) {
  const submitAttempt = useMutation(api.attempts.submit);
  const generateExplanation = useAction(
    api.attemptsExplain.generateExplanation,
  );
  const verifyShortAnswerWithAI = useAction(
    api.attemptsVerify.verifyShortAnswerWithAI,
  );

  const {
    currentExerciseIndex,
    startSession,
    nextExercise,
    recordAttempt,
    completeSession,
  } = useExerciseSessionStore();

  const { triggerConfetti, updateScore } = useGamificationStore();

  // Per-exercise state
  const [attemptCount, setAttemptCount] = useState(0);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState<string | null>(null);
  const [showRevealedAnswer, setShowRevealedAnswer] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiExplanationLoading, setAiExplanationLoading] = useState(false);
  const [accessBlocked, setAccessBlocked] = useState(false);

  // Timer
  const exerciseStartTime = useRef<number>(Date.now());

  // Session-wide stats
  const [sessionCorrectCount, setSessionCorrectCount] = useState(0);
  const [sessionTotalTime, setSessionTotalTime] = useState(0);
  const [sessionTotalHints, setSessionTotalHints] = useState(0);

  // Initialize session
  useEffect(() => {
    startSession(
      topicId,
      exercises.map((e) => ({
        id: e._id,
        type: e.type,
        prompt: e.prompt,
        payload: e.payload,
        order: e.order,
      })),
      initialIndex,
    );
    // Update the sessionCorrectCount so resumed students don't see 0/N at end
    if (initialIndex && initialIndex > 0) {
      setSessionCorrectCount(initialIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset timer when exercise changes
  useEffect(() => {
    exerciseStartTime.current = Date.now();
  }, [currentExerciseIndex]);

  const currentExercise = exercises[currentExerciseIndex];
  if (!currentExercise) return null;

  const availableHints = currentExercise.hints.slice(
    0,
    Math.min(MAX_HINTS, currentExercise.hints.length),
  );

  const handleAdvance = useCallback(() => {
    if (currentExerciseIndex < exercises.length - 1) {
      setIsTransitioning(true);
      setTimeout(() => {
        nextExercise();
        // Reset per-exercise state
        setAttemptCount(0);
        setHintsRevealed(0);
        setIsCorrect(null);
        setCorrectAnswer(null);
        setShowRevealedAnswer(false);
        setAiExplanation(null);
        setAiExplanationLoading(false);
        setIsTransitioning(false);
      }, 300);
    } else {
      // Session complete
      completeSession();
      onComplete({
        correctCount: sessionCorrectCount,
        totalCount: exercises.length,
        totalTimeMs: sessionTotalTime,
        totalHintsUsed: sessionTotalHints,
      });
    }
  }, [
    currentExerciseIndex,
    exercises.length,
    nextExercise,
    completeSession,
    onComplete,
    sessionCorrectCount,
    sessionTotalTime,
    sessionTotalHints,
  ]);

  const handleSubmit = async (answer: string) => {
    if (isSubmitting || isCorrect === true) return;

    setIsSubmitting(true);
    const newAttemptCount = attemptCount + 1;
    setAttemptCount(newAttemptCount);

    const timeSpentMs = Date.now() - exerciseStartTime.current;

    try {
      let result = await submitAttempt({
        exerciseId: currentExercise._id as Id<"exercises">,
        studentId: studentId as Id<"profiles">,
        submittedAnswer: answer,
        attemptNumber: newAttemptCount,
        hintsUsedCount: hintsRevealed,
        timeSpentMs,
      });

      // Short-answer fallback: if the literal check failed, ask the AI to
      // semantically verify the answer against the accepted answers.
      if (!result.isCorrect && result.needsAiVerification && result.attemptId) {
        try {
          const aiVerdict = await verifyShortAnswerWithAI({
            attemptId: result.attemptId,
          });
          if (aiVerdict.isCorrect) {
            result = { ...result, isCorrect: true };
          }
        } catch (err) {
          // ACCESS_DENIED possible ici (accès révoqué entre deux appels déjà réussis, fenêtre étroite) — non traité : retomber sur "réponse fausse" est un compromis accepté (tâche 8).
          console.error("AI verification failed:", err);
        }
      }

      recordAttempt(currentExercise._id, newAttemptCount, hintsRevealed);

      if (result.isCorrect) {
        setIsCorrect(true);
        const newCorrectCount = sessionCorrectCount + 1;
        setSessionCorrectCount(newCorrectCount);
        setSessionTotalTime((prev) => prev + timeSpentMs);
        setSessionTotalHints((prev) => prev + hintsRevealed);
        updateScore(newCorrectCount, exercises.length);
        triggerConfetti();

        // Wait 1.5s then advance
        setTimeout(() => {
          handleAdvance();
        }, 1500);
      } else {
        setIsCorrect(false);
        // Reset isCorrect feedback after 1s so the child can try again
        setTimeout(() => setIsCorrect(null), 1000);

        // After MAX_ATTEMPTS wrong answers: reveal the answer + ask the AI
        // for a personalised pedagogical explanation. We no longer require
        // all hints to be used — once max attempts is reached, we move on
        // with help from the AI.
        if (newAttemptCount >= MAX_ATTEMPTS) {
          setCorrectAnswer(result.correctAnswer ?? null);
          setShowRevealedAnswer(true);
          setSessionTotalTime((prev) => prev + timeSpentMs);
          setSessionTotalHints((prev) => prev + hintsRevealed);

          // Trigger AI explanation in background
          setAiExplanationLoading(true);
          generateExplanation({
            exerciseId: currentExercise._id as Id<"exercises">,
            studentId: studentId as Id<"profiles">,
          })
            .then((res) => {
              setAiExplanation(res.explanation);
              if (res.correctAnswer) setCorrectAnswer(res.correctAnswer);
            })
            .catch((err) => {
              console.error("AI explanation failed:", err);
              setAiExplanation(
                "Pas d'inquiétude ! Regarde bien la bonne réponse, essaie de comprendre pourquoi, et tu réussiras la prochaine fois.",
              );
            })
            .finally(() => setAiExplanationLoading(false));
        }
      }
    } catch (error) {
      if (isAccessDenied(error)) {
        setAccessBlocked(true);
      } else {
        console.error("Error submitting attempt:", error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Gradual unlocking of hints based on failed attempts.
  // With MAX_ATTEMPTS = 5 and MAX_HINTS = 3:
  //   after 1 failed attempt  → indice 1 unlocked
  //   after 2 failed attempts → indice 2 unlocked
  //   after 4 failed attempts → indice 3 (last) unlocked, just before max attempts
  const unlockedHintsCount = Math.min(
    availableHints.length,
    attemptCount >= 4 ? 3 : attemptCount >= 2 ? 2 : attemptCount >= 1 ? 1 : 0,
  );

  const handleRevealHint = () => {
    if (hintsRevealed < unlockedHintsCount) {
      setHintsRevealed(hintsRevealed + 1);
    }
  };

  const showHintButton =
    attemptCount > 0 &&
    isCorrect !== true &&
    hintsRevealed < unlockedHintsCount &&
    !showRevealedAnswer;

  // Helper: how many more failed attempts before the next hint unlocks.
  // Returns null if all hints are unlocked or none are yet available.
  const nextHintInAttempts = (() => {
    if (hintsRevealed >= availableHints.length) return null;
    if (availableHints.length <= hintsRevealed) return null;
    const nextHintIndex = hintsRevealed; // zero-based: which hint would come next
    const requiredAttempts =
      nextHintIndex === 0 ? 1 : nextHintIndex === 1 ? 2 : 4;
    const remaining = requiredAttempts - attemptCount;
    return remaining > 0 ? remaining : null;
  })();

  const exerciseDisabled = isSubmitting || isCorrect === true || showRevealedAnswer;

  const progressPercentage = ((currentExerciseIndex + 1) / exercises.length) * 100;

  return (
    <div
      className={`space-y-6 transition-opacity duration-300 ${
        isTransitioning ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm font-semibold text-gray-600">
          <span>
            Exercice {currentExerciseIndex + 1} sur {exercises.length}
          </span>
          <span>{Math.round(progressPercentage)}%</span>
        </div>
        <div className="h-4 rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-400 to-pink-500 transition-all duration-500 ease-out"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>

      {/* Exercise component — `key` forces a remount on each exercise change
          so that every child's local state (input values, selected pairs,
          dragged items) is reset. */}
      <div className="rounded-3xl border-2 border-gray-100 bg-white p-6 shadow-lg">
        {currentExercise.type === "qcm" && (
          <QcmExercise
            key={currentExercise._id}
            prompt={currentExercise.prompt}
            payload={currentExercise.payload as any}
            onSubmit={handleSubmit}
            onSkip={handleAdvance}
            disabled={exerciseDisabled}
            isCorrect={isCorrect}
          />
        )}
        {currentExercise.type === "match" && (
          <MatchExercise
            key={currentExercise._id}
            prompt={currentExercise.prompt}
            payload={currentExercise.payload as any}
            onSubmit={handleSubmit}
            onSkip={handleAdvance}
            disabled={exerciseDisabled}
            isCorrect={isCorrect}
          />
        )}
        {currentExercise.type === "order" && (
          <OrderExercise
            key={currentExercise._id}
            prompt={currentExercise.prompt}
            payload={currentExercise.payload as any}
            onSubmit={handleSubmit}
            onSkip={handleAdvance}
            disabled={exerciseDisabled}
            isCorrect={isCorrect}
          />
        )}
        {currentExercise.type === "drag-drop" && (
          <DragDropExercise
            key={currentExercise._id}
            prompt={currentExercise.prompt}
            payload={currentExercise.payload as any}
            onSubmit={handleSubmit}
            onSkip={handleAdvance}
            disabled={exerciseDisabled}
            isCorrect={isCorrect}
          />
        )}
        {currentExercise.type === "short-answer" && (
          <ShortAnswerExercise
            key={currentExercise._id}
            prompt={currentExercise.prompt}
            payload={currentExercise.payload as any}
            onSubmit={handleSubmit}
            disabled={exerciseDisabled}
            isCorrect={isCorrect}
          />
        )}
      </div>

      {/* Loading indicator */}
      {isSubmitting && (
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Verification...</span>
        </div>
      )}

      {/* Hints — unlocked progressively as the student tries more times */}
      {showHintButton && (
        <button
          onClick={handleRevealHint}
          className="flex items-center gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-3 text-base font-semibold text-amber-800 transition-all hover:bg-amber-100 hover:shadow-md"
        >
          <Lightbulb className="h-5 w-5" />
          Voir un indice ({hintsRevealed}/{availableHints.length})
        </button>
      )}

      {/* Locked-hint hint: tell the student when the next hint will unlock */}
      {!showHintButton &&
        !showRevealedAnswer &&
        isCorrect !== true &&
        hintsRevealed < availableHints.length &&
        nextHintInAttempts !== null && (
          <div className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 px-5 py-3 text-sm font-medium text-gray-500">
            <Lightbulb className="h-4 w-4" />
            Prochain indice débloqué après{" "}
            {nextHintInAttempts} essai{nextHintInAttempts !== 1 ? "s" : ""}{" "}
            supplémentaire{nextHintInAttempts !== 1 ? "s" : ""}.
          </div>
        )}

      {hintsRevealed > 0 && (
        <div className="space-y-2">
          {availableHints.slice(0, hintsRevealed).map((hint, i) => (
            <div
              key={i}
              className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-5 py-3 text-base text-amber-800"
            >
              <span className="font-bold">Indice {i + 1} : </span>
              {hint}
            </div>
          ))}
        </div>
      )}

      {/* Revealed answer + AI explanation */}
      {showRevealedAnswer && (
        <div className="space-y-4">
          {correctAnswer && (
            <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 px-5 py-4 text-base text-indigo-800">
              <span className="font-bold">La bonne réponse était : </span>
              {correctAnswer}
            </div>
          )}

          <div className="rounded-2xl border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50 px-5 py-4">
            <div className="flex items-center gap-2 mb-2 text-purple-700 font-bold">
              <Sparkles className="h-5 w-5" />
              <span>Explication personnalisée</span>
            </div>
            {aiExplanationLoading ? (
              <div className="flex items-center gap-2 text-purple-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">L&apos;assistant prépare ton explication…</span>
              </div>
            ) : (
              <p className="text-base text-purple-900 whitespace-pre-line leading-relaxed">
                {aiExplanation ?? "Pas d'inquiétude, tu vas y arriver !"}
              </p>
            )}
          </div>

          <button
            onClick={handleAdvance}
            disabled={aiExplanationLoading}
            className="flex items-center justify-center gap-2 w-full rounded-2xl bg-gradient-to-r from-indigo-400 to-purple-500 px-6 py-4 text-lg font-bold text-white shadow-lg transition-all hover:shadow-xl hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Exercice suivant
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Attempt counter */}
      {attemptCount > 0 && isCorrect !== true && !showRevealedAnswer && (
        <div className="text-center text-sm text-gray-500">
          Tentative {attemptCount}/{MAX_ATTEMPTS}
        </div>
      )}

      {/* Paywall (spec §5.8) : attempts.submit lève une ConvexError de
          données { code: "ACCESS_DENIED", reason } quand l'école n'a plus
          d'accès valide — reconnue par isAccessDenied(), jamais par le
          message, que Convex occulte hors développement. Même copy que
          AccessGate et que la variante SceneAlert "access-blocked" de
          session/page.tsx — jamais le code brut ni la raison. */}
      <StudentAlertDialog
        open={accessBlocked}
        onOpenChange={(open) => {
          if (!open) setAccessBlocked(false);
        }}
        tone="info"
        label="Petit blocage"
        title="Message pour toi"
        description={kidMessages.accessNotOpen}
        primaryLabel="J'ai compris"
        onPrimary={() => setAccessBlocked(false)}
      />
    </div>
  );
}
