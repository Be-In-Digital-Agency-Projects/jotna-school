import { StyleSheet, Text, View } from "react-native";

import { colors, fontSize, radius, spacing } from "@/theme/tokens";

/**
 * « Tu joues sans réseau » — dit à l'enfant, dans ses mots.
 *
 * POURQUOI LE DIRE PLUTÔT QUE DE LE TAIRE. Hors ligne, deux choses
 * disparaissent : l'explication pas à pas et « j'en veux encore », toutes deux
 * portées par l'IA (D19). Un bouton qui s'évapore sans un mot, à huit ans,
 * c'est l'application qui est cassée. Une phrase, et c'est le réseau qui
 * manque — ce qui est vrai, et rassurant.
 *
 * LE MESSAGE PORTE LA PROMESSE, pas la panne. « Tes réponses sont gardées »
 * est ce que l'enfant a besoin de savoir ; « pas de connexion » est ce que
 * l'adulte en déduira.
 */
export function OfflineBanner() {
  return (
    <View style={styles.bar} accessibilityRole="alert">
      <Text style={styles.icon}>💾</Text>
      <Text style={styles.text}>
        Pas de réseau — tu peux continuer, tes réponses sont gardées.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#fffbeb",
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    borderRadius: radius.md,
    margin: spacing.sm,
    padding: spacing.sm,
  },
  icon: { fontSize: 20 },
  text: { flex: 1, fontSize: fontSize.body, lineHeight: 22, color: colors.text },
});
