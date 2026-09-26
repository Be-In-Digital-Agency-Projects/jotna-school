import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { VISIBLE_CLASSES, type VisibleClassName } from "@convex/curriculum";
import { isAccessDenied } from "@lib/accessCopy";
import { kidMessages } from "@lib/kidCopy";
import { ExercisePlayer, type VerifyOutcome } from "@/exercises/exercise-player";
import { releaseSounds } from "@/feedback/sounds";
import { OfflineBanner } from "@/offline/offline-banner";
import { makeOfflineEngine } from "@/offline/offline-engine";
import { useServerReach } from "@/session/reach";
import { closePendingPaliers, flushJournal } from "@/offline/sync";
import {
  enforceStorageCap,
  findUsableBundle,
  markPendingClose,
  saveBundle,
  type StoredBundle,
} from "@/offline/store";
import type { SanitizedExercise } from "@/exercises/types";
import { ChestWaiting } from "@/screens/chest-waiting";
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

  // TROIS ÉTATS, PAS DEUX (5.1). `connecting` n'est ni « en ligne » ni « hors
  // ligne » : lancer `getBucket` pendant que la socket s'ouvre donne une
  // action qui pend, et basculer sur le lot local donnerait à l'enfant un
  // palier hors-ligne alors que le réseau arrivait dans la seconde.
  const reach = useServerReach();
  const online = reach === "online";
  const syncJournal = useMutation(api.palierAttempts.syncOfflineJournal);

  /** Le lot local, quand la séance se joue SANS réseau. */
  const [stored, setStored] = useState<StoredBundle | null>(null);

  const [attemptId, setAttemptId] = useState<Id<"palierAttempts"> | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState<PalierOutcome | null>(null);
  /** L'enfant a passé le dernier exercice SANS réseau — 3.7, clôture différée. */
  const [finishedOffline, setFinishedOffline] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenMessage, setRegenMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Le verrou d'amorçage — voir l'en-tête : il évite une seconde génération IA.
  const booting = useRef(false);

  // Les lecteurs audio sont des objets NATIFS : les laisser derrière soi à
  // chaque séance les accumule. On les libère en quittant.
  useEffect(() => releaseSounds, []);

  // AMORÇAGE HORS LIGNE — on ne peut pas créer de tentative sans réseau, donc
  // on rejoue celle d'un lot DÉJÀ téléchargé (D14 : la tentative se crée au
  // téléchargement, précisément pour que ce moment-ci soit possible).
  useEffect(() => {
    // `reach === "offline"` ET NON `!online` : pendant le délai de grâce, la
    // condition `!online` est vraie, et l'on ouvrirait un lot local à un
    // enfant dont le réseau arrivait une seconde plus tard — qui perdrait
    // alors l'explication et « j'en veux encore » pour rien.
    if (reach !== "offline" || booting.current) return;
    if (attemptId !== null || stored !== null) return;
    booting.current = true;
    void (async () => {
      const bundle = await findUsableBundle(topicId, palierIndex, Date.now());
      if (bundle === null) {
        // Rien de téléchargé, ou l'échéance d'accès est passée (D18).
        setBootError(
          "Il faut du réseau pour commencer ce palier. Prépare-le quand tu en auras.",
        );
        booting.current = false;
        return;
      }
      setStored(bundle);
    })();
  }, [reach, attemptId, stored, topicId, palierIndex]);

  useEffect(() => {
    if (!online) return;
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
  }, [online, topic, topicId, palierIndex, attemptId, getBucket, startAttempt]);

  const onlineExercises = useQuery(
    api.paliers.index.getExercisesForPalier,
    attemptId !== null && online ? { palierAttemptId: attemptId } : "skip",
  ) as SanitizedExercise[] | null | undefined;

  // LE LOT SE TÉLÉCHARGE EN MÊME TEMPS QU'ON JOUE EN LIGNE. L'enfant n'a rien
  // à demander : quand il y a du réseau, on garde de quoi continuer sans lui.
  // C'est ce qui fait qu'une coupure au milieu d'un palier ne l'arrête pas.
  const bundle = useQuery(
    api.paliers.index.getOfflineBundle,
    attemptId !== null && online ? { palierAttemptId: attemptId } : "skip",
  );

  useEffect(() => {
    if (bundle == null || attemptId === null) return;
    void (async () => {
      await saveBundle({
        palierAttemptId: attemptId,
        topicId,
        // Le lot ne se télécharge qu'EN LIGNE, donc `topic` est là. On fige
        // son nom pour que l'accueil hors-ligne sache dire de quoi il s'agit.
        topicName: topic?.name ?? null,
        palierIndex,
        downloadedAt: Date.now(),
        accessValidUntil: bundle.accessValidUntil,
        atomScheme: bundle.atomSchemeVersion,
        exercises: bundle.exercises,
      });
      // Le plafond s'applique à CHAQUE écriture, pas seulement au
      // téléchargement délibéré : c'est ce chemin-ci qui tourne tous les
      // jours, et c'est donc lui qui remplirait la tablette. Le lot de la
      // séance en cours est protégé — on ne va pas effacer ce qu'on joue.
      await enforceStorageCap([attemptId]);
    })();
  }, [bundle, attemptId, topicId, topic, palierIndex]);

  // DÈS QUE LE RÉSEAU REVIENT, ON REND COMPTE. Sans attendre la fin du palier :
  // une tablette d'école repasse en ligne quelques secondes dans un couloir, et
  // c'est peut-être la seule fenêtre de la journée.
  useEffect(() => {
    const id = attemptId ?? stored?.palierAttemptId ?? null;
    if (!online || id === null) return;
    void (async () => {
      await flushJournal(id, (a) => syncJournal(a as never) as never);
      // L'ORDRE EST OBLIGATOIRE : on clôt APRÈS avoir envoyé. `submitPalier`
      // note le palier depuis les lignes `attempts` du serveur — clore avant
      // que la dernière réponse soit arrivée noterait sur un palier incomplet.
      // `pendingCloses` le vérifie aussi, en SQL ; la ceinture et les
      // bretelles, parce que se tromper ici coûte des étoiles à l'enfant.
      const closed = await closePendingPaliers((a) =>
        submit({ palierAttemptId: a.palierAttemptId as Id<"palierAttempts"> }),
      );
      // Si c'est CE palier-ci qui vient de se clore, l'enfant est encore
      // devant l'écran du coffre : on l'ouvre, avec les VRAIES étoiles.
      const mine = closed.find((c) => c.palierAttemptId === id);
      if (mine) setOutcome(mine.result as PalierOutcome);
    })();
  }, [online, attemptId, stored, syncJournal, submit]);

  /** Le moteur local, quand on joue sans réseau. */
  const engine = useMemo(
    () => (stored === null ? null : makeOfflineEngine(stored)),
    [stored],
  );

  // UNE SEULE LISTE POUR LES DEUX MODES : le lecteur ne sait pas s'il y a du
  // réseau, et il n'a pas à le savoir.
  const exercises: SanitizedExercise[] | null | undefined =
    engine !== null
      ? (engine.exercises as unknown as SanitizedExercise[])
      : onlineExercises;

  const sessionAttemptId = attemptId ?? stored?.palierAttemptId ?? null;

  const onVerify = useCallback(
    async (encoded: string, timeSpentMs: number): Promise<VerifyOutcome> => {
      const current = exercises?.[index];
      if (!current) throw new Error("Exercice indisponible");

      // HORS LIGNE, LE VERDICT EST LOCAL ET LA RÉPONSE VA AU JOURNAL. Il n'est
      // que consultatif : le serveur relira la réponse à la synchronisation et
      // recalculera tout (D12).
      if (engine !== null) {
        return engine.verify(current._id, encoded, timeSpentMs);
      }

      if (attemptId === null) throw new Error("Exercice indisponible");
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
    [exercises, index, attemptId, verify, engine],
  );

  const onRequestHint = useCallback(
    async (hintIndex: number): Promise<string> => {
      const current = exercises?.[index];
      if (!current) throw new Error("Indice indisponible");
      // Le texte est déjà dans le lot (D20.3) ; seul le COMPTE part au journal.
      if (engine !== null) return engine.hint(current._id, hintIndex);
      if (attemptId === null) throw new Error("Indice indisponible");
      const result = await hint({
        exerciseId: current._id as Id<"exercises">,
        palierAttemptId: attemptId,
        hintIndex,
      });
      return result.hint;
    },
    [exercises, index, attemptId, hint, engine],
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
    // FIN DE PALIER HORS LIGNE : on ne peut pas clore MAINTENANT, mais on
    // note qu'il y a un palier à clore. Le marqueur est ce qui transforme
    // « tes étoiles arriveront » d'une phrase rassurante en une promesse que
    // du code tient : au retour du réseau, `closePendingPaliers` appelle
    // vraiment `submitPalier`, et c'est le serveur qui décide des étoiles
    // (D12). Sans marqueur, le palier resterait ouvert indéfiniment.
    if (engine !== null || attemptId === null) {
      const id = attemptId ?? stored?.palierAttemptId ?? null;
      if (id !== null) void markPendingClose(id);
      setFinishedOffline(true);
      return;
    }
    if (submitting) return;
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
  }, [exercises, index, attemptId, submit, submitting, engine, stored]);

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

  // LE COFFRE — le palier est fini, le réseau manque encore. Il passe APRÈS
  // `outcome` : dès que la clôture aboutit, c'est le vrai résultat qui
  // s'affiche, et le coffre s'efface de lui-même.
  if (finishedOffline && sessionAttemptId !== null) {
    return (
      <ChestWaiting
        palierAttemptId={sessionAttemptId}
        online={online}
        onLeave={onLeave}
      />
    );
  }

  // Hors ligne, `topic` n'est pas interrogeable : on ne bloque que si l'on
  // jouait en ligne et que la thématique est introuvable.
  if (engine === null && topic === null) {
    return <Blocked message={kidMessages.genFailed} onLeave={onLeave} />;
  }

  // Un message hors résultat — la fin de palier sans réseau, par exemple.
  // Sans ce rendu-ci, il serait posé dans l'état et jamais affiché : il n'est
  // porté que par l'écran de fin, qu'on n'atteint pas hors ligne.
  if (outcome === null && regenMessage !== null) {
    return <Blocked message={regenMessage} onLeave={onLeave} />;
  }

  if (exercises === undefined || exercises === null || sessionAttemptId === null) {
    return <Preparing />;
  }

  if (exercises.length === 0) {
    return <Blocked message={kidMessages.genFailed} onLeave={onLeave} />;
  }

  const current = exercises[Math.min(index, exercises.length - 1)];

  return (
    <View style={styles.flex}>
      {/* L'enfant doit savoir POURQUOI l'explication et « j'en veux encore »
          ne sont pas là (D19). */}
      {engine !== null && <OfflineBanner />}
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
    </View>
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
  flex: { flex: 1, backgroundColor: colors.backgroundTop },
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
