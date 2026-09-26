import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";

/**
 * Le bouton de l'espace enfant.
 *
 * Trois contraintes qui viennent de l'utilisateur, pas du goût :
 * hauteur minimale de 48 dp (recommandation Android, et un doigt de huit ans
 * n'est pas plus précis qu'un doigt d'adulte), texte à 18 points au moins, et
 * un état désactivé qui se VOIT — un bouton gris qui ne répond pas sans raison
 * visible est la première chose qui fait abandonner un enfant.
 */
export function BigButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  tone = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "primary" | "quiet";
}) {
  const inactive = disabled || busy;
  const quiet = tone === "quiet";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        quiet ? styles.quiet : styles.primary,
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={quiet ? colors.accent : colors.surface} />
      ) : (
        <Text style={[styles.label, quiet ? styles.labelQuiet : styles.labelPrimary]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET + 8,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    backgroundColor: colors.accent,
    shadowColor: colors.accentShadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  quiet: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  inactive: { opacity: 0.45 },
  label: { fontSize: fontSize.label, fontWeight: "700" },
  labelPrimary: { color: colors.surface },
  labelQuiet: { color: colors.accent },
});
