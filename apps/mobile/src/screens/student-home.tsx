import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@convex/_generated/api";
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
