import type { ExerciseType } from "@convex/paliers/answers";

/**
 * L'exercice tel que l'appareil le reçoit.
 *
 * C'est la forme que rend `api.paliers.index.getExercisesForPalier` après
 * `stripAnswerFromExercise` : le corrigé n'y est PAS (Décision 61), et les
 * colonnes mélangeables le sont déjà, avec une graine déterministe côté
 * serveur (Décision 75). L'appareil ne remélange donc jamais rien — il
 * afficherait un ordre que le serveur ne connaît pas.
 */
export interface SanitizedExercise {
  _id: string;
  type: ExerciseType;
  prompt: string;
  payload: unknown;
  hintsAvailable: number;
  palierAttemptId: string;
  isVariation: boolean;
}

/**
 * Le contrat de TOUT composant d'exercice.
 *
 * IL NE SOUMET RIEN, et c'est la règle qui tient le contrat de réponse. Un
 * composant produit la chaîne encodée — par les `encode*` de
 * `@convex/paliers/answers`, jamais à la main — et la remonte. Le lecteur est
 * le SEUL à appeler `verifyAttempt`. Cinq composants qui soumettraient
 * chacun de leur côté, ce sont cinq endroits où la chaîne peut dériver de
 * celle que le serveur relit.
 *
 * `null` signifie « l'enfant n'a pas fini » : le bouton Valider reste éteint,
 * plutôt que d'envoyer une réponse incomplète qui compterait comme un essai
 * perdu sur les cinq.
 */
export interface ExerciseInputProps<TPayload> {
  payload: TPayload;
  /** Verrouillé pendant l'envoi et après une bonne réponse. */
  disabled: boolean;
  /** Remonte la réponse ENCODÉE, ou `null` tant qu'elle est incomplète. */
  onAnswer: (encoded: string | null) => void;
  /** Change à chaque nouvel essai : remet le composant à zéro. */
  attemptKey: number;
}
