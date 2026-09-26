import { useMutation, useQuery } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNetworkOnline } from "@/offline/network";
import { pendingCount } from "@/offline/store";
import { catchUpAll } from "@/offline/sync";
import { useChangeStudent } from "@/session/change-student";
import { MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

/**
 * L'accueil de l'élève — NAVIGATION MINIMALE, PROVISOIRE.
 *
 * Le vrai accueil est la phase 4 : série, niveau, progression, matières
 * illustrées. Ce qui est ici est le strict nécessaire pour que le moteur
 * d'exercices de la phase 2 soit ESSAYABLE sur un appareil — sans un chemin
 * qui y mène, ni vous ni moi ne pouvons le vérifier autrement que par le
 * typecheck et le paquet.
 *
 * Il porte aussi « changer d'élève » (D10), sans quoi une tablette partagée
 * resterait bloquée sur le premier enfant connecté.
 */
export function StudentHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useQuery(api.profiles.getCurrentProfile, {});
  const subjects = useQuery(api.subjects.list, {});
  const { changeStudent, busy } = useChangeStudent();
  const online = useNetworkOnline();

  // CE QUI ATTEND ENCORE D'ÊTRE ENVOYÉ.
  //
  // On relit à chaque fois que l'écran revient au premier plan — donc au
  // retour d'une séance, au moment précis où le compte vient de changer.
  // Un abonnement permanent coûterait une requête SQLite en boucle pour une
  // information qui ne bouge qu'à ces instants-là.
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

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.hello}>
        {profile ? `Bonjour ${profile.name} !` : "Bonjour !"}
      </Text>
      <Text style={styles.sub}>Choisis une matière.</Text>

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
          <Text style={styles.cardIcon}>{subject.icon ?? "📘"}</Text>
          <View style={styles.cardMain}>
            <Text style={styles.cardTitle}>{subject.name}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}

      <View style={styles.spacer} />
      <BigButton
        label="Changer d'élève"
        onPress={changeStudent}
        busy={busy}
        tone="quiet"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  hello: { fontSize: fontSize.display, fontWeight: "800", color: colors.text },
  sub: { fontSize: fontSize.label, color: colors.textMuted, marginTop: -spacing.sm },
  muted: { fontSize: fontSize.body, color: colors.textMuted },
  pending: {
    backgroundColor: "#fffbeb",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pendingText: { fontSize: fontSize.body, lineHeight: 22, color: colors.text },
  arrived: {
    backgroundColor: "#f7fee7",
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  arrivedText: { fontSize: fontSize.label, lineHeight: 26, color: colors.text },
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
  cardIcon: { fontSize: 32 },
  cardMain: { flex: 1 },
  cardTitle: { fontSize: fontSize.title, fontWeight: "700", color: colors.text },
  chevron: { fontSize: 28, color: colors.textMuted },
  spacer: { height: spacing.md },
});
