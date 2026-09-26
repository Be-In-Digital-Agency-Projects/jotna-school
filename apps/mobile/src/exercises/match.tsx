import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { buildMatchAnswer, type MatchClientPayload } from "@convex/paliers/answers";
import { MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";
import type { ExerciseInputProps } from "./types";

/** Les couleurs qui marquent les paires formées — assez distinctes pour huit ans. */
const PAIR_COLORS = ["#f97316", "#0ea5e9", "#16a34a", "#a855f7", "#e11d48", "#ca8a04"];

/**
 * Relier — UN TAP À GAUCHE, UN TAP À DROITE.
 *
 * C'est la décision prise au plan : tracer une liaison au doigt sur un écran de
 * cinq pouces échoue une fois sur trois à cet âge. Deux taps ne ratent jamais,
 * et un lecteur d'écran sait les annoncer.
 *
 * LES PAIRES SE MARQUENT PAR UNE COULEUR, pas par un trait. Un trait entre deux
 * colonnes demande de mesurer des positions à l'écran, ce qui se décale dès que
 * le texte grandit — or la mise à l'échelle des polices est une exigence
 * d'accessibilité, pas une option. Une pastille de couleur des deux côtés dit
 * la même chose et ne bouge pas.
 *
 * LA COLONNE DE DROITE EST DÉJÀ MÉLANGÉE par le serveur (`sanitizePayload`,
 * graine déterministe). On ne la retouche pas.
 *
 * TOUCHER UNE PAIRE FORMÉE LA DÉFAIT : un enfant qui se trompe doit pouvoir
 * revenir sans tout recommencer.
 */
export function MatchInput({
  payload,
  disabled,
  onAnswer,
  attemptKey,
}: ExerciseInputProps<MatchClientPayload>) {
  /** `left` -> `right`, dans l'ordre où l'enfant les a formées. */
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [heldLeft, setHeldLeft] = useState<string | null>(null);

  useEffect(() => {
    setPairs({});
    setHeldLeft(null);
    onAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptKey]);

  // La règle de complétude vit dans `paliers/answers.ts`, sous tests : c'est
  // elle qui décide si Valider s'allume, et une réponse partielle envoyée
  // coûterait un essai sur les cinq.
  function publish(next: Record<string, string>) {
    setPairs(next);
    onAnswer(buildMatchAnswer(payload.left, next));
  }

  function tapLeft(left: string) {
    if (pairs[left] !== undefined) {
      const next = { ...pairs };
      delete next[left];
      setHeldLeft(null);
      publish(next);
      return;
    }
    setHeldLeft((h) => (h === left ? null : left));
  }

  function tapRight(right: string) {
    // Une droite déjà prise se libère en touchant sa gauche : ici on ne fait
    // rien plutôt que de voler la paire d'un autre, ce qui surprendrait.
    const takenBy = Object.keys(pairs).find((l) => pairs[l] === right);
    if (takenBy !== undefined) return;
    if (heldLeft === null) return;
    publish({ ...pairs, [heldLeft]: right });
    setHeldLeft(null);
  }

  const colorOf = (left: string) =>
    PAIR_COLORS[payload.left.indexOf(left) % PAIR_COLORS.length];

  return (
    <View style={styles.wrap}>
      <View style={styles.columns}>
        <View style={styles.column}>
          {payload.left.map((left) => {
            const paired = pairs[left] !== undefined;
            const held = heldLeft === left;
            return (
              <Pressable
                key={left}
                accessibilityRole="button"
                accessibilityState={{ selected: held || paired, disabled }}
                accessibilityLabel={
                  paired ? `${left}, relié à ${pairs[left]}` : left
                }
                accessibilityHint={
                  paired ? "Touche pour défaire" : "Touche, puis choisis à droite"
                }
                disabled={disabled}
                onPress={() => tapLeft(left)}
                style={[
                  styles.cell,
                  held && styles.cellHeld,
                  paired && { borderColor: colorOf(left) },
                  disabled && styles.cellDisabled,
                ]}
              >
                {paired && (
                  <View style={[styles.dot, { backgroundColor: colorOf(left) }]} />
                )}
                <Text style={styles.cellText}>{left}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.column}>
          {payload.right.map((right) => {
            const owner = Object.keys(pairs).find((l) => pairs[l] === right);
            const paired = owner !== undefined;
            return (
              <Pressable
                key={right}
                accessibilityRole="button"
                accessibilityState={{ selected: paired, disabled: disabled || paired }}
                accessibilityLabel={paired ? `${right}, relié à ${owner}` : right}
                disabled={disabled || paired}
                onPress={() => tapRight(right)}
                style={[
                  styles.cell,
                  paired && { borderColor: colorOf(owner) },
                  (disabled || (paired && heldLeft !== null)) && styles.cellDisabled,
                ]}
              >
                {paired && (
                  <View style={[styles.dot, { backgroundColor: colorOf(owner) }]} />
                )}
                <Text style={styles.cellText}>{right}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Text style={styles.help}>
        {heldLeft === null
          ? "Touche un mot à gauche, puis celui qui va avec à droite."
          : `« ${heldLeft} » va avec… touche à droite.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  columns: { flexDirection: "row", gap: spacing.md },
  column: { flex: 1, gap: spacing.sm },
  cell: {
    minHeight: MIN_TOUCH_TARGET + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  cellHeld: { borderColor: colors.accent, backgroundColor: "#fff7ed" },
  cellDisabled: { opacity: 0.6 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  cellText: { flex: 1, fontSize: fontSize.body, color: colors.text },
  help: { fontSize: fontSize.body, color: colors.textMuted },
});
