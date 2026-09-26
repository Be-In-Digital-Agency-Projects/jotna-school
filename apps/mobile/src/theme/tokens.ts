/**
 * Les valeurs de l'identité visuelle, reprises du web pour que l'enfant
 * retrouve la même application.
 *
 * DÉCISION D22 — `StyleSheet` et ces jetons, PAS NativeWind.
 *
 * La phase 0 devait trancher entre les deux sur un écran témoin. Trois raisons
 * ont décidé, et aucune n'est « Tailwind c'est moins bien » :
 *
 *   1. LA SURFACE EST PETITE. L'application élève tient en une quinzaine
 *      d'écrans, pas cent. Ce que NativeWind fait gagner — une convention
 *      partagée sur un grand nombre d'écrans — ne se rembourse pas ici.
 *   2. LE CŒUR DU PRODUIT N'EST PAS STYLABLE PAR CLASSES. Les cinq exercices
 *      sont animés au doigt, sur `react-native-reanimated` : ces composants
 *      écrivent des styles calculés dans un worklet, où une chaîne de classes
 *      n'a rien à dire.
 *   3. C'EST UNE PIÈCE DE MOINS DANS LA CHAÎNE DE CONSTRUCTION. NativeWind
 *      s'insère dans Babel ET dans Metro, et se couple à la version de
 *      Reanimated. Sur un chantier qui vise Android d'entrée de gamme et une
 *      montée de version annuelle du SDK, chaque pièce du pipeline est un
 *      rendez-vous à honorer.
 *
 * CE CHOIX SE RETOURNE. Les valeurs ci-dessous sont des constantes, pas des
 * classes : adopter NativeWind plus tard les reprend telles quelles dans un
 * thème, sans réécrire un écran.
 *
 * Les couleurs sont les valeurs Tailwind employées par
 * `app/(student)/layout.tsx` sur le web — mêmes teintes, mêmes noms.
 */
export const colors = {
  /** amber-50 — fond haut du dégradé élève */
  backgroundTop: "#fffbeb",
  /** yellow-50 — fond milieu */
  backgroundMiddle: "#fefce8",
  /** lime-50 — fond bas */
  backgroundBottom: "#f7fee7",
  /** amber-100 — filets et séparateurs */
  border: "#fef3c7",
  /** orange-500 — l'accent, celui des boutons actifs */
  accent: "#f97316",
  /** orange-200 — l'ombre portée de l'accent */
  accentShadow: "#fed7aa",
  surface: "#ffffff",
  text: "#1c1917",
  textMuted: "#78716c",
  danger: "#b91c1c",
  success: "#15803d",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  md: 12,
  lg: 20,
  pill: 999,
} as const;

/**
 * Les tailles de texte partent de 16 et montent.
 *
 * Rien en dessous de 16 dans cette application : le lecteur a huit ans, et
 * l'écran est souvent une tablette d'école posée à plat sur une table, donc
 * plus loin des yeux qu'un téléphone tenu en main.
 */
export const fontSize = {
  body: 16,
  label: 18,
  title: 24,
  display: 32,
} as const;

/** Cible tactile minimale — 48 dp, recommandation Android. */
export const MIN_TOUCH_TARGET = 48;
