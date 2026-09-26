import { verifyOffline } from "@convex/paliers/offline";
import type { VerifyOutcome } from "@/exercises/exercise-player";
import { deviceDigest } from "./digest";
import {
  appendJournal,
  countAttempts,
  countHints,
  type StoredBundle,
} from "./store";

/** Un exercice tel que `getOfflineBundle` l'a rendu. */
export interface BundledExercise {
  _id: string;
  type: string;
  prompt: string;
  payload: unknown;
  hintsAvailable: number;
  palierAttemptId: string;
  isVariation: boolean;
  hints: string[];
  verifier: { salt: string; digests: string[] };
}

/** Le même plafond que le serveur (`verifyAttempt` rend `5 - attemptNumber`). */
const MAX_ATTEMPTS = 5;

/**
 * LE MOTEUR HORS LIGNE — la contrepartie exacte de `verifyAttempt` et
 * `requestHint`, sans réseau.
 *
 * CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS. Il rend un verdict à l'enfant tout
 * de suite, et il ÉCRIT la réponse au journal. Il ne note rien, ne valide
 * rien, ne décerne rien : à la synchronisation, le serveur relit la réponse
 * avec `verifyAnswer` et recalcule tout (D12). Son verdict à lui est
 * consultatif — il part quand même dans le journal, pour que l'écart soit
 * mesurable (D20.4).
 *
 * LES COMPTES VIENNENT DU JOURNAL, pas d'un état en mémoire. L'enfant peut
 * fermer l'application au milieu d'un palier et la rouvrir : le rang de la
 * tentative doit être le même, sinon le score que le serveur calculera plus
 * tard ne correspondra pas à ce que l'enfant a vécu.
 */
export function makeOfflineEngine(bundle: StoredBundle) {
  const byId = new Map<string, BundledExercise>(
    (bundle.exercises as BundledExercise[]).map((e) => [e._id, e]),
  );

  async function verify(
    exerciseId: string,
    encoded: string,
    timeSpentMs: number,
  ): Promise<VerifyOutcome> {
    const exercise = byId.get(exerciseId);
    if (exercise === undefined) throw new Error("Exercice absent du lot");

    const isCorrect = await verifyOffline(
      exercise.type,
      exercise.payload,
      encoded,
      exercise.verifier.digests,
      exercise.verifier.salt,
      deviceDigest,
    );

    const previous = await countAttempts(bundle.palierAttemptId, exerciseId);
    const attemptNumber = previous + 1;

    await appendJournal({
      palierAttemptId: bundle.palierAttemptId,
      exerciseId,
      submittedAnswer: encoded,
      attemptNumber,
      // Les indices sont comptés sur LEURS propres lignes, comme le fait
      // `requestHint` côté serveur. Zéro ici, sans quoi ils compteraient deux
      // fois et le score chuterait.
      hintsUsedCount: 0,
      timeSpentMs,
      submittedAt: Date.now(),
      localVerdict: isCorrect,
    });

    return {
      isCorrect,
      attemptNumber,
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attemptNumber),
    };
  }

  /**
   * L'indice, pris dans le lot.
   *
   * SON TEXTE EST DÉJÀ LÀ (D20.3) : `requestHint` ne passera pas. Ce qui
   * compte pour le score, c'est le COMPTE, et il part au journal sous la même
   * forme que le serveur écrit — sentinelle `attemptNumber: 0`,
   * `__HINT_<i>` en réponse, `hintsUsedCount: 1`.
   *
   * CONCESSION ASSUMÉE (D20.2) : hors ligne, ce compte est DÉCLARÉ par
   * l'appareil. Le serveur ne peut pas le contredire.
   */
  async function hint(exerciseId: string, hintIndex: number): Promise<string> {
    const exercise = byId.get(exerciseId);
    if (exercise === undefined) throw new Error("Exercice absent du lot");
    const text = exercise.hints[hintIndex];
    if (typeof text !== "string") throw new Error("Indice indisponible");

    const already = await countHints(bundle.palierAttemptId, exerciseId);
    // Le même indice redemandé ne se compte pas deux fois : l'enfant peut
    // avoir fermé l'écran et être revenu.
    if (hintIndex >= already) {
      await appendJournal({
        palierAttemptId: bundle.palierAttemptId,
        exerciseId,
        submittedAnswer: `__HINT_${hintIndex}`,
        attemptNumber: 0,
        hintsUsedCount: 1,
        timeSpentMs: 0,
        submittedAt: Date.now(),
        localVerdict: null,
      });
    }
    return text;
  }

  return { verify, hint, exercises: bundle.exercises as BundledExercise[] };
}
