/**
 * « CE LOT EST-IL ENCORE JOUABLE ? » — tâche 6.7, décision D21.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEUX RAISONS DE NE PLUS L'ÊTRE, ET LA SECONDE EST NOUVELLE.
 *
 * 1. LE BAIL EST EXPIRÉ. `accessValidUntil` est le plus proche de la fin
 *    d'abonnement de l'école et de quatorze jours. Passé ce point, le lot ne
 *    doit plus s'ouvrir : l'école ne paie peut-être plus.
 *
 * 2. LE SCHÉMA D'ATOMES A CHANGÉ SOUS L'APPAREIL. Les empreintes du lot ont
 *    été calculées par le serveur avec l'atomisation de son jour de
 *    téléchargement. Une mise à jour à chaud remplace le code de l'appareil
 *    sans toucher aux lots déjà là : si elle change la manière de construire
 *    un atome, l'appareil calcule désormais des atomes que ces empreintes ne
 *    reconnaissent plus.
 *
 *    LA PANNE NE RESSEMBLE PAS À UNE PANNE : rien ne plante, l'enfant répond
 *    juste et l'application lui dit faux. Le serveur recalculera tout à la
 *    synchronisation et son score finira même par être correct — seul
 *    l'enfant aura passé l'après-midi à se croire nul. C'est exactement le
 *    genre de défaut qu'aucun test d'intégration ne rattrape et qu'aucun
 *    journal ne signale.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * UN LOT D'AVANT CETTE VERSION N'A PAS DE NUMÉRO, et on le traite comme
 * INCOMPATIBLE plutôt que comme compatible. C'est le sens de la prudence :
 * un lot sans numéro a été construit par un serveur qui ne savait pas encore
 * qu'il fallait en donner un, donc par un code dont on ne peut rien affirmer.
 * Le refuser coûte un téléchargement ; l'accepter coûte un après-midi.
 */

export interface BundleValidityInput {
  accessValidUntil: number;
  /** Le numéro porté par le lot. `null` pour un lot d'avant la tâche 6.7. */
  atomScheme: number | null;
}

export type BundleUnplayableReason = "expired" | "scheme_changed";

/**
 * Rend `null` quand le lot est jouable, ou la raison qui l'en empêche.
 *
 * L'ORDRE N'A PAS D'IMPORTANCE ICI — les deux raisons sont également
 * définitives, et un lot peut parfaitement cumuler les deux. On rend
 * l'expiration en premier parce que c'est la plus courante, donc la plus
 * utile à lire dans un journal.
 */
export function bundleUnplayableReason(
  bundle: BundleValidityInput,
  now: number,
  currentScheme: number,
): BundleUnplayableReason | null {
  if (bundle.accessValidUntil <= now) return "expired";
  if (bundle.atomScheme !== currentScheme) return "scheme_changed";
  return null;
}

export function isBundlePlayable(
  bundle: BundleValidityInput,
  now: number,
  currentScheme: number,
): boolean {
  return bundleUnplayableReason(bundle, now, currentScheme) === null;
}
