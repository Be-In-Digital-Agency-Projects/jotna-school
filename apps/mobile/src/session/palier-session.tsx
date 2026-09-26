import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { VISIBLE_CLASSES, type VisibleClassName } from "@convex/curriculum";
import { isAccessDenied } from "@lib/accessCopy";
import { kidMessages } from "@lib/kidCopy";
import { ExercisePlayer, type VerifyOutcome } from "@/exercises/exercise-player";
import { releaseSounds } from "@/feedback/sounds";
import type { SanitizedExercise } from "@/exercises/types";
import { PalierResult, type PalierOutcome } from "@/screens/palier-result";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

/** La classe du topic, si c'est une classe que le client a le droit d'ouvrir. */
function visibleClassOf(klass: string | undefined): VisibleClassName | null {
  return (VISIBLE_CLASSES as readonly string[]).includes(klass ?? "")
    ? (klass as VisibleClassName)
    : null;
}

/**
 * UNE SÉANCE DE PALIER, DE BOUT EN BOUT — tâches 2.8 et 2.10.
 *
 * C'est la pièce qui rend le reste réel : sans elle, le lecteur et les cinq
 * composants existent sans que rien ne se joue.
 *
 * L'AMORÇAGE SE FAIT UNE FOIS, ET C'EST GARDÉ PAR UN VERROU. `getBucket` peut
 * déclencher une GÉNÉRATION par IA — longue, et facturée. Un effet qui
 * repartirait à chaque rendu en lancerait plusieurs pour un seul enfant. Le
 * `ref` ci-dessous n'est donc pas une optimisation : c'est ce qui empêche de
 * dépenser deux fois.
 *
 * LA TENTATIVE SE CRÉE AVANT LES EXERCICES, dans cet ordre, parce que le
 * mélange des colonnes est semé avec son identifiant (`sanitizePayload`,
 * Décision 75). C'est aussi ce que la phase 3 exigera du téléchargement
 * hors-ligne (D14) : le même ordre, pour la même raison.
 *
 * AUCUN SCORE N'EST CALCULÉ ICI. `verifyAttempt` rend le verdict,
 * `submitPalier` rend les étoiles. L'appareil affiche ; il ne juge pas.
 */
export function PalierSession({
  topicId,
  palierIndex,
  onLeave,
}: {
  topicId: Id<"topics">;
  palierIndex: number;
  onLeave: () => void;
}) {
  const topic = useQuery(api.topics.getById, { id: topicId });

  const getBucket = useAction(api.paliers.index.getBucket);
  const startAttempt = useMutation(api.paliers.index.startPalierAttempt);
  const verify = useMutation(api.palierAttempts.verifyAttempt);
  const hint = useMutation(api.palierAttempts.requestHint);
  const submit = useMutation(api.palierAttempts.submitPalier);
  const regenerate = useAction(api.paliers.index.regenerateFailedExercises);
  const explain = useAction(api.attemptsExplain.generateExplanation);

  // La préférence de son vit côté SERVEUR, pour qu'elle suive l'enfant d'un
  // appareil à l'autre : une tablette d'école n'est pas la sienne. Tant que la
  // réponse n'est pas là, on ne joue rien — un son qui part chez un enfant qui
  // les avait coupés est pire que pas de son du tout.
  const soundPref = useQuery(api.students.getMySoundEnabled, {});
  const soundEnabled = soundPref?.soundEnabled === true;

  const [attemptId, setAttemptId] = useState<Id<"palierAttempts"> | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState<PalierOutcome | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenMessage, setRegenMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Le verrou d'amorçage — voir l'en-tête : il évite une seconde génération IA.
  const booting = useRef(false);

  // Les lecteurs audio sont des objets NATIFS : les laisser derrière soi à
  // chaque séance les accumule. On les libère en quittant.
  useEffect(() => releaseSounds, []);

  useEffect(() => {
    if (topic === undefined || topic === null) return;
    if (booting.current || attemptId !== null) return;
    booting.current = true;

    // `getBucket` n'accepte QUE les classes primaires visibles — son
    // `visibleClassValidator` refuse collège et lycée, qui existent en base
    // mais sont masqués (`convex/curriculum.ts`). Un topic peut aussi n'avoir
    // aucune classe. Le compilateur l'a signalé ; on le garde à l'exécution
    // plutôt que de forcer le type, sans quoi l'appel lèverait côté serveur et
    // l'enfant lirait une erreur de validateur.
    //
    // Ce cas ne s'atteint pas par la navigation de l'application :
    // `getStudentSubjectMap` filtre déjà les classes masquées. C'est une
    // deuxième ligne, pour un lien profond ou un contenu mal saisi.
    const klass = visibleClassOf(topic.class);
    if (klass === null) {
      setBootError(kidMessages.genFailed);
      booting.current = false;
      return;
    }

    void (async () => {
      try {
        const bucket = await getBucket({
          subjectId: topic.subjectId,
          class: klass,
          topicId,
          palierIndex,
        });
        const id = await startAttempt({ palierId: bucket.palierId });
        setAttemptId(id);
      } catch (error) {
        // Le mur d'accès parle d'argent à l'adulte, jamais à l'enfant.
        setBootError(
          isAccessDenied(error)
            ? kidMessages.accessNotOpen
            : kidMessages.genFailed,
        );
        booting.current = false;
      }
    })();
  }, [topic, topicId, palierIndex, attemptId, getBucket, startAttempt]);

  const exercises = useQuery(
    api.paliers.index.getExercisesForPalier,
    attemptId !== null ? { palierAttemptId: attemptId } : "skip",
  ) as SanitizedExercise[] | null | undefined;

  const onVerify = useCallback(
    async (encoded: string, timeSpentMs: number): Promise<VerifyOutcome> => {
      const current = exercises?.[index];
      if (!current || attemptId === null) {
        throw new Error("Exercice indisponible");
      }
      const result = await verify({
        exerciseId: current._id as Id<"exercises">,
        palierAttemptId: attemptId,
        userAnswer: encoded,
        timeSpentMs,
      });
      return {
        isCorrect: result.isCorrect,
        attemptNumber: result.attemptNumber,
        attemptsRemaining: result.attemptsRemaining,
      };
    },
    [exercises, index, attemptId, verify],
  );

  const onRequestHint = useCallback(
    async (hintIndex: number): Promise<string> => {
      const current = exercises?.[index];
      if (!current || attemptId === null) throw new Error("Indice indisponible");
      const result = await hint({
        exerciseId: current._id as Id<"exercises">,
        palierAttemptId: attemptId,
        hintIndex,
      });
      return result.hint;
    },
    [exercises, index, attemptId, hint],
  );

  const onExplain = useCallback(async (): Promise<string> => {
    const current = exercises?.[index];
    if (!current) throw new Error("Exercice indisponible");
    const result = await explain({ exerciseId: current._id as Id<"exercises"> });
    return result.explanation;
  }, [exercises, index, explain]);

  const onNext = useCallback(() => {
    if (exercises === undefined || exercises === null) return;
    if (index < exercises.length - 1) {
      setIndex((i) => i + 1);
      return;
    }
    if (attemptId === null || submitting) return;
    setSubmitting(true);
    void (async () => {
      try {
        const result = await submit({ palierAttemptId: attemptId });
        setOutcome(result as PalierOutcome);
      } catch {
        setRegenMessage(kidMessages.genFailed);
      } finally {
        setSubmitting(false);
      }
    })();
  }, [exercises, index, attemptId, submit, submitting]);

  const onRegen = useCallback(() => {
    if (attemptId === null || regenBusy) return;
    setRegenBusy(true);
    setRegenMessage(null);
    void (async () => {
      try {
        const result = await regenerate({ palierAttemptId: attemptId });
        if (result.ok) {
          // Les variations remplacent les exercices ratés SUR LA MÊME
          // tentative : la requête d'exercices se met à jour toute seule, on
          // n'a qu'à revenir au début et effacer le résultat précédent.
          setIndex(0);
          setOutcome(null);
        } else {
          // Le serveur écrit déjà un message d'enfant quand il en a un —
          // plafond de dépense IA, par exemple. On l'affiche tel quel.
          setRegenMessage(result.kidMessage ?? kidMessages.genFailed);
        }
      } catch {
        setRegenMessage(kidMessages.genFailed);
      } finally {
        setRegenBusy(false);
      }
    })();
  }, [attemptId, regenBusy, regenerate]);

  if (bootError !== null) {
    return <Blocked message={bootError} onLeave={onLeave} />;
  }

  if (outcome !== null) {
    return (
      <PalierResult
        outcome={outcome}
        regenBusy={regenBusy}
        regenMessage={regenMessage}
        onRegen={onRegen}
        onLeave={onLeave}
      />
    );
  }

  if (topic === null) {
    return <Blocked message={kidMessages.genFailed} onLeave={onLeave} />;
  }

  if (exercises === undefined || exercises === null || attemptId === null) {
    return <Preparing />;
  }

  if (exercises.length === 0) {
    return <Blocked message={kidMessages.genFailed} onLeave={onLeave} />;
  }

  const current = exercises[Math.min(index, exercises.length - 1)];

  return (
    <ExercisePlayer
      key={current._id}
      exercise={current}
      position={{ index, total: exercises.length }}
      onVerify={onVerify}
      onRequestHint={onRequestHint}
      onExplain={onExplain}
      onNext={onNext}
      soundEnabled={soundEnabled}
    />
  );
}

/** L'attente pendant que le serveur prépare — parfois une génération IA. */
function Preparing() {
  const [message, setMessage] = useState<string>(kidMessages.loaderMessages[0]);

  useEffect(() => {
    // Les messages tournent : une attente muette de vingt secondes fait croire
    // à un blocage, et un enfant de huit ans quitte l'application.
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % kidMessages.loaderMessages.length;
      setMessage(kidMessages.loaderMessages[i]);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.centerText}>{message}</Text>
    </View>
  );
}

function Blocked({ message, onLeave }: { message: string; onLeave: () => void }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.blocked}>
      <View style={styles.card}>
        <Text style={styles.cardText}>{message}</Text>
      </View>
      <BigButton label="Revenir à l'accueil" onPress={onLeave} tone="quiet" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: colors.backgroundTop,
  },
  centerText: { fontSize: fontSize.label, color: colors.textMuted },
  blocked: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  cardText: { fontSize: fontSize.label, lineHeight: 28, color: colors.text },
});
