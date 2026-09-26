import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { loginCredentials } from "@convex/importCodes";
import { readClassPrefix, writeClassPrefix } from "@/session/class-prefix";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

const DIGITS = 4;

/** Le préfixe se nettoie comme `buildLoginCode` le construit : alphanumérique, majuscules. */
function cleanPrefix(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * L'écran d'entrée : un enfant tape le code de son billet.
 *
 * IL COMPOSE LE CODE, IL NE LE FAIT PAS SAISIR. Le billet porte `CM1A-4821`, et
 * un champ de texte libre laisserait l'enfant se tromper sur le tiret, sur un
 * espace, sur la casse. Deux champs séparés — la classe, puis quatre chiffres —
 * suppriment ces trois erreurs d'un coup : l'application recompose la forme
 * exacte. Le préfixe étant retenu (voir `session/class-prefix.ts`), un enfant
 * qui revient ne tape plus que quatre chiffres.
 *
 * LE CLAVIER EST CELUI DU SYSTÈME, pas un pavé dessiné. `keyboardType="number-pad"`
 * donne de grandes touches que l'enfant connaît déjà, que les lecteurs d'écran
 * savent annoncer et que le système adapte à sa taille de police. Un pavé
 * maison aurait fallu réinventer tout cela, moins bien.
 *
 * AUCUN « CODE OUBLIÉ » — décision D5. `ResendOTPPasswordReset` n'a nulle part
 * où écrire pour un élève sans adresse, et c'est voulu à huit ans : c'est un
 * adulte de l'école qui dépanne, avec
 * `studentCredentials.resetStudentLoginCode`. Le bas de l'écran le dit.
 */
export function CodePad() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuthActions();

  const [prefix, setPrefix] = useState("");
  const [prefixKnown, setPrefixKnown] = useState(false);
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digitsRef = useRef<TextInput>(null);

  useEffect(() => {
    let alive = true;
    void readClassPrefix().then((saved) => {
      if (!alive || !saved) return;
      setPrefix(saved);
      setPrefixKnown(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const ready = prefix.length > 0 && digits.length === DIGITS && !busy;

  async function enter() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      // LE POINT DE LA DÉCISION D5 : identifiant et secret ne sont pas la même
      // chaîne. `loginCredentials` vit dans `convex/importCodes.ts`, avec le
      // format des codes, et ses tests gardent l'asymétrie.
      const { email, password } = loginCredentials(`${prefix}-${digits}`);
      await signIn("password", { email, password, flow: "signIn" });
      await writeClassPrefix(prefix);
      // Pas de navigation ici : `SessionGate` voit la session s'ouvrir et
      // remplace cet écran. Une navigation en plus créerait une course avec lui.
    } catch {
      // Le serveur dit « Invalid credentials ». Un enfant de huit ans ne lit
      // pas ça, et ne doit pas apprendre que son échec a un nom anglais.
      setError("Ce code ne marche pas. Regarde bien ton billet et réessaie.");
      setDigits("");
      digitsRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function changeClass() {
    setPrefixKnown(false);
    setPrefix("");
    setDigits("");
    setError(null);
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Bonjour !</Text>
        <Text style={styles.subtitle}>Tape le code de ton billet.</Text>

        {prefixKnown ? (
          <View style={styles.knownClass}>
            <Text style={styles.knownClassLabel}>Ta classe</Text>
            <Text style={styles.knownClassValue}>{prefix}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={changeClass}
              hitSlop={12}
              style={styles.changeClass}
            >
              <Text style={styles.changeClassText}>Ce n&apos;est pas ma classe</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Ta classe</Text>
            <TextInput
              value={prefix}
              onChangeText={(t) => setPrefix(cleanPrefix(t))}
              placeholder="CM1A"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              style={styles.prefixInput}
              accessibilityLabel="La classe écrite sur ton billet"
              returnKeyType="next"
              onSubmitEditing={() => digitsRef.current?.focus()}
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Tes quatre chiffres</Text>
          <TextInput
            ref={digitsRef}
            value={digits}
            onChangeText={(t) => setDigits(t.replace(/\D/g, "").slice(0, DIGITS))}
            placeholder="0000"
            placeholderTextColor={colors.border}
            keyboardType="number-pad"
            maxLength={DIGITS}
            style={styles.digitsInput}
            accessibilityLabel="Les quatre chiffres de ton billet"
            returnKeyType="go"
            onSubmitEditing={() => void enter()}
          />
        </View>

        {error !== null && (
          <View style={styles.error} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <BigButton label="Entrer" onPress={() => void enter()} disabled={!ready} busy={busy} />

        <Text style={styles.help}>
          Tu as perdu ton billet ? Demande à ton maître ou à ta maîtresse : ils
          peuvent t&apos;en donner un nouveau.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  title: { fontSize: fontSize.display, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: fontSize.label, color: colors.textMuted, marginTop: -spacing.md },
  field: { gap: spacing.sm },
  fieldLabel: { fontSize: fontSize.label, fontWeight: "600", color: colors.text },
  prefixInput: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.title,
    fontWeight: "700",
    letterSpacing: 2,
    color: colors.text,
  },
  digitsInput: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: 12,
    textAlign: "center",
    color: colors.text,
  },
  knownClass: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  knownClassLabel: { fontSize: fontSize.body, color: colors.textMuted },
  knownClassValue: {
    fontSize: fontSize.title,
    fontWeight: "800",
    letterSpacing: 2,
    color: colors.text,
  },
  changeClass: { marginTop: spacing.xs, minHeight: 32, justifyContent: "center" },
  changeClassText: {
    fontSize: fontSize.body,
    color: colors.accent,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  error: {
    backgroundColor: "#fef2f2",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { fontSize: fontSize.body, lineHeight: 24, color: colors.danger },
  help: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.textMuted,
    textAlign: "center",
  },
});
