import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import {
  encodeShortAnswer,
  type ShortAnswerClientPayload,
} from "@convex/paliers/answers";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";
import type { ExerciseInputProps } from "./types";

/**
 * La réponse libre — l'enfant écrit.
 *
 * LE TEXTE PART BRUT. `verifyShortAnswer` met en minuscules et retire les
 * espaces de bord ; et surtout, quand la comparaison littérale échoue,
 * `attemptsVerify` fait relire la réponse à l'IA pour juger d'une équivalence
 * de sens. Un composant qui raboterait le texte avant de l'envoyer retirerait
 * à ce rattrapage de quoi juger. On ne coupe donc que pour savoir si le champ
 * est VIDE, jamais pour fabriquer la réponse.
 *
 * `autoCorrect` et `autoCapitalize` sont désactivés : le correcteur du
 * téléphone réécrit les mots qu'il ne connaît pas, et un exercice de
 * vocabulaire ou un nom propre sénégalais en fait partie. L'enfant serait
 * compté faux pour une correction qu'il n'a pas demandée.
 */
export function ShortAnswerInput({
  disabled,
  onAnswer,
  attemptKey,
}: ExerciseInputProps<ShortAnswerClientPayload>) {
  const [text, setText] = useState("");

  useEffect(() => {
    setText("");
    onAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptKey]);

  function change(next: string) {
    setText(next);
    onAnswer(next.trim().length === 0 ? null : encodeShortAnswer(next));
  }

  return (
    <View>
      <TextInput
        value={text}
        onChangeText={change}
        editable={!disabled}
        placeholder="Écris ta réponse…"
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        multiline
        style={[styles.input, disabled && styles.inputDisabled]}
        accessibilityLabel="Ta réponse"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 96,
    fontSize: fontSize.label,
    lineHeight: 26,
    color: colors.text,
    textAlignVertical: "top",
  },
  inputDisabled: { opacity: 0.6 },
});
