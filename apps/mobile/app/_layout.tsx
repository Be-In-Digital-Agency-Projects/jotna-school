import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet, Text, View } from "react-native";

import { secureStorage } from "@/auth/secure-storage";
import { SessionGate } from "@/session/session-gate";
import { convex, convexUrl } from "@/convex/client";
import { colors, fontSize, spacing } from "@/theme/tokens";

export default function RootLayout() {
  if (convex === null) {
    return <MissingConfiguration />;
  }

  return (
    <SafeAreaProvider>
      {/* `storage` n'est pas optionnel en React Native — voir
          `src/auth/secure-storage.ts` pour la citation des types. */}
      <ConvexAuthProvider client={convex} storage={secureStorage}>
        <StatusBar style="dark" />
        {/* Qui tient l'appareil décide de ce qu'il voit : le pavé de code, un
            renvoi pour adulte, le mur d'accès, ou l'application. */}
        <SessionGate>
          <Stack screenOptions={{ headerShown: false }} />
        </SessionGate>
      </ConvexAuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * L'écran qu'on voit quand `EXPO_PUBLIC_CONVEX_URL` manque.
 *
 * Il s'adresse à un développeur, pas à un enfant : personne ne peut construire
 * l'application sans cette variable, donc elle ne manque jamais sur l'appareil
 * d'un élève. Il dit ce qui manque et où le poser, plutôt que de laisser un
 * écran blanc à interpréter.
 */
function MissingConfiguration() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Configuration incomplète</Text>
      <Text style={styles.body}>
        La variable <Text style={styles.code}>EXPO_PUBLIC_CONVEX_URL</Text>{" "}
        n&apos;est pas définie. Posez-la dans{" "}
        <Text style={styles.code}>apps/mobile/.env.local</Text> avec la même
        valeur que <Text style={styles.code}>NEXT_PUBLIC_CONVEX_URL</Text> côté
        web : c&apos;est le même déploiement.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.backgroundTop,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.danger,
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.text,
  },
  code: {
    fontFamily: "monospace",
    color: colors.textMuted,
  },
});
