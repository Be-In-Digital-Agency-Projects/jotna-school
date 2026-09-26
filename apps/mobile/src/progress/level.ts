/**
 * MIROIR DE `convex/students.ts` — `EXOS_PER_LEVEL`.
 *
 * ON NE L'IMPORTE PAS, ET CE N'EST PAS UN CAPRICE. `convex/students.ts` tire
 * `@convex-dev/auth/server` et tout le graphe serveur : Metro les embarquerait
 * dans le paquet de l'appareil pour une seule constante — quand il n'échoue
 * pas d'abord sur un module qui n'existe pas côté client.
 *
 * Le web fait la même copie, pour la même raison
 * (`app/(student)/student/profil/page.tsx`, `EXOS_PER_LEVEL_UI`). Si le
 * serveur change ce nombre, CES TROIS ENDROITS changent ensemble. C'est le
 * prix du découplage, et il est écrit ici pour que personne ne le découvre par
 * une barre de progression qui ment.
 *
 * Le SEUL usage légitime de cette constante est de retrouver la part du niveau
 * déjà parcourue : le serveur donne `exosToNextLevel`, pas le pourcentage.
 */
export const EXOS_PER_LEVEL = 50;

/** La part du niveau en cours déjà parcourue, en pourcentage borné. */
export function levelPercent(exosToNextLevel: number): number {
  const done = EXOS_PER_LEVEL - exosToNextLevel;
  return Math.max(0, Math.min(100, (done / EXOS_PER_LEVEL) * 100));
}
