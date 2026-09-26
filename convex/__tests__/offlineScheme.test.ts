import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ATOM_SCHEME_VERSION,
  buildDigests,
  saltedInput,
  serverAtoms,
} from "../paliers/offline";

/**
 * LE SCELLÉ DU SCHÉMA D'ATOMES — tâche 6.7 du plan mobile.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE ALORS QUE `offline.test.ts` EXISTE DÉJÀ.
 *
 * Les tests croisés voisins posent la même question aux deux côtés et exigent
 * le même verdict. Ils sont excellents, et ils sont AVEUGLES À CE QUI SUIT :
 * ils construisent les empreintes ET les vérifient avec le MÊME code. Changez
 * le séparateur d'un atome, son préfixe de type, l'ordre de ses champs — les
 * deux côtés changent ensemble et tout reste vert.
 *
 * Or c'est exactement le changement qui casse la production.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE SCÉNARIO, EN ENTIER.
 *
 * Les empreintes d'un lot sont calculées par le SERVEUR au téléchargement, et
 * elles restent sur l'appareil jusqu'à quatorze jours. L'appareil, lui,
 * recalcule les atomes avec le code EMBARQUÉ DANS SON PAQUET. Une mise à jour
 * à chaud remplace ce code sans toucher aux lots déjà là.
 *
 * Si le schéma a bougé entre les deux, l'enfant répond juste et
 * l'application lui dit faux. Rien ne plante, aucun journal ne le signale, et
 * le serveur recalcule tout à la synchronisation — son score finira même par
 * être correct. Seul l'enfant aura passé l'après-midi à se croire nul.
 *
 * `ATOM_SCHEME_VERSION` empêche cela : elle voyage avec le lot, l'appareil
 * compare, un écart rend le lot injouable. Mais elle ne se lève pas toute
 * seule, et jusqu'ici RIEN n'obligeait à la lever — un commentaire disant
 * « pensez à incrémenter » n'est pas un garde, c'est un vœu.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER FAIT, ET COMMENT LE RÉPARER QUAND IL CASSE.
 *
 * Il fige les atomes ET leurs empreintes, en dur, pour un sel fixe. Ces
 * valeurs ont été calculées une fois puis recopiées : elles ne sont
 * RECALCULÉES PAR RIEN. C'est ce qui les rend capables de contredire le code.
 *
 * Si ce fichier casse, vous avez changé la forme canonique. Ce n'est pas une
 * erreur en soi — mais c'est un changement de contrat, et le réparer demande
 * DEUX gestes, jamais un seul :
 *
 *   1. lever `ATOM_SCHEME_VERSION` dans `paliers/offline.ts` ;
 *   2. lever `GOLDEN_SCHEME` ici, et remplacer les valeurs figées.
 *
 * Le premier test ci-dessous vérifie que les deux numéros s'accordent, ce qui
 * interdit les deux demi-gestes : changer la forme sans lever la version
 * (l'après-midi perdu), et lever la version sans changer la forme (chaque lot
 * du terrain jeté pour rien).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QU'IL NE PEUT PAS GARDER : `apps/mobile/src/offline/digest.ts`, qui
 * appelle `expo-crypto` et demande donc un appareil. Les empreintes figées
 * ici sont celles de Node. Les deux s'accordent parce que SHA-256 est
 * SHA-256 et que les deux rendent de l'hexadécimal minuscule — le jour où
 * quelqu'un touche à cet encodage, aucun test ne le dira.
 */

/**
 * Le sel du jeu d'épreuve. Il est FIGÉ : en changer la valeur change les
 * quarante-huit chiffres de chaque empreinte ci-dessous. Il n'a rien à voir
 * avec les sels de production, dérivés par `saltFor`.
 */
const SALT = "sel-du-scheme-v1";

/** La version de schéma que les valeurs de ce fichier décrivent. */
const GOLDEN_SCHEME = 1;

const digest = async (input: string): Promise<string> =>
  createHash("sha256").update(input, "utf8").digest("hex");

interface GoldenCase {
  readonly type: string;
  readonly serverPayload: Record<string, unknown>;
  /** La forme canonique exacte, séparateurs compris. */
  readonly atoms: readonly string[];
  /** SHA-256 de `saltedInput(SALT, atome)`, en hexadécimal minuscule. */
  readonly digests: readonly string[];
}

const GOLDEN: readonly GoldenCase[] = [
  {
    type: "qcm",
    serverPayload: { correctIndex: 2, options: ["a", "b", "c", "d"] },
    atoms: ["qcm\u001f2"],
    digests: [
      "bc249e12769e04cf361de45e05211515d78f9ea56dbb0429deadbf8a0078fdfc",
    ],
  },
  {
    type: "order",
    serverPayload: { correctSequence: ["Lundi", "Mardi", "Mercredi"] },
    atoms: ["order\u001fLundi\u001fMardi\u001fMercredi"],
    digests: [
      "2b9e6e1be4586ad3d86e01a4984484b4a4d8367df60b52f3a5450963d44f2fc8",
    ],
  },
  {
    // La casse et les espaces sont MANGÉS ici, comme `verifyShortAnswer` les
    // mange. Deux réponses acceptées qui se ramènent au même atome livrent
    // donc deux empreintes identiques — c'est le comportement actuel, et le
    // figer le rend visible plutôt que surprenant.
    type: "short-answer",
    serverPayload: { acceptedAnswers: ["Dakar", "  NDAKAARU  "] },
    atoms: ["short-answer\u001fdakar", "short-answer\u001fndakaaru"],
    digests: [
      "90f6897f2c97c4519e08eacc08217290bc2b52bbef280343eefa4262eb8e1cd5",
      "a802119a417862c0f12393cb1805f1bf6c5849f39947a0d0cdfe81abcdf85f92",
    ],
  },
  {
    type: "match",
    serverPayload: {
      pairs: [
        { left: "chat", right: "miaule" },
        { left: "chien", right: "aboie" },
      ],
    },
    atoms: ["match\u001fchat\u001fmiaule", "match\u001fchien\u001faboie"],
    digests: [
      "06fb7baa0f91346bbb758411bf7dfc7e88f2e28cf12678e81213d560e76da678",
      "91df7a6f491b4782160c49a8accfa296687eb5941341cd374594cea7389b1669",
    ],
  },
  {
    // « légumes » porte un accent DÉLIBÉRÉMENT : il fige l'encodage de
    // l'entrée hachée. Un passage en latin-1, ou une normalisation Unicode
    // glissée dans la chaîne, changerait l'empreinte sans changer le texte
    // affiché — et le français d'une application sénégalaise en est plein.
    type: "drag-drop",
    serverPayload: {
      items: [
        { text: "pomme", correctZone: "fruits" },
        { text: "carotte", correctZone: "légumes" },
      ],
    },
    atoms: [
      "drag-drop\u001fpomme\u001ffruits",
      "drag-drop\u001fcarotte\u001flégumes",
    ],
    digests: [
      "ab313ffebe2ddb559e36dc8892cb5c848de086c6c6142d23504b06432959199b",
      "6dc042f6ec1a85cebe93b4b0c2d457a62cafc5bf25d21fa325785fb22b8f6221",
    ],
  },
];

describe("le scellé du schéma d'atomes", () => {
  it("la version du code est celle que ce fichier décrit", () => {
    expect(
      ATOM_SCHEME_VERSION,
      "ATOM_SCHEME_VERSION et GOLDEN_SCHEME ont divergé. Les deux se lèvent " +
        "ENSEMBLE, et seulement quand la forme canonique change : la lever " +
        "seule jette tous les lots du terrain, l'oublier fait dire « faux » " +
        "à des réponses justes.",
    ).toBe(GOLDEN_SCHEME);
  });

  describe.each(GOLDEN)("$type", (golden) => {
    it("les atomes gardent leur forme exacte", () => {
      expect(serverAtoms(golden.type, golden.serverPayload)).toEqual(
        golden.atoms,
      );
    });

    it("les empreintes livrées n'ont pas bougé", async () => {
      expect(
        await buildDigests(golden.type, golden.serverPayload, SALT, digest),
      ).toEqual(golden.digests);
    });

    it("chaque empreinte est bien celle de l'atome salé", async () => {
      // Ce que le test précédent vérifie de bout en bout, celui-ci le
      // décompose : si les deux cassent ensemble, la forme de l'atome a
      // changé ; si seul le précédent casse, c'est `serverAtoms` qui n'en
      // produit plus le même nombre ou plus le même ordre.
      for (const [i, atom] of golden.atoms.entries()) {
        expect(await digest(saltedInput(SALT, atom))).toBe(golden.digests[i]);
      }
    });
  });

  it("le texte accentué du jeu d'épreuve est en forme NFC", () => {
    // Sans cela, un éditeur qui normalise le fichier en NFD ferait échouer
    // les empreintes de « légumes » avec un message incompréhensible : deux
    // chaînes qui s'affichent à l'identique et ne se hachent pas pareil.
    const accented = "légumes";
    expect(accented).toBe(accented.normalize("NFC"));
    expect(accented).toHaveLength(7);
  });
});
