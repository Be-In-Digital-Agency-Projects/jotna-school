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

/**
 * LE PLAFOND D'AGRANDISSEMENT DES GLYPHES ENFERMÉS — tâche 5.4.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE TEXTE DOIT GRANDIR. React Native suit le réglage de taille de police du
 * système par défaut, et c'est la bonne conduite : un adulte presbyte assis à
 * côté de l'enfant, un enfant qui voit mal, une tablette posée à plat sur une
 * table. Tout ce qui se LIT dans cette application grandit sans plafond.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SAUF CE QUI EST ENFERMÉ DANS UNE BOÎTE DE TAILLE FIXE.
 *
 * Quelques éléments ne sont pas du texte mais des DESSINS faits de caractères :
 * l'emoji d'une matière dans sa pastille de 56 points, la flamme dans le rond
 * de 38 points du ruban de série, les initiales dans l'avatar. Leur boîte a
 * une dimension fixe parce qu'elle est un repère visuel, pas un paragraphe.
 * À 200 % — ce que propose Android — un emoji de 28 points en réclame 56 dans
 * une boîte qui en fait 56 : il déborde, se coupe, ou pousse la mise en page.
 *
 * Les plafonner À EUX SEULS, c'est laisser tout le reste grandir vraiment.
 * L'alternative — enlever les dimensions fixes — coûterait la grille, et une
 * grille qui bouge à chaque réglage se lit plus mal, pas mieux.
 *
 * 1,3 laisse un agrandissement VISIBLE sans casser la boîte : c'est mesuré sur
 * le rapport le plus serré des trois (38 points de rond pour 16 de glyphe).
 */
export const GLYPH_MAX_SCALE = 1.3;
