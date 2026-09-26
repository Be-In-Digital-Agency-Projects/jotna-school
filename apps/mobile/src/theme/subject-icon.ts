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
 * LA TABLE A ÉTÉ SORTIE D'ICI. Elle vivait en deux exemplaires, un par
 * application, et le commentaire d'origine disait déjà pourquoi c'était
 * risqué. Les deux ont fini par oublier `Users` — l'EMC affichait « US »
 * sur l'accueil d'un enfant. Il n'y en a plus qu'une : `lib/subject-icons.ts`,
 * liée par un test à la liste des matières réellement semées.
 *
 * LE REPLI SUR UN VRAI EMOJI est conservé, et le web en hérite maintenant
 * qu'il partage la même fonction.
 */
export { subjectEmoji as subjectIcon } from "@lib/subject-icons";
