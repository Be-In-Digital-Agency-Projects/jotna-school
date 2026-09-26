import { useConvexAuth, useQuery } from "convex/react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { api } from "@convex/_generated/api";
import { AccessClosed } from "@/screens/access-closed";
import { AdultStop } from "@/screens/adult-stop";
import { CodePad } from "@/screens/code-pad";
import { colors, fontSize, spacing } from "@/theme/tokens";

/**
 * Ce que l'appareil montre, selon qui le tient.
 *
 * UNE SEULE REQUÊTE DÉCIDE DE TOUT, et ce n'est pas une économie de bout de
 * chandelle : `api.access.getAccessState` porte à la fois la garde de rôle
 * (D3) et le mur de paiement (D7), parce que `decideAccess`
 * (`convex/accessRules.ts`) ordonne ses motifs.
 *
 *     not_authenticated  →  personne n'est connecté
 *     not_student        →  un adulte est connecté
 *     tout le reste      →  un ÉLÈVE authentifié, dont l'école n'est pas à jour
 *
 * Les deux premiers sont testés AVANT tous les autres, donc la déduction est
 * exacte par construction de la fonction, pas par estimation.
 * `components/AccessGate.tsx` s'appuie déjà sur la même propriété côté web, et
 * la documente. Demander le profil en plus pour lire `role` serait une requête
 * de trop, et surtout une SECONDE source de vérité sur la même question.
 *
 * PAS DE NAVIGATION ICI. L'espace enfant n'a pas de zone publique : déconnecté,
 * il n'y a rien d'autre à voir que le pavé de code. Router entre des routes
 * gardées créerait des courses au démarrage — un éclair d'accueil avant la
 * redirection, que l'enfant voit et qui le perd. On remplace l'arbre, on ne
 * navigue pas.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();

  // Tant que l'authentification n'a pas tranché, la requête partirait anonyme
  // et reviendrait `not_authenticated` pour une raison qui n'est pas la bonne
  // (même précaution que la Décision 99 côté web).
  const access = useQuery(
    api.access.getAccessState,
    isAuthenticated ? {} : "skip",
  );

  // 1.3 — reconnexion automatique : le jeton est relu dans le trousseau avant
  // que quoi que ce soit s'affiche, pour que l'enfant déjà connecté ne voie
  // jamais le pavé de code clignoter.
  if (isLoading) return <Booting />;

  if (!isAuthenticated) return <CodePad />;

  if (access === undefined) return <Booting />;

  if (!access.ok) {
    if (access.reason === "not_student") return <AdultStop />;
    // Le jeton a expiré entre-temps : on redemande le code.
    if (access.reason === "not_authenticated") return <CodePad />;
    return <AccessClosed />;
  }

  return <>{children}</>;
}

function Booting() {
  return (
    <View style={styles.booting}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.bootingText}>Un instant…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  booting: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: colors.backgroundTop,
  },
  bootingText: { fontSize: fontSize.label, color: colors.textMuted },
});
