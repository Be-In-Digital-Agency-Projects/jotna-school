/**
 * LE CONTRAT DE RÉPONSE — module PUR, sans import Convex.
 *
 * Une réponse d'élève voyage en UNE CHAÎNE : `attempts.submittedAnswer`. Ce
 * fichier tient les deux bouts de cette chaîne au même endroit :
 *
 *   - ce que le CLIENT écrit dedans   → les `encode*`
 *   - ce que le SERVEUR en relit      → les `verify*`
 *
 * POURQUOI ENSEMBLE, ET PAS CHACUN DE SON CÔTÉ. Les vérificateurs vivaient
 * dans `palierAttempts.ts`, et chaque composant d'exercice du web fabriquait
 * sa chaîne dans son coin. Tant qu'il n'y avait qu'un client, la divergence se
 * voyait tout de suite. À deux clients — web et mobile — un encodage qui
 * dérive d'un caractère donne un enfant qui a RAISON et que le serveur compte
 * FAUX, sans que rien nulle part ne signale l'écart. Les tests d'aller-retour
 * de `convex/__tests__/answers.test.ts` ne peuvent tenir que si les deux
 * moitiés sont lisibles dans un seul fichier.
 *
 * ---------------------------------------------------------------------------
 * LES DEUX LAXISMES SONT REPRODUITS TELS QUELS, ET C'EST VOULU (décision D21).
 *
 * `verifyMatch` n'interdit pas les doublons : quatre fois la même bonne paire
 * passent le test de longueur puis d'appartenance. `verifyDragDrop` ignore les
 * clés en trop. Ces comportements sont ceux du serveur EN SERVICE ; les
 * corriger ici, sans corriger le reste, ferait diverger l'appareil du serveur —
 * exactement ce que ce fichier existe pour empêcher.
 *
 * Les resserrer est légitime et souhaitable, mais c'est UN changement à part,
 * qui doit atterrir des deux côtés à la fois et invalider les lots hors-ligne
 * déjà téléchargés. Les tests plus bas ÉPINGLENT le comportement actuel pour
 * que ce changement-là soit visible le jour où il arrive.
 * ---------------------------------------------------------------------------
 */

export type ExerciseType =
  | "qcm"
  | "drag-drop"
  | "match"
  | "order"
  | "short-answer";

// ---------------------------------------------------------------------------
// Ce que le CLIENT reçoit — la forme assainie par `sanitizePayload`.
// Le corrigé n'y est pas (Décision 61) : ces types le disent au compilateur.
// ---------------------------------------------------------------------------

export interface QcmClientPayload {
  options: string[];
}

/** Colonne de droite MÉLANGÉE côté serveur (graine déterministe, Décision 75). */
export interface MatchClientPayload {
  left: string[];
  right: string[];
}

/** Éléments MÉLANGÉS : l'ordre reçu n'est jamais le bon. */
export interface OrderClientPayload {
  items: string[];
}

export interface DragDropClientPayload {
  zones: string[];
  items: { text: string }[];
}

export interface ShortAnswerClientPayload {
  tolerance: unknown;
}

// ---------------------------------------------------------------------------
// Ce que le SERVEUR garde — la forme complète, jamais envoyée au client.
// ---------------------------------------------------------------------------

interface QcmServerPayload {
  correctIndex: number;
}
interface MatchServerPayload {
  pairs: { left: string; right: string }[];
}
interface OrderServerPayload {
  correctSequence: string[];
}
interface DragDropServerPayload {
  items: { text: string; correctZone: string }[];
}
interface ShortAnswerServerPayload {
  acceptedAnswers: string[];
}

// ---------------------------------------------------------------------------
// ENCODEURS — ce que le client écrit dans `submittedAnswer`.
// ---------------------------------------------------------------------------

/** L'INDICE de l'option choisie, en base dix. `verifyQcm` fait `parseInt`. */
export function encodeQcmAnswer(chosenIndex: number): string {
  return String(chosenIndex);
}

/** La séquence dans l'ordre où l'enfant l'a rangée. */
export function encodeOrderAnswer(orderedItems: readonly string[]): string {
  return JSON.stringify(orderedItems);
}

/** Les paires que l'enfant a reliées, dans n'importe quel ordre. */
export function encodeMatchAnswer(
  pairs: readonly { left: string; right: string }[],
): string {
  return JSON.stringify(pairs.map((p) => ({ left: p.left, right: p.right })));
}

/** Un objet `texte de l'élément -> nom de la zone` où l'enfant l'a posé. */
export function encodeDragDropAnswer(
  placement: Readonly<Record<string, string>>,
): string {
  return JSON.stringify(placement);
}

/**
 * Le texte tel que l'enfant l'a tapé.
 *
 * On ne normalise PAS ici : `verifyShortAnswer` met en minuscules et retire les
 * espaces de bord, et l'IA de rattrapage (`attemptsVerify`) lit la réponse
 * BRUTE pour juger d'une équivalence de sens. Un encodeur qui raboterait le
 * texte lui retirerait de quoi juger.
 */
export function encodeShortAnswer(text: string): string {
  return text;
}

// ---------------------------------------------------------------------------
// VÉRIFICATEURS — purs, déterministes, et jamais exposés au client.
// ---------------------------------------------------------------------------

function verifyQcm(submitted: string, payload: QcmServerPayload): boolean {
  return parseInt(submitted, 10) === payload.correctIndex;
}

function verifyMatch(submitted: string, payload: MatchServerPayload): boolean {
  try {
    const arr: { left: string; right: string }[] = JSON.parse(submitted);
    if (arr.length !== payload.pairs.length) return false;
    const correct = new Set(payload.pairs.map((p) => `${p.left}|||${p.right}`));
    for (const pair of arr) {
      if (!correct.has(`${pair.left}|||${pair.right}`)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function verifyOrder(submitted: string, payload: OrderServerPayload): boolean {
  try {
    const arr: string[] = JSON.parse(submitted);
    if (arr.length !== payload.correctSequence.length) return false;
    return arr.every((it, i) => it === payload.correctSequence[i]);
  } catch {
    return false;
  }
}

function verifyDragDrop(
  submitted: string,
  payload: DragDropServerPayload,
): boolean {
  try {
    const map: Record<string, string> = JSON.parse(submitted);
    for (const item of payload.items) {
      if (map[item.text] !== item.correctZone) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function verifyShortAnswer(
  submitted: string,
  payload: ShortAnswerServerPayload,
): boolean {
  const norm = submitted.toLowerCase().trim();
  return payload.acceptedAnswers.some((a) => a.toLowerCase().trim() === norm);
}

/**
 * Le dispatcher pur.
 *
 * Il prend le TYPE et le PAYLOAD plutôt qu'un document d'exercice, pour rester
 * sans dépendance à Convex — c'est ce qui le rend testable et lisible depuis
 * l'application mobile. `palierAttempts.ts` garde son enveloppe qui prend un
 * `Doc<"exercises">`.
 *
 * Un type inconnu rend `false` : une réponse qu'on ne sait pas relire n'est
 * jamais comptée juste.
 */
export function verifyAnswer(
  type: ExerciseType | string,
  payload: unknown,
  submitted: string,
): boolean {
  switch (type) {
    case "qcm":
      return verifyQcm(submitted, payload as QcmServerPayload);
    case "match":
      return verifyMatch(submitted, payload as MatchServerPayload);
    case "order":
      return verifyOrder(submitted, payload as OrderServerPayload);
    case "drag-drop":
      return verifyDragDrop(submitted, payload as DragDropServerPayload);
    case "short-answer":
      return verifyShortAnswer(submitted, payload as ShortAnswerServerPayload);
    default:
      return false;
  }
}
