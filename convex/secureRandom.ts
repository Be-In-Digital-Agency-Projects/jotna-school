/**
 * Tirage aléatoire pour ce qui est un SECRET.
 *
 * `Math.random()` NE CONVIENT PAS, et CodeQL a raison de le refuser. Le
 * générateur de V8 est un xorshift dont l'état interne se reconstitue à partir
 * de quelques sorties consécutives : qui obtient deux ou trois codes — le
 * billet de son propre enfant suffit — peut calculer ceux qui ont été tirés
 * juste avant et juste après. Or ces valeurs-là ouvrent des comptes d'enfants
 * et des dossiers scolaires.
 *
 * `crypto.getRandomValues` EST DISPONIBLE DANS L'EXÉCUTION CONVEX, vérifié et
 * non supposé : `@convex-dev/auth` l'appelle directement pour fabriquer ses
 * propres jetons (`dist/server/implementation/utils.js`), et ce code tourne
 * dans le même isolat que les fonctions de ce dépôt.
 *
 * LE TIRAGE EST DÉCOUPÉ EN DEUX pour rester testable : `uniformInt` est pure et
 * reçoit sa source d'entropie ; `secureRandomInt` la branche sur le vrai
 * générateur. Même découpage que partout ailleurs dans ce dépôt — ce qui décide
 * est pur, ce qui lit le monde est une enveloppe mince.
 */

/** Une source de 32 bits non signés. */
export type Uint32Source = () => number;

const UINT32_RANGE = 0x100000000;

/**
 * Un entier uniforme dans `[0, range)`, SANS biais de modulo.
 *
 * `x % range` n'est PAS uniforme quand `range` ne divise pas 2³² : les petites
 * valeurs sortent un peu plus souvent que les grandes. Sur un code à quatre
 * chiffres le biais est infime, mais il se mesure — et un générateur de secrets
 * dont on sait que certaines valeurs sont plus probables est un générateur
 * qu'on n'a pas le droit d'appeler uniforme.
 *
 * ON REJETTE DONC LA QUEUE. Seules les valeurs sous le plus grand multiple de
 * `range` inférieur à 2³² sont retenues ; les autres sont retirées. L'espérance
 * du nombre de tirages reste inférieure à deux, quelle que soit la plage.
 */
export function uniformInt(range: number, next: Uint32Source): number {
  if (!Number.isInteger(range) || range <= 0) {
    throw new Error("uniformInt: plage invalide");
  }
  if (range === 1) return 0;

  const limit = Math.floor(UINT32_RANGE / range) * range;
  // Borne de sécurité : une source dégénérée qui rendrait toujours la même
  // valeur hors limite boucherait l'appel à l'infini. Mille essais, c'est
  // une probabilité de l'ordre de 2⁻¹⁰⁰⁰ pour une vraie source.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const x = next();
    if (x < limit) return x % range;
  }
  throw new Error("uniformInt: source d'entropie inexploitable");
}

/** 32 bits pris au générateur cryptographique de l'exécution. */
function cryptoUint32(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0];
}

/** Un entier uniforme dans `[minInclusive, maxInclusive]`, tiré sûrement. */
export function secureRandomInt(
  minInclusive: number,
  maxInclusive: number,
): number {
  return minInclusive + uniformInt(maxInclusive - minInclusive + 1, cryptoUint32);
}

/** Une chaîne de `length` symboles tirés uniformément dans `alphabet`. */
export function secureRandomString(length: number, alphabet: string): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet.charAt(secureRandomInt(0, alphabet.length - 1));
  }
  return out;
}
