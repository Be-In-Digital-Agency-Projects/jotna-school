import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { api } from "@convex/_generated/api";
import { AccessClosed } from "@/screens/access-closed";
import { AdultStop } from "@/screens/adult-stop";
import { CodePad } from "@/screens/code-pad";
import { NoConnection } from "@/screens/no-connection";
import { useServerReach } from "@/session/reach";
import {
  readVerdict,
  rememberVerdict,
  verdictStillOpens,
  type CachedVerdict,
} from "@/session/last-verdict";
import { colors, fontSize, spacing } from "@/theme/tokens";

/**
 * Ce que l'appareil montre, selon qui le tient — ET selon ce qu'on peut savoir.
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
 * `components/AccessGate.tsx` s'appuie déjà sur la même propriété côté web.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PHASE 5 — ET QUAND LA REQUÊTE NE REVIENT JAMAIS ?
 *
 * C'est le défaut que la tâche 5.1 a mis au jour, et il annulait la phase 3
 * tout entière. Sans socket, `getAccessState` reste `undefined` pour toujours
 * et cet écran affichait « Un instant… » sans fin. L'enfant qui prépare ses
 * paliers le vendredi à l'école et ouvre l'application le samedi au village
 * n'atteignait JAMAIS ce qu'il avait préparé : le hors-ligne ne servait qu'aux
 * coupures survenant en pleine séance.
 *
 * On distingue donc trois situations là où il n'y en avait qu'une :
 *
 *   la socket est ouverte          → on attend la réponse, elle vient
 *   elle s'ouvre encore            → on attend aussi, c'est le délai de grâce
 *   elle ne s'ouvre pas            → on consulte le DERNIER VERDICT CONNU
 *
 * Le dernier verdict n'autorise qu'une chose : franchir cette porte pour
 * atteindre ce qui est déjà sur l'appareil. `last-verdict.ts` dit pourquoi
 * c'est sans danger, et pourquoi il porte deux bornes.
 *
 * ON NE NAVIGUE TOUJOURS PAS ICI. L'espace enfant n'a pas de zone publique :
 * déconnecté, il n'y a rien d'autre à voir que le pavé de code. Router entre
 * des routes gardées créerait des courses au démarrage — un éclair d'accueil
 * avant la redirection, que l'enfant voit et qui le perd. On remplace l'arbre.
 *
 * Ce qui se passe DERRIÈRE la porte, en revanche, navigue normalement : les
 * onglets choisissent eux-mêmes leur version hors-ligne, ce qui fait qu'au
 * retour du réseau ils se remplissent sans que rien ne soit remonté.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const reach = useServerReach();

  // Tant que l'authentification n'a pas tranché, la requête partirait anonyme
  // et reviendrait `not_authenticated` pour une raison qui n'est pas la bonne
  // (même précaution que la Décision 99 côté web).
  const access = useQuery(
    api.access.getAccessState,
    isAuthenticated ? {} : "skip",
  );

  // `undefined` = on n'a pas fini de lire le trousseau ; `null` = rien dedans.
  const [cached, setCached] = useState<CachedVerdict | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let alive = true;
    void readVerdict()
      .then((v) => {
        if (alive) setCached(v);
      })
      .catch(() => {
        if (alive) setCached(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // CHAQUE RÉPONSE DU SERVEUR RAFRAÎCHIT LE SOUVENIR. C'est ce qui fait que la
  // borne de fraîcheur se recharge toute seule tant que l'enfant vient à
  // l'école : il n'a rien à faire pour que son hors-ligne reste ouvert.
  useEffect(() => {
    if (access?.ok === true) {
      void rememberVerdict(access.endsAt);
      setCached({ endsAt: access.endsAt, askedAt: Date.now() });
    }
  }, [access]);

  // 1.3 — reconnexion automatique : le jeton est relu dans le trousseau avant
  // que quoi que ce soit s'affiche, pour que l'enfant déjà connecté ne voie
  // jamais le pavé de code clignoter.
  if (isLoading) return <Booting />;

  if (!isAuthenticated) return <CodePad />;

  if (access === undefined) {
    // La socket répond ou est en train de s'ouvrir : la réponse vient.
    if (reach !== "offline" || cached === undefined) return <Booting />;

    // Elle ne s'ouvrira pas. On entre sur le souvenir, ou l'on dit pourquoi
    // on n'entre pas — jamais un fileur de plus.
    return verdictStillOpens(cached, Date.now()) ? (
      <>{children}</>
    ) : (
      <NoConnection />
    );
  }

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
