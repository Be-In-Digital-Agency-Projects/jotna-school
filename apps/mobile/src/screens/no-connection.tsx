import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fontSize, radius, spacing } from "@/theme/tokens";

/**
 * « PAS DE CONNEXION » — l'écran qui remplace une attente sans fin (5.1).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IL N'Y A PAS DE BOUTON « RÉESSAYER », ET C'EST UN CHOIX.
 *
 * Le client Convex se reconnecte TOUT SEUL, en boucle, avec son propre recul
 * exponentiel. Un bouton ne déclencherait rien que la bibliothèque ne fasse
 * déjà : il donnerait à l'enfant l'impression d'agir alors qu'il n'agit pas,
 * et — pire — lui ferait croire que c'est à lui de réparer. Dès que la socket
 * s'ouvre, `useServerReach` bascule et cet écran disparaît de lui-même.
 *
 * LE MESSAGE EST EN DEUX ÉTAGES, parce que deux personnes le lisent.
 * L'enfant a besoin de savoir que ce n'est pas sa faute et que ça va revenir.
 * L'adulte à côté a besoin de savoir QUOI faire — et la seule chose utile,
 * c'est de préparer les paliers la prochaine fois qu'il y a du réseau.
 *
 * LE FILEUR TOURNE, et il dit la vérité : on essaie encore.
 */
export function NoConnection({ hint }: { hint?: string }) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.emoji}>📡</Text>
      <Text style={styles.title}>Pas de connexion</Text>

      <View style={styles.card}>
        <Text style={styles.body}>
          Ce n&apos;est pas ta faute 🙂 L&apos;application a besoin
          d&apos;internet pour aller chercher tes exercices.
        </Text>
        <Text style={styles.body}>
          {hint ??
            "On réessaie tout seul. Dès qu'il y a du réseau, ça repart."}
        </Text>
      </View>

      <View style={styles.spinnerRow}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.spinnerText}>On cherche le réseau…</Text>
      </View>

      <View style={styles.adult}>
        <Text style={styles.adultText}>
          <Text style={styles.adultLabel}>Pour l&apos;adulte : </Text>
          la prochaine fois qu&apos;il y a du réseau, ouvrez une matière et
          appuyez sur « Je prépare pour plus tard ». Les paliers préparés se
          jouent ensuite sans connexion.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  emoji: { fontSize: 64, textAlign: "center" },
  title: {
    fontSize: fontSize.display,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  body: { fontSize: fontSize.label, lineHeight: 28, color: colors.text },
  spinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  spinnerText: { fontSize: fontSize.body, color: colors.textMuted },
  adult: {
    backgroundColor: colors.backgroundMiddle,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  adultText: { fontSize: fontSize.body, lineHeight: 22, color: colors.textMuted },
  adultLabel: { fontWeight: "700", color: colors.text },
});
