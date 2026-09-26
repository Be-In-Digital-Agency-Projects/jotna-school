/**
 * L'EMOJI D'UNE MATIÈRE — UNE SEULE TABLE, POUR LE WEB ET LE MOBILE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI ELLE EST ICI PLUTÔT QU'EN DEUX EXEMPLAIRES.
 *
 * `subjects.icon` est une CHAÎNE LIBRE au schéma, et ce qu'elle contient n'est
 * pas un emoji mais un nom d'icône Lucide : « Calculator », « Globe »,
 * « Users ». Web et mobile traduisaient chacun de leur côté, avec deux copies
 * de la même table — et `apps/mobile/src/theme/subject-icon.ts` disait déjà
 * pourquoi c'était risqué : « deux tables qui dérivent donneraient deux
 * applications où la même matière n'a pas le même visage ».
 *
 * ELLES N'ONT PAS DÉRIVÉ L'UNE DE L'AUTRE — ELLES ONT DÉRIVÉ DES DONNÉES.
 * Les deux oubliaient `Users`, que `subjects.seedDefaults` écrit pour l'EMC.
 * Sur le web, la matière tombait sur une icône générique ; sur mobile, elle
 * affichait **« US »** en deux lettres majuscules dans une pastille colorée,
 * sur l'écran d'accueil d'un enfant de huit ans. Exactement le défaut que
 * cette traduction existe pour empêcher, sur la matière que personne n'avait
 * regardée.
 *
 * Trouvé en RENDANT l'application, pas en la lisant. Le garde qui l'empêche
 * de revenir est `lib/__tests__/subjectIcons.test.ts` : il lie cette table à
 * la liste réellement semée, et échoue si l'une bouge sans l'autre.
 */
export const SUBJECT_EMOJI: Record<string, string> = {
  Calculator: "🧮",
  Book: "📖",
  BookOpen: "📚",
  Flask: "🔬",
  Globe: "🌍",
  Users: "👥",
  Music: "🎵",
  Palette: "🎨",

  Code: "💻",
  Hash: "#️⃣",
};

/** Ce qu'on affiche quand le nom d'icône n'évoque rien. */
export const SUBJECT_EMOJI_FALLBACK = "📘";

/**
 * L'emoji d'une matière, avec les deux replis qui comptent.
 *
 * SI QUELQU'UN SAISIT UN VRAI EMOJI dans l'administration, on l'affiche tel
 * quel. `Array.from` compte les POINTS DE CODE et non les unités UTF-16 : un
 * emoji hors du plan de base en occupe deux, et une comparaison sur `.length`
 * le prendrait pour un sigle de deux lettres.
 *
 * SINON, deux lettres majuscules — visible, laid, et voulu : c'est le signal
 * qu'une icône manque à la table ci-dessus.
 */
export function subjectEmoji(icon: string | undefined | null): string {
  if (icon == null || icon.trim() === "") return SUBJECT_EMOJI_FALLBACK;
  const known = SUBJECT_EMOJI[icon];
  if (known !== undefined) return known;

  const points = Array.from(icon);
  if (points.length <= 2 && !/^[a-z0-9]+$/i.test(icon)) return icon;

  return icon.slice(0, 2).toUpperCase();
}
