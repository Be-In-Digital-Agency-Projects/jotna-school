import { StyleSheet, Text, View } from "react-native";

import { streakWeek } from "./streak-week";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";

/**
 * LE RUBAN DE SÉRIE — sept jours, et aucun reproche (D7c côté web).
 *
 * LA COPIE EST « SANS HONTE », et cela se joue sur des mots. Un jour sans
 * activité n'est pas « raté », « perdu » ni « manqué » : il est simplement
 * éteint. L'enfant de huit ans qui rouvre l'application après trois jours
 * d'absence doit avoir envie de recommencer, pas de se cacher.
 *
 * LE RECORD NE S'AFFICHE QUE S'IL DÉPASSE LA SÉRIE EN COURS. Écrire
 * « record : 5 » à côté de « 5 jours » serait du bruit ; l'écrire à côté de
 * « 2 jours » est un but à atteindre, et c'est pour cela qu'il est là.
 *
 * Le calcul des sept jours est dans `streak-week.ts`, à part, parce qu'il est
 * plein de frontières (minuit, mois, année, fuseau) et qu'il doit être
 * éprouvé. Ce fichier-ci ne fait que dessiner.
 */
export function StreakRibbon({
  currentStreak,
  longestStreak,
  now = Date.now(),
}: {
  currentStreak: number;
  longestStreak: number;
  now?: number;
}) {
  const days = streakWeek(now, currentStreak);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>
          🔥 {currentStreak} jour{currentStreak > 1 ? "s" : ""} de série
        </Text>
        {longestStreak > currentStreak && (
          <Text style={styles.record}>record : {longestStreak}</Text>
        )}
      </View>

      <View style={styles.week}>
        {days.map((day, i) => (
          <View key={i} style={styles.day}>
            <Text
              style={[
                styles.dayLabel,
                day.state === "today" && styles.dayLabelToday,
              ]}
            >
              {day.label}
            </Text>
            <View
              accessible
              accessibilityLabel={`${day.label} ${day.dayOfMonth} ${
                day.state === "active"
                  ? "actif"
                  : day.state === "today"
                    ? "aujourd'hui"
                    : "en pause"
              }`}
              style={[
                styles.dot,
                day.state === "active" && styles.dotActive,
                day.state === "today" && styles.dotToday,
              ]}
            >
              <Text style={styles.dotText}>
                {day.state === "active" ? "🔥" : "·"}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.accentShadow,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: { fontSize: fontSize.label, fontWeight: "700", color: colors.text },
  record: { fontSize: fontSize.body, color: colors.textMuted },
  week: { flexDirection: "row", justifyContent: "space-between", gap: spacing.xs },
  day: { flex: 1, alignItems: "center", gap: spacing.xs },
  dayLabel: { fontSize: fontSize.body, fontWeight: "600", color: colors.textMuted },
  dayLabelToday: { color: colors.accent },
  dot: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.backgroundMiddle,
    alignItems: "center",
    justifyContent: "center",
  },
  dotActive: { borderColor: colors.accentShadow, backgroundColor: "#ffedd5" },
  dotToday: { borderColor: colors.accent, backgroundColor: colors.surface },
  dotText: { fontSize: 16, color: colors.textMuted },
});
