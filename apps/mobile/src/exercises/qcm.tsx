import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { encodeQcmAnswer, type QcmClientPayload } from "@convex/paliers/answers";
import { MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";
import type { ExerciseInputProps } from "./types";

/**
 * Le QCM — une option à choisir parmi celles que le serveur a envoyées.
 *
 * L'ORDRE DES OPTIONS NE SE TOUCHE PAS. `sanitizePayload` n'en mélange aucune
 * pour ce type : l'indice remonté est celui de la liste reçue, et c'est lui que
 * `verifyQcm` compare à `correctIndex`. Un mélange local casserait la
 * correspondance sans rien afficher d'anormal.
 *
 * L'INDICE ZÉRO EST UNE RÉPONSE VALIDE. `selected` est donc `null` quand rien
 * n'est choisi, jamais `0` ni `-1` : un test de véracité perdrait la première
 * option, et l'enfant qui la choisit verrait le bouton Valider rester éteint.
 */
export function QcmInput({
  payload,
  disabled,
  onAnswer,
  attemptKey,
}: ExerciseInputProps<QcmClientPayload>) {
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    setSelected(null);
    onAnswer(null);
    // `attemptKey` seul : remettre à zéro à chaque nouvel essai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptKey]);

  function choose(index: number) {
    setSelected(index);
    onAnswer(encodeQcmAnswer(index));
  }

  return (
    <View style={styles.list}>
      {payload.options.map((option, index) => {
        const active = selected === index;
        return (
          <Pressable
            key={`${index}-${option}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={option}
            disabled={disabled}
            onPress={() => choose(index)}
            style={({ pressed }) => [
              styles.option,
              active && styles.optionActive,
              pressed && !disabled && styles.optionPressed,
              disabled && styles.optionDisabled,
            ]}
          >
            <View style={[styles.bullet, active && styles.bulletActive]}>
              {active && <View style={styles.bulletDot} />}
            </View>
            <Text style={[styles.optionText, active && styles.optionTextActive]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  option: {
    minHeight: MIN_TOUCH_TARGET + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  optionActive: { borderColor: colors.accent, backgroundColor: "#fff7ed" },
  optionPressed: { transform: [{ scale: 0.99 }] },
  optionDisabled: { opacity: 0.6 },
  bullet: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  bulletActive: { borderColor: colors.accent },
  bulletDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  optionText: { flex: 1, fontSize: fontSize.label, color: colors.text },
  optionTextActive: { fontWeight: "700" },
});
