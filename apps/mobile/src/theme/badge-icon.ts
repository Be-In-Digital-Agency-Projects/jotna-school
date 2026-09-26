/**
 * L'ICÔNE D'UN BADGE — des emojis, pas des composants Lucide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `badges.icon` CONTIENT UN NOM D'ICÔNE LUCIDE, pas un dessin : « Trophy »,
 * « Flame », « Sunrise ». Le web les résout avec une table de quarante entrées
 * vers `lucide-react` (`components/student/badge-icon.tsx`), qui est du DOM et
 * ne s'exécute pas sur React Native.
 *
 * DEUX SORTIES POSSIBLES, ET CELLE-CI EST CHOISIE :
 *
 *   `lucide-react-native` — même jeu d'icônes, mais une dépendance de plus,
 *   qui tire `react-native-svg`, qui est un module NATIF : une pièce de plus
 *   dans la chaîne de construction et au rendez-vous de chaque montée de SDK.
 *   C'est exactement le raisonnement de D22, et il conclut pareil.
 *
 *   UNE TABLE D'EMOJIS — zéro dépendance, rendu par le système, et sur l'écran
 *   d'un enfant de huit ans un trophée en couleur vaut mieux qu'un trait fin
 *   monochrome. Les badges sont décoratifs : ils récompensent, ils n'informent
 *   pas.
 *
 * LA TABLE COUVRE LES MÊMES QUARANTE NOMS QUE LE WEB, et son repli est le
 * même — le trophée. Un badge inventé demain s'affichera donc en 🏆 des deux
 * côtés, plutôt que de disparaître d'un seul.
 */
const EMOJI_BY_LUCIDE_NAME: Record<string, string> = {
  Award: "🎖️",
  BookOpen: "📖",
  BookOpenCheck: "📚",
  Brain: "🧠",
  Calculator: "🧮",
  Clock: "🕐",
  Compass: "🧭",
  Crown: "👑",
  Dumbbell: "🏋️",
  EyeOff: "🙈",
  Feather: "🪶",
  Flame: "🔥",
  Footprints: "👣",
  GraduationCap: "🎓",
  Heart: "❤️",
  Infinity: "♾️",
  Lightbulb: "💡",
  Medal: "🥇",
  Moon: "🌙",
  Mountain: "⛰️",
  Music: "🎵",
  Palette: "🎨",
  Pencil: "✏️",
  Puzzle: "🧩",
  Rabbit: "🐇",
  RefreshCw: "🔄",
  Rocket: "🚀",
  Snowflake: "❄️",
  Sparkles: "✨",
  Star: "⭐",
  Sun: "☀️",
  Sunrise: "🌅",
  Target: "🎯",
  Timer: "⏱️",
  Trophy: "🏆",
  Zap: "⚡",
};

export function badgeIcon(icon: string | undefined | null): string {
  if (icon == null) return "🏆";
  return EMOJI_BY_LUCIDE_NAME[icon] ?? "🏆";
}
