import type {
  DragDropClientPayload,
  ExerciseType,
  MatchClientPayload,
} from "./answers";

/**
 * LE VERDICT HORS LIGNE — module PUR, sans import Convex ni crypto.
 *
 * Décisions D11, D12, D20, D21 du plan mobile.
 *
 * ---------------------------------------------------------------------------
 * CE QUE LE PLAN DISAIT, ET POURQUOI ÇA NE MARCHE PAS TEL QUEL.
 *
 * D11 prévoyait « une empreinte de la forme canonique acceptée » : on
 * canonicalise la réponse, on la hache, on compare à UNE empreinte livrée.
 * Cela tient pour le QCM, la remise en ordre et la réponse courte. Cela
 * S'EFFONDRE pour « relier » et « ranger », et la raison est dans le code du
 * serveur, pas dans la théorie :
 *
 *   `verifyMatch` teste une LONGUEUR puis une APPARTENANCE par élément. Pour
 *   quatre paires, TOUT multi-ensemble de taille quatre pris dans les paires
 *   correctes est accepté — la même bonne paire quatre fois comprise (laxisme
 *   D21). Ce sont 35 réponses acceptées, aux formes canoniques toutes
 *   différentes. Une empreinte unique en reconnaîtrait UNE.
 *
 *   `verifyDragDrop` ignore les clés en trop : le nombre de réponses acceptées
 *   est littéralement infini.
 *
 * L'appareil aurait donc compté FAUX des réponses que le serveur compte
 * JUSTE — et la divergence se serait vue en production, chez un enfant, une
 * fois les lots déjà distribués.
 *
 * ---------------------------------------------------------------------------
 * CE QUI MARCHE : L'EMPREINTE SUIT LA STRUCTURE DU VÉRIFICATEUR.
 *
 * On ne hache pas la réponse, on hache ses ATOMES. Le lot livre l'empreinte de
 * chaque atome acceptable, et l'appareil vérifie exactement ce que le serveur
 * vérifie :
 *
 *   | type          | atomes livrés                  | ce que l'appareil teste        |
 *   |---------------|--------------------------------|--------------------------------|
 *   | qcm           | l'indice correct               | l'atome soumis est connu       |
 *   | order         | la séquence entière            | idem                           |
 *   | short-answer  | chaque réponse acceptée        | idem                           |
 *   | match         | chaque paire correcte          | bon NOMBRE, et chacune connue  |
 *   | drag-drop     | chaque `étiquette -> zone`     | chacune posée, et connue       |
 *
 * Les deux laxismes de D21 sont alors reproduits GRATUITEMENT, parce qu'ils
 * découlent de la même structure : une paire répétée passe (elle est connue,
 * et le compte est bon), une clé en trop est ignorée (on ne regarde que les
 * étiquettes attendues).
 *
 * ---------------------------------------------------------------------------
 * UNE EMPREINTE SALÉE, PAS UN HMAC — et ce n'est pas un raccourci.
 *
 * Le plan disait HMAC. Un HMAC suppose une clé SECRÈTE ; or l'appareil doit
 * calculer l'empreinte hors ligne, donc il détient la clé. Un HMAC à clé
 * connue n'apporte rien sur un hachage salé : ce qu'il protège en plus
 * (l'extension de longueur) n'a aucun rôle ici. Ce serait du décorum.
 *
 * Ce que le sel achète VRAIMENT : qu'une même réponse ne donne pas la même
 * empreinte d'un exercice à l'autre, donc qu'on ne puisse pas reconnaître
 * « la réponse est 2 » en comparant deux lots. Ce qu'il n'achète pas est écrit
 * en D20 : sur un QCM à quatre options, quatre essais suffisent à trouver —
 * et le chemin EN LIGNE en accorde déjà cinq.
 * ---------------------------------------------------------------------------
 */

/** Sépare les champs d'un atome composite. Improbable dans un énoncé. */
const FIELD = "\u001f";

/**
 * Le type préfixe chaque atome.
 *
 * Sans lui, l'atome d'une réponse courte « 2 » et celui d'un QCM d'indice 2
 * seraient identiques : deux exercices de types différents partageraient une
 * empreinte, et l'un validerait la réponse de l'autre.
 */
function atom(type: ExerciseType, ...fields: string[]): string {
  return [type, ...fields].join(FIELD);
}

// ---------------------------------------------------------------------------
// CÔTÉ SERVEUR — les atomes à hacher et à livrer dans le lot.
// ---------------------------------------------------------------------------

interface QcmServer {
  correctIndex: number;
}
interface MatchServer {
  pairs: { left: string; right: string }[];
}
interface OrderServer {
  correctSequence: string[];
}
interface DragDropServer {
  items: { text: string; correctZone: string }[];
}
interface ShortAnswerServer {
  acceptedAnswers: string[];
}

export function serverAtoms(
  type: ExerciseType | string,
  payload: unknown,
): string[] {
  switch (type) {
    case "qcm":
      return [atom("qcm", String((payload as QcmServer).correctIndex))];
    case "order":
      return [atom("order", ...(payload as OrderServer).correctSequence)];
    case "short-answer":
      return (payload as ShortAnswerServer).acceptedAnswers.map((a) =>
        atom("short-answer", a.toLowerCase().trim()),
      );
    case "match":
      return (payload as MatchServer).pairs.map((p) =>
        atom("match", p.left, p.right),
      );
    case "drag-drop":
      return (payload as DragDropServer).items.map((it) =>
        atom("drag-drop", it.text, it.correctZone),
      );
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// CÔTÉ APPAREIL — les atomes que la réponse soumise doit faire reconnaître.
//
// `null` signifie « refusée sans même regarder les empreintes » : JSON
// illisible, mauvais nombre de paires, étiquette non posée. Ce sont les mêmes
// refus structurels que ceux du serveur, avant toute comparaison.
// ---------------------------------------------------------------------------

export function submittedAtoms(
  type: ExerciseType | string,
  clientPayload: unknown,
  submitted: string,
): string[] | null {
  try {
    switch (type) {
      case "qcm": {
        const index = parseInt(submitted, 10);
        // `verifyQcm` compare `parseInt(...) === correctIndex` : un NaN
        // n'égale rien, donc une saisie illisible est refusée, pas hachée.
        if (!Number.isFinite(index)) return null;
        return [atom("qcm", String(index))];
      }
      case "order": {
        const arr = JSON.parse(submitted) as string[];
        if (!Array.isArray(arr)) return null;
        return [atom("order", ...arr)];
      }
      case "short-answer":
        return [atom("short-answer", submitted.toLowerCase().trim())];
      case "match": {
        const arr = JSON.parse(submitted) as { left: string; right: string }[];
        if (!Array.isArray(arr)) return null;
        // La LONGUEUR d'abord, comme `verifyMatch`. La colonne de gauche du
        // payload client a autant d'entrées que `pairs` côté serveur.
        const expected = (clientPayload as MatchClientPayload).left.length;
        if (arr.length !== expected) return null;
        return arr.map((p) => atom("match", p.left, p.right));
      }
      case "drag-drop": {
        const map = JSON.parse(submitted) as Record<string, string>;
        if (map === null || typeof map !== "object") return null;
        const items = (clientPayload as DragDropClientPayload).items;
        const atoms: string[] = [];
        for (const it of items) {
          const zone = map[it.text];
          // `verifyDragDrop` échoue sur `map[text] !== correctZone`, et une
          // étiquette non posée vaut `undefined`. Les clés EN TROP ne sont
          // jamais regardées — laxisme D21, reproduit ici par construction.
          if (typeof zone !== "string") return null;
          atoms.push(atom("drag-drop", it.text, zone));
        }
        return atoms;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// L'empreinte
// ---------------------------------------------------------------------------

/** Ce qu'on hache réellement : le sel, puis l'atome. */
export function saltedInput(salt: string, atomValue: string): string {
  return `${salt}${FIELD}${atomValue}`;
}

/** Le hachage est INJECTÉ : `expo-crypto` sur l'appareil, Node dans les tests. */
export type DigestFn = (input: string) => Promise<string>;

/** Les empreintes à livrer dans le lot, pour un exercice. */
export async function buildDigests(
  type: ExerciseType | string,
  serverPayload: unknown,
  salt: string,
  digest: DigestFn,
): Promise<string[]> {
  const atoms = serverAtoms(type, serverPayload);
  return Promise.all(atoms.map((a) => digest(saltedInput(salt, a))));
}

/**
 * LE VERDICT DE L'APPAREIL.
 *
 * Il ne dit PAS la réponse et ne peut pas la lire : il reconnaît, ou non.
 * Et il ne fait pas autorité — ce qui se synchronise, ce sont les RÉPONSES,
 * que le serveur relit avec `verifyAnswer` (D12). Ceci ne sert qu'à montrer
 * la coche verte tout de suite.
 */
export async function verifyOffline(
  type: ExerciseType | string,
  clientPayload: unknown,
  submitted: string,
  digests: readonly string[],
  salt: string,
  digest: DigestFn,
): Promise<boolean> {
  const atoms = submittedAtoms(type, clientPayload, submitted);
  if (atoms === null || atoms.length === 0) return false;
  const known = new Set(digests);
  for (const a of atoms) {
    if (!known.has(await digest(saltedInput(salt, a)))) return false;
  }
  return true;
}
