"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useAction, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Lightbulb,
  LockKeyhole,
  Sparkles,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";
import Link from "next/link";

import { JotnaLoader } from "@/components/jotna-loader";
import { playCorrect, setSoundEnabledLocal } from "@/lib/sounds";
import { PalierStarsBar } from "@/components/star-rating";
import { CapRegenAlternatives } from "@/components/cap-regen-alternatives";
import { kidMessages } from "@/lib/kidCopy";
import { isAccessDenied } from "@/lib/accessCopy";
import { ExplainStepByStep } from "@/components/student/explain-step-by-step";
import { Pio } from "@/components/student/pio";
import { StudentAlertDialog } from "@/components/student/student-alert-dialog";
import QcmExercise from "@/components/exercises/QcmExercise";
import ShortAnswerExercise from "@/components/exercises/ShortAnswerExercise";
import MatchExercise from "@/components/exercises/MatchExercise";
import OrderExercise from "@/components/exercises/OrderExercise";
import DragDropExercise from "@/components/exercises/DragDropExercise";
import { motion, AnimatePresence } from "framer-motion";

type SanitizedExo = {
  _id: Id<"exercises">;
  type: "qcm" | "drag-drop" | "match" | "order" | "short-answer";
  prompt: string;
  payload: Record<string, unknown>;
  hintsAvailable: number;
  palierAttemptId: Id<"palierAttempts">;
  isVariation: boolean;
};

type PalierResult = {
  status: "validated" | "failed";
  average: number;
  starsTotal: number;
  threshold: number;
  failedCount: number;
  canRegen: boolean;
  cumulativeRegens: number;
};

type SceneAlert =
  | { type: "regen-error"; message: string }
  | { type: "access-blocked" }
  | { type: "parent-notified" }
  | { type: "quit-confirm" };

type AttemptProgress = {
  currentIndex: number;
  completedCount: number;
  totalCount: number;
  failedAttemptsThisExo: number;
  hintsUsedThisExo: number;
};

export default function TopicSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: topicId } = use(params);
  const searchParams = useSearchParams();
  const palierIndex = parseInt(searchParams.get("palier") ?? "1", 10);

  return <PalierSession key={`${topicId}-${palierIndex}`} topicId={topicId} palierIndex={palierIndex} />;
}

function PalierSession({ topicId, palierIndex }: { topicId: string; palierIndex: number }) {
  const router = useRouter();

  // Wait for Convex auth before querying profile (Decision 99 — anti race-condition)
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const profile = useQuery(
    api.profiles.getCurrentProfile,
    isAuthenticated ? {} : "skip",
  );
  const topic = useQuery(api.topics.getById, {
    id: topicId as Id<"topics">,
  });

  const getBucket = useAction(api.paliers.index.getBucket);
  const startAttempt = useMutation(api.paliers.index.startPalierAttempt);
  const verifyAttempt = useMutation(api.palierAttempts.verifyAttempt);
  const requestHint = useMutation(api.palierAttempts.requestHint);
  const submitPalier = useMutation(api.palierAttempts.submitPalier);
  const regenerate = useAction(api.paliers.index.regenerateFailedExercises);
  // D22 — quick-mute support during session focus mode
  const soundPref = useQuery(api.students.getMySoundEnabled);
  const setSoundEnabled = useMutation(api.streak.setSoundEnabled);

  // Bootstrap state
  const [palierAttemptId, setPalierAttemptId] =
    useState<Id<"palierAttempts"> | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);

  // Load exercises (only when palierAttemptId ready)
  const exercises = useQuery(
    api.paliers.index.getExercisesForPalier,
    palierAttemptId ? { palierAttemptId } : "skip",
  ) as SanitizedExo[] | null | undefined;
  const attemptProgress = useQuery(
    api.palierAttempts.getProgressForPalierAttempt,
    palierAttemptId ? { palierAttemptId } : "skip",
  ) as AttemptProgress | null | undefined;

  // Palier loop state
  const [localCurrentIndex, setLocalCurrentIndex] = useState(0);
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    attemptsRemaining: number;
  } | null>(null);
  const [hintShown, setHintShown] = useState<{
    text: string;
    index: number;
  } | null>(null);
  const [localHintsUsedThisExo, setLocalHintsUsedThisExo] = useState(0);
  const [localFailedAttemptsThisExo, setLocalFailedAttemptsThisExo] =
    useState(0);
  const [palierResult, setPalierResult] = useState<PalierResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [sceneAlert, setSceneAlert] = useState<SceneAlert | null>(null);
  const [localStateAttemptId, setLocalStateAttemptId] =
    useState<Id<"palierAttempts"> | null>(null);
  // Step-by-step explanation panel — opened when the kid taps
  // "Je veux comprendre" after exhausting all 5 attempts on an exercise.
  const [explainOpen, setExplainOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // Network status (Decision 90)
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // D29 — sync local sound memo with server preference for play() short-circuit.
  useEffect(() => {
    if (soundPref?.soundEnabled !== undefined) {
      setSoundEnabledLocal(soundPref.soundEnabled);
    }
  }, [soundPref?.soundEnabled]);

  const handleToggleSound = useCallback(async () => {
    const next = !(soundPref?.soundEnabled ?? false);
    setSoundEnabledLocal(next);
    try {
      await setSoundEnabled({ enabled: next });
    } catch {
      // Mutation will queue offline; UI reflects optimistic state via memo.
    }
  }, [soundPref?.soundEnabled, setSoundEnabled]);

  // Bootstrap : getBucket → startAttempt
  useEffect(() => {
    if (!topic || palierAttemptId || bootstrapping || bootstrapError) return;
    (async () => {
      setBootstrapping(true);
      setBootstrapError(null);
      try {
        if (!topic.class) {
          setBootstrapError(
            "Cette thématique n'a pas encore de classe assignée.",
          );
          return;
        }
        const bucket = await getBucket({
          subjectId: topic.subjectId,
          class: topic.class as
            | "CI"
            | "CP"
            | "CE1"
            | "CE2"
            | "CM1"
            | "CM2",
          topicId: topicId as Id<"topics">,
          palierIndex,
        });
        const attemptId = await startAttempt({ palierId: bucket.palierId });
        setPalierAttemptId(attemptId);
      } catch (err: unknown) {
        let msg = err instanceof Error ? err.message : String(err ?? "Erreur inconnue");
        const match = msg.match(/Uncaught Error:\s*(.+?)(?:\n|$)/);
        if (match) msg = match[1].trim();
        setBootstrapError(
          isAccessDenied(err) ? kidMessages.accessNotOpen : msg,
        );
      } finally {
        setBootstrapping(false);
      }
    })();
  }, [
    topic,
    palierAttemptId,
    bootstrapping,
    bootstrapError,
    getBucket,
    startAttempt,
    topicId,
    palierIndex,
  ]);

  const shouldUseServerProgress =
    palierAttemptId !== null &&
    localStateAttemptId !== palierAttemptId &&
    attemptProgress !== null &&
    attemptProgress !== undefined;
  const currentIndex = shouldUseServerProgress
    ? attemptProgress.currentIndex
    : localCurrentIndex;
  const hintsUsedThisExo = shouldUseServerProgress
    ? attemptProgress.hintsUsedThisExo
    : localHintsUsedThisExo;
  const failedAttemptsThisExo = shouldUseServerProgress
    ? attemptProgress.failedAttemptsThisExo
    : localFailedAttemptsThisExo;

  const handleQuit = useCallback(() => {
    setSceneAlert({ type: "quit-confirm" });
  }, []);

  const nextExoRef = useRef<() => void>(() => {});

  const handleRequestHint = useCallback(async () => {
    if (!exercises || !palierAttemptId) return;
    const exo = exercises[currentIndex];
    if (!exo) return;
    if (hintsUsedThisExo >= exo.hintsAvailable) return;
    try {
      const res = await requestHint({
        exerciseId: exo._id,
        palierAttemptId,
        hintIndex: hintsUsedThisExo,
      });
      setLocalStateAttemptId(palierAttemptId);
      setHintShown({ text: res.hint, index: res.hintIndex });
      setLocalHintsUsedThisExo(hintsUsedThisExo + 1);
    } catch (err) {
      if (isAccessDenied(err)) {
        setSceneAlert({ type: "access-blocked" });
      } else {
        console.error(err);
      }
    }
  }, [exercises, palierAttemptId, currentIndex, hintsUsedThisExo, requestHint]);

  const handleNextExo = useCallback(async () => {
    if (!exercises) return;
    if (palierAttemptId) setLocalStateAttemptId(palierAttemptId);
    setFeedback(null);
    setHintShown(null);
    setLocalHintsUsedThisExo(0);
    setLocalFailedAttemptsThisExo(0);
    if (currentIndex < exercises.length - 1) {
      setLocalCurrentIndex(currentIndex + 1);
      return;
    }
    // End of palier — submit
    if (!palierAttemptId) return;
    setSubmitting(true);
    try {
      const res = await submitPalier({ palierAttemptId });
      setPalierResult(res as PalierResult);
    } catch (err) {
      if (isAccessDenied(err)) {
        setSceneAlert({ type: "access-blocked" });
      } else {
        console.error(err);
      }
    } finally {
      setSubmitting(false);
    }
  }, [exercises, currentIndex, palierAttemptId, submitPalier]);

  useEffect(() => {
    nextExoRef.current = handleNextExo;
  }, [handleNextExo]);

  const handleSubmitAnswer = useCallback(
    async (answer: string) => {
      if (!exercises || !palierAttemptId) return;
      const exo = exercises[currentIndex];
      if (!exo) return;
      try {
        const res = await verifyAttempt({
          exerciseId: exo._id,
          palierAttemptId,
          userAnswer: answer,
        });
        setFeedback({
          correct: res.isCorrect,
          attemptsRemaining: res.attemptsRemaining,
        });
        if (res.isCorrect) {
          setLocalStateAttemptId(palierAttemptId);
          void playCorrect();
          setTimeout(() => nextExoRef.current(), 1200);
        } else {
          setLocalStateAttemptId(palierAttemptId);
          setLocalFailedAttemptsThisExo(failedAttemptsThisExo + 1);
          if (res.attemptsRemaining > 0) {
            setTimeout(() => setFeedback(null), 2500);
          }
        }
      } catch (err) {
        if (isAccessDenied(err)) {
          setSceneAlert({ type: "access-blocked" });
        } else {
          console.error(err);
        }
      }
    },
    [
      exercises,
      palierAttemptId,
      currentIndex,
      failedAttemptsThisExo,
      verifyAttempt,
    ],
  );

  const handleRegen = useCallback(async () => {
    if (!palierAttemptId) return;
    setRegenerating(true);
    try {
      await regenerate({ palierAttemptId });
      setPalierResult(null);
      setLocalStateAttemptId(palierAttemptId);
      setLocalCurrentIndex(0);
      setFeedback(null);
      setHintShown(null);
      setLocalHintsUsedThisExo(0);
      setLocalFailedAttemptsThisExo(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur";
      if (isAccessDenied(err)) {
        setSceneAlert({ type: "access-blocked" });
      } else {
        setSceneAlert({ type: "regen-error", message: msg });
      }
    } finally {
      setRegenerating(false);
    }
  }, [palierAttemptId, regenerate]);

  // ==== RENDER ====

  // Loading states — wait for auth resolution AND queries
  if (authLoading || (isAuthenticated && profile === undefined) || topic === undefined) {
    return <JotnaLoader />;
  }
  if (!isAuthenticated || profile === null) {
    return (
      <CenteredCard>
        <h2 className="text-xl font-bold">Non connecté</h2>
        <p className="text-gray-500">Connecte-toi pour faire les exercices.</p>
        <Link
          href="/login"
          className="rounded-2xl bg-gradient-to-r from-orange-400 to-pink-500 px-6 py-3 text-base font-bold text-white shadow-lg"
        >
          Se connecter
        </Link>
      </CenteredCard>
    );
  }
  if (!topic) {
    return (
      <CenteredCard>
        <BookOpen className="h-16 w-16 text-gray-300" />
        <h2 className="text-xl font-bold">Thématique introuvable</h2>
      </CenteredCard>
    );
  }

  if (bootstrapError) {
    const isPalierLocked = bootstrapError.includes("valider le palier");
    if (isPalierLocked && palierIndex > 1) {
      return (
        <LockedPalierScreen
          currentPalier={palierIndex}
          previousPalier={palierIndex - 1}
          message={bootstrapError}
          onGoPrevious={() =>
            router.replace(
              `/student/topics/${topicId}/session?palier=${palierIndex - 1}`,
            )
          }
        />
      );
    }

    return (
      <CenteredCard>
        <p className="text-base text-red-600">{bootstrapError}</p>
        <button
          onClick={() => router.back()}
          className="rounded-2xl bg-gray-200 px-6 py-2 text-base font-semibold"
        >
          Retour
        </button>
      </CenteredCard>
    );
  }

  if (
    !palierAttemptId ||
    exercises === undefined ||
    attemptProgress === undefined
  ) {
    return <JotnaLoader />;
  }
  if (exercises === null || exercises.length === 0) {
    return (
      <CenteredCard>
        <BookOpen className="h-16 w-16 text-gray-300" />
        <h2 className="text-xl font-bold">Aucun exercice disponible</h2>
        <button
          onClick={() => router.back()}
          className="rounded-2xl bg-gradient-to-r from-orange-400 to-pink-500 px-6 py-3 text-base font-bold text-white shadow-lg"
        >
          Retour
        </button>
      </CenteredCard>
    );
  }

  // Final palier screen
  if (palierResult) {
    const validated = palierResult.status === "validated";
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`rounded-3xl p-8 text-center text-white shadow-xl ${
            validated
              ? "bg-gradient-to-r from-green-400 to-emerald-500"
              : "bg-gradient-to-r from-orange-400 via-pink-500 to-purple-500"
          }`}
        >
          <h1 className="text-3xl font-extrabold mb-3">
            {validated
              ? kidMessages.palierValidatedShort
              : "Palier non validé"}
          </h1>
          <p className="text-lg opacity-90 mb-4">
            {validated
              ? kidMessages.palierValidated(palierResult.starsTotal)
              : kidMessages.palierFailed(palierResult.starsTotal)}
          </p>
          <div className="mx-auto max-w-sm">
            <PalierStarsBar
              starsTotal={palierResult.starsTotal}
              threshold={palierResult.threshold * 3}
            />
          </div>
        </motion.div>

        {!validated && palierResult.canRegen && !regenerating && (
          <div className="text-center space-y-3">
            <p className="text-base text-gray-700">{kidMessages.regenIntro}</p>
            <button
              onClick={handleRegen}
              className="rounded-2xl bg-gradient-to-r from-orange-400 to-pink-500 px-8 py-3 text-lg font-bold text-white shadow-lg hover:scale-[1.02] transition-all"
            >
              {kidMessages.regenCta}
            </button>
          </div>
        )}

        {regenerating && (
          <JotnaLoader message={kidMessages.regenLoading} />
        )}

        {!validated && !palierResult.canRegen && (
          <CapRegenAlternatives
            onSeeCorrected={() =>
              router.push(`/student/topics/${topicId}/session?palier=${palierIndex}&review=1`)
            }
            previousPalierHref={
              palierIndex > 1
                ? `/student/topics/${topicId}/session?palier=${palierIndex - 1}`
                : null
            }
            onAskParent={() => {
              setSceneAlert({ type: "parent-notified" });
            }}
          />
        )}

        {validated && (
          <div className="text-center">
            <Link
              href={`/student/topics/${topicId}/session?palier=${palierIndex + 1}`}
              className="inline-block rounded-2xl bg-gradient-to-r from-orange-400 to-pink-500 px-8 py-3 text-lg font-bold text-white shadow-lg hover:scale-[1.02] transition-all"
            >
              Palier suivant 🚀
            </Link>
          </div>
        )}
        <SceneAlertDialog
          alert={sceneAlert}
          onClose={() => setSceneAlert(null)}
          onGoHome={() => {
            setSceneAlert(null);
            router.push("/student/home");
          }}
          onQuit={() => {
            setSceneAlert(null);
            if (topic?.subjectId) {
              router.push(`/student/subjects/${topic.subjectId}`);
            } else {
              router.push("/student/home");
            }
          }}
        />
      </div>
    );
  }

  // In-progress palier player
  const exo = exercises[currentIndex];
  const totalExos = exercises.length;
  const disabled = feedback !== null;

  return (
    <div className="relative mx-auto max-w-2xl py-4">
      {/* Network drop banner (Decision 90) */}
      {!isOnline && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-yellow-100 px-4 py-2 text-sm text-yellow-800">
          <WifiOff className="h-4 w-4" />
          {kidMessages.networkLost}
        </div>
      )}

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          <span className="font-semibold text-gray-700">
            {topic.name ?? "Palier"} — niveau {palierIndex}
          </span>
          <span className="mx-2">·</span>
          <span>
            Question {currentIndex + 1}/{totalExos}
          </span>
          {exo?.isVariation && (
            <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
              Variation
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* D22 — quick-mute. Only renders if the kid has decided about
              sounds (soundPref !== null + .soundEnabled defined). Hides for
              brand-new students who haven't seen the opt-in dialog yet. */}
          {soundPref && (
            <button
              type="button"
              onClick={handleToggleSound}
              aria-label={
                soundPref.soundEnabled
                  ? "Couper le son"
                  : "Activer le son"
              }
              aria-pressed={soundPref.soundEnabled}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/70 text-gray-600 shadow-sm transition-all hover:bg-white"
            >
              {soundPref.soundEnabled ? (
                <Volume2 className="h-5 w-5" aria-hidden />
              ) : (
                <VolumeX className="h-5 w-5" aria-hidden />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleQuit}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-white"
          >
            <X className="h-4 w-4" />
            {kidMessages.cta.quit}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <motion.div
          initial={{ width: 0 }}
          animate={{
            width: `${((currentIndex + (feedback?.correct ? 1 : 0)) / totalExos) * 100}%`,
          }}
          className="h-full bg-gradient-to-r from-orange-400 to-pink-500"
        />
      </div>

      {/* Exercise */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${exo._id}-${feedback?.correct ?? "pending"}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="rounded-3xl bg-white p-6 shadow-md"
        >
          <ExerciseRenderer
            exo={exo}
            disabled={disabled}
            isCorrect={feedback?.correct ?? null}
            onSubmit={handleSubmitAnswer}
            onSkip={handleNextExo}
          />

          {/* Hints — progressive: first hint unlocks after 1 failed attempt,
              second after 2, third after 4. Only shown when the kid has failed
              at least once and isn't currently seeing feedback. */}
          {!feedback && failedAttemptsThisExo > 0 && exo.hintsAvailable > 0 && (
            <div className="mt-4 space-y-2">
              {hintsUsedThisExo < exo.hintsAvailable &&
                hintsUsedThisExo < (failedAttemptsThisExo >= 4 ? 3 : failedAttemptsThisExo >= 2 ? 2 : 1) && (
                <button
                  onClick={handleRequestHint}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800 transition-all hover:bg-amber-200"
                >
                  <Lightbulb className="h-4 w-4" />
                  Voir un indice
                </button>
              )}
              {hintShown && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl bg-amber-50 border border-amber-200 p-3"
                >
                  <p className="text-sm text-amber-900">
                    <span className="font-semibold">
                      Indice {hintShown.index + 1} :
                    </span>{" "}
                    {hintShown.text}
                  </p>
                </motion.div>
              )}
            </div>
          )}

          {/* Feedback — brief flash, no buttons. Auto-dismisses (correct →
              auto-advance after 1.2s, wrong with retries → auto-clear 1.2s,
              wrong with 0 retries → stays until "Je veux comprendre" or next). */}
          <AnimatePresence>
            {feedback && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="mt-4 space-y-3"
              >
                <div
                  className={`rounded-xl px-4 py-3 text-center font-semibold ${
                    feedback.correct
                      ? "bg-green-100 text-green-800"
                      : "bg-orange-100 text-orange-800"
                  }`}
                >
                  {feedback.correct
                    ? "Bravo !"
                    : feedback.attemptsRemaining > 0
                      ? `Pas tout à fait…`
                      : "Tu peux passer à la suite."}
                </div>
                {!feedback.correct && feedback.attemptsRemaining === 0 && (
                  <>
                    <button
                      onClick={() => setExplainOpen(true)}
                      disabled={submitting}
                      className="flex w-full min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-orange-300 bg-amber-50 px-6 py-3 text-base font-bold text-orange-700 shadow-sm hover:bg-amber-100 transition-all"
                    >
                      <Lightbulb className="h-5 w-5" aria-hidden />
                      Je veux comprendre
                    </button>
                    <button
                      onClick={handleNextExo}
                      disabled={submitting}
                      className="w-full rounded-2xl bg-gradient-to-r from-orange-400 to-pink-500 px-6 py-3 text-lg font-bold text-white shadow-lg hover:scale-[1.01] transition-all"
                    >
                      {currentIndex < totalExos - 1
                        ? kidMessages.cta.next
                        : submitting
                          ? "..."
                          : "Voir mon résultat"}
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      {/* Step-by-step pedagogical explanation overlay (kid clicked
          "Je veux comprendre" after exhausting all 5 attempts). The
          `key={exo._id}` forces a remount on exercise change so the
          loading state resets cleanly without setState-in-effect. */}
      {exo && (
        <ExplainStepByStep
          key={exo._id}
          exerciseId={exo._id}
          open={explainOpen}
          onClose={() => setExplainOpen(false)}
        />
      )}
      <SceneAlertDialog
        alert={sceneAlert}
        onClose={() => setSceneAlert(null)}
        onGoHome={() => {
          setSceneAlert(null);
          router.push("/student/home");
        }}
        onQuit={() => {
          setSceneAlert(null);
          if (topic?.subjectId) {
            router.push(`/student/subjects/${topic.subjectId}`);
          } else {
            router.push("/student/home");
          }
        }}
      />
    </div>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

function SceneAlertDialog({
  alert,
  onClose,
  onGoHome,
  onQuit,
}: {
  alert: SceneAlert | null;
  onClose: () => void;
  onGoHome: () => void;
  onQuit: () => void;
}) {
  if (alert?.type === "quit-confirm") {
    return (
      <StudentAlertDialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        tone="warning"
        label="Pause possible"
        title="Tu veux quitter ?"
        description="Ta progression est sauvegardée. Tu pourras reprendre plus tard."
        primaryLabel="Sauvegarder et quitter"
        onPrimary={onQuit}
        secondaryLabel="Continuer l'exercice"
        onSecondary={onClose}
      />
    );
  }

  if (alert?.type === "parent-notified") {
    return (
      <StudentAlertDialog
        open
        onOpenChange={(open) => {
          if (!open) onGoHome();
        }}
        tone="info"
        label="Message envoyé"
        title="Pio prévient ton parent"
        description="Ton parent va recevoir une notification pour t'aider à continuer."
        primaryLabel="Retour à l'accueil"
        onPrimary={onGoHome}
      />
    );
  }

  if (alert?.type === "regen-error") {
    return (
      <StudentAlertDialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        tone="warning"
        label="Petit blocage"
        title="On réessaie dans un instant"
        description={alert.message}
        primaryLabel="J'ai compris"
        onPrimary={onClose}
      />
    );
  }

  if (alert?.type === "access-blocked") {
    return (
      <StudentAlertDialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        tone="info"
        label="Petit blocage"
        title="Message pour toi"
        description={kidMessages.accessNotOpen}
        primaryLabel="J'ai compris"
        onPrimary={onClose}
      />
    );
  }

  return null;
}

function LockedPalierScreen({
  currentPalier,
  previousPalier,
  message,
  onGoPrevious,
}: {
  currentPalier: number;
  previousPalier: number;
  message: string;
  onGoPrevious: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative w-full overflow-hidden rounded-3xl bg-gradient-to-br from-amber-300 via-orange-300 to-pink-400 p-1 shadow-2xl"
      >
        <div className="absolute left-8 top-8 h-8 w-8 rotate-12 rounded-lg bg-white/35" />
        <div className="absolute right-10 top-10 h-7 w-7 -rotate-12 rounded-md bg-sky-200/70" />
        <div className="absolute bottom-12 left-12 h-6 w-6 rotate-45 rounded-md bg-emerald-200/70" />

        <div className="relative rounded-[1.35rem] bg-white/92 px-5 py-7 text-center sm:px-8 sm:py-8">
          <div className="mx-auto mb-3 flex h-36 w-36 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-pink-100 shadow-inner">
            <Pio state="hello" size={122} />
          </div>

          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-orange-700">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
            Palier {currentPalier} verrouillé
          </div>

          <h1 className="font-display text-3xl font-extrabold leading-tight text-slate-950 sm:text-4xl">
            Encore une marche avant !
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base font-semibold text-slate-600">
            Pio garde ce palier au chaud. Termine d&apos;abord le palier{" "}
            {previousPalier}, puis la suite s&apos;ouvrira.
          </p>

          <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-2">
            <StepBubble
              active
              icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
              label={`Palier ${previousPalier}`}
            />
            <StepBubble
              active={false}
              icon={<LockKeyhole className="h-5 w-5" aria-hidden />}
              label={`Palier ${currentPalier}`}
            />
            <StepBubble
              active={false}
              icon={<Sparkles className="h-5 w-5" aria-hidden />}
              label="Après"
            />
          </div>

          <p className="mx-auto mt-5 max-w-md rounded-2xl bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500">
            {message}
          </p>

          <button
            type="button"
            onClick={onGoPrevious}
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-400 to-pink-500 px-6 py-3 text-base font-extrabold text-white shadow-lg transition-all hover:scale-[1.01] hover:shadow-xl sm:w-auto"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
            Reprendre le palier {previousPalier}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function StepBubble({
  active,
  icon,
  label,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div
      className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border-2 px-2 py-3 ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-400"
      }`}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm">
        {icon}
      </div>
      <p className="text-xs font-extrabold">{label}</p>
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4 text-center">
      {children}
    </div>
  );
}

function ExerciseRenderer({
  exo,
  disabled,
  isCorrect,
  onSubmit,
  onSkip,
}: {
  exo: SanitizedExo;
  disabled: boolean;
  isCorrect: boolean | null;
  onSubmit: (answer: string) => void;
  onSkip?: () => void;
}) {
  // Existing components expect payloads with the answer fields; we pass the
  // sanitized payload as-is. They render UI without the answer, which is fine
  // because verification now happens server-side via mutation.
  switch (exo.type) {
    case "qcm":
      return (
        <QcmExercise
          prompt={exo.prompt}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload={exo.payload as any}
          disabled={disabled}
          isCorrect={isCorrect}
          onSubmit={onSubmit}
          onSkip={onSkip}
        />
      );
    case "short-answer":
      return (
        <ShortAnswerExercise
          prompt={exo.prompt}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload={exo.payload as any}
          disabled={disabled}
          isCorrect={isCorrect}
          onSubmit={onSubmit}
        />
      );
    case "match":
      return (
        <MatchExercise
          prompt={exo.prompt}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload={exo.payload as any}
          disabled={disabled}
          isCorrect={isCorrect}
          onSubmit={onSubmit}
          onSkip={onSkip}
        />
      );
    case "order":
      return (
        <OrderExercise
          prompt={exo.prompt}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload={exo.payload as any}
          disabled={disabled}
          isCorrect={isCorrect}
          onSubmit={onSubmit}
          onSkip={onSkip}
        />
      );
    case "drag-drop":
      return (
        <DragDropExercise
          prompt={exo.prompt}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload={exo.payload as any}
          disabled={disabled}
          isCorrect={isCorrect}
          onSubmit={onSubmit}
          onSkip={onSkip}
        />
      );
    default:
      return <p>Type d&apos;exercice non supporté</p>;
  }
}
