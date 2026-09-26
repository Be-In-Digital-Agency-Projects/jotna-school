import { useQuery } from "convex/react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@convex/_generated/api";
import { useChangeStudent } from "@/session/change-student";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

/**
 * L'accueil de l'élève — PROVISOIRE.
 *
 * La phase 1 s'arrête à « l'enfant est entré, et il le voit ». Les matières,
 * la série, le niveau et les paliers sont la phase 4 ; le moteur d'exercices
 * qu'ils ouvrent est la phase 2. Cet écran existe pour que la phase 1 soit
 * vérifiable de bout en bout sur un appareil, et pour porter « changer
 * d'élève » (D10), sans lequel une tablette partagée reste bloquée sur le
 * premier enfant qui s'est connecté.
 */
export function StudentHome() {
  const insets = useSafeAreaInsets();
  const profile = useQuery(api.profiles.getCurrentProfile, {});
  const { changeStudent, busy } = useChangeStudent();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.hello}>
        {profile === undefined
          ? "Bonjour !"
          : profile === null
            ? "Bonjour !"
            : `Bonjour ${profile.name} !`}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tu es bien entré 🎉</Text>
        <Text style={styles.cardBody}>
          Tes matières et tes exercices arrivent bientôt.
        </Text>
      </View>

      <BigButton label="Changer d'élève" onPress={changeStudent} busy={busy} tone="quiet" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  hello: { fontSize: fontSize.display, fontWeight: "800", color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: fontSize.title, fontWeight: "700", color: colors.text },
  cardBody: { fontSize: fontSize.body, lineHeight: 24, color: colors.textMuted },
});
