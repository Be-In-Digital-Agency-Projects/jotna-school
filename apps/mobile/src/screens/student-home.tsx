import { useMutation, useQuery } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { pendingCount } from "@/offline/store";
import { catchUpAll } from "@/offline/sync";
import { useServerReach } from "@/session/reach";
import { levelPercent } from "@/progress/level";
import { StreakRibbon } from "@/progress/streak-ribbon";
import { subjectIcon } from "@/theme/subject-icon";
import {
  GLYPH_MAX_SCALE,
  MIN_TOUCH_TARGET,
  colors,
  fontSize,
  radius,
  spacing,
} from "@/theme/tokens";
import { ProgressBar } from "@/ui/progress-bar";

/**
 * L'ACCUEIL DE L'ÉLÈVE — tâche 4.1.
 *
 * Il répond à trois questions, dans cet ordre, et c'est l'ordre qui compte
 * pour un enfant de huit ans :
 *
 *   1. « Est-ce qu'on me reconnaît ? »  — son prénom, tout en haut.
 *   2. « Où j'en suis ? »               — sa série, son niveau, ses étoiles.
 *   3. « Qu'est-ce que je fais ? »      — ses matières, en grand.
 *
 * LE DÉMARRAGE À FROID EST UN ÉCRAN À PART (D8 côté web). Un enfant qui ouvre
 * l'application pour la première fois ne doit pas voir « 0 étoile, 0 badge, 0
 * jour de série » : trois zéros disent « tu n'as rien », ce qui est vrai et
 * décourageant. On les cache, et on ne montre qu'une invitation.
 *
 * « CHANGER D'ÉLÈVE » A QUITTÉ CET ÉCRAN pour le profil (4.4). Il y était
 * faute d'ailleurs où le mettre ; c'est un geste d'adulte, et le laisser sous
 * les matières l'exposait au doigt d'un enfant qui fait défiler.
 */
export function StudentHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const stats = useQuery(api.students.getMyStats, {});
  const subjects = useQuery(api.subjects.list, {});
  const markLevelSeen = useMutation(api.students.markLevelSeen);
  const online = useServerReach() === "online";

  const [pending, setPending] = useState(0);
  const [justClosed, setJustClosed] = useState(0);

  // LE RATTRAPAGE SE DÉCLENCHE ICI, ET PAS SEULEMENT DANS LA SÉANCE.
  //
  // La séance ne connaît que son palier ; l'accueil est le seul écran que
  // l'enfant revoit forcément. Sans cette passe, celui qui finit un palier
  // hors ligne puis ferme l'application ne rendrait jamais ses réponses tant
  // qu'il ne rouvre pas ce palier-là.
  //
  // Le verrou `running` n'est pas une optimisation : `useFocusEffect` peut
  // repartir avant que la passe précédente ait fini, et deux clôtures
  // concurrentes appelleraient `submitPalier` deux fois sur la même tentative.
  const running = useRef(false);
  const syncJournal = useMutation(api.palierAttempts.syncOfflineJournal);
  const submit = useMutation(api.palierAttempts.submitPalier);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const read = () =>
        pendingCount()
          .then((n) => {
            if (alive) setPending(n);
          })
          .catch(() => {});

      void read();

      if (online && !running.current) {
        running.current = true;
        void (async () => {
          try {
            const closed = await catchUpAll(
              (a) => syncJournal(a as never) as never,
              (a) =>
                submit({
                  palierAttemptId: a.palierAttemptId as Id<"palierAttempts">,
                }),
            );
            if (alive && closed.length > 0) setJustClosed(closed.length);
          } finally {
            running.current = false;
            void read();
          }
        })();
      }

      return () => {
        alive = false;
        // Le mot du coffre se dit UNE FOIS, sur la visite où la clôture a eu
        // lieu. Le laisser en place le ferait réapparaître chaque fois que
        // l'enfant revient à l'accueil, longtemps après que les étoiles sont
        // arrivées — une bonne nouvelle répétée cesse d'en être une.
        setJustClosed(0);
      };
    }, [online, syncJournal, submit]),
  );

  const firstName = (stats?.student.name ?? "").split(" ")[0] ?? "";

  // D8 — démarrage à froid : compte neuf, aucune progression nulle part.
  const coldStart =
    stats != null &&
    stats.totalExercises === 0 &&
    stats.totalStars === 0 &&
    (!stats.streaksEnabled || stats.currentStreak === 0);

  const showStreak =
    stats != null && stats.streaksEnabled && stats.currentStreak > 0;

  const unseenLevel = stats?.unseenLevelUp?.level;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.hello}>
        {coldStart
          ? `Bienvenue${firstName ? ` ${firstName}` : ""} ! 👋`
          : `Bonjour${firstName ? ` ${firstName}` : ""} !`}
      </Text>
      <Text style={styles.sub}>
        {coldStart
          ? "Choisis ta première matière pour commencer."
          : "Choisis une matière."}
      </Text>

      {/* LA MONTÉE DE NIVEAU SE DIT ICI QUAND ELLE A ÉTÉ MANQUÉE (D19).
          Un niveau gagné pendant une séance sans réseau n'a été fêté nulle
          part : le serveur garde `unseenLevelUp` jusqu'à ce qu'on le montre,
          et `markLevelSeen` referme la fête — une seule fois. */}
      {unseenLevel !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Niveau ${unseenLevel} atteint, appuie pour fermer`}
          onPress={() => {
            void markLevelSeen({ level: unseenLevel }).catch(() => {});
          }}
          style={styles.levelUp}
        >
          <Text style={styles.levelUpTitle}>🎉 Niveau {unseenLevel} !</Text>
          <Text style={styles.levelUpBody}>
            Bravo, tu as monté d&apos;un niveau. Appuie pour continuer.
          </Text>
        </Pressable>
      )}

      {justClosed > 0 && (
        <View style={styles.arrived}>
          <Text style={styles.arrivedText}>
            Ton coffre s&apos;est ouvert 🎁 {justClosed} palier
            {justClosed > 1 ? "s" : ""} que tu as fini
            {justClosed > 1 ? "s" : ""} sans réseau {justClosed > 1 ? "ont" : "a"}{" "}
            été compté{justClosed > 1 ? "s" : ""} — va voir tes étoiles ⭐
          </Text>
        </View>
      )}

      {pending > 0 && (
        <View style={styles.pending}>
          <Text style={styles.pendingText}>
            {online
              ? `On envoie ${pending} réponse${pending > 1 ? "s" : ""} que tu as faite${pending > 1 ? "s" : ""} sans réseau… 📤`
              : `${pending} réponse${pending > 1 ? "s" : ""} t'attend${pending > 1 ? "ent" : ""} bien au chaud 💾 Elles partiront dès qu'il y aura du réseau.`}
          </Text>
        </View>
      )}

      {showStreak && stats != null && (
        <StreakRibbon
          currentStreak={stats.currentStreak}
          longestStreak={stats.longestStreak}
        />
      )}

      {stats != null && !coldStart && (
        <View style={styles.levelCard}>
          <View style={styles.levelHead}>
            <Text style={styles.levelTitle}>Niveau {stats.level}</Text>
            <Text style={styles.levelCounts}>
              {stats.totalStars} ⭐ · {stats.badgeCount} 🏅
            </Text>
          </View>
          <ProgressBar
            percent={levelPercent(stats.exosToNextLevel)}
            label={`Progression vers le niveau ${stats.level + 1}`}
          />
          <Text style={styles.levelFoot}>
            Encore {stats.exosToNextLevel} exercice
            {stats.exosToNextLevel > 1 ? "s" : ""} pour le niveau{" "}
            {stats.level + 1}.
          </Text>
        </View>
      )}

      {subjects === undefined && <Text style={styles.muted}>Chargement…</Text>}
      {subjects !== undefined && subjects.length === 0 && (
        <Text style={styles.muted}>
          Aucune matière n&apos;est encore ouverte pour toi.
        </Text>
      )}

      {subjects?.map((subject) => (
        <Pressable
          key={subject._id}
          accessibilityRole="button"
          accessibilityLabel={subject.name}
          onPress={() =>
            router.push({
              pathname: "/subject",
              params: { subjectId: subject._id },
            })
          }
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
          {/* La pastille prend la couleur de la matière, comme sur le web :
              c'est à elle que l'enfant reconnaît « sa » matière de loin,
              avant même de lire le nom. */}
          <View style={[styles.cardIconBox, { backgroundColor: subject.color }]}>
            <Text
              style={styles.cardIcon}
              maxFontSizeMultiplier={GLYPH_MAX_SCALE}
            >
              {subjectIcon(subject.icon)}
            </Text>
          </View>
          <View style={styles.cardMain}>
            <Text style={styles.cardTitle}>{subject.name}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  hello: { fontSize: fontSize.display, fontWeight: "800", color: colors.text },
  sub: { fontSize: fontSize.label, color: colors.textMuted, marginTop: -spacing.sm },
  muted: { fontSize: fontSize.body, color: colors.textMuted },
  levelUp: {
    backgroundColor: "#fef3c7",
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  levelUpTitle: { fontSize: fontSize.title, fontWeight: "800", color: colors.text },
  levelUpBody: { fontSize: fontSize.body, lineHeight: 22, color: colors.text },
  arrived: {
    backgroundColor: "#f7fee7",
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  arrivedText: { fontSize: fontSize.label, lineHeight: 26, color: colors.text },
  pending: {
    backgroundColor: "#fffbeb",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pendingText: { fontSize: fontSize.body, lineHeight: 22, color: colors.text },
  levelCard: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  levelHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  levelTitle: { fontSize: fontSize.label, fontWeight: "700", color: colors.text },
  levelCounts: { fontSize: fontSize.label, color: colors.text },
  levelFoot: { fontSize: fontSize.body, color: colors.textMuted },
  card: {
    minHeight: MIN_TOUCH_TARGET + 16,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardPressed: { transform: [{ scale: 0.99 }] },
  cardIconBox: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cardIcon: { fontSize: 28, color: colors.surface, fontWeight: "800" },
  cardMain: { flex: 1 },
  cardTitle: { fontSize: fontSize.title, fontWeight: "700", color: colors.text },
  chevron: { fontSize: 28, color: colors.textMuted },
});
