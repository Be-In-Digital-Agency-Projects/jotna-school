/**
 * LES SOURATES DU PARCOURS — texte coranique, et ce qu'il exige.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │  À RELIRE PAR UN ENSEIGNANT AVANT MISE EN LIGNE.                      │
 * │                                                                       │
 * │  Ce fichier porte du texte coranique. Une voyelle déplacée n'est pas  │
 * │  une coquille : c'est un mot faux enseigné à un enfant, et rendu à    │
 * │  une école qui nous fait confiance. Le texte ci-dessous a été SAISI   │
 * │  À LA MAIN — il n'a PAS été copié depuis une édition faisant          │
 * │  autorité, et ce dépôt ne contient aucune source de vérité à laquelle │
 * │  le comparer automatiquement.                                         │
 * │                                                                       │
 * │  Avant la première mise en service dans une école, faire relire       │
 * │  `SURAHS` par un maître d'arabe ou un imam, sourate par sourate, et   │
 * │  noter la relecture dans `docs/`. `convex/__tests__/arabic.test.ts`   │
 * │  vérifie le NOMBRE de versets de chaque sourate — un verset perdu se  │
 * │  voit, une voyelle fausse, non.                                       │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * LA RIWĀYA EST CELLE DE ḤAFṢ (`RIWAYA` ci-dessous), la plus répandue dans le
 * monde et celle des mushafs imprimés au Caire et à Médine. LE SÉNÉGAL LIT
 * MAJORITAIREMENT EN WARSH — l'orthographe et certaines voyelles y diffèrent.
 * Une école qui enseigne Warsh ne doit pas servir ces textes tels quels : le
 * champ `riwaya` existe pour que la différence soit VISIBLE plutôt que subie,
 * et pour qu'une seconde table Warsh puisse être ajoutée à côté, sans toucher
 * au reste du module. C'est une décision à porter par l'école, pas par le code.
 *
 * L'ORDRE DU PARCOURS N'EST PAS L'ORDRE DU MUSHAF. On lit d'abord les
 * sourates les plus courtes — quatre à six versets de trois ou quatre mots —
 * et Al-Fātiḥa ferme le niveau, ses versets étant les plus longs. C'est un
 * ordre de LECTURE, pour un enfant qui déchiffre ; il ne dit rien du rang des
 * sourates, et un enseignant peut vouloir l'inverse : `order` est là pour ça.
 *
 * PAS DE TRADUCTION VERSET PAR VERSET. Traduire le Coran est un acte
 * d'exégèse, qui engage une école et une famille bien au-delà d'un module de
 * lecture. On donne le nom de la sourate et son sens en français — ce qu'un
 * enfant a besoin de savoir pour situer ce qu'il lit — et rien de plus.
 */

/** La lecture (riwāya) dans laquelle ces textes sont écrits. */
export const RIWAYA = "hafs" as const;

export interface Ayah {
  /** Le rang du verset dans la sourate, à partir de 1. */
  number: number;
  /** Le texte vocalisé. */
  ar: string;
}

export interface Surah {
  /** Clé stable — sert d'identifiant de leçon et de clé de cache audio. */
  key: string;
  /** Le rang dans le mushaf (1 = Al-Fātiḥa, 114 = An-Nās). */
  number: number;
  nameAr: string;
  nameFr: string;
  /** Le sens du nom, en français. */
  meaningFr: string;
  riwaya: typeof RIWAYA;
  ayahs: readonly Ayah[];
}

/**
 * LA BASMALA — en tête de chaque sourate sauf At-Tawba.
 *
 * Elle est ici à part parce qu'elle EST le premier verset d'Al-Fātiḥa (on la
 * retrouve donc dans ses sept versets) alors qu'elle précède les autres
 * sourates sans en être un verset. La donner séparément évite d'avoir à
 * trancher ce point dans chaque sourate, et permet à l'écran de l'afficher
 * en ouverture — c'est la première phrase qu'un enfant apprend à lire.
 */
export const BASMALA = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";

export const SURAHS: readonly Surah[] = [
  {
    key: "al-ikhlas",
    number: 112,
    nameAr: "الإِخْلَاص",
    nameFr: "Al-Ikhlâs",
    meaningFr: "Le culte pur",
    riwaya: RIWAYA,
    ayahs: [
      { number: 1, ar: "قُلْ هُوَ اللَّهُ أَحَدٌ" },
      { number: 2, ar: "اللَّهُ الصَّمَدُ" },
      { number: 3, ar: "لَمْ يَلِدْ وَلَمْ يُولَدْ" },
      { number: 4, ar: "وَلَمْ يَكُنْ لَهُ كُفُوًا أَحَدٌ" },
    ],
  },
  {
    key: "al-kawthar",
    number: 108,
    nameAr: "الكَوْثَر",
    nameFr: "Al-Kawthar",
    meaningFr: "L'abondance",
    riwaya: RIWAYA,
    ayahs: [
      { number: 1, ar: "إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ" },
      { number: 2, ar: "فَصَلِّ لِرَبِّكَ وَانْحَرْ" },
      { number: 3, ar: "إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ" },
    ],
  },
  {
    key: "al-asr",
    number: 103,
    nameAr: "العَصْر",
    nameFr: "Al-'Asr",
    meaningFr: "Le temps",
    riwaya: RIWAYA,
    ayahs: [
      { number: 1, ar: "وَالْعَصْرِ" },
      { number: 2, ar: "إِنَّ الْإِنْسَانَ لَفِي خُسْرٍ" },
      {
        number: 3,
        ar: "إِلَّا الَّذِينَ آمَنُوا وَعَمِلُوا الصَّالِحَاتِ وَتَوَاصَوْا بِالْحَقِّ وَتَوَاصَوْا بِالصَّبْرِ",
      },
    ],
  },
  {
    key: "al-falaq",
    number: 113,
    nameAr: "الفَلَق",
    nameFr: "Al-Falaq",
    meaningFr: "L'aube naissante",
    riwaya: RIWAYA,
    ayahs: [
      { number: 1, ar: "قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ" },
      { number: 2, ar: "مِنْ شَرِّ مَا خَلَقَ" },
      { number: 3, ar: "وَمِنْ شَرِّ غَاسِقٍ إِذَا وَقَبَ" },
      { number: 4, ar: "وَمِنْ شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ" },
      { number: 5, ar: "وَمِنْ شَرِّ حَاسِدٍ إِذَا حَسَدَ" },
    ],
  },
  {
    key: "an-nas",
    number: 114,
    nameAr: "النَّاس",
    nameFr: "An-Nâs",
    meaningFr: "Les hommes",
    riwaya: RIWAYA,
    ayahs: [
      { number: 1, ar: "قُلْ أَعُوذُ بِرَبِّ النَّاسِ" },
      { number: 2, ar: "مَلِكِ النَّاسِ" },
      { number: 3, ar: "إِلَٰهِ النَّاسِ" },
      { number: 4, ar: "مِنْ شَرِّ الْوَسْوَاسِ الْخَنَّاسِ" },
      { number: 5, ar: "الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ" },
      { number: 6, ar: "مِنَ الْجِنَّةِ وَالنَّاسِ" },
    ],
  },
  {
    key: "al-fatiha",
    number: 1,
    nameAr: "الفَاتِحَة",
    nameFr: "Al-Fâtiha",
    meaningFr: "L'ouverture",
    riwaya: RIWAYA,
    ayahs: [
      { number: 1, ar: BASMALA },
      { number: 2, ar: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ" },
      { number: 3, ar: "الرَّحْمَٰنِ الرَّحِيمِ" },
      { number: 4, ar: "مَالِكِ يَوْمِ الدِّينِ" },
      { number: 5, ar: "إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ" },
      { number: 6, ar: "اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ" },
      {
        number: 7,
        ar: "صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",
      },
    ],
  },
];

/**
 * LE NOMBRE DE VERSETS ATTENDU, sourate par sourate.
 *
 * Recopié d'un mushaf et non calculé depuis `SURAHS` — sinon le test qui les
 * compare vérifierait qu'un tableau est égal à lui-même. C'est le seul
 * invariant du texte qu'un test PEUT tenir : il attrape un verset oublié au
 * copier-coller, jamais une voyelle fausse. La relecture humaine reste due.
 */
export const EXPECTED_AYAH_COUNT: Readonly<Record<string, number>> = {
  "al-fatiha": 7,
  "al-asr": 3,
  "al-kawthar": 3,
  "al-ikhlas": 4,
  "al-falaq": 5,
  "an-nas": 6,
};

const BY_KEY: ReadonlyMap<string, Surah> = new Map(
  SURAHS.map((surah) => [surah.key, surah]),
);

/** La sourate, ou `null` si la clé ne désigne rien — une clé vient du client. */
export function getSurah(key: string): Surah | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * Les mots d'un verset, dans l'ordre de lecture.
 *
 * Découpés sur les espaces à la lecture plutôt que stockés : un verset a une
 * seule écriture, et deux copies d'un texte coranique dans le même fichier
 * sont deux copies à relire — donc une de trop.
 */
export function ayahWords(ayah: Ayah): string[] {
  return ayah.ar.split(/\s+/).filter((word) => word.length > 0);
}
