import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { accessMessageForAdult } from "@lib/accessCopy";
import { useChangeStudent } from "@/session/change-student";
import { colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

/**
 * L'écran qu'un ADULTE voit s'il se connecte ici — décision D3.
 *
 * Il ne voit pas une navigation dégradée ni un menu grisé : une application
 * d'enfant qui laisse entrevoir un espace d'adulte apprend à l'enfant qu'il
 * existe une porte à pousser. On explique, et on sort.
 *
 * LE MOTIF VIENT DE `getAccessState`, PAS D'UNE REQUÊTE DE PROFIL. Vérifié
 * dans `convex/accessRules.ts` : `decideAccess` teste `not_authenticated` puis
 * `not_student` AVANT tout le reste, donc `not_student` désigne exactement un
 * adulte authentifié. `components/AccessGate.tsx` s'appuie déjà sur cette
 * propriété, et elle tient par CONSTRUCTION de la fonction, pas par estimation.
 *
 * AUCUN LIEN SORTANT, et ce n'est pas un oubli. Les règles des catégories
 * Enfants d'Apple et Families de Google (décision D9) exigent une barrière
 * parentale devant tout lien qui quitte l'application. L'adresse est donc
 * ÉCRITE, pas cliquable : l'adulte la recopie dans son navigateur, ce qu'il
 * sait faire, et l'application n'a pas de porte de sortie.
 */
export function AdultStop() {
  const insets = useSafeAreaInsets();
  const { changeStudent, busy } = useChangeStudent();
  const { title, body } = accessMessageForAdult("not_student");

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Cette application est celle des élèves</Text>
        <Text style={styles.cardBody}>
          Les espaces parent, professeur et direction sont sur le site, depuis
          un navigateur :
        </Text>
        <Text style={styles.address} selectable>
          jotna.school
        </Text>
      </View>

      <BigButton label="Se déconnecter" onPress={changeStudent} busy={busy} tone="quiet" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.title, fontWeight: "800", color: colors.text },
  body: { fontSize: fontSize.body, lineHeight: 24, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  cardTitle: { fontSize: fontSize.label, fontWeight: "700", color: colors.text },
  cardBody: { fontSize: fontSize.body, lineHeight: 24, color: colors.textMuted },
  address: {
    fontSize: fontSize.label,
    fontWeight: "700",
    color: colors.text,
    fontFamily: "monospace",
  },
});
