/**
 * L'ICÔNE D'UNE MATIÈRE — et le défaut qu'elle corrige.
 *
 * `subjects.icon` est une CHAÎNE LIBRE au schéma (`convex/schema.ts`), et ce
 * qu'elle contient n'est pas un emoji : `convex/testSeeds.ts` y écrit
 * « Calculator ». Le web le sait et traduit (`app/(student)/student/home/page.tsx`
 * porte la table ci-dessous). L'accueil mobile de la phase 2, lui, affichait
 * `subject.icon ?? "📘"` — donc le mot « Calculator » en corps 32 sur la carte
 * d'un enfant de huit ans. Personne ne l'aurait vu avant un appareil.
 *
 * LA TABLE EST CELLE DU WEB, VOLONTAIREMENT. Deux tables qui dérivent
 * donneraient deux applications où la même matière n'a pas le même visage —
 * et l'enfant qui passe de la tablette de l'école au téléphone de la maison
 * ne retrouverait pas ses repères.
 *
 * LE TROISIÈME CAS N'EST PAS DANS LE WEB, et il est délibéré : si quelqu'un
 * saisit un jour un vrai emoji dans l'administration, on l'affiche tel quel
 * plutôt que de le hacher en deux lettres majuscules. Le web le hacherait ;
 * c'est un défaut mineur dont il n'y a aucune raison d'hériter.
 */
const EMOJI_BY_NAME: Record<string, string> = {
  Calculator: "🧮",
  Book: "📖",
  Flask: "🔬",
  Globe: "🌍",
  Music: "🎵",
  Palette: "🎨",
  Code: "💻",
  Hash: "#️⃣",
};

export function subjectIcon(icon: string | undefined | null): string {
  if (icon == null || icon.trim() === "") return "📘";
  const known = EMOJI_BY_NAME[icon];
  if (known !== undefined) return known;

  // `Array.from` compte les POINTS DE CODE, pas les unités UTF-16 : un emoji
  // hors du plan de base en occupe deux, et `icon.length <= 2` le prendrait
  // pour un sigle de deux lettres.
  const points = Array.from(icon);
  if (points.length <= 2 && !/^[a-z0-9]+$/i.test(icon)) return icon;

  return icon.slice(0, 2).toUpperCase();
}
