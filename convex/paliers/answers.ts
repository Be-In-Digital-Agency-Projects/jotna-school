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
 * LES DEUX LAXISMES DE D21 SONT CORRIGÉS DEPUIS. Ce qui suit dit lesquels,
 * parce qu'un vérificateur resserré se relit mal sans savoir de quoi.
 *
 * `verifyMatch` testait une LONGUEUR puis une APPARTENANCE par élément : pour
 * quatre paires, tout multi-ensemble de taille quatre pris dans les paires
 * correctes passait — la même bonne paire quatre fois comprise. 35 réponses
 * acceptées là où une seule démontre la compétence. `verifyDragDrop`, lui,
 * ignorait les clés en trop : le nombre de réponses acceptées était
 * littéralement infini.
 *
 * Les deux comparent désormais des MULTI-ENSEMBLES : la réponse doit être une
 * permutation exacte de ce qui est attendu, ni doublon ni surplus.
 *
 * CE CHANGEMENT A ATTERRI DES DEUX CÔTÉS À LA FOIS, comme D21 l'exigeait :
 * `paliers/offline.ts` compare les atomes de la même façon, et
 * `ATOM_SCHEME_VERSION` est passée à 2 — ce qui rend INJOUABLES les lots
 * hors-ligne déjà téléchargés, qui auraient jugé avec l'ancienne règle. C'est
 * le prix, il est connu, et le scellé de `offlineScheme.test.ts` l'a rendu
 * visible avant d'être payé.
 *
 * AUCUNE INTERFACE DU PRODUIT NE PRODUIT CES FORMES — vérifié une par une
 * avant de resserrer : le pavé mobile pose une paire par élément de gauche, le
 * composant web filtre sur la gauche ET sur la droite, et les deux « ranger »
 * ne connaissent que les étiquettes de leur exercice. Le resserrement ne
 * transforme donc aucune bonne réponse vécue en mauvaise ; il ferme une porte
 * que seul un client fabriqué pouvait pousser.
 *
 * ET IL N'EST PAS RÉTROACTIF : `submitPalier` lit le `isCorrect` STOCKÉ des
 * lignes `attempts`, il ne revérifie rien. Aucun enfant ne perd une étoile
 * déjà acquise.
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

/**
 * La clé d'une paire.
 *
 * ELLE ÉTAIT `${left}|||${right}`, ET DEUX PAIRES DIFFÉRENTES POUVAIENT LA
 * PARTAGER : (« a|||1 », « x ») et (« a », « 1|||x ») donnaient la même
 * chaîne. Improbable en français d'école, gratuit à fermer. `JSON.stringify`
 * d'un couple échappe les guillemets et ne peut pas se confondre.
 */
function pairKey(left: unknown, right: unknown): string {
  return JSON.stringify([left, right]);
}

/**
 * Relier — chaque paire attendue reliée UNE FOIS, ni plus ni moins.
 *
 * La comparaison porte sur un MULTI-ENSEMBLE et non sur un ensemble : deux
 * paires identiques dans l'énoncé (donnée dégénérée, mais possible) veulent
 * alors deux paires identiques dans la réponse, ce qu'un ensemble ne saurait
 * pas exprimer.
 */
function verifyMatch(submitted: string, payload: MatchServerPayload): boolean {
  try {
    const arr: unknown = JSON.parse(submitted);
    if (!Array.isArray(arr)) return false;
    // UN EXERCICE SANS PAIRE N'EST PAS RÉUSSISSABLE. Sans cette ligne, `[]`
    // passait la comparaison de longueur, ne consommait rien et rendait
    // `true` — pendant que `verifyOffline` refusait déjà tout jeu d'atomes
    // vide. Une divergence appareil/serveur latente, trouvée en relisant, et
    // fermée du côté qui avait tort.
    if (payload.pairs.length === 0) return false;
    if (arr.length !== payload.pairs.length) return false;

    const remaining = new Map<string, number>();
    for (const p of payload.pairs) {
      const key = pairKey(p.left, p.right);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
    for (const pair of arr as { left?: unknown; right?: unknown }[]) {
      const key = pairKey(pair?.left, pair?.right);
      const left = remaining.get(key);
      // `0` compte : la paire est correcte, mais elle a DÉJÀ servi.
      if (left === undefined || left === 0) return false;
      remaining.set(key, left - 1);
    }
    // Les longueurs étant égales et chaque paire ayant consommé un jeton,
    // `remaining` est nécessairement à zéro partout.
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

/**
 * Ranger — chaque étiquette attendue dans sa zone, ET AUCUNE AUTRE CLÉ.
 *
 * Le compte se fait sur les étiquettes DISTINCTES attendues, pas sur
 * `items.length` : deux éléments au même texte (donnée dégénérée) ne peuvent
 * produire qu'une clé, et exiger deux clés condamnerait une réponse juste.
 *
 * `Object.entries` ne rend que les propriétés PROPRES. Une réponse portant une
 * clé `constructor` ou `toString` ne peut donc pas emprunter sa valeur au
 * prototype d'`Object`, ce que `map[item.text]` autorisait.
 */
function verifyDragDrop(
  submitted: string,
  payload: DragDropServerPayload,
): boolean {
  try {
    const raw: unknown = JSON.parse(submitted);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return false;
    }
    const placed = new Map(Object.entries(raw as Record<string, unknown>));
    const expected = new Set(payload.items.map((item) => item.text));
    // Même raison qu'en « relier » : sans étiquette à ranger, `{}` rendait
    // `true` côté serveur et `false` côté appareil.
    if (expected.size === 0) return false;
    if (placed.size !== expected.size) return false;
    for (const item of payload.items) {
      if (placed.get(item.text) !== item.correctZone) return false;
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

// ---------------------------------------------------------------------------
// ASSEMBLAGE — de ce que l'enfant a choisi à la chaîne soumise.
//
// Ces deux fonctions portent la RÈGLE DE COMPLÉTUDE, et c'est pour cela
// qu'elles vivent ici plutôt que dans un composant. Elles décident si le bouton
// Valider s'allume ; un composant qui se tromperait laisserait envoyer une
// réponse partielle, laquelle coûterait un essai sur les cinq pour une réponse
// que l'enfant n'avait pas fini d'écrire. C'est la sorte de défaut qu'un
// enfant subit sans pouvoir le nommer.
//
// Elles rendent `null` quand la réponse n'est pas complète — la même valeur que
// les composants remontent pour dire « pas encore ».
// ---------------------------------------------------------------------------

/**
 * Les paires reliées, ordonnées comme la colonne de gauche AFFICHÉE.
 *
 * L'ordre n'a aucune importance pour `verifyMatch`, qui compare des
 * multi-ensembles. On le fixe quand même, pour qu'une même sélection produise
 * toujours la même chaîne : deux chaînes différentes pour un même choix
 * rendraient le journal hors-ligne (phase 3) impossible à comparer.
 */
export function buildMatchAnswer(
  leftOrder: readonly string[],
  chosen: Readonly<Record<string, string>>,
): string | null {
  const complete = leftOrder.every((left) => chosen[left] !== undefined);
  if (!complete) return null;
  return encodeMatchAnswer(
    leftOrder.map((left) => ({ left, right: chosen[left] })),
  );
}

/**
 * Le rangement, complet seulement quand CHAQUE étiquette est dans une case.
 *
 * `verifyDragDrop` REFUSE désormais une clé en trop autant qu'une étiquette
 * manquante. La complétude se mesure sur les étiquettes attendues, et cet
 * assembleur ne sérialise que celles-là : `placed` n'accueille jamais d'autre
 * clé, ce qui est exactement ce qui rend le resserrement sans danger.
 */
export function buildDragDropAnswer(
  itemTexts: readonly string[],
  placed: Readonly<Record<string, string>>,
): string | null {
  const complete = itemTexts.every((text) => placed[text] !== undefined);
  if (!complete) return null;
  return encodeDragDropAnswer(placed);
}
