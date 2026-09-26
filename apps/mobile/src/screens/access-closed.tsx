import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { kidMessages } from "@lib/kidCopy";
import { useChangeStudent } from "@/session/change-student";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

/**
 * L'espace de l'enfant n'est pas ouvert — décision D7, et spec §5.8.
 *
 * L'ENFANT NE LIT JAMAIS UN MOTIF D'ARGENT. Le message vient de
 * `kidMessages.accessNotOpen`, partagé avec le web : « Ton espace n'est pas
 * encore ouvert 🌱 Parle-en à ton maître ou à ta maîtresse. » Que l'abonnement
 * de l'école soit impayé, échu ou jamais signé ne le regarde pas, et le lui
 * dire ne lui donnerait aucun moyen d'agir — seulement de la honte.
 *
 * AUCUN LIEN VERS UN PAIEMENT, AUCUN PRIX, AUCUN BOUTON « RENOUVELER ».
 * Ce n'est pas de la pudeur, c'est la condition qui garde l'application hors
 * de la règle App Store 3.1.1 : on accède ici à un contenu acheté ailleurs par
 * l'école, cas prévu par 3.1.3(b). Le jour où un bouton de caisse apparaît sur
 * cet écran, c'est un refus en revue ET 15 à 30 % prélevés sur un abonnement
 * scolaire libellé en francs CFA.
 *
 * « Changer d'élève » est là parce que l'appareil est partagé : sans lui, une
 * tablette resterait coincée sur cet écran pour toute la classe.
 */
export function AccessClosed() {
  const insets = useSafeAreaInsets();
  const { changeStudent, busy } = useChangeStudent();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <View style={styles.card}>
        <Text style={styles.sprout}>🌱</Text>
        <Text style={styles.message}>{kidMessages.accessNotOpen}</Text>
      </View>

      <BigButton label="Changer d'élève" onPress={changeStudent} busy={busy} tone="quiet" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
  },
  sprout: { fontSize: 56 },
  message: {
    fontSize: fontSize.label,
    lineHeight: 28,
    color: colors.text,
    textAlign: "center",
  },
});
