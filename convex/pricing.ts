/**
 * Barème d'abonnement des écoles — module PUR.
 *
 * Aucun import, aucune lecture de base : `schools.recordSubscription` passe un
 * nombre de sièges et reçoit un devis, `schools.amendSeats` passe le contrat
 * qu'il vient de lire et reçoit le prorata. Même découpage que `accessRules.ts`
 * (pur, testé) / `access.ts` (I/O), et pour une raison de plus ici : une règle
 * qui décide d'un MONTANT doit pouvoir être éprouvée sans base de données, et
 * le dépôt n'a pas `convex-test`.
 *
 * Spec : docs/superpowers/specs/2026-09-14-abonnement-ecoles-design.md §7
 */

/** Une tranche du barème : ses sièges s'arrêtent à `upToSeat`, inclus. */
export interface PricingTier {
  /** Dernier siège de la tranche, inclus. La dernière tranche est infinie. */
  readonly upToSeat: number;
  /** Prix annuel de CHAQUE siège de cette tranche-là, jamais du contrat. */
  readonly pricePerSeatFcfa: number;
}

export interface PricingScale {
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
 * marginal réel n'a pas pu être calculé.
 *
 * TARIF RETENU — 5 000 FCFA par élève et par année scolaire, décidé par le
 * propriétaire du projet, et provisoire de son propre aveu (« pour le
 * moment »). Une seule tranche, donc un prix plat : c'est le barème en
 * vigueur, et cette constante est le seul endroit du dépôt qui porte un prix.
 *
 * POURQUOI LE MOTEUR CUMULATIF RESTE, avec une seule tranche à nourrir. Le
 * calcul par tranches ne coûte rien tant qu'il n'y en a qu'une, et il rend le
 * retour à un barème dégressif éditable ici, sans toucher une ligne de logique.
 * Surtout, le piège qu'il évite redevient réel à la SECONDE tranche : en prix
 * de tranche unique appliqué à tout le contrat, 101 × 2 400 = 242 400 coûterait
 * MOINS que 100 × 3 000 = 300 000, et acheter plus reviendrait moins cher
 * (§7.2). Le supprimer aujourd'hui reviendrait à le réécrire, moins bien, le
 * jour où une remise au volume sera consentie. Les tests du moteur tournent
 * d'ailleurs sur un barème dégressif de démonstration, pour qu'il reste couvert
 * pendant qu'il dort.
 */
export const PRICING_SCALE: PricingScale = {
  seatFloor: 30,
  tiers: [{ upToSeat: Number.POSITIVE_INFINITY, pricePerSeatFcfa: 5000 }],
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
 * Le plancher OUVRE les sièges qu'il facture : une école qui paie le plancher
 * en reçoit autant. La spec §7.1 pose un minimum facturé sans trancher ce que
 * l'école reçoit, et l'autre lecture — facturer le plancher, n'en ouvrir que
 * l'effectif réel — ferait payer un droit qu'on ne donne pas, et rendrait un
 * tarif moyen supérieur au tarif affiché pour une école
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
function billedSeats(seatsRequested: number, scale: PricingScale): number {
  if (!Number.isInteger(seatsRequested) || seatsRequested <= 0) return 0;
  return Math.max(seatsRequested, scale.seatFloor);
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
  return quoteWithScale(seatsRequested, PRICING_SCALE);
}

/**
 * Le moteur, sur un barème passé en argument. Existe pour que le calcul
 * cumulatif reste TESTÉ alors que le barème en vigueur n'a qu'une tranche : les
 * tests lui donnent un barème dégressif de démonstration.
 *
 * LA PRODUCTION NE L'APPELLE JAMAIS AVEC AUTRE CHOSE QUE `PRICING_SCALE`, et
 * aucun barème ne doit jamais venir d'un argument de mutation : ce serait un
 * prix fourni par l'appelant, précisément le trou que `recordSubscription`
 * existe pour fermer en calculant le montant au lieu de le recevoir.
 */
export function quoteWithScale(
  seatsRequested: number,
  scale: PricingScale,
): SubscriptionQuote {
  const seatsBilled = billedSeats(seatsRequested, scale);

  // Zéro siège facturé : zéro franc, et un tarif moyen de zéro plutôt qu'une
  // division par zéro. Un contrat sans siège n'a pas de prix par siège.
  if (seatsBilled === 0) {
    return { seatsBilled: 0, totalFcfa: 0, pricePerSeatFcfa: 0 };
  }

  let totalFcfa = 0;
  let seatsPriced = 0;
  for (const tier of scale.tiers) {
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

// ---------------------------------------------------------------------------
// AVENANT DE SIÈGES — faire grossir un contrat DÉJÀ SIGNÉ, au prorata.
//
// Une école qui recrute vingt élèves en février ne peut pas attendre la
// rentrée suivante, et un second contrat de février à juillet est précisément
// ce que l'invariant de disjointness interdit (spec §4.5) : deux contrats qui
// se croisent, et la lecture en UN document qui décide de l'accès de chaque
// enfant devient fausse. L'avenant fait grossir le contrat existant sans
// toucher à ses dates — la disjointness est alors INCHANGÉE, puisque rien ne
// bouge de ce sur quoi elle porte.
//
// Le calcul vit ici, avec le reste du barème, et pour la même raison : une
// règle qui décide d'un MONTANT doit pouvoir être éprouvée sans base de
// données. `schools.amendSeats` lui passe le contrat qu'il vient de lire et
// écrit ce qu'elle rend.
// ---------------------------------------------------------------------------

/** Ce que `schools.amendSeats` lit du contrat, et ce que l'école demande. */
export interface SeatAmendmentInput {
  /** Sièges que le contrat ouvre AUJOURD'HUI (`subscriptions.seatsPurchased`). */
  readonly currentSeats: number;
  /** Ce qui a déjà été facturé (`subscriptions.totalFcfa`), et qui fait foi. */
  readonly currentTotalFcfa: number;
  /** Le nouveau nombre TOTAL de sièges demandé — jamais le nombre ajouté. */
  readonly newSeats: number;
  /** L'instant de l'acte. Un seul, pour la part restante et pour la trace. */
  readonly now: number;
  /** Début du contrat, tel qu'il est en base — l'avenant n'y touche pas. */
  readonly startsAt: number;
  /** Fin du contrat, telle qu'elle est en base — l'avenant n'y touche pas. */
  readonly endsAt: number;
}

/** Ce qu'un avenant change au contrat, et ce qu'il coûte à l'école. */
export interface SeatAmendmentQuote {
  /** Sièges facturés APRÈS l'avenant — la valeur à écrire dans `seatsPurchased`. */
  seatsBilled: number;
  /**
   * Sièges réellement AJOUTÉS. Zéro veut dire « cet avenant n'ajoute rien » —
   * une baisse, une égalité, ou une demande illisible — et rien ne doit alors
   * être écrit : `seatsBilled` vaut l'existant et `amountFcfa` vaut zéro.
   */
  seatsAdded: number;
  /** Ce que ces sièges coûteraient sur la période ENTIÈRE, avant prorata. */
  fullTermDeltaFcfa: number;
  /** Part de la période qui reste à courir, bornée à [0, 1]. */
  remainingShare: number;
  /** Ce qui s'AJOUTE au total — arrondi, le FCFA n'a pas de sous-unité. */
  amountFcfa: number;
  /** Le nouveau `totalFcfa` : ancien + `amountFcfa`. Fait foi (§7.2). */
  totalFcfa: number;
  /**
   * Tarif moyen après avenant, MIXTE — des sièges payés sur une année pleine,
   * d'autres sur une fraction d'année. À usage d'affichage uniquement (§7.2),
   * comme celui de `quoteWithScale` : ne jamais en reconstituer un total.
   */
  pricePerSeatFcfa: number;
}

/**
 * La part de la période qui reste à courir, BORNÉE À [0, 1].
 *
 * La borne haute n'est pas décorative : un contrat qui n'a pas encore commencé
 * donne `now < startsAt`, donc un rapport supérieur à 1, et l'école se verrait
 * facturer PLUS qu'une année pleine pour des sièges qu'elle n'a pas encore
 * commencé à consommer. Bornée à 1, elle paie exactement le plein tarif de ce
 * qu'elle ajoute — ce qui est juste, le contrat lui étant tout entier devant.
 * Et ce n'est plus un cas d'école : `schools.amendSeats` amende le prochain
 * contrat à commencer quand aucun ne court, donc cette borne-là est une
 * PREMIÈRE ligne, pas une seconde.
 *
 * La borne basse tient le contrat échu : un `endsAt` dépassé rendrait une part
 * NÉGATIVE, donc un avoir silencieux retranché du total déjà facturé. Zéro,
 * jamais moins. `schools.amendSeats` refuse de toute façon d'amender un
 * contrat échu, qui n'ouvrirait aucun accès à l'école : cette borne est une
 * seconde ligne, pas la première.
 *
 * Une période illisible — bornes non finies, ou fin qui ne suit pas le début —
 * ne vaut AUCUNE part, par la même convention que `billedSeats` : c'est le
 * seul repli qui ne peut jamais surfacturer. `recordSubscription` refuse déjà
 * `endsAt <= startsAt` à la saisie.
 */
export function remainingPeriodShare(
  now: number,
  startsAt: number,
  endsAt: number,
): number {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(startsAt) ||
    !Number.isFinite(endsAt)
  ) {
    return 0;
  }
  const span = endsAt - startsAt;
  if (span <= 0) return 0;
  const left = endsAt - now;
  if (left <= 0) return 0;
  return Math.min(left / span, 1);
}

/**
 * Les sièges qu'un contrat ouvre DÉJÀ, ramenés à un entier exploitable.
 *
 * Même convention que `contractSeats` dans `schools.ts`, et pour la même
 * raison : `seatsPurchased` est un `v.number()` au schéma. Une valeur illisible
 * vaut zéro siège tenu — l'avenant facture alors tout ce qu'il ouvre, ce qui
 * est cohérent, plutôt que de rendre `NaN` sur le montant d'une facture.
 *
 * Le PLANCHER ne s'applique pas ici : il dit ce qu'une école doit ACHETER au
 * minimum, pas ce qu'un contrat déjà signé lui a ouvert.
 */
function seatsHeld(currentSeats: number): number {
  if (!Number.isInteger(currentSeats) || currentSeats <= 0) return 0;
  return currentSeats;
}

/**
 * Ce que coûte l'ajout de sièges à un contrat en cours.
 *
 * DEUX DEVIS, JAMAIS UNE MULTIPLICATION. Le coût de vingt sièges de plus est
 * la DIFFÉRENCE entre le devis d'après et le devis d'avant, et non vingt fois
 * un prix unitaire. Avec le tarif plat d'aujourd'hui les deux coïncident ; le
 * jour où une remise au volume reviendra, ils divergeront — le coût marginal
 * d'un siège dépend de la tranche où il tombe, et une multiplication
 * facturerait au prix du premier palier des sièges qui relèvent du troisième,
 * ou l'inverse. C'est la même raison qui rend le moteur cumulatif non
 * négociable (§7.2).
 *
 * PUIS LE PRORATA. Une école qui ajoute un élève à deux mois de la fin ne paie
 * pas une année pleine : le delta est multiplié par la part de période qui
 * reste à courir, et arrondi au franc. Un directeur trouverait l'année pleine
 * exactement comme il trouverait la non-monotonie que §7.2 interdit.
 *
 * NE REND JAMAIS MOINS QUE L'EXISTANT. `seatsBilled` est le maximum des sièges
 * demandés (plancher appliqué) et des sièges déjà tenus : une demande en
 * baisse, nulle ou illisible rend le contrat INCHANGÉ et un montant nul,
 * plutôt qu'un contrat rétréci et un avoir. `schools.amendSeats` refuse ces
 * demandes en amont, avec un message qui dit quoi faire ; ceci est la seconde
 * ligne, celle qui garantit qu'aucun chemin d'écriture ne peut retirer des
 * sièges à une école qui les a payés.
 */
export function quoteSeatAmendment(
  input: SeatAmendmentInput,
): SeatAmendmentQuote {
  return quoteSeatAmendmentWithScale(input, PRICING_SCALE);
}

/**
 * Le moteur de l'avenant sur un barème passé en argument — même rôle, mêmes
 * précautions que `quoteWithScale` : LA PRODUCTION NE L'APPELLE JAMAIS AVEC
 * AUTRE CHOSE QUE `PRICING_SCALE`, et aucun barème ne vient jamais d'un
 * argument de mutation. Il existe pour que les tests puissent prouver sur un
 * barème dégressif ce que le tarif plat rend invisible : que le coût d'un
 * ajout dépend de la tranche où les sièges tombent.
 */
export function quoteSeatAmendmentWithScale(
  input: SeatAmendmentInput,
  scale: PricingScale,
): SeatAmendmentQuote {
  const held = seatsHeld(input.currentSeats);
  const seatsBilled = Math.max(billedSeats(input.newSeats, scale), held);
  const seatsAdded = seatsBilled - held;

  // Positif ou nul par la monotonie du barème (§7.2, prouvée par balayage
  // dans les tests) : `seatsBilled >= held` et le total ne baisse jamais quand
  // les sièges montent.
  const fullTermDeltaFcfa =
    quoteWithScale(seatsBilled, scale).totalFcfa -
    quoteWithScale(held, scale).totalFcfa;

  const remainingShare = remainingPeriodShare(
    input.now,
    input.startsAt,
    input.endsAt,
  );

  const amountFcfa =
    seatsAdded <= 0 ? 0 : Math.round(fullTermDeltaFcfa * remainingShare);

  // Le total de DÉPART vient du contrat, jamais d'un devis recalculé : après
  // un premier avenant, `totalFcfa` ne vaut plus le devis de ses sièges — il
  // vaut le devis d'origine plus les proratas consentis. Le recalculer
  // effacerait ces avenants de la facture.
  const currentTotalFcfa = Number.isFinite(input.currentTotalFcfa)
    ? input.currentTotalFcfa
    : 0;
  const totalFcfa = currentTotalFcfa + amountFcfa;

  return {
    seatsBilled,
    seatsAdded,
    fullTermDeltaFcfa,
    remainingShare,
    amountFcfa,
    totalFcfa,
    pricePerSeatFcfa:
      seatsBilled > 0 ? Math.round(totalFcfa / seatsBilled) : 0,
  };
}
