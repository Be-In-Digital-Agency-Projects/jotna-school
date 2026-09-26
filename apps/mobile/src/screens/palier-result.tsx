import { ScrollView, StyleSheet, Text, View } from "react-native";

import { kidMessages } from "@lib/kidCopy";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

export interface PalierOutcome {
  status: "validated" | "failed";
  average: number;
  starsTotal: number;
  threshold: number;
  failedCount: number;
  canRegen: boolean;
  cumulativeRegens: number;
}

/** 30 étoiles au total : dix exercices, trois étoiles chacun (Décision 81). */
const MAX_STARS = 30;

/**
 * La fin de palier — tâche 2.10.
 *
 * LES CHIFFRES VIENNENT DU SERVEUR, AUCUN N'EST RECALCULÉ ICI. `submitPalier`
 * rend `starsTotal`, `average`, `status` et `canRegen` ; l'appareil les
 * AFFICHE. Un second calcul finirait par diverger du premier, et c'est
 * l'enfant qui lirait deux notes pour un même travail.
 *
 * LE PLAFOND DE RÉGÉNÉRATION EST CELUI DU SERVEUR. `canRegen` vaut déjà
 * `!validé && cumulativeRegens < 3` : le bouton suit ce drapeau et ne compte
 * rien lui-même. Quand il retombe, l'enfant lit le message prévu pour cela
 * (`jenVeuxEncoreLimit`), qui parle de revenir demain — pas d'un quota.
 *
 * AUCUN MOTIF D'ARGENT NI DE BUDGET N'ARRIVE JUSQU'ICI : « j'en veux encore »
 * consomme de l'IA, et quand le plafond de dépense est atteint le serveur rend
 * un `kidMessage` déjà écrit pour un enfant. On l'affiche tel quel.
 */
export function PalierResult({
  outcome,
  regenBusy,
  regenMessage,
  onRegen,
  onLeave,
}: {
  outcome: PalierOutcome;
  regenBusy: boolean;
  regenMessage: string | null;
  onRegen: () => void;
  onLeave: () => void;
}) {
  const validated = outcome.status === "validated";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.headline}>
        {validated
          ? kidMessages.palierValidated(outcome.starsTotal)
          : kidMessages.palierFailed(outcome.starsTotal)}
      </Text>

      <View style={styles.starsCard}>
        <Text style={styles.starsValue}>
          {outcome.starsTotal}
          <Text style={styles.starsMax}> / {MAX_STARS}</Text>
        </Text>
        <StarBar total={outcome.starsTotal} />
      </View>

      {!validated && outcome.failedCount > 0 && (
        <Text style={styles.detail}>
          {outcome.failedCount} exercice{outcome.failedCount > 1 ? "s" : ""} à
          revoir.
        </Text>
      )}

      {regenMessage !== null && (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Text style={styles.noticeText}>{regenMessage}</Text>
        </View>
      )}

      {outcome.canRegen ? (
        <>
          <Text style={styles.regenIntro}>{kidMessages.regenIntro}</Text>
          <BigButton
            label={kidMessages.cta.seeMore}
            onPress={onRegen}
            busy={regenBusy}
          />
        </>
      ) : (
        !validated && (
          <Text style={styles.regenIntro}>{kidMessages.jenVeuxEncoreLimit}</Text>
        )
      )}

      <BigButton label="Revenir à l'accueil" onPress={onLeave} tone="quiet" />
    </ScrollView>
  );
}

/** Une barre de 30 étoiles, en trois rangées de dix — une rangée par tranche. */
function StarBar({ total }: { total: number }) {
  const rows = [0, 1, 2];
  return (
    <View
      style={styles.starRows}
      accessibilityLabel={`${total} étoiles sur ${MAX_STARS}`}
    >
      {rows.map((row) => (
        <View key={row} style={styles.starRow}>
          {Array.from({ length: 10 }).map((_, i) => {
            const index = row * 10 + i;
            return (
              <Text
                key={i}
                style={index < total ? styles.starOn : styles.starOff}
              >
                ★
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { padding: spacing.lg, gap: spacing.md },
  headline: {
    fontSize: fontSize.title,
    fontWeight: "800",
    lineHeight: 34,
    color: colors.text,
  },
  starsCard: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
  },
  starsValue: { fontSize: 44, fontWeight: "800", color: colors.text },
  starsMax: { fontSize: fontSize.title, color: colors.textMuted },
  starRows: { gap: spacing.xs },
  starRow: { flexDirection: "row", justifyContent: "center" },
  starOn: { fontSize: 20, color: colors.accent },
  starOff: { fontSize: 20, color: colors.border },
  detail: { fontSize: fontSize.label, color: colors.textMuted },
  regenIntro: { fontSize: fontSize.label, lineHeight: 26, color: colors.text },
  notice: {
    backgroundColor: "#fffbeb",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: { fontSize: fontSize.body, lineHeight: 24, color: colors.text },
});
