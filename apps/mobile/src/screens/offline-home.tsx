import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ATOM_SCHEME_VERSION } from "@convex/paliers/offline";
import { isBundlePlayable } from "@/offline/bundle-validity";
import { listBundles, pendingCount, type BundleSummary } from "@/offline/store";
import { useChangeStudent } from "@/session/change-student";
import { MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

/**
 * L'ACCUEIL SANS RÉSEAU — ce qui est jouable MAINTENANT (tâche 5.1).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN ACCUEIL DIFFÉRENT, ET NON L'ACCUEIL ORDINAIRE EN PANNE.
 *
 * L'accueil ordinaire ne sait parler que de données du serveur : les matières,
 * le niveau, la série, les étoiles. Sans socket, ses trois requêtes restent
 * `undefined` et il n'affiche que « Chargement… », pour toujours. Le montrer
 * quand même serait la même faute qu'à la porte d'entrée — une attente sans
 * fin déguisée en écran.
 *
 * Celui-ci ne promet que ce qu'il peut tenir : la liste de ce qui est DÉJÀ sur
 * l'appareil, lue dans SQLite, qui n'a besoin de personne. C'est court, c'est
 * vrai, et c'est exactement ce que l'enfant est venu chercher.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE NOM DE LA THÉMATIQUE EST FIGÉ DANS LE LOT, et il a fallu l'y mettre :
 * la table ne portait que `topicId`, et un identifiant ne se montre pas à un
 * enfant. Un lot d'avant cette version n'en a pas — on écrit alors « Palier N »
 * seul, plutôt que d'inventer un nom.
 *
 * « CHANGER D'ÉLÈVE » EST LÀ AUSSI, et ce n'est pas un détail d'école : sans
 * lui, une tablette partagée qui démarre sans réseau resterait coincée sur
 * l'enfant précédent, sans aucun moyen d'en sortir.
 */
export function OfflineHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { changeStudent, busy } = useChangeStudent();

  const [bundles, setBundles] = useState<BundleSummary[] | null>(null);
  const [pending, setPending] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void listBundles()
        .then((rows) => {
          if (!alive) return;
          // LA MÊME RÈGLE QUE LA SÉANCE, et pour la même raison : un lot
          // dont le schéma d'atomes a changé sous l'appareil (6.7) ferait
          // compter faux des réponses justes. L'offrir ici et le refuser
          // ensuite serait le pire des deux.
          const now = Date.now();
          setBundles(
            rows.filter((b) => isBundlePlayable(b, now, ATOM_SCHEME_VERSION)),
          );
        })
        .catch(() => {
          if (alive) setBundles([]);
        });
      void pendingCount()
        .then((n) => {
          if (alive) setPending(n);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  const playable = bundles ?? [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.title}>Sans réseau 📡</Text>
      <Text style={styles.sub}>
        Voici ce que tu peux faire tout de suite. Le reste revient dès
        qu&apos;il y a du réseau.
      </Text>

      {pending > 0 && (
        <View style={styles.pending}>
          <Text style={styles.pendingText}>
            {pending} réponse{pending > 1 ? "s" : ""} t&apos;attend
            {pending > 1 ? "ent" : ""} bien au chaud 💾 Elles partiront toutes
            seules.
          </Text>
        </View>
      )}

      {bundles === null && <Text style={styles.muted}>Un instant…</Text>}

      {bundles !== null && playable.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🎒</Text>
          <Text style={styles.emptyText}>
            Tu n&apos;as rien préparé pour l&apos;instant.
          </Text>
          <Text style={styles.emptyHint}>
            La prochaine fois qu&apos;il y a du réseau, ouvre une matière et
            appuie sur « Je prépare pour plus tard ». Tu pourras jouer partout.
          </Text>
        </View>
      )}

      {playable.map((bundle) => (
        <Pressable
          key={bundle.palierAttemptId}
          accessibilityRole="button"
          accessibilityLabel={`${bundle.topicName ?? "Palier"} ${bundle.palierIndex}, prêt à jouer sans réseau`}
          onPress={() =>
            router.push({
              pathname: "/palier",
              params: {
                topicId: bundle.topicId,
                palier: String(bundle.palierIndex),
              },
            })
          }
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
          <Text style={styles.cardIcon}>💾</Text>
          <View style={styles.cardMain}>
            <Text style={styles.cardTitle}>
              {bundle.topicName ?? "Palier prêt"}
            </Text>
            <Text style={styles.cardSub}>
              Palier {bundle.palierIndex}
              {bundle.awaitsClose ? " · fini, étoiles en attente ⭐" : ""}
            </Text>
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
  title: { fontSize: fontSize.display, fontWeight: "800", color: colors.text },
  sub: { fontSize: fontSize.body, lineHeight: 22, color: colors.textMuted },
  muted: { fontSize: fontSize.body, color: colors.textMuted },
  pending: {
    backgroundColor: "#fffbeb",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pendingText: { fontSize: fontSize.body, lineHeight: 22, color: colors.text },
  empty: {
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  emptyEmoji: { fontSize: 48 },
  emptyText: {
    fontSize: fontSize.label,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  emptyHint: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: "center",
  },
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
  cardIcon: { fontSize: 28 },
  cardMain: { flex: 1, gap: 2 },
  cardTitle: { fontSize: fontSize.label, fontWeight: "700", color: colors.text },
  cardSub: { fontSize: fontSize.body, color: colors.textMuted },
  chevron: { fontSize: 28, color: colors.textMuted },
  spacer: { height: spacing.md },
});
