import { StyleSheet, View } from "react-native";

import { colors, radius } from "@/theme/tokens";

/**
 * La barre de progression du niveau (D3b côté web).
 *
 * Le web dessine un ANNEAU autour de l'avatar, en SVG. Une barre dit la même
 * chose, se lit de plus loin, et ne demande pas `react-native-svg` — une
 * dépendance de plus dans une chaîne qui vise un Android d'entrée de gamme
 * (le raisonnement de D22, appliqué encore une fois).
 *
 * `accessibilityValue` porte le pourcentage : un lecteur d'écran annonce « 60
 * pour cent » plutôt que de décrire deux rectangles.
 */
export function ProgressBar({
  percent,
  label,
}: {
  percent: number;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
    >
      <View style={[styles.fill, { width: `${clamped}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
});
