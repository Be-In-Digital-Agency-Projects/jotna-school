import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  buildDragDropAnswer,
  type DragDropClientPayload,
} from "@convex/paliers/answers";
import { MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";
import type { ExerciseInputProps } from "./types";

/**
 * Ranger dans les bonnes zones — UN TAP SUR L'ÉTIQUETTE, UN TAP SUR LA ZONE.
 *
 * Le type s'appelle « glisser-déposer » au schéma, et c'est le NOM de
 * l'exercice, pas de son geste : l'enfant classe des étiquettes dans des
 * catégories. La chaîne soumise est rigoureusement la même qu'au glissé — un
 * objet `étiquette -> zone`, produit par `encodeDragDropAnswer`. Voir **D24**
 * pour le pourquoi du tap, et pour ce qu'il faudrait ajouter le jour où l'on
 * voudra aussi le glissé.
 *
 * UNE ÉTIQUETTE POSÉE SE REPREND d'un tap : un enfant qui se trompe de zone
 * doit pouvoir corriger sans tout défaire.
 *
 * LA RÉPONSE N'EST COMPLÈTE QUE QUAND LE VIVIER EST VIDE. Tant qu'il reste une
 * étiquette, `onAnswer(null)` garde Valider éteint — envoyer une réponse
 * partielle coûterait un essai sur les cinq, pour une réponse que l'enfant
 * n'avait pas fini d'écrire.
 */
export function DragDropInput({
  payload,
  disabled,
  onAnswer,
  attemptKey,
}: ExerciseInputProps<DragDropClientPayload>) {
  /** `texte de l'étiquette` -> `nom de la zone`. Absent = encore au vivier. */
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<string | null>(null);

  useEffect(() => {
    setPlaced({});
    setHeld(null);
    onAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptKey]);

  // Même principe qu'en « relier » : la complétude est une règle testée, pas
  // une condition recopiée dans un composant.
  function publish(next: Record<string, string>) {
    setPlaced(next);
    onAnswer(buildDragDropAnswer(payload.items.map((it) => it.text), next));
  }

  function tapItem(text: string) {
    if (placed[text] !== undefined) {
      const next = { ...placed };
      delete next[text];
      setHeld(text);
      publish(next);
      return;
    }
    setHeld((h) => (h === text ? null : text));
  }

  function tapZone(zone: string) {
    if (held === null) return;
    publish({ ...placed, [held]: zone });
    setHeld(null);
  }

  const pool = payload.items.filter((it) => placed[it.text] === undefined);

  return (
    <View style={styles.wrap}>
      <View style={styles.pool}>
        {pool.length === 0 ? (
          <Text style={styles.poolEmpty}>Tout est rangé 👍</Text>
        ) : (
          pool.map((it) => (
            <Chip
              key={it.text}
              label={it.text}
              held={held === it.text}
              disabled={disabled}
              onPress={() => tapItem(it.text)}
              hint="Touche, puis choisis une case"
            />
          ))
        )}
      </View>

      {payload.zones.map((zone) => {
        const inside = payload.items.filter((it) => placed[it.text] === zone);
        return (
          <Pressable
            key={zone}
            accessibilityRole="button"
            accessibilityLabel={`Case ${zone}, ${inside.length} élément${inside.length > 1 ? "s" : ""}`}
            accessibilityHint={held ? `Touche pour y poser « ${held} »` : undefined}
            disabled={disabled || held === null}
            onPress={() => tapZone(zone)}
            style={[
              styles.zone,
              held !== null && !disabled && styles.zoneOpen,
            ]}
          >
            <Text style={styles.zoneTitle}>{zone}</Text>
            <View style={styles.zoneItems}>
              {inside.length === 0 ? (
                <Text style={styles.zoneEmpty}>
                  {held !== null ? "Touche ici" : "Vide"}
                </Text>
              ) : (
                inside.map((it) => (
                  <Chip
                    key={it.text}
                    label={it.text}
                    held={false}
                    disabled={disabled}
                    onPress={() => tapItem(it.text)}
                    hint="Touche pour la reprendre"
                    placed
                  />
                ))
              )}
            </View>
          </Pressable>
        );
      })}

      <Text style={styles.help}>
        {held === null
          ? "Touche une étiquette, puis la case où elle va."
          : `« ${held} » va dans quelle case ?`}
      </Text>
    </View>
  );
}

function Chip({
  label,
  held,
  disabled,
  onPress,
  hint,
  placed = false,
}: {
  label: string;
  held: boolean;
  disabled: boolean;
  onPress: () => void;
  hint: string;
  placed?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: held, disabled }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        held && styles.chipHeld,
        placed && styles.chipPlaced,
        disabled && styles.chipDisabled,
      ]}
    >
      <Text style={[styles.chipText, held && styles.chipTextHeld]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  pool: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center",
  },
  poolEmpty: { fontSize: fontSize.body, color: colors.textMuted },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
  },
  chipHeld: { borderColor: colors.accent, backgroundColor: "#fff7ed" },
  chipPlaced: { backgroundColor: colors.backgroundMiddle },
  chipDisabled: { opacity: 0.6 },
  chipText: { fontSize: fontSize.body, color: colors.text },
  chipTextHeld: { fontWeight: "700", color: colors.accent },
  zone: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  zoneOpen: { borderColor: colors.accent, borderStyle: "solid" },
  zoneTitle: { fontSize: fontSize.label, fontWeight: "700", color: colors.text },
  zoneItems: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, minHeight: MIN_TOUCH_TARGET },
  zoneEmpty: { fontSize: fontSize.body, color: colors.textMuted, alignSelf: "center" },
  help: { fontSize: fontSize.body, color: colors.textMuted },
});
