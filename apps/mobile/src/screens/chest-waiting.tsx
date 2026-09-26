import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { pendingEntries } from "@/offline/store";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

/**
 * « TON COFFRE T'ATTEND » — la fin d'un palier joué sans réseau (3.12).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CET ÉCRAN NE FAIT PAS, ET C'EST LE PLUS IMPORTANT : IL N'ANNONCE
 * AUCUNE ÉTOILE.
 *
 * L'appareil a montré « juste » ou « faux » à chaque exercice, mais ce verdict
 * est CONSULTATIF (D12) : le serveur relit toutes les réponses et recalcule
 * tout. Afficher ici « tu as gagné 24 ⭐ » serait crédible, facile, et pourrait
 * se révéler faux au retour du réseau — un enfant à qui l'on reprend des
 * étoiles annoncées ne revient pas. On annonce donc ce qui est CERTAIN : les
 * réponses sont gardées, et le coffre s'ouvrira.
 *
 * LA PROMESSE EST TENUE PAR DU CODE, PAS PAR UNE PHRASE. `closePendingPaliers`
 * (`offline/sync.ts`) clôt vraiment le palier au retour du réseau, et la
 * séance affiche alors le VRAI résultat. Sans cette clôture, cet écran
 * mentirait ; c'est pourquoi les deux ont été écrits ensemble.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Le compte des réponses en attente est là pour l'adulte autant que pour
 * l'enfant : c'est la preuve visible que le travail existe quelque part.
 */
export function ChestWaiting({
  palierAttemptId,
  online,
  onLeave,
}: {
  palierAttemptId: string;
  online: boolean;
  onLeave: () => void;
}) {
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void pendingEntries(palierAttemptId)
      .then((rows) => {
        if (alive) setPending(rows.length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // `online` est dans les dépendances pour relire au retour du réseau : le
    // compte tombe alors à zéro sous les yeux de l'enfant, ce qui est
    // exactement ce qu'on veut lui montrer.
  }, [palierAttemptId, online]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.chest}>🎁</Text>
      <Text style={styles.title}>Ton coffre t&apos;attend !</Text>

      <View style={styles.card}>
        <Text style={styles.line}>
          Tu as fini ton palier, bravo 👏 Toutes tes réponses sont bien gardées
          dans la tablette 💾
        </Text>
        <Text style={styles.line}>
          {online
            ? "On les envoie maintenant… Tes étoiles arrivent !"
            : "Tes étoiles et tes badges t'attendent : ils arriveront dès qu'il y aura du réseau."}
        </Text>
        {pending !== null && pending > 0 && (
          <Text style={styles.count}>
            {pending} réponse{pending > 1 ? "s" : ""} en route 📤
          </Text>
        )}
        {pending === 0 && (
          <Text style={styles.count}>Tout est arrivé ✅</Text>
        )}
      </View>

      <BigButton label="Revenir à l'accueil" onPress={onLeave} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  chest: { fontSize: 72 },
  title: {
    fontSize: fontSize.display,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  line: { fontSize: fontSize.label, lineHeight: 28, color: colors.text },
  count: { fontSize: fontSize.body, color: colors.textMuted },
});
