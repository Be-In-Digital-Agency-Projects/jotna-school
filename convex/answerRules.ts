/**
 * La correction d'une réponse d'élève, et elle seule.
 *
 * Fonctions pures, sans aucun import : c'est ce qui les rend testables, le
 * dépôt n'ayant pas `convex-test` et vitest tournant en `jsdom`. Le même motif
 * que `roleRules.ts` — et ici il répare une situation précise : ces cinq
 * vérificateurs existaient en TROIS copies (`convex/attempts.ts`,
 * `convex/palierAttempts.ts`, et une réimplémentation dans
 * `convex/__tests__/attempts.test.ts`). Les tests notaient donc une copie que
 * la production n'exécutait jamais, et les deux mutations publiques pouvaient
 * diverger sans que rien ne le signale. Une seule définition, importée par les
 * deux appelants et par les tests, supprime les deux risques.
 *
 * C'EST LA SÉMANTIQUE DE RÉFÉRENCE. Le mode hors ligne prévoit une forme
 * canonique côté appareil qui doit rendre le MÊME verdict que le serveur ; elle
 * doit reproduire ce fichier, et rien d'autre.
 *
 * ## Deux vérificateurs acceptaient des soumissions qu'ils devaient refuser
 *
 * `verifyMatch` testait « même longueur » + « chaque paire soumise appartient à
 * l'ensemble attendu ». Sur un exercice à 4 paires, quatre fois LA MÊME bonne
 * paire passait : la longueur tombait juste et chaque élément appartenait bien
 * à l'ensemble. L'appartenance à un ensemble ne dit pas combien de fois. On
 * compare donc des MULTI-ENSEMBLES : chaque paire attendue doit être présente
 * autant de fois qu'attendu, ce qui exige une bijection quand les paires
 * attendues sont distinctes, et reste juste si le contenu en répète une.
 *
 * `verifyDragDrop` ne regardait que les clés attendues : des clés en trop dans
 * l'objet soumis n'invalidaient rien. ON LES REFUSE, choix explicite : une
 * soumission qui place des éléments que l'exercice ne propose pas ne décrit
 * pas cet exercice. L'interface web ne peut pas en produire — `assignments`
 * n'est initialisé qu'à partir des `items` du payload — donc le refus ne coûte
 * rien au jeu normal.
 *
 * Les deux défauts n'étaient atteignables qu'en appelant les mutations
 * publiques directement, jamais en jouant : `MatchExercise` interdit déjà les
 * doublons côté client (une paire chasse celle qui partageait sa gauche OU sa
 * droite), et `DragDropExercise` ne peut émettre que des clés connues.
 */

/** Les cinq types d'exercice du schéma (`convex/schema.ts` → exercises.type). */
export type ExerciseType =
  | "qcm"
  | "drag-drop"
  | "match"
  | "order"
  | "short-answer";

export interface MatchPayload {
  pairs: { left: string; right: string }[];
}
export interface QcmPayload {
  correctIndex: number;
}
export interface OrderPayload {
  correctSequence: string[];
}
export interface DragDropPayload {
  items: { text: string; correctZone: string }[];
}
export interface ShortAnswerPayload {
  acceptedAnswers: string[];
}

export function verifyQcm(submitted: string, payload: QcmPayload): boolean {
  return parseInt(submitted, 10) === payload.correctIndex;
}

/**
 * Clé d'une paire. `JSON.stringify` plutôt qu'un séparateur littéral : avec
 * `${left}|||${right}`, une gauche contenant le séparateur pouvait se faire
 * passer pour une autre paire. Un encodage sans ambiguïté ferme ça pour rien.
 */
function pairKey(left: string, right: string): string {
  return JSON.stringify([left, right]);
}

function multiset(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

export function verifyMatch(submitted: string, payload: MatchPayload): boolean {
  try {
    const parsed: unknown = JSON.parse(submitted);
    if (!Array.isArray(parsed)) return false;

    const proposed: string[] = [];
    for (const pair of parsed) {
      if (typeof pair !== "object" || pair === null) return false;
      const { left, right } = pair as { left?: unknown; right?: unknown };
      if (typeof left !== "string" || typeof right !== "string") return false;
      proposed.push(pairKey(left, right));
    }

    const expected = multiset(payload.pairs.map((p) => pairKey(p.left, p.right)));
    const got = multiset(proposed);
    if (got.size !== expected.size) return false;
    for (const [key, count] of expected) {
      if (got.get(key) !== count) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function verifyOrder(submitted: string, payload: OrderPayload): boolean {
  try {
    const parsed: unknown = JSON.parse(submitted);
    if (!Array.isArray(parsed)) return false;
    if (parsed.length !== payload.correctSequence.length) return false;
    return parsed.every((item, i) => item === payload.correctSequence[i]);
  } catch {
    return false;
  }
}

export function verifyDragDrop(
  submitted: string,
  payload: DragDropPayload,
): boolean {
  try {
    const parsed: unknown = JSON.parse(submitted);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return false;
    }
    const placements = parsed as Record<string, unknown>;

    for (const item of payload.items) {
      if (placements[item.text] !== item.correctZone) return false;
    }

    // Clés en trop : refus explicite, voir l'en-tête du fichier.
    const expectedTexts = new Set(payload.items.map((it) => it.text));
    for (const key of Object.keys(placements)) {
      if (!expectedTexts.has(key)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Comparaison littérale, insensible à la casse et aux espaces de bord. Un
 * second avis sémantique de l'IA peut faire PASSER une réponse refusée ici
 * (`attemptsVerify.ts`), jamais l'inverse.
 */
export function verifyShortAnswer(
  submitted: string,
  payload: ShortAnswerPayload,
): boolean {
  const normalized = submitted.toLowerCase().trim();
  return payload.acceptedAnswers.some((a) => a.toLowerCase().trim() === normalized);
}

/**
 * Aiguillage par type. Un type inconnu rend `false` : le schéma restreint déjà
 * `exercises.type` à cinq valeurs, donc ce cas n'est pas atteignable — et un
 * refus vaut mieux qu'une acceptation pour un type qu'on ne sait pas corriger.
 */
export function verifyAnswer(
  type: string,
  payload: unknown,
  submitted: string,
): boolean {
  switch (type) {
    case "qcm":
      return verifyQcm(submitted, payload as QcmPayload);
    case "match":
      return verifyMatch(submitted, payload as MatchPayload);
    case "order":
      return verifyOrder(submitted, payload as OrderPayload);
    case "drag-drop":
      return verifyDragDrop(submitted, payload as DragDropPayload);
    case "short-answer":
      return verifyShortAnswer(submitted, payload as ShortAnswerPayload);
    default:
      return false;
  }
}
