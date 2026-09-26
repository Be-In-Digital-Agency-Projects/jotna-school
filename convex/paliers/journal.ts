/**
 * LE BORNAGE D'HORLOGE DU JOURNAL HORS-LIGNE — décision D17, module PUR.
 *
 * POURQUOI CE N'EST PAS UN DÉTAIL. `submittedAt` décide de la SÉRIE de
 * l'enfant (`convex/streak.ts`, `dailyStreakRollover`), et il vient d'un
 * appareil que personne ne surveille. Deux façons de se tromper, symétriques :
 *
 *   - TOUT CROIRE : une horloge avancée d'un mois fabrique des séries qui
 *     n'ont pas été jouées, et la progression affichée aux parents ment ;
 *   - TOUT JETER en datant à la synchronisation : un enfant qui joue vraiment
 *     le lundi sans réseau et synchronise le vendredi PERD son lundi, donc sa
 *     série. Il serait puni d'avoir joué là où il n'y a pas de réseau —
 *     exactement la situation que le hors-ligne existe pour servir.
 *
 * LA RÈGLE EST DONC UNE FENÊTRE. On garde la date déclarée quand elle tombe
 * entre le téléchargement du lot et la réception de la synchronisation ; on la
 * ramène dans cet intervalle sinon. Le lundi honnête est gardé, le mois en
 * avant est ramené.
 */

/** Au-delà d'une heure sur UN exercice, l'horloge ment ou l'enfant est parti. */
export const MAX_TIME_SPENT_MS = 60 * 60 * 1000;

/**
 * La borne BASSE de la fenêtre.
 *
 * L'appareil annonce quand il a téléchargé le lot — et il peut mentir sur cela
 * aussi. On ne descend donc jamais avant le début de la tentative, qui est une
 * date SERVEUR, et on ne monte jamais au-delà de maintenant.
 */
export function lowerBound(
  declaredDownloadedAt: number,
  attemptStartedAt: number,
  now: number,
): number {
  return Math.min(Math.max(declaredDownloadedAt, attemptStartedAt), now);
}

/** La date d'une réponse, ramenée dans la fenêtre plausible. */
export function clampSubmittedAt(
  declared: number,
  lower: number,
  now: number,
): number {
  if (!Number.isFinite(declared)) return now;
  return Math.min(Math.max(declared, lower), now);
}

/** Le temps passé sur un exercice, borné des deux côtés. */
export function clampTimeSpent(declared: number): number {
  if (!Number.isFinite(declared) || declared < 0) return 0;
  return Math.min(declared, MAX_TIME_SPENT_MS);
}

/** Un compteur d'essais ou d'indices : entier, jamais négatif. */
export function clampCount(declared: number): number {
  if (!Number.isFinite(declared) || declared < 0) return 0;
  return Math.floor(declared);
}
