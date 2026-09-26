import {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  digestStringAsync,
} from "expo-crypto";

import type { DigestFn } from "@convex/paliers/offline";

/**
 * L'empreinte SHA-256 de l'appareil.
 *
 * ELLE DOIT RENDRE EXACTEMENT CE QUE LE SERVEUR REND. Là-bas c'est
 * `crypto.subtle` et un encodage hexadécimal MINUSCULE
 * (`convex/paliers/digest.ts`) ; ici c'est `expo-crypto`, avec
 * `CryptoEncoding.HEX` — qui rend également des minuscules. SHA-256 étant
 * SHA-256, les deux s'accordent sur la même entrée.
 *
 * SI CE CONTRAT SE ROMPAIT — un encodage en base64, des majuscules — le
 * symptôme serait « l'enfant a TOUT faux hors ligne », qui n'oriente vers
 * rien. Les tests croisés de `convex/__tests__/offline.test.ts` gardent le
 * schéma ; ce qu'ils ne peuvent pas garder, c'est cette fonction-ci, qui a
 * besoin d'un appareil. Le jour où quelqu'un la touche, c'est le premier
 * endroit à vérifier.
 */
export const deviceDigest: DigestFn = async (input: string): Promise<string> =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, input, {
    encoding: CryptoEncoding.HEX,
  });
