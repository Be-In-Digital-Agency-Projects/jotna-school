import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { encodeOrderAnswer, type OrderClientPayload } from "@convex/paliers/answers";
import { GLYPH_MAX_SCALE, MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";
import type { ExerciseInputProps } from "./types";

/**
 * Remettre dans l'ordre — DEUX TAPS ÉCHANGENT DEUX ÉLÉMENTS.
 *
 * L'enfant touche celui qu'il veut déplacer, puis celui avec lequel l'échanger.
 * Voir **D24** : ici comme pour les deux autres types au doigt, le tap remplace
 * le glissé.
 *
 * L'ORDRE REÇU EST DÉJÀ MÉLANGÉ, par le serveur et avec une graine
 * déterministe (`sanitizePayload`, Décision 75). On ne le remélange jamais :
 * ce serait afficher un ordre que le serveur ne connaît pas, et le mélange
 * rejoué après une reconnexion ne correspondrait plus à ce que l'enfant a vu.
 *
 * LA RÉPONSE EST TOUJOURS COMPLÈTE, donc Valider est actif d'emblée. Ce n'est
 * pas un oubli : l'ordre mélangé PEUT se trouver être le bon, et exiger un
 * échange avant de laisser valider refuserait une réponse juste.
 */
export function OrderInput({
  payload,
  disabled,
  onAnswer,
  attemptKey,
}: ExerciseInputProps<OrderClientPayload>) {
  const [items, setItems] = useState<string[]>(payload.items);
  const [held, setHeld] = useState<number | null>(null);

  useEffect(() => {
    setItems(payload.items);
    setHeld(null);
    onAnswer(encodeOrderAnswer(payload.items));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptKey, payload.items]);

  function tap(index: number) {
    if (held === null) {
      setHeld(index);
      return;
    }
    if (held === index) {
      setHeld(null);
      return;
    }
    const next = [...items];
    [next[held], next[index]] = [next[index], next[held]];
    setItems(next);
    setHeld(null);
    onAnswer(encodeOrderAnswer(next));
  }

  return (
    <View style={styles.list}>
      {items.map((item, index) => {
        const active = held === index;
        return (
          <Pressable
            key={`${item}-${index}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={`Position ${index + 1} : ${item}`}
            accessibilityHint={
              held === null
                ? "Touche pour prendre cet élément"
                : "Touche pour l'échanger avec l'élément pris"
            }
            disabled={disabled}
            onPress={() => tap(index)}
            style={({ pressed }) => [
              styles.row,
              active && styles.rowHeld,
              pressed && !disabled && styles.rowPressed,
              disabled && styles.rowDisabled,
            ]}
          >
            <View style={[styles.rank, active && styles.rankHeld]}>
              <Text
                maxFontSizeMultiplier={GLYPH_MAX_SCALE}
                style={[styles.rankText, active && styles.rankTextHeld]}
              >
                {index + 1}
              </Text>
            </View>
            <Text style={styles.rowText}>{item}</Text>
            {active && <Text style={styles.holdMark}>✋</Text>}
          </Pressable>
        );
      })}
      <Text style={styles.help}>
        {held === null
          ? "Touche un élément, puis celui avec lequel l'échanger."
          : "Maintenant, touche l'élément avec lequel l'échanger."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    minHeight: MIN_TOUCH_TARGET + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowHeld: { borderColor: colors.accent, backgroundColor: "#fff7ed" },
  rowPressed: { transform: [{ scale: 0.99 }] },
  rowDisabled: { opacity: 0.6 },
  rank: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.backgroundMiddle,
    alignItems: "center",
    justifyContent: "center",
  },
  rankHeld: { backgroundColor: colors.accent },
  rankText: { fontSize: fontSize.body, fontWeight: "700", color: colors.textMuted },
  rankTextHeld: { color: colors.surface },
  rowText: { flex: 1, fontSize: fontSize.label, color: colors.text },
  holdMark: { fontSize: 20 },
  help: { fontSize: fontSize.body, color: colors.textMuted, marginTop: spacing.xs },
});
