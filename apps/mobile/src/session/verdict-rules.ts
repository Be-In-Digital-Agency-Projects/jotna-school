/**
 * LA RÈGLE DU VERDICT GARDÉ — pure, donc éprouvable sans appareil.
 *
 * Elle vit à part de `last-verdict.ts` pour une raison que la configuration
 * Vitest du mobile annonce dans son en-tête : un fichier éprouvé ici ne doit
 * RIEN importer d'`expo`. `expo-secure-store` tire `react-native`, dont la
 * syntaxe Flow n'est pas analysable sous Node — le test échoue alors à
 * l'import, avant d'avoir rien vérifié.
 *
 * C'est la même séparation que `offline/eviction.ts` face à `offline/store.ts`,
 * et pour le même motif : ce qui DÉCIDE doit pouvoir être mis à l'épreuve,
 * ce qui ÉCRIT peut attendre l'appareil.
 */

export interface CachedVerdict {
  /** Fin de l'abonnement de l'école, telle que le serveur l'a dite. */
  endsAt: number;
  /** Quand on a posé la question pour la dernière fois. */
  askedAt: number;
}

/**
 * « Ce verdict permet-il encore d'entrer hors ligne ? » — fonction PURE, donc
 * éprouvable sans trousseau ni appareil.
 *
 * DEUX BORNES, ET LA SECONDE N'EST PAS REDONDANTE.
 *
 *   1. L'ABONNEMENT. Passé `endsAt`, l'école ne paie plus, et un verdict
 *      gardé au chaud ne doit pas faire semblant du contraire.
 *
 *   2. LA FRAÎCHEUR. Un verdict vieux de deux mois vient d'un monde qui a pu
 *      changer — l'enfant a quitté l'école, son inscription est « released »,
 *      son compte est fermé. Le serveur le dirait ; sans lui on ne peut que
 *      cesser de croire un souvenir trop vieux. Quatorze jours, la même durée
 *      que le bail d'un lot : au-delà, il n'y a de toute façon plus rien de
 *      jouable sur l'appareil, donc entrer n'apporterait rien.
 *
 * UNE HORLOGE RECULÉE NE DOIT PAS PROLONGER L'ACCÈS. `askedAt` dans le futur
 * signale une horloge trafiquée ou remise à zéro ; on refuse, plutôt que de
 * calculer un âge négatif qui passerait tous les tests.
 */
export const VERDICT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function verdictStillOpens(
  verdict: CachedVerdict | null,
  now: number,
  maxAgeMs: number = VERDICT_MAX_AGE_MS,
): boolean {
  if (verdict === null) return false;
  if (now >= verdict.endsAt) return false;
  if (verdict.askedAt > now) return false;
  return now - verdict.askedAt < maxAgeMs;
}
