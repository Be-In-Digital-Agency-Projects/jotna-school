/**
 * Numéro, intitulés et montants d'une facture — fonctions pures, sans import.
 *
 * Même découpage que `billingRules`, `accountRules` et `importCodes`, et pour la
 * même raison : ce dépôt n'utilise pas `convex-test` et vitest tourne en
 * `jsdom`, donc un handler Convex n'est pas testable directement. Ce qui décide
 * vit ici ; les enveloppes Convex lisent, écrivent et envoient.
 *
 * CE MODULE NE CONNAÎT NI BASE NI HORLOGE. La séquence lui est DONNÉE : elle se
 * lit en base, sous transaction, et une fonction pure qui prétendrait
 * l'attribuer mentirait — deux appels concurrents rendraient le même numéro.
 */

// ---------------------------------------------------------------------------
// Numérotation
// ---------------------------------------------------------------------------

/**
 * Le numéro affiché d'une facture — forme `FAC-2026-0001`.
 *
 * SÉQUENTIEL PAR ANNÉE, SANS TROU, et ce n'est pas une préférence de style :
 * une facture sénégalaise se numérote de façon chronologique et continue. Le
 * numéro se compose donc de l'année d'émission et d'un rang qui repart à 1 le
 * 1er janvier — et le rang est ALLOUÉ EN BASE, dans la transaction qui solde la
 * tranche, jamais tiré au sort ni dérivé d'un identifiant.
 *
 * QUATRE CHIFFRES, soit 9 999 factures par an. Une école règle trois tranches ;
 * ce plafond tient jusqu'à trois mille écoles clientes, et le dépassement
 * s'écrit sur cinq chiffres sans casser l'ordre lexicographique de ce qui
 * précède.
 */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `FAC-${year}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Le rang de la prochaine facture de l'année.
 *
 * `lastSequence` vaut `null` quand l'année n'a encore rien émis — premier
 * janvier, ou premier encaissement du déploiement. Elle repart alors à 1.
 */
export function nextSequence(lastSequence: number | null | undefined): number {
  if (lastSequence === null || lastSequence === undefined) return 1;
  return lastSequence + 1;
}

// ---------------------------------------------------------------------------
// Identité de l'émetteur
// ---------------------------------------------------------------------------

export type IssuerIdentity = {
  name: string;
  ninea: string;
  address: string;
  email: string;
};

export type IssuerCheck =
  | { ok: true; issuer: IssuerIdentity }
  | { ok: false; missing: string[] };

/**
 * L'identité de celui qui ÉMET la facture, ou la liste de ce qui manque.
 *
 * ELLE NE S'INVENTE PAS, ET SON ABSENCE EMPÊCHE L'ENVOI. Une facture porte la
 * raison sociale et le NINEA de l'émetteur — le schéma le note déjà pour celui
 * du client (`schools.ninea`, « identifiant fiscal SN, requis sur la
 * facture »). Un document envoyé à une école sans ces mentions n'est pas une
 * facture : c'est un courriel qui en a l'air, et l'école ne pourra ni le
 * comptabiliser ni le produire à un contrôle.
 *
 * ELLE VIENT DE L'ENVIRONNEMENT parce qu'elle diffère par déploiement — une
 * préproduction ne facture pas sous la même raison sociale qu'une production —
 * et qu'elle n'a pas à vivre dans le dépôt.
 *
 * REND LA LISTE DE CE QUI MANQUE plutôt qu'un booléen : l'adulte qui lit le
 * journal doit savoir quelle variable poser, pas seulement que « ce n'est pas
 * configuré ».
 */
export function checkIssuer(env: {
  name?: string;
  ninea?: string;
  address?: string;
  email?: string;
}): IssuerCheck {
  const missing: string[] = [];
  if (!env.name || env.name.trim() === "") missing.push("INVOICE_ISSUER_NAME");
  if (!env.ninea || env.ninea.trim() === "") missing.push("INVOICE_ISSUER_NINEA");
  if (!env.address || env.address.trim() === "") {
    missing.push("INVOICE_ISSUER_ADDRESS");
  }
  if (!env.email || env.email.trim() === "") {
    missing.push("INVOICE_ISSUER_EMAIL");
  }
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    issuer: {
      name: env.name!.trim(),
      ninea: env.ninea!.trim(),
      address: env.address!.trim(),
      email: env.email!.trim(),
    },
  };
}

/** La phrase du journal quand l'identité de l'émetteur n'est pas posée. */
export function issuerMissingMessage(missing: string[]): string {
  return (
    "Facture non envoyée : l'identité de l'émetteur n'est pas configurée sur ce " +
    `déploiement (${missing.join(", ")}). La facture est enregistrée et pourra ` +
    "être renvoyée une fois ces variables posées avec `npx convex env set`."
  );
}

// ---------------------------------------------------------------------------
// Montants et intitulés
// ---------------------------------------------------------------------------

/**
 * Un montant en francs CFA, tel qu'il s'écrit sur une facture.
 *
 * LES DEUX ESPACES SONT INSÉCABLES, ET ÉCRITES PAR ÉCHAPPEMENT. `\u202f`, fine
 * insécable, sépare les milliers ; `\u00a0`, insécable, précède l'unité. C'est
 * l'usage typographique français, et surtout : un montant coupé en fin de ligne
 * par un client de messagerie se relit mal, or une facture se relit à voix haute
 * au téléphone.
 *
 * ÉCRITES `\u202f` ET NON TAPÉES. Ces deux caractères sont invisibles dans un
 * éditeur : posés en clair, un copier-coller, un reformatage ou un collègue qui
 * retape la ligne les remplace par une espace ordinaire sans que personne le
 * voie, et la mise en page casse silencieusement. L'échappement rend
 * l'intention lisible et la rupture impossible.
 *
 * PAS DE DÉCIMALES : le franc CFA n'a pas de subdivision en usage. Un montant
 * fractionnaire arrivant ici serait un bug de calcul ailleurs, et l'arrondi le
 * masquerait — il est donc tronqué, et `pricing` garantit déjà des entiers.
 */
export const THOUSANDS_SEPARATOR = "\u202f";
export const UNIT_SEPARATOR = "\u00a0";

export function formatFcfa(amount: number): string {
  const whole = Math.trunc(amount);
  const grouped = String(Math.abs(whole)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    THOUSANDS_SEPARATOR,
  );
  return `${whole < 0 ? "-" : ""}${grouped}${UNIT_SEPARATOR}FCFA`;
}

/**
 * L'intitulé de la ligne facturée.
 *
 * IL DIT CE QUI EST PAYÉ, ET SUR QUELLE PÉRIODE. « Tranche 2 sur 3 » seule
 * laisserait l'école chercher de quel contrat il s'agit ; la période la situe
 * sans qu'elle ait à ouvrir son dossier.
 */
export function invoiceLineLabel(input: {
  index: number;
  total: number;
  seats: number;
  periodStart: string;
  periodEnd: string;
}): string {
  return (
    `Abonnement Jotna School — tranche ${input.index} sur ${input.total}, ` +
    `${input.seats} sièges, période du ${input.periodStart} au ${input.periodEnd}`
  );
}

/** La date telle qu'elle s'écrit sur une facture française : 17/09/2026. */
export function formatInvoiceDate(timestamp: number): string {
  const d = new Date(timestamp);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}
