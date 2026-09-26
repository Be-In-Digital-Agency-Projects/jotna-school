import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors, fontSize, radius, spacing } from "@/theme/tokens";

/**
 * « CET ÉCRAN A BESOIN DU RÉSEAU » — la version courte (tâche 5.1).
 *
 * Le coffre et le profil ne vivent que de données du serveur : il n'y a pas de
 * version locale d'un catalogue de badges ni d'un compteur d'étoiles. Sans
 * socket, leurs requêtes restent `undefined`, et ces deux écrans affichaient
 * « Chargement… » pour toujours.
 *
 * ON NE MENT PAS SUR LA CAUSE, et c'est toute la différence avec le fileur : un
 * enfant qui lit « chargement » attend et finit par croire que l'application
 * est cassée ; celui qui lit « il faut du réseau » sait qu'il n'y est pour
 * rien, et que revenir plus tard suffit.
 *
 * `NoConnection` occupe l'écran entier et s'adresse aussi à l'adulte ; ce
 * bandeau-ci tient dans une carte, au milieu d'un écran qui a déjà son titre.
 */
export function OfflineNotice({ what }: { what: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.emoji}>📡</Text>
      <Text style={styles.title}>Il faut du réseau pour voir {what}.</Text>
      <View style={styles.row}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.hint}>On réessaie tout seul…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  emoji: { fontSize: 40 },
  title: {
    fontSize: fontSize.label,
    lineHeight: 26,
    color: colors.text,
    textAlign: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hint: { fontSize: fontSize.body, color: colors.textMuted },
});
