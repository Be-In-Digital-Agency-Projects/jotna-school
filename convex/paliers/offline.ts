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
 *   `verifyMatch` compare des MULTI-ENSEMBLES de paires. Pour quatre paires,
 *   les 24 permutations sont toutes acceptables, et leurs formes canoniques
 *   sont toutes différentes. Une empreinte unique en reconnaîtrait UNE.
 *
 *   `verifyDragDrop` accepte de même tout ordre de clés dans l'objet soumis.
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
 *   | match         | chaque paire correcte          | permutation exacte des paires  |
 *   | drag-drop     | chaque `étiquette -> zone`     | exactement les étiquettes dues |
 *
 * CE QUE LA STRUCTURE NE SUFFIT PAS À DIRE : « chaque atome attendu servi UNE
 * FOIS ». Reconnaître chaque atome soumis laisserait passer la même bonne
 * paire quatre fois — c'était le laxisme D21, et le serveur l'avait aussi.
 * Les deux l'ont perdu ensemble : `atomMatch` plus bas distingue les types où
 * UN atome connu suffit de ceux où il faut l'ÉGALITÉ DE MULTI-ENSEMBLE avec
 * les empreintes livrées. C'est la contrepartie exacte, atome pour atome, des
 * vérificateurs resserrés de `answers.ts`.
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

/**
 * LA VERSION DU SCHÉMA D'ATOMES — tâche 6.7, décision D21.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE DANGER QU'ELLE DÉSAMORCE, ET IL EST SILENCIEUX.
 *
 * Les empreintes d'un lot sont calculées PAR LE SERVEUR, au téléchargement,
 * avec le code d'atomisation de ce jour-là. L'appareil, lui, recalcule les
 * atomes de la réponse de l'enfant avec le code EMBARQUÉ DANS SON PAQUET.
 * Tant que les deux coïncident, tout va bien.
 *
 * Une mise à jour à chaud (`expo-updates`) remplace le code de l'appareil sans
 * toucher aux lots déjà téléchargés. Qu'elle change la moindre chose à la
 * manière de construire un atome — un `trim()` en plus, une séparation
 * différente, un `toLowerCase()` retiré — et l'appareil se met à calculer des
 * atomes que les empreintes livrées ne reconnaissent plus.
 *
 * LA PANNE NE RESSEMBLE PAS À UNE PANNE. Rien ne plante : l'enfant répond
 * juste, l'application lui dit faux, et il recommence. Personne ne voit la
 * cause, ni sur l'appareil, ni dans les journaux — le serveur, lui, recalcule
 * tout à la synchronisation et comptera les bonnes réponses, ce qui fait que
 * même le score finit par être juste. Seul l'enfant aura passé l'après-midi à
 * se croire nul.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * QUAND LA BOUGER — et il vaut mieux la bouger pour rien que l'oublier une
 * fois. Tout changement de :
 *
 *   • `serverAtoms` ou `submittedAtoms` (les fonctions ci-dessous) ;
 *   • la forme d'un atome, son préfixe de type, son séparateur ;
 *   • `saltedInput` ;
 *   • la canonicalisation employée par les vérificateurs de
 *     `paliers/answers.ts`, que les atomes reproduisent.
 *
 * Le lot porte cette version, l'appareil compare avec la sienne, et un écart
 * rend le lot INJOUABLE — exactement comme un bail expiré. L'enfant est
 * renvoyé vers « prépare-le quand tu auras du réseau », ce qui est
 * désagréable et honnête, là où le laisser jouer serait confortable et faux.
 */
export const ATOM_SCHEME_VERSION = 2;

/**
 * COMMENT les atomes soumis se comparent aux empreintes livrées, PAR TYPE.
 *
 * `"any"` — un atome connu suffit. L'exercice admet plusieurs réponses, et la
 * liste d'empreintes les énumère : une réponse courte a ses formes acceptées,
 * un QCM sa bonne option. Le lot livre N empreintes, l'appareil en soumet UNE.
 *
 * `"all"` — il faut l'ÉGALITÉ DE MULTI-ENSEMBLE. L'exercice n'admet qu'une
 * réponse, mais elle s'exprime en PLUSIEURS atomes, un par paire ou par
 * étiquette. Le lot livre N empreintes, l'appareil en soumet N, et les deux
 * multi-ensembles doivent coïncider. C'est ce qui interdit la même bonne paire
 * répétée : son empreinte est connue, mais elle n'est livrée qu'une fois.
 *
 * SE TROMPER DE MODE NE SE VOIT PAS EN LISANT. Mettre `match` en `"any"` rend
 * l'appareil plus laxiste que le serveur, donc l'enfant voit une coche verte
 * puis perd l'étoile à la synchronisation. Le scellé
 * (`convex/__tests__/offlineScheme.test.ts`) fige donc aussi ce tableau-ci, et
 * pas seulement la forme des atomes.
 */
export type AtomMatch = "any" | "all";

export function atomMatch(type: ExerciseType | string): AtomMatch {
  switch (type) {
    case "match":
    case "drag-drop":
      return "all";
    default:
      return "any";
  }
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
        const raw: unknown = JSON.parse(submitted);
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
          return null;
        }
        // `Object.entries` ne rend que les propriétés PROPRES — même raison
        // que côté serveur : une clé `toString` ne doit pas emprunter sa
        // valeur au prototype.
        const placed = new Map(Object.entries(raw as Record<string, unknown>));
        const items = (clientPayload as DragDropClientPayload).items;
        // LE COMPTE D'ABORD, comme `verifyDragDrop` : une clé en trop est
        // désormais un refus STRUCTUREL, avant toute empreinte. Le compte se
        // fait sur les étiquettes DISTINCTES, deux éléments au même texte ne
        // pouvant produire qu'une clé.
        const expected = new Set(items.map((it) => it.text));
        if (placed.size !== expected.size) return null;
        const atoms: string[] = [];
        for (const it of items) {
          const zone = placed.get(it.text);
          // Une étiquette non posée vaut `undefined` : refus, comme le
          // serveur qui compare à `correctZone`.
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

  const submittedDigests = await Promise.all(
    atoms.map((a) => digest(saltedInput(salt, a))),
  );

  if (atomMatch(type) === "any") {
    const known = new Set(digests);
    return submittedDigests.every((d) => known.has(d));
  }

  // `"all"` — ÉGALITÉ DE MULTI-ENSEMBLE, et non d'ensemble : chaque empreinte
  // livrée est consommée une fois. C'est ici, et nulle part ailleurs, que la
  // même bonne paire répétée se fait refuser.
  if (submittedDigests.length !== digests.length) return false;
  const remaining = new Map<string, number>();
  for (const d of digests) remaining.set(d, (remaining.get(d) ?? 0) + 1);
  for (const d of submittedDigests) {
    const left = remaining.get(d);
    if (left === undefined || left === 0) return false;
    remaining.set(d, left - 1);
  }
  return true;
}
