import { Tabs } from "expo-router/js-tabs";
import { StyleSheet, Text } from "react-native";

import { colors, fontSize } from "@/theme/tokens";

/**
 * TROIS DESTINATIONS, TOUJOURS VISIBLES — phase 4.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE BARRE D'ONGLETS PLUTÔT QUE DES BOUTONS.
 *
 * Les phases 0 à 3 n'avaient qu'un écran, et « changer d'élève » tenait dans
 * un bouton au bas de l'accueil. Avec le coffre et le profil, cela ferait
 * trois boutons qu'il faut faire DÉFILER pour trouver — c'est-à-dire savoir
 * qu'ils existent. À huit ans, ce qu'on ne voit pas n'existe pas. Une barre
 * les tient sous le pouce en permanence, et dit aussi où l'on se trouve.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'IMPORT VIENT DE `expo-router/js-tabs`, PAS DE `expo-router`.
 *
 * `Tabs` y est toujours exporté, mais ses propres types le marquent déprécié :
 * « Use `import { Tabs } from 'expo-router/js-tabs'` instead ». Prendre le
 * chemin déprécié aujourd'hui, c'est une panne à la prochaine montée de SDK,
 * dans une application publiée sur deux boutiques.
 *
 * LES ICÔNES SONT DES EMOJIS. La même raison que pour les badges
 * (`theme/badge-icon.ts`) : une bibliothèque d'icônes tirerait
 * `react-native-svg`, un module natif, pour trois pictogrammes.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        // LA BARRE EST UNE CHROME DE HAUTEUR FIXE (49 dp + encoche, imposés
        // par le navigateur), et le libellé tient sous une icône de 22. Le
        // laisser grandir à 200 % le couperait. C'est la seule entorse à la
        // règle « tout ce qui se lit grandit » (5.4), et elle est compensée :
        // chaque onglet porte son `accessibilityLabel`, son icône, et le
        // titre de l'écran auquel il mène, lui, grandit sans plafond.
        tabBarAllowFontScaling: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Apprendre",
          tabBarIcon: () => <Text style={styles.icon}>📚</Text>,
        }}
      />
      <Tabs.Screen
        name="badges"
        options={{
          title: "Mon coffre",
          tabBarIcon: () => <Text style={styles.icon}>🎁</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Moi",
          tabBarIcon: () => <Text style={styles.icon}>😊</Text>,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 2,
    borderTopColor: colors.border,
  },
  // PAS DE `height` ICI, ET C'ÉTAIT UNE FAUTE DE L'Y METTRE. `getTabBarHeight`
  // (`expo-router/build/react-navigation/bottom-tabs/views/BottomTabBar`) rend
  // la hauteur du style TELLE QUELLE dès qu'elle est un nombre, et n'ajoute
  // alors PLUS l'encoche du bas. Sur un téléphone à barre gestuelle, la barre
  // d'onglets se serait retrouvée sous le trait système. Sans `height`, le
  // navigateur calcule 49 dp + encoche — déjà au-dessus de la cible tactile
  // recommandée, et juste sur tous les appareils.
  label: { fontSize: fontSize.body - 2, fontWeight: "700" },
  icon: { fontSize: 22 },
});
