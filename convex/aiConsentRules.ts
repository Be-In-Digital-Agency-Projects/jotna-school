/**
 * LE CONSENTEMENT AU TRAITEMENT IA DU TRAVAIL DES ENFANTS — tâche 6.4.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CE FICHIER FERME.
 *
 * `profiles.aiDataConsentGranted` et `aiDataConsentGrantedAt` sont au schéma
 * depuis le début, avec le commentaire « Parental consent for AI data
 * processing (Loi 2008-12, Sénégal) ». **Ils n'étaient lus par personne.**
 * Pendant ce temps, trois chemins envoyaient le travail d'enfants de huit ans
 * chez OpenAI sans qu'aucune garde ne se pose la question.
 *
 * Ce n'est pas un défaut du mobile : il existe sur le web depuis le premier
 * jour. La garde vivant dans `convex/`, la corriger ici la corrige partout —
 * c'est le seul bon côté de l'avoir laissé si longtemps.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI EST GARDÉ, ET CE QUI NE L'EST PAS.
 *
 * On garde les chemins qui envoient le TRAVAIL DE L'ENFANT :
 *
 *   `attemptsVerify.verifyShortAnswerWithAI`  → sa réponse courte
 *   `attemptsExplain.generateExplanation`     → ses réponses fausses
 *   `paliers.index.regenerateFailedExercises` → son `studentAnswer`
 *
 * On NE garde PAS `explainMistake.explainExercise`, et c'est délibéré : son
 * invite ne porte que le type, l'énoncé et le corrigé de l'exercice — aucune
 * donnée personnelle ne part. La garder coûterait une fonction pédagogique à
 * l'enfant sans rien protéger. Vérifié ligne à ligne dans son constructeur
 * d'invite, pas supposé d'après son nom.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE MODÈLE D'AUTORITÉ — décision du propriétaire, prise le 26/09/2026.
 *
 * **L'ÉCOLE DÉCLARE, LE PARENT PEUT REFUSER.** L'école enrôle l'enfant, signe
 * le contrat, et déclare dans l'application qu'elle détient l'autorisation des
 * parents. Tout parent rattaché peut refuser pour son enfant, et son refus
 * l'emporte — c'est déjà la logique de `streaksEnabled` (`getMyStats` :
 * « si UN parent rattaché a explicitement mis false, la série est coupée »).
 *
 * TROIS ÉTATS SUR UN BOOLÉEN OPTIONNEL, et c'est ce qui permet de réutiliser
 * le champ existant plutôt que d'en inventer un :
 *
 *   `false`     → le parent REFUSE. Immédiat, sans délai de grâce, et il
 *                 l'emporte sur tout. C'est le sens même de lui donner un
 *                 levier : un « non » qui attendrait trente jours n'en est pas
 *                 un.
 *   `true`      → le parent ACCEPTE explicitement. Il est le représentant
 *                 légal : son oui est l'autorisation la plus forte qui existe,
 *                 et il vaut même si l'école n'a rien déclaré.
 *   `undefined` → il n'a pas d'avis. On regarde l'école.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE DÉLAI DE GRÂCE — décision du propriétaire, 30 jours.
 *
 * Le jour où cette garde entre en service, AUCUNE école n'a de déclaration
 * enregistrée : sans délai, toutes les classes perdraient l'explication pas à
 * pas du jour au lendemain, sans prévenir. Pendant la grâce, l'IA continue de
 * fonctionner et l'écran le dit au directeur et au parent. Ensuite, elle
 * s'éteint pour qui n'a pas déclaré.
 *
 * LA GRÂCE NE COUVRE JAMAIS UN REFUS PARENTAL. Elle existe pour laisser aux
 * écoles le temps de cliquer, pas pour passer outre un « non ».
 */

/** Ce que l'appelant sait de l'enfant et de son école. */
export interface AiConsentInput {
  /**
   * `profiles.aiDataConsentGranted` de l'ENFANT — l'avis parental.
   * `undefined` quand aucun parent ne s'est prononcé.
   */
  parentDecision: boolean | undefined;
  /** `schools.aiConsentDeclaredAt`, ou `null` si l'école n'a rien déclaré. */
  schoolDeclaredAt: number | null;
  /** Fin du délai de grâce, en millisecondes epoch. */
  graceEndsAt: number;
  now: number;
}

export type AiConsentReason =
  /** Un parent a explicitement refusé. */
  | "parent_refused"
  /** Un parent a explicitement accepté. */
  | "parent_granted"
  /** L'école a déclaré détenir l'autorisation des parents. */
  | "school_declared"
  /** Personne n'a déclaré, mais le délai de grâce court encore. */
  | "grace_period"
  /** Personne n'a déclaré et le délai est passé. */
  | "no_declaration";

export interface AiConsentDecision {
  allowed: boolean;
  reason: AiConsentReason;
  /**
   * Vrai quand l'IA ne tourne que grâce au délai de grâce. Les écrans du
   * directeur et du parent s'en servent pour afficher un avertissement daté,
   * et c'est la SEULE raison pour laquelle ce champ existe : sans lui, la
   * coupure au trentième jour arriverait sans que personne l'ait vue venir.
   */
  onGrace: boolean;
}

/**
 * L'ORDRE DES RÈGLES EST LE FOND, PAS LA FORME.
 *
 * Le refus parental se lit EN PREMIER, avant même de regarder l'école ou la
 * date. Inverser deux lignes ici ferait passer un enfant dont le parent a dit
 * non, parce que son école, elle, avait déclaré.
 */
export function decideAiConsent(input: AiConsentInput): AiConsentDecision {
  if (input.parentDecision === false) {
    return { allowed: false, reason: "parent_refused", onGrace: false };
  }
  if (input.parentDecision === true) {
    return { allowed: true, reason: "parent_granted", onGrace: false };
  }
  if (input.schoolDeclaredAt !== null) {
    return { allowed: true, reason: "school_declared", onGrace: false };
  }
  if (input.now < input.graceEndsAt) {
    return { allowed: true, reason: "grace_period", onGrace: true };
  }
  return { allowed: false, reason: "no_declaration", onGrace: false };
}

/**
 * FIN DU DÉLAI DE GRÂCE — 26 octobre 2026, minuit UTC.
 *
 * Trente jours après la décision du propriétaire (26 septembre 2026). C'est
 * une date ÉCRITE, et non « trente jours après le déploiement » : un délai
 * calculé au premier passage demanderait d'écrire quelque chose sur un chemin
 * de lecture, et un délai relatif à la date de compilation repartirait à zéro
 * à chaque redéploiement — l'échéance ne tomberait jamais.
 *
 * SI LA MISE EN SERVICE GLISSE, CETTE DATE SE DÉPLACE À LA MAIN. Elle est ici,
 * en clair, pour que ce soit une décision et non un oubli. Passée cette date
 * sans déclaration, une école perd l'IA pour ses élèves.
 */
export const AI_CONSENT_GRACE_ENDS_AT = Date.UTC(2026, 9, 26);

/**
 * Le message rendu à l'enfant quand l'IA lui est fermée.
 *
 * IL NE PARLE NI DE CONSENTEMENT, NI DE LOI, NI DE SES PARENTS. Un enfant de
 * huit ans à qui l'on répond « tes parents n'ont pas autorisé » apprend deux
 * choses fausses : que c'est de leur faute, et qu'il lui manque quelque chose
 * que les autres ont. Il lit donc que cette aide-là n'est pas disponible, ce
 * qui est vrai, et il garde l'indice et la correction, qui ne sont pas partis.
 */
export const AI_CONSENT_KID_MESSAGE =
  "Cette aide-là n'est pas disponible ici 🙂 Tu as toujours tes indices, et tu peux réessayer autant que tu veux !";
