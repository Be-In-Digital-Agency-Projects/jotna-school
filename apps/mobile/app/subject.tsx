import { useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

/**
 * Les thématiques d'une matière — navigation MINIMALE (voir `student-home`).
 *
 * `getStudentSubjectMap` filtre déjà les classes masquées et rend, pour chaque
 * thématique, le `nextPalierIndex` que l'enfant doit ouvrir : on ne le calcule
 * pas ici.
 */
export default function SubjectRoute() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();

  const map = useQuery(api.students.getStudentSubjectMap, {
    subjectId: subjectId as Id<"subjects">,
  });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.title}>{map?.subject.name ?? "…"}</Text>

      {map === undefined && <Text style={styles.muted}>Chargement…</Text>}
      {map === null && (
        <Text style={styles.muted}>Rien à afficher pour le moment.</Text>
      )}

      {map?.topics.map((topic) => (
        <Pressable
          key={topic._id}
          accessibilityRole="button"
          accessibilityLabel={`${topic.name}, palier ${topic.nextPalierIndex}`}
          onPress={() =>
            router.push({
              pathname: "/palier",
              params: { topicId: topic._id, palier: String(topic.nextPalierIndex) },
            })
          }
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>{topic.name}</Text>
            <Text style={styles.rowSub}>
              Palier {topic.nextPalierIndex} · {topic.starsApprox} ⭐
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}

      <BigButton label="Retour" onPress={() => router.back()} tone="quiet" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.display, fontWeight: "800", color: colors.text },
  muted: { fontSize: fontSize.body, color: colors.textMuted },
  row: {
    minHeight: MIN_TOUCH_TARGET + 12,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowPressed: { transform: [{ scale: 0.99 }] },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.label, fontWeight: "700", color: colors.text },
  rowSub: { fontSize: fontSize.body, color: colors.textMuted },
  chevron: { fontSize: 28, color: colors.textMuted },
});
