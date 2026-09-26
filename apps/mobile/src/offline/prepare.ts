import type { ConvexReactClient } from "convex/react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { VisibleClassName } from "@convex/curriculum";
import { enforceStorageCap, saveBundle } from "./store";

/**
 * « JE PRÉPARE POUR PLUS TARD » — le téléchargement DÉLIBÉRÉ (tâche 3.11).
 *
 * Le lot du palier EN COURS descend tout seul pendant qu'on y joue ; c'est ce
 * qui fait qu'une coupure en pleine séance n'arrête pas l'enfant. Ce
 * fichier-ci répond à l'autre besoin, celui du départ en week-end chez la
 * grand-mère : prendre AVANT de quitter le réseau de quoi jouer sans lui.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'ON PEUT PRÉPARER N'EST PAS CE QU'ON CROIT, ET LE SERVEUR L'IMPOSE.
 *
 * On ne peut PAS prendre d'avance DANS une thématique. `startPalierAttempt`
 * (`convex/paliers/index.ts`) refuse d'ouvrir le palier N tant que les paliers
 * 1 à N-1 ne portent pas chacun une tentative `validated`. Préparer les
 * paliers 4, 5 et 6 d'une thématique où l'enfant en est au 3 lèverait « Tu
 * dois d'abord valider le palier 3 ». La garde est juste : elle tient la
 * progression linéaire (D4 du web).
 *
 * Ce qu'on prépare, ce sont donc les paliers suivants EN LARGEUR : le prochain
 * palier de CHAQUE thématique ouverte. Pour un enfant qui a cinq thématiques
 * en cours, cela fait cinq paliers d'avance — de quoi tenir un week-end, ce
 * qui était le besoin.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ON PRÉPARE UNE THÉMATIQUE À LA FOIS, JAMAIS EN PARALLÈLE.
 *
 * `getBucket` est une ACTION qui peut déclencher une génération par IA —
 * longue, et facturée. Cinq en parallèle, c'est cinq générations simultanées
 * sur le budget de l'école, et un téléphone qui chauffe. En série, l'enfant
 * voit avancer, et l'on peut s'arrêter à la première erreur sans avoir déjà
 * lancé les quatre autres.
 *
 * L'ORDRE EST CELUI DE LA SÉANCE EN LIGNE, ET CE N'EST PAS UN HASARD :
 * `getBucket`, puis `startPalierAttempt`, puis `getOfflineBundle`. La
 * tentative se crée AU TÉLÉCHARGEMENT (D14) parce que le mélange des colonnes
 * est semé avec son identifiant (Décision 75) : un lot téléchargé sans
 * tentative ne pourrait pas être rejoué hors ligne.
 */

export type PrepareOutcome =
  | "done"
  | "locked"
  | "closed"
  | "failed";

export interface PrepareTarget {
  topicId: Id<"topics">;
  topicName: string;
  class: VisibleClassName;
  palierIndex: number;
}

/**
 * Prépare UN palier. Rend ce qui s'est passé, et ne lève jamais.
 *
 * Les trois échecs se distinguent parce qu'ils ne se disent pas pareil à un
 * enfant : « il faut finir le palier d'avant », « demande à la maîtresse » et
 * « ça n'a pas marché, réessaie ».
 */
export async function preparePalier(
  client: ConvexReactClient,
  subjectId: Id<"subjects">,
  target: PrepareTarget,
): Promise<PrepareOutcome> {
  let attemptId: Id<"palierAttempts">;
  try {
    const bucket = await client.action(api.paliers.index.getBucket, {
      subjectId,
      class: target.class,
      topicId: target.topicId,
      palierIndex: target.palierIndex,
    });
    attemptId = await client.mutation(api.paliers.index.startPalierAttempt, {
      palierId: bucket.palierId,
    });
  } catch (error) {
    // Le message de la garde de progression est écrit pour être lu par
    // l'enfant, et il est le seul à contenir « valider le palier ».
    const message = error instanceof Error ? error.message : "";
    return /valider le palier/i.test(message) ? "locked" : "failed";
  }

  // `getOfflineBundle` rend `null` — sans lever — quand l'accès de l'école est
  // fermé (D18 : on n'OUVRE pas de lot neuf, même si l'on garde tout ce qui
  // est déjà là). C'est un refus, pas une panne, et il se dit autrement.
  const bundle = await client
    .query(api.paliers.index.getOfflineBundle, { palierAttemptId: attemptId })
    .catch(() => null);
  if (bundle == null) return "closed";

  await saveBundle({
    palierAttemptId: attemptId,
    topicId: target.topicId,
    topicName: target.topicName,
    palierIndex: target.palierIndex,
    downloadedAt: Date.now(),
    accessValidUntil: bundle.accessValidUntil,
    exercises: bundle.exercises,
  });

  // LE PLAFOND S'APPLIQUE APRÈS L'ÉCRITURE, ET LE LOT QU'ON VIENT DE PRENDRE
  // EST PROTÉGÉ. L'appliquer avant laisserait la place libérée à un autre
  // processus ; le protéger évite le comique de l'effacer aussitôt écrit quand
  // il est à lui seul plus gros que le plafond.
  await enforceStorageCap([attemptId]);

  return "done";
}
