import { getRarityLabel, type RarityTier } from "@lib/badges";

export { getRarityLabel, type RarityTier };

/**
 * LES COULEURS DE RARETÉ, EN VALEURS — pas en classes Tailwind.
 *
 * `lib/badges.ts` est partagé avec le web et sert les deux : on lui reprend
 * `RARITY_TIERS`, le type et `getRarityLabel`, qui sont du texte et de la
 * donnée. Ses trois autres fonctions rendent des classes CSS
 * (`ring-2 ring-blue-300/70`, `animate-[legendaryPulse…]`) : sur React Native
 * elles ne veulent rien dire, et les y appeler produirait des cartes sans
 * bordure sans qu'aucune erreur ne le signale.
 *
 * LES TEINTES SONT LES MÊMES, prises une à une dans la palette Tailwind que le
 * web emploie — bleu 300/100/700, violet 400/100/700, ambre 400/100/700. Le
 * badge « épique » d'un enfant doit être le même violet sur les deux
 * applications ; c'est à cela qu'il le reconnaît.
 *
 * Ce qui ne se transpose PAS, et qu'on assume : la pulsation du légendaire.
 * Elle est une animation CSS ; la refaire en `Animated` coûterait une boucle
 * qui tourne en permanence derrière une grille de badges, sur un Android
 * d'entrée de gamme. La bordure ambre suffit à le distinguer.
 */
export interface RarityStyle {
  border: string;
  chipBackground: string;
  chipText: string;
}

const STYLES: Record<RarityTier, RarityStyle> = {
  common: {
    border: "#e5e7eb",
    chipBackground: "#f3f4f6",
    chipText: "#4b5563",
  },
  rare: {
    border: "#93c5fd",
    chipBackground: "#dbeafe",
    chipText: "#1d4ed8",
  },
  epic: {
    border: "#c084fc",
    chipBackground: "#f3e8ff",
    chipText: "#7e22ce",
  },
  legendary: {
    border: "#fbbf24",
    chipBackground: "#fef3c7",
    chipText: "#b45309",
  },
};

export function rarityStyle(tier: RarityTier): RarityStyle {
  return STYLES[tier] ?? STYLES.common;
}
