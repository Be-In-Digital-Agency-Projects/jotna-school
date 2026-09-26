import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type {
  QcmClientPayload,
  ShortAnswerClientPayload,
} from "@convex/paliers/answers";
import { kidMessages } from "@lib/kidCopy";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";
import { QcmInput } from "./qcm";
import { ShortAnswerInput } from "./short-answer";
import type { SanitizedExercise } from "./types";

export interface VerifyOutcome {
  isCorrect: boolean;
  attemptNumber: number;
  attemptsRemaining: number;
}

export interface ExercisePlayerProps {
  exercise: SanitizedExercise;
  position: { index: number; total: number };
  /** Envoie la réponse encodée au serveur. Le lecteur est le SEUL appelant. */
  onVerify: (encoded: string, timeSpentMs: number) => Promise<VerifyOutcome>;
  /** Demande l'indice suivant. Rend son texte. */
  onRequestHint: (hintIndex: number) => Promise<string>;
  /** L'enfant a fini avec cet exercice — juste ou épuisé. */
  onNext: () => void;
}

type Phase =
  | { kind: "answering" }
  | { kind: "sending" }
  | { kind: "wrong"; attemptsRemaining: number }
  | { kind: "exhausted" }
  | { kind: "correct" };

/**
 * LE LECTEUR D'EXERCICE — il orchestre, il n'affiche pas les réponses.
 *
 * TROIS RÈGLES QU'IL TIENT, ET QUI VIENNENT DU SERVEUR, PAS DU GOÛT :
 *
 *   1. CINQ ESSAIS AU PLUS. `verifyAttempt` rend `attemptsRemaining`, et
 *      `computeExerciseScore` note 10, 7, 4, 1, 1 selon le rang du succès.
 *      Le lecteur AFFICHE ce que le serveur a compté, il ne le recalcule pas :
 *      deux comptes d'essais qui se suivraient finiraient par diverger.
 *   2. LES INDICES ARRIVENT UN PAR UN, du serveur (`requestHint`). Chacun
 *      retire un point au score, et l'enfant en est prévenu AVANT de le
 *      demander — pas après, quand il ne peut plus revenir en arrière.
 *   3. LE TEMPS EST CELUI DE L'EXERCICE, pas de la session : le chronomètre
 *      repart à chaque exercice et s'envoie à la vérification.
 *
 * IL NE CONNAÎT AUCUN CORRIGÉ. Le verdict vient de `onVerify`, donc du
 * serveur : c'est la Décision 61, et c'est ce qui fera la différence en phase 3
 * quand le hors-ligne descendra une EMPREINTE, jamais la réponse.
 */
export function ExercisePlayer({
  exercise,
  position,
  onVerify,
  onRequestHint,
  onNext,
}: ExercisePlayerProps) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "answering" });
  const [attemptKey, setAttemptKey] = useState(0);
  const [hints, setHints] = useState<string[]>([]);
  const [hintBusy, setHintBusy] = useState(false);

  const startedAt = useRef(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
    setAnswer(null);
    setPhase({ kind: "answering" });
    setAttemptKey(0);
    setHints([]);
  }, [exercise._id]);

  const handleAnswer = useCallback((encoded: string | null) => {
    setAnswer(encoded);
  }, []);

  async function validate() {
    if (answer === null || phase.kind === "sending") return;
    setPhase({ kind: "sending" });
    try {
      const outcome = await onVerify(answer, Date.now() - startedAt.current);
      if (outcome.isCorrect) {
        setPhase({ kind: "correct" });
      } else if (outcome.attemptsRemaining <= 0) {
        setPhase({ kind: "exhausted" });
      } else {
        setPhase({ kind: "wrong", attemptsRemaining: outcome.attemptsRemaining });
        setAnswer(null);
        setAttemptKey((k) => k + 1);
      }
    } catch {
      // Le réseau a lâché : on NE compte pas d'essai et on laisse réessayer.
      // Compter un essai qui n'a jamais atteint le serveur volerait un point
      // à l'enfant pour une panne qui n'est pas la sienne.
      setPhase({ kind: "wrong", attemptsRemaining: -1 });
    }
  }

  async function askHint() {
    if (hintBusy || hints.length >= exercise.hintsAvailable) return;
    setHintBusy(true);
    try {
      const text = await onRequestHint(hints.length);
      setHints((h) => [...h, text]);
    } catch {
      // Un indice qu'on n'a pas pu chercher n'empêche pas de répondre.
    } finally {
      setHintBusy(false);
    }
  }

  const locked = phase.kind !== "answering" && phase.kind !== "wrong";
  const hintsLeft = exercise.hintsAvailable - hints.length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.position}>
        Exercice {position.index + 1} sur {position.total}
      </Text>

      <Text style={styles.prompt}>{exercise.prompt}</Text>

      <ExerciseInput
        exercise={exercise}
        disabled={locked}
        onAnswer={handleAnswer}
        attemptKey={attemptKey}
      />

      {hints.map((hint, i) => (
        <View key={i} style={styles.hint}>
          <Text style={styles.hintLabel}>
            {kidMessages.hintLevel(i + 1, exercise.hintsAvailable)}
          </Text>
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      ))}

      <Feedback phase={phase} />

      {phase.kind === "correct" || phase.kind === "exhausted" ? (
        <BigButton label={kidMessages.cta.next} onPress={onNext} />
      ) : (
        <BigButton
          label={kidMessages.cta.submit}
          onPress={() => void validate()}
          disabled={answer === null}
          busy={phase.kind === "sending"}
        />
      )}

      {hintsLeft > 0 && !locked && (
        <BigButton
          label={`Un indice (${hintsLeft} restant${hintsLeft > 1 ? "s" : ""})`}
          onPress={() => void askHint()}
          busy={hintBusy}
          tone="quiet"
        />
      )}
    </ScrollView>
  );
}

/** Aiguille vers le composant du type. */
function ExerciseInput({
  exercise,
  disabled,
  onAnswer,
  attemptKey,
}: {
  exercise: SanitizedExercise;
  disabled: boolean;
  onAnswer: (encoded: string | null) => void;
  attemptKey: number;
}) {
  const common = { disabled, onAnswer, attemptKey };

  switch (exercise.type) {
    case "qcm":
      return <QcmInput payload={exercise.payload as QcmClientPayload} {...common} />;
    case "short-answer":
      return (
        <ShortAnswerInput
          payload={exercise.payload as ShortAnswerClientPayload}
          {...common}
        />
      );
    // Les trois types au doigt — remise en ordre, relier, glisser-déposer —
    // sont les tâches 2.5 à 2.7. Aucun parcours ne mène encore ici : le lecteur
    // n'est branché à aucune session. Ce panneau est explicite plutôt que muet,
    // pour qu'un branchement prématuré se voie tout de suite.
    default:
      return (
        <View style={styles.pending}>
          <Text style={styles.pendingText}>
            Ce type d&apos;exercice n&apos;est pas encore prêt sur mobile.
          </Text>
        </View>
      );
  }
}

function Feedback({ phase }: { phase: Phase }) {
  if (phase.kind === "correct") {
    return (
      <View style={[styles.feedback, styles.feedbackGood]}>
        <Text style={styles.feedbackText}>Bravo, c&apos;est juste ! 🎉</Text>
      </View>
    );
  }
  if (phase.kind === "exhausted") {
    return (
      <View style={[styles.feedback, styles.feedbackNeutral]}>
        <Text style={styles.feedbackText}>
          On passe à la suivante — tu reverras celle-ci plus tard 💪
        </Text>
      </View>
    );
  }
  if (phase.kind === "wrong") {
    return (
      <View style={[styles.feedback, styles.feedbackNeutral]} accessibilityLiveRegion="polite">
        <Text style={styles.feedbackText}>
          {phase.attemptsRemaining < 0
            ? kidMessages.networkLost
            : `Pas encore ! Il te reste ${phase.attemptsRemaining} essai${
                phase.attemptsRemaining > 1 ? "s" : ""
              }.`}
        </Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { padding: spacing.lg, gap: spacing.md },
  position: { fontSize: fontSize.body, color: colors.textMuted },
  prompt: {
    fontSize: fontSize.title,
    fontWeight: "700",
    lineHeight: 34,
    color: colors.text,
  },
  hint: {
    backgroundColor: "#fffbeb",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  hintLabel: { fontSize: fontSize.body, color: colors.textMuted },
  hintText: { fontSize: fontSize.label, lineHeight: 26, color: colors.text },
  feedback: { borderRadius: radius.md, padding: spacing.md },
  feedbackGood: { backgroundColor: "#ecfdf5" },
  feedbackNeutral: { backgroundColor: "#fffbeb" },
  feedbackText: { fontSize: fontSize.label, lineHeight: 26, color: colors.text },
  pending: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pendingText: { fontSize: fontSize.body, color: colors.textMuted },
});
