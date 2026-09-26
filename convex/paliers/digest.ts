import { saltedInput, type DigestFn } from "./offline";

/**
 * L'empreinte SHA-256 d'un texte, en hexadécimal minuscule.
 *
 * `crypto.subtle` est disponible dans l'exécution Convex — vérifié dans ce
 * dépôt même, `billingRules.sha512Hex` s'en sert déjà — et dans
 * l'environnement de test. Sur l'appareil, c'est `expo-crypto` qui calcule ;
 * seule compte la propriété « même entrée, même sortie », que les deux
 * tiennent puisque SHA-256 est SHA-256.
 *
 * LA FORME HEXADÉCIMALE MINUSCULE EST LE CONTRAT entre les deux côtés. Un
 * encodage qui différerait — base64, majuscules — ferait échouer TOUTES les
 * comparaisons, et le symptôme serait « l'enfant a tout faux hors ligne »,
 * ce qui n'oriente vers rien.
 */
export const sha256Hex: DigestFn = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Le sel d'un exercice — DÉRIVÉ, pas tiré au hasard.
 *
 * POURQUOI CE N'EST PAS UN AFFAIBLISSEMENT. Le sel ne protège rien à lui seul :
 * il part dans le lot, sur l'appareil, en clair. Ce qu'il achète est une seule
 * chose, écrite en D11 — qu'une même réponse ne donne pas la même empreinte
 * d'un exercice à l'autre, donc qu'on ne puisse pas reconnaître « la réponse
 * est 2 » en comparant deux lots. Un sel dérivé de la tentative ET de
 * l'exercice donne exactement cette propriété : il est unique pour chaque
 * couple.
 *
 * POURQUOI C'EST PRÉFÉRABLE À UN TIRAGE. Une mutation Convex est une
 * transaction qui peut être REJOUÉE. Un sel tiré au hasard devrait être
 * persisté pour que le rejeu ne change pas les empreintes déjà livrées ; un sel
 * dérivé est le même à chaque rejeu, sans rien écrire. C'est le même choix que
 * `sanitizePayload` fait déjà pour son mélange (`${attemptId}:${exerciseId}`,
 * Décision 75) — et le mélange et les empreintes DOIVENT vivre la même vie,
 * puisqu'ils décrivent le même exercice tel que l'enfant l'a vu.
 */
export function saltFor(attemptId: string, exerciseId: string): string {
  return `${attemptId}:${exerciseId}:offline`;
}

/** Réexport, pour que l'appelant n'ait pas à connaître `offline.ts`. */
export { saltedInput };
