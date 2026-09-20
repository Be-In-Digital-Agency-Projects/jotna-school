/**
 * L'ALPHABET ARABE — la donnée de référence du module « Arabe & Coran ».
 *
 * DU CODE, PAS DES LIGNES EN BASE. Les vingt-huit lettres ne changent pas :
 * les poser en base demanderait un ensemencement à rejouer sur chaque
 * déploiement, une migration à chaque correction de translittération, et
 * ouvrirait la porte à deux déploiements qui n'enseignent pas le même
 * alphabet. Ici, la donnée est versionnée avec le code qui la lit, et une
 * faute de frappe se voit en revue.
 *
 * LU DES DEUX CÔTÉS. Le serveur en a besoin pour fabriquer l'audio et juger
 * une prononciation ; l'écran en a besoin pour dessiner la lettre. Le fichier
 * est donc PUR — aucune importation de `_generated`, aucun accès à `ctx` —
 * exactement comme `convex/pricing.ts` et `convex/accessRules.ts`, que les
 * écrans importent déjà par `@/convex/...`.
 *
 * CE QU'UNE LETTRE PORTE, ET POURQUOI :
 *
 *   - les QUATRE formes (isolée, initiale, médiane, finale). L'arabe s'écrit
 *     attaché : un enfant qui ne connaît que la forme isolée ne sait pas lire
 *     un mot. C'est la matière même des exercices « reconnais la lettre dans
 *     le mot » ;
 *   - `connectsToNext`. Six lettres (ا د ذ ر ز و) n'attachent JAMAIS ce qui
 *     les suit. C'est la première règle d'écriture à enseigner, et elle
 *     explique pourquoi leurs formes initiale et médiane sont identiques aux
 *     formes isolée et finale ;
 *   - les POINTS, comptés et positionnés. Neuf paires ou triplets de lettres
 *     ne diffèrent QUE par eux (ب ت ث, ج ح خ, د ذ, ر ز, س ش, ص ض, ط ظ, ع غ,
 *     ف ق). Un enfant qui confond ب et ت ne confond pas deux dessins : il n'a
 *     pas encore regardé les points. Les exercices s'appuient dessus ;
 *   - `confusables`, justement — les lettres avec lesquelles celle-ci se
 *     confond. Elles servent de LEURRES dans les QCM : proposer ب, م, ع, ي
 *     quand on demande ت, c'est une question qu'on réussit sans savoir lire.
 *     Les vrais leurres sont ب, ث, ن ;
 *   - `spokenName` et `syllables`, les textes ENVOYÉS À LA SYNTHÈSE VOCALE.
 *     Le nom de la lettre s'entend une fois ; ce sont les syllabes (بَ بِ بُ)
 *     qui apprennent à LIRE, parce qu'une lettre seule ne se prononce pas en
 *     arabe — elle se prononce avec sa voyelle.
 *
 * LES TRANSLITTÉRATIONS VISENT UN ENFANT FRANCOPHONE du Sénégal : « dj » et
 * non « j », « ch » et non « sh », et l'on cite le wolof pour le « r » roulé,
 * que l'élève sait déjà faire. Ce sont des APPROXIMATIONS assumées : aucune
 * lettre arabe n'a d'équivalent français exact, et c'est la voix — pas le
 * texte — qui enseigne le son.
 */

/** L'identifiant stable d'une lettre. Sert de clé de progression et de cache. */
export type ArabicLetterKey =
  | "alif" | "ba" | "ta" | "tha" | "jim" | "ha" | "kha"
  | "dal" | "dhal" | "ra" | "zay" | "sin" | "shin"
  | "sad" | "dad" | "taEmph" | "zaEmph" | "ayn" | "ghayn"
  | "fa" | "qaf" | "kaf" | "lam" | "mim" | "nun"
  | "haSoft" | "waw" | "ya";

/**
 * Le point d'articulation, simplifié pour un enfant.
 *
 * La phonétique arabe classique (`makharij`) en compte dix-sept ; quatre
 * familles suffisent à faire sentir d'où vient un son, et c'est tout ce qu'on
 * demande à un débutant. `emphatic` est à part parce qu'il se CROISE avec les
 * familles : ص est une lettre de langue ET emphatique.
 */
export type Articulation = "gorge" | "langue" | "dents" | "levres";

export interface ArabicLetter {
  key: ArabicLetterKey;
  /** 1..28, l'ordre alphabétique (hijā'ī) tel qu'on l'enseigne. */
  order: number;
  /** Forme isolée — la lettre seule. */
  isolated: string;
  /** Forme initiale — début de mot, attachée à la suivante. */
  initial: string;
  /** Forme médiane — attachée des deux côtés. */
  medial: string;
  /** Forme finale — attachée à la précédente seulement. */
  final: string;
  /**
   * Faux pour ا د ذ ر ز و : ces six lettres n'attachent jamais la suivante,
   * donc leurs formes initiale et médiane sont celles d'une lettre non liée.
   */
  connectsToNext: boolean;
  /** Le nom de la lettre, en arabe vocalisé — c'est lui qu'on fait entendre. */
  nameAr: string;
  /** Le même nom, écrit pour un lecteur francophone. */
  nameFr: string;
  /** Le son, en une ou deux lettres françaises. Approximation assumée. */
  soundFr: string;
  /** Comment le produire, dit à un enfant. */
  hintFr: string;
  articulation: Articulation;
  /** Les emphatiques (ص ض ط ظ ق) : bouche pleine, son épais. */
  emphatic: boolean;
  dots: { count: 0 | 1 | 2 | 3; position: "none" | "above" | "below" };
  /** Les lettres qui se confondent avec celle-ci — leurres des QCM. */
  confusables: ArabicLetterKey[];
  /** Les trois syllabes de base : fatha, kasra, damma. */
  syllables: { fatha: string; kasra: string; damma: string };
}

/** Les trois voyelles brèves, dans l'ordre où on les enseigne. */
export const HARAKAT = [
  { key: "fatha", mark: "َ", nameAr: "فَتْحَة", nameFr: "fatha", soundFr: "a", exampleFr: "« a » de papa" },
  { key: "kasra", mark: "ِ", nameAr: "كَسْرَة", nameFr: "kasra", soundFr: "i", exampleFr: "« i » de midi" },
  { key: "damma", mark: "ُ", nameAr: "ضَمَّة", nameFr: "damma", soundFr: "ou", exampleFr: "« ou » de loup" },
] as const;

export type HarakaKey = (typeof HARAKAT)[number]["key"];

const FATHA = "َ";
const KASRA = "ِ";
const DAMMA = "ُ";

/** Syllabes régulières : la lettre, puis la voyelle. */
function syl(letter: string) {
  return {
    fatha: letter + FATHA,
    kasra: letter + KASRA,
    damma: letter + DAMMA,
  };
}

/**
 * LES VINGT-HUIT LETTRES, dans l'ordre alphabétique.
 *
 * L'ordre du tableau EST l'ordre d'enseignement : `curriculum.ts` y découpe
 * ses leçons par tranches. Le réordonner change donc le parcours de tous les
 * élèves — ce n'est pas une liste qu'on trie pour faire joli.
 */
export const ARABIC_LETTERS: readonly ArabicLetter[] = [
  {
    key: "alif", order: 1,
    isolated: "ا", initial: "ا", medial: "ـا", final: "ـا", connectsToNext: false,
    nameAr: "أَلِف", nameFr: "alif", soundFr: "a",
    hintFr: "Un simple trait debout. Seule, elle porte la voyelle : أَ fait « a ».",
    articulation: "gorge", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["lam"],
    // Une alif nue ne se vocalise pas : c'est la hamza qu'elle porte qui se
    // prononce. On enseigne donc أَ إِ أُ, ce que l'enfant verra dans un mot.
    syllables: { fatha: "أَ", kasra: "إِ", damma: "أُ" },
  },
  {
    key: "ba", order: 2,
    isolated: "ب", initial: "بـ", medial: "ـبـ", final: "ـب", connectsToNext: true,
    nameAr: "بَاء", nameFr: "bâ", soundFr: "b",
    hintFr: "Comme le « b » de bateau. Une barque avec un point dessous.",
    articulation: "levres", emphatic: false,
    dots: { count: 1, position: "below" },
    confusables: ["ta", "tha", "nun", "ya"],
    syllables: syl("ب"),
  },
  {
    key: "ta", order: 3,
    isolated: "ت", initial: "تـ", medial: "ـتـ", final: "ـت", connectsToNext: true,
    nameAr: "تَاء", nameFr: "tâ", soundFr: "t",
    hintFr: "Comme le « t » de tapis. La même barque, avec deux points dessus.",
    articulation: "dents", emphatic: false,
    dots: { count: 2, position: "above" },
    confusables: ["ba", "tha", "nun"],
    syllables: syl("ت"),
  },
  {
    key: "tha", order: 4,
    isolated: "ث", initial: "ثـ", medial: "ـثـ", final: "ـث", connectsToNext: true,
    nameAr: "ثَاء", nameFr: "thâ", soundFr: "th",
    hintFr: "La langue entre les dents, comme le « th » anglais de think. Trois points dessus.",
    articulation: "dents", emphatic: false,
    dots: { count: 3, position: "above" },
    confusables: ["ba", "ta", "nun"],
    syllables: syl("ث"),
  },
  {
    key: "jim", order: 5,
    isolated: "ج", initial: "جـ", medial: "ـجـ", final: "ـج", connectsToNext: true,
    nameAr: "جِيم", nameFr: "djîm", soundFr: "dj",
    hintFr: "Comme le « dj » de djembé. Un ventre avec un point dedans.",
    articulation: "langue", emphatic: false,
    dots: { count: 1, position: "below" },
    confusables: ["ha", "kha"],
    syllables: syl("ج"),
  },
  {
    key: "ha", order: 6,
    isolated: "ح", initial: "حـ", medial: "ـحـ", final: "ـح", connectsToNext: true,
    nameAr: "حَاء", nameFr: "ḥâ", soundFr: "h (soufflé)",
    hintFr: "Un souffle chaud du fond de la gorge, comme pour embuer une vitre. Sans point.",
    articulation: "gorge", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["jim", "kha"],
    syllables: syl("ح"),
  },
  {
    key: "kha", order: 7,
    isolated: "خ", initial: "خـ", medial: "ـخـ", final: "ـخ", connectsToNext: true,
    nameAr: "خَاء", nameFr: "khâ", soundFr: "kh",
    hintFr: "On racle doucement le fond de la gorge, comme la jota espagnole. Un point dessus.",
    articulation: "gorge", emphatic: false,
    dots: { count: 1, position: "above" },
    confusables: ["jim", "ha"],
    syllables: syl("خ"),
  },
  {
    key: "dal", order: 8,
    isolated: "د", initial: "د", medial: "ـد", final: "ـد", connectsToNext: false,
    nameAr: "دَال", nameFr: "dâl", soundFr: "d",
    hintFr: "Comme le « d » de datte. Elle n'attache jamais la lettre suivante.",
    articulation: "dents", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["dhal", "ra"],
    syllables: syl("د"),
  },
  {
    key: "dhal", order: 9,
    isolated: "ذ", initial: "ذ", medial: "ـذ", final: "ـذ", connectsToNext: false,
    nameAr: "ذَال", nameFr: "dhâl", soundFr: "dh",
    hintFr: "La langue entre les dents, comme le « th » anglais de this. Un point dessus.",
    articulation: "dents", emphatic: false,
    dots: { count: 1, position: "above" },
    confusables: ["dal", "zay"],
    syllables: syl("ذ"),
  },
  {
    key: "ra", order: 10,
    isolated: "ر", initial: "ر", medial: "ـر", final: "ـر", connectsToNext: false,
    nameAr: "رَاء", nameFr: "râ", soundFr: "r (roulé)",
    hintFr: "Un « r » roulé du bout de la langue, comme en wolof. Elle descend sous la ligne.",
    articulation: "langue", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["zay", "dal", "waw"],
    syllables: syl("ر"),
  },
  {
    key: "zay", order: 11,
    isolated: "ز", initial: "ز", medial: "ـز", final: "ـز", connectsToNext: false,
    nameAr: "زَاي", nameFr: "zây", soundFr: "z",
    hintFr: "Comme le « z » de zèbre. C'est le râ avec un point dessus.",
    articulation: "dents", emphatic: false,
    dots: { count: 1, position: "above" },
    confusables: ["ra", "dhal"],
    syllables: syl("ز"),
  },
  {
    key: "sin", order: 12,
    isolated: "س", initial: "سـ", medial: "ـسـ", final: "ـس", connectsToNext: true,
    nameAr: "سِين", nameFr: "sîn", soundFr: "s",
    hintFr: "Comme le « s » de soleil. Trois petites dents, sans point.",
    articulation: "dents", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["shin", "sad"],
    syllables: syl("س"),
  },
  {
    key: "shin", order: 13,
    isolated: "ش", initial: "شـ", medial: "ـشـ", final: "ـش", connectsToNext: true,
    nameAr: "شِين", nameFr: "chîn", soundFr: "ch",
    hintFr: "Comme le « ch » de chat. Les mêmes dents, coiffées de trois points.",
    articulation: "dents", emphatic: false,
    dots: { count: 3, position: "above" },
    confusables: ["sin", "dad"],
    syllables: syl("ش"),
  },
  {
    key: "sad", order: 14,
    isolated: "ص", initial: "صـ", medial: "ـصـ", final: "ـص", connectsToNext: true,
    nameAr: "صَاد", nameFr: "ṣâd", soundFr: "s (épais)",
    hintFr: "Un « s » lourd : la bouche s'arrondit, le son devient épais.",
    articulation: "dents", emphatic: true,
    dots: { count: 0, position: "none" },
    confusables: ["dad", "sin"],
    syllables: syl("ص"),
  },
  {
    key: "dad", order: 15,
    isolated: "ض", initial: "ضـ", medial: "ـضـ", final: "ـض", connectsToNext: true,
    nameAr: "ضَاد", nameFr: "ḍâd", soundFr: "d (épais)",
    hintFr: "Un « d » épais, sur le côté de la langue. L'arabe s'appelle « la langue du dâd ».",
    articulation: "langue", emphatic: true,
    dots: { count: 1, position: "above" },
    confusables: ["sad", "zaEmph"],
    syllables: syl("ض"),
  },
  {
    key: "taEmph", order: 16,
    isolated: "ط", initial: "طـ", medial: "ـطـ", final: "ـط", connectsToNext: true,
    nameAr: "طَاء", nameFr: "ṭâ", soundFr: "t (épais)",
    hintFr: "Un « t » lourd et profond, très différent du tâ léger (ت).",
    articulation: "dents", emphatic: true,
    dots: { count: 0, position: "none" },
    confusables: ["zaEmph", "ta"],
    syllables: syl("ط"),
  },
  {
    key: "zaEmph", order: 17,
    isolated: "ظ", initial: "ظـ", medial: "ـظـ", final: "ـظ", connectsToNext: true,
    nameAr: "ظَاء", nameFr: "ẓâ", soundFr: "dh (épais)",
    hintFr: "Le son du ذ, mais épais et profond. C'est le ط avec un point dessus.",
    articulation: "dents", emphatic: true,
    dots: { count: 1, position: "above" },
    confusables: ["taEmph", "dad"],
    syllables: syl("ظ"),
  },
  {
    key: "ayn", order: 18,
    isolated: "ع", initial: "عـ", medial: "ـعـ", final: "ـع", connectsToNext: true,
    nameAr: "عَيْن", nameFr: "ʿayn", soundFr: "3 (son de gorge)",
    hintFr: "Le milieu de la gorge se serre doucement. Aucun son français ne lui ressemble : écoute bien.",
    articulation: "gorge", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["ghayn", "fa"],
    syllables: syl("ع"),
  },
  {
    key: "ghayn", order: 19,
    isolated: "غ", initial: "غـ", medial: "ـغـ", final: "ـغ", connectsToNext: true,
    nameAr: "غَيْن", nameFr: "ghayn", soundFr: "gh",
    hintFr: "Comme le « r » grasseyé de Paris. C'est le ع avec un point dessus.",
    articulation: "gorge", emphatic: false,
    dots: { count: 1, position: "above" },
    confusables: ["ayn", "qaf"],
    syllables: syl("غ"),
  },
  {
    key: "fa", order: 20,
    isolated: "ف", initial: "فـ", medial: "ـفـ", final: "ـف", connectsToNext: true,
    nameAr: "فَاء", nameFr: "fâ", soundFr: "f",
    hintFr: "Comme le « f » de fleur. Une tête ronde et un point dessus.",
    articulation: "levres", emphatic: false,
    dots: { count: 1, position: "above" },
    confusables: ["qaf"],
    syllables: syl("ف"),
  },
  {
    key: "qaf", order: 21,
    isolated: "ق", initial: "قـ", medial: "ـقـ", final: "ـق", connectsToNext: true,
    nameAr: "قَاف", nameFr: "qâf", soundFr: "q (profond)",
    hintFr: "Un « k » très en arrière, tout au fond de la bouche. Deux points dessus.",
    articulation: "gorge", emphatic: true,
    dots: { count: 2, position: "above" },
    confusables: ["fa", "kaf"],
    syllables: syl("ق"),
  },
  {
    key: "kaf", order: 22,
    isolated: "ك", initial: "كـ", medial: "ـكـ", final: "ـك", connectsToNext: true,
    nameAr: "كَاف", nameFr: "kâf", soundFr: "k",
    hintFr: "Comme le « k » de kilo, à l'avant de la bouche — pas au fond comme ق.",
    articulation: "langue", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["qaf", "lam"],
    syllables: syl("ك"),
  },
  {
    key: "lam", order: 23,
    isolated: "ل", initial: "لـ", medial: "ـلـ", final: "ـل", connectsToNext: true,
    nameAr: "لَام", nameFr: "lâm", soundFr: "l",
    hintFr: "Comme le « l » de lune. Un grand trait qui plonge à la fin.",
    articulation: "langue", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["alif", "kaf"],
    syllables: syl("ل"),
  },
  {
    key: "mim", order: 24,
    isolated: "م", initial: "مـ", medial: "ـمـ", final: "ـم", connectsToNext: true,
    nameAr: "مِيم", nameFr: "mîm", soundFr: "m",
    hintFr: "Comme le « m » de maman. Une petite boucle avec une queue.",
    articulation: "levres", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["waw", "fa"],
    syllables: syl("م"),
  },
  {
    key: "nun", order: 25,
    isolated: "ن", initial: "نـ", medial: "ـنـ", final: "ـن", connectsToNext: true,
    nameAr: "نُون", nameFr: "noûn", soundFr: "n",
    hintFr: "Comme le « n » de nuage. Un bol profond avec un point dessus.",
    articulation: "langue", emphatic: false,
    dots: { count: 1, position: "above" },
    confusables: ["ba", "ta", "ya"],
    syllables: syl("ن"),
  },
  {
    key: "haSoft", order: 26,
    isolated: "ه", initial: "هـ", medial: "ـهـ", final: "ـه", connectsToNext: true,
    nameAr: "هَاء", nameFr: "hâ", soundFr: "h (léger)",
    hintFr: "Un souffle léger, comme le « h » de hello en anglais. Elle change beaucoup de forme.",
    articulation: "gorge", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["ha", "mim"],
    syllables: syl("ه"),
  },
  {
    key: "waw", order: 27,
    isolated: "و", initial: "و", medial: "ـو", final: "ـو", connectsToNext: false,
    nameAr: "وَاو", nameFr: "wâw", soundFr: "w / ou",
    hintFr: "Comme le « w » de wagon ; allongée, elle fait « ou ». Elle n'attache pas la suivante.",
    articulation: "levres", emphatic: false,
    dots: { count: 0, position: "none" },
    confusables: ["ra", "mim"],
    syllables: syl("و"),
  },
  {
    key: "ya", order: 28,
    isolated: "ي", initial: "يـ", medial: "ـيـ", final: "ـي", connectsToNext: true,
    nameAr: "يَاء", nameFr: "yâ", soundFr: "y / î",
    hintFr: "Comme le « y » de yaourt ; allongée, elle fait « î ». Deux points dessous.",
    articulation: "langue", emphatic: false,
    dots: { count: 2, position: "below" },
    confusables: ["ba", "ta", "nun"],
    syllables: syl("ي"),
  },
];

/** Index par clé — les lectures ponctuelles ne balaient pas le tableau. */
const BY_KEY: ReadonlyMap<ArabicLetterKey, ArabicLetter> = new Map(
  ARABIC_LETTERS.map((letter) => [letter.key, letter]),
);

/** La lettre, ou `null` si la clé ne désigne rien — une clé vient du client. */
export function getLetter(key: string): ArabicLetter | null {
  return BY_KEY.get(key as ArabicLetterKey) ?? null;
}

/** Vrai si la chaîne est bien une clé de lettre. Garde d'entrée des mutations. */
export function isLetterKey(key: string): key is ArabicLetterKey {
  return BY_KEY.has(key as ArabicLetterKey);
}

/**
 * Les leurres d'un QCM : d'abord les lettres qui se confondent avec la bonne,
 * complétées si besoin par d'autres lettres du même point d'articulation.
 *
 * `pool` borne le tirage aux lettres DÉJÀ VUES par l'élève : proposer un ظ à
 * qui n'a appris que les quatre premières lettres ne teste rien, ça décourage.
 * Quand la réserve est trop petite — au tout début du parcours — on complète
 * avec ce qu'il y a, faute de mieux : un QCM à deux choix reste un QCM.
 *
 * DÉTERMINISTE À DESSEIN, et c'est `seed` qui le permet : la même question
 * posée deux fois propose les mêmes leurres dans le même ordre, donc un
 * rechargement d'écran ne rebat pas les cartes au milieu d'un exercice. Le
 * mélange lui-même est un Fisher-Yates ordinaire, tiré d'un générateur
 * congruentiel semé par `seed` — pas de cryptographie ici, seulement de la
 * reproductibilité.
 */
export function pickDistractors(
  correct: ArabicLetterKey,
  pool: readonly ArabicLetterKey[],
  count: number,
  seed: number,
): ArabicLetterKey[] {
  const letter = BY_KEY.get(correct);
  if (!letter) return [];

  const allowed = new Set(pool);
  allowed.delete(correct);

  const preferred = letter.confusables.filter((k) => allowed.has(k));
  const sameFamily = ARABIC_LETTERS.filter(
    (l) =>
      allowed.has(l.key) &&
      !preferred.includes(l.key) &&
      l.articulation === letter.articulation,
  ).map((l) => l.key);
  const rest = ARABIC_LETTERS.filter(
    (l) =>
      allowed.has(l.key) &&
      !preferred.includes(l.key) &&
      !sameFamily.includes(l.key),
  ).map((l) => l.key);

  const ordered = [
    ...shuffle(preferred, seed),
    ...shuffle(sameFamily, seed + 1),
    ...shuffle(rest, seed + 2),
  ];
  return ordered.slice(0, count);
}

/** Mélange reproductible — même graine, même ordre. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = (seed >>> 0) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    // Générateur congruentiel linéaire (constantes de Numerical Recipes).
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
