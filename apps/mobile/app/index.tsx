import { useConvexAuth, useQuery } from "convex/react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@convex/_generated/api";
import { convexUrl } from "@/convex/client";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";

/**
 * L'ÉCRAN TÉMOIN de la phase 0 (tâche 0.5).
 *
 * Il n'est pas destiné à un enfant et disparaîtra en phase 1, remplacé par le
 * pavé de code. Sa seule raison d'être est de montrer, sur un appareil réel,
 * les trois choses que la phase 0 devait établir :
 *
 *   1. le client Convex se connecte au déploiement ;
 *   2. `ConvexAuthProvider` lit le trousseau et sait dire s'il y a une session ;
 *   3. l'API partagée par alias — `@convex/_generated/api`, résolue vers
 *      `convex/` à la racine du dépôt — s'importe, se type et se bundle.
 *
 * Le point 3 est celui qui compte : c'est la décision D2 du plan, et elle se
 * vérifie AUSSI hors appareil, par `pnpm --filter @jotna/mobile typecheck` et
 * `bundle:check`.
 */
export default function WitnessScreen() {
  const insets = useSafeAreaInsets();
  const { isLoading, isAuthenticated } = useConvexAuth();

  // Même précaution que le web (Décision 99) : on n'interroge pas le profil
  // tant que l'authentification n'a pas tranché, sinon la requête part
  // anonyme et revient vide pour une raison qui n'est pas la bonne.
  const profile = useQuery(
    api.profiles.getCurrentProfile,
    isAuthenticated ? {} : "skip",
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.title}>Jotna School</Text>
      <Text style={styles.subtitle}>Écran témoin — phase 0</Text>

      <Row label="Déploiement Convex" value={convexUrl ?? "absent"} />
      <Row
        label="Authentification"
        value={
          isLoading
            ? "en cours…"
            : isAuthenticated
              ? "session ouverte"
              : "aucune session"
        }
      />
      <Row
        label="Profil"
        value={
          !isAuthenticated
            ? "—"
            : profile === undefined
              ? "chargement…"
              : profile === null
                ? "introuvable"
                : `${profile.name} (${profile.role})`
        }
      />

      <View style={styles.note}>
        <Text style={styles.noteText}>
          La connexion par code arrive en phase 1. Sans session, « aucune
          session » est le résultat attendu : il prouve que le fournisseur
          d&apos;authentification a lu le trousseau et a tranché.
        </Text>
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.backgroundTop,
  },
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: "800",
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  rowLabel: {
    fontSize: fontSize.body,
    color: colors.textMuted,
  },
  rowValue: {
    fontSize: fontSize.label,
    fontWeight: "600",
    color: colors.text,
  },
  note: {
    backgroundColor: colors.backgroundBottom,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  noteText: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.text,
  },
});
