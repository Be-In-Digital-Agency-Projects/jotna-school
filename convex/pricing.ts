/**
 * Barème d'abonnement des écoles — module PUR.
 *
 * Aucun import, aucune lecture de base : `schools.recordSubscription` passe un
 * nombre de sièges et reçoit un devis. Même découpage que `accessRules.ts`
 * (pur, testé) / `access.ts` (I/O), et pour une raison de plus ici : une règle
 * qui décide d'un MONTANT doit pouvoir être éprouvée sans base de données, et
 * le dépôt n'a pas `convex-test`.
 *
 * Spec : docs/superpowers/specs/2026-09-14-abonnement-ecoles-design.md §7
 */

/** Une tranche du barème : ses sièges s'arrêtent à `upToSeat`, inclus. */
interface PricingTier {
  /** Dernier siège de la tranche, inclus. La dernière tranche est infinie. */
  readonly upToSeat: number;
  /** Prix annuel de CHAQUE siège de cette tranche-là, jamais du contrat. */
  readonly pricePerSeatFcfa: number;
}

interface PricingScale {
  /** Sièges facturés au minimum, quel que soit l'effectif (spec §7.1). */
  readonly seatFloor: number;
  /** Tranches par bornes CROISSANTES, prix par siège non croissant. */
  readonly tiers: readonly PricingTier[];
}

/**
 * Le barème, en UNE constante — valeurs PROVISOIRES.
 *
 * Ces montants ne sont PAS confirmés par le client : la spec §7.3 les donne
 * pour une estimation de marché non vérifiée, et §7.4 rappelle que le coût
 * marginal réel n'a pas pu être calculé. Ce qui est décidé, c'est la STRUCTURE
 * — cumulative, à plancher, monotone ; les valeurs sont des hypothèses, et
 * cette constante est le seul endroit à éditer le jour où le propriétaire du
 * projet les tranche. Rien d'autre dans le dépôt ne porte un prix.
 *
 * Cumulative, « comme un barème d'impôt » : chaque tranche ne facture que ses
 * propres sièges. En prix de tranche unique appliqué à tout le contrat,
 * l'arithmétique se retourne — 100 × 3 000 = 300 000 contre
 * 101 × 2 400 = 242 400 — et acheter plus coûterait moins (spec §7.2). Un
 * directeur le trouverait.
 */
export const PRICING_SCALE: PricingScale = {
  seatFloor: 50,
  tiers: [
    { upToSeat: 100, pricePerSeatFcfa: 3000 },
    { upToSeat: 300, pricePerSeatFcfa: 2400 },
    { upToSeat: Number.POSITIVE_INFINITY, pricePerSeatFcfa: 1800 },
  ],
};

/** Ce que coûte un contrat, et sur combien de sièges il porte vraiment. */
export interface SubscriptionQuote {
  /**
   * Sièges réellement FACTURÉS, plancher appliqué — la valeur à écrire dans
   * `subscriptions.seatsPurchased`, et donc celle que le plafond
   * d'`schools.enrollStudent` fera respecter.
   */
  seatsBilled: number;
  /** Montant annuel. SEULE valeur qui fait foi pour la facturation (§7.2). */
  totalFcfa: number;
  /**
   * Tarif effectif moyen par siège facturé, arrondi à l'entier — le FCFA n'a
   * pas de sous-unité. À USAGE D'AFFICHAGE UNIQUEMENT (§7.2) : ne jamais
   * reconstituer un total en le multipliant par les sièges, l'arrondi rendrait
   * un montant qui n'est celui d'aucun barème.
   */
  pricePerSeatFcfa: number;
}

/**
 * Les sièges FACTURÉS pour un nombre de sièges demandé.
 *
 * Le plancher OUVRE les sièges qu'il facture : une école qui paie 50 sièges en
 * reçoit 50. La spec §7.1 dit « 50 sièges facturés minimum » sans trancher, et
 * l'autre lecture — facturer 50, n'en ouvrir que 30 — ferait payer un droit
 * qu'on ne donne pas, et rendrait un tarif moyen de 5 000 FCFA pour une école
 * du palier le moins cher : un prix par élève qui AUGMENTE quand l'effectif
 * baisse.
 *
 * Une demande absurde — négative, nulle, fractionnaire, NaN, infinie — ne vaut
 * AUCUN siège et aucun franc, plutôt que de se faire remonter au plancher : le
 * plancher est une règle commerciale sur de vrais contrats, pas une machine à
 * transformer une saisie erronée en facture de 150 000 FCFA. C'est aussi la
 * convention qu'applique déjà `schools.contractSeats` à une valeur de siège
 * illisible — zéro siège — et le seul sens sûr, puisqu'il ne peut jamais
 * surfacturer. `recordSubscription` refuse de toute façon ces entrées avant
 * d'arriver ici : ce repli est une seconde ligne, pas la première.
 */
function billedSeats(seatsRequested: number): number {
  if (!Number.isInteger(seatsRequested) || seatsRequested <= 0) return 0;
  return Math.max(seatsRequested, PRICING_SCALE.seatFloor);
}

/**
 * Le devis d'un contrat, à partir des sièges DEMANDÉS.
 *
 * Le prix ne se reçoit jamais en argument d'une mutation — un total fourni par
 * l'appelant serait un montant de facturation accepté sans contrôle. Il se
 * calcule ici, à partir du seul nombre de sièges, et `recordSubscription`
 * écrit ce que cette fonction rend.
 */
export function quoteSubscription(seatsRequested: number): SubscriptionQuote {
  const seatsBilled = billedSeats(seatsRequested);

  // Zéro siège facturé : zéro franc, et un tarif moyen de zéro plutôt qu'une
  // division par zéro. Un contrat sans siège n'a pas de prix par siège.
  if (seatsBilled === 0) {
    return { seatsBilled: 0, totalFcfa: 0, pricePerSeatFcfa: 0 };
  }

  let totalFcfa = 0;
  let seatsPriced = 0;
  for (const tier of PRICING_SCALE.tiers) {
    if (seatsPriced >= seatsBilled) break;
    const upTo = Math.min(seatsBilled, tier.upToSeat);
    totalFcfa += (upTo - seatsPriced) * tier.pricePerSeatFcfa;
    seatsPriced = upTo;
  }

  return {
    seatsBilled,
    totalFcfa,
    pricePerSeatFcfa: Math.round(totalFcfa / seatsBilled),
  };
}
