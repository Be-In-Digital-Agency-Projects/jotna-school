import { ConvexError, v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { bictorysOutcome, type ProviderOutcome } from "./billingRules";

// ---------------------------------------------------------------------------
// LE SEUL MODULE DU DÉPÔT QUI PARLE À BICTORYS — spec §8.2.
//
// MÊME FORME QUE `billingPaydunya.ts`, et c'est voulu : les deux adaptateurs
// exposent `openInvoice` et une reconfirmation interne, traduisent le dialecte
// de leur prestataire en `ProviderOutcome`, et ne touchent jamais à la base.
// `billing.ts` ne sait pas lequel des deux l'appelle.
//
// POURQUOI BICTORYS. 1,5 % en mobile money contre 2,25 % chez PayDunya sur le
// palier qui nous concerne — et ce palier est le seul qui nous concernera
// longtemps, le premier de leur grille allant jusqu'à cent millions de francs
// PAR MOIS. Wave, Orange Money, Free Money et MTN y sont. Les deux prestataires
// sont agréés par la BCEAO comme établissements de paiement.
//
// CE QUI EST VÉRIFIÉ ICI, ET CE QUI NE L'EST PAS. Tout ce qui suit vient de
// leur OpenAPI publique (`docs.bictorys.com`, lue le 16/09/2026). RIEN n'a été
// essayé contre leur bac à sable depuis l'environnement où ce code a été écrit :
// leur domaine y est bloqué. Les deux endroits qui demandent une vérification au
// premier paiement réel sont signalés par « À ÉPROUVER » ci-dessous.
// ---------------------------------------------------------------------------

/** Production. Ne sert QUE si `BICTORYS_MODE` vaut exactement « live ». */
const LIVE_BASE = "https://api.bictorys.com/pay/v1";

/** Bac à sable — le défaut, et c'est délibéré (D46). */
const SANDBOX_BASE = "https://api.test.bictorys.com/pay/v1";

type BictorysConfig = {
  base: string;
  apiKey: string;
  webhookSecret: string;
};

/**
 * Les clés, ou `null` si l'encaissement n'est pas configuré.
 *
 * DEUX SECRETS, ET ILS NE VIENNENT PAS DU MÊME ENDROIT. `BICTORYS_API_KEY` est
 * délivrée par Bictorys ; `BICTORYS_WEBHOOK_SECRET` est une chaîne que NOUS
 * choisissons et déposons sur leur tableau de bord — ils nous la renverront
 * telle quelle à chaque rappel. C'est plus propre que l'empreinte dérivée de
 * PayDunya : ce secret-là ne sert qu'aux webhooks, et le révoquer ne casse pas
 * les paiements en cours.
 *
 * LA CLÉ DE TEST ET CELLE DE PRODUCTION SONT DIFFÉRENTES, leur documentation
 * insiste : en mode live il faut la clé live ET un webhook configuré en mode
 * live. Un déploiement qui garderait la clé de test enverrait ses écoles payer
 * avec de la fausse monnaie.
 */
function bictorysConfig(): BictorysConfig | null {
  const apiKey = process.env.BICTORYS_API_KEY;
  const webhookSecret = process.env.BICTORYS_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) return null;

  return {
    base: process.env.BICTORYS_MODE === "live" ? LIVE_BASE : SANDBOX_BASE,
    apiKey,
    webhookSecret,
  };
}

/**
 * Le secret que Bictorys doit nous présenter, ou `null` si rien n'est posé.
 *
 * ELLE VIT ICI ET NON DANS LA ROUTE, pour que les noms des variables
 * d'environnement n'aient qu'un seul endroit où être écrits — même raison que
 * chez PayDunya : une route qui lirait une clé absente laisserait passer les
 * webhooks au lieu de les refuser.
 */
export function expectedWebhookSecret(): string | null {
  const config = bictorysConfig();
  return config ? config.webhookSecret : null;
}

/** L'en-tête d'authentification, identique sur tous les appels. */
function bictorysHeaders(config: BictorysConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": config.apiKey,
  };
}

/**
 * La phrase affichée sur la page de paiement, ramenée à ce que Bictorys accepte.
 *
 * ÉPROUVÉ CONTRE LEUR BAC À SABLE le 19/09/2026, et pas déduit de leur
 * documentation, qui ne dit rien du format de ce champ. Deux contraintes, et
 * chacune faisait refuser le paiement entier par un
 * `HTTP 400 — E400-46: Invalid paymentReference format` :
 *
 *   1. ASCII IMPRIMABLE SEULEMENT. Le tiret cadratin de la phrase d'origine
 *      suffisait à faire refuser CHAQUE paiement, avant même qu'un nom d'école
 *      soit en cause ; « École », « Lycée » ou « Institut Cheikh Ahmadou »
 *      auraient fait le reste ;
 *   2. 64 CARACTÈRES AU PLUS. 64 passe, 65 est refusé.
 *
 * ON TRANSLITÈRE PLUTÔT QUE DE SUPPRIMER : « École » devient « Ecole », pas
 * « cole ». Et on coupe à 64 plutôt que de laisser partir une requête qu'on
 * sait refusée : un nom d'école long ne doit pas empêcher son école de payer.
 *
 * LES LIGATURES SE TRAITENT AVANT LE RESTE, parce que NFD ne les décompose
 * pas : « œ » n'est pas un « o » porteur d'un accent, c'est une lettre à part.
 * Sans cette ligne, « Sacré-Cœur » — une école de Dakar, pas un cas d'école —
 * s'afficherait « Sacre-C ur » sur la page de paiement.
 *
 * CE CHAMP EST DÉCORATIF, et c'est ce qui rend la coupe acceptable. Ce qui
 * identifie la tranche est `merchantReference`, qui porte l'identifiant Convex
 * — de l'ASCII, jamais tronqué.
 */
function bictorysReference(text: string): string {
  return text
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―]/g, "-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
    .trim();
}

/** La phrase que lit un adulte quand les clés ne sont pas posées. */
const NOT_CONFIGURED =
  "L'encaissement en ligne n'est pas configuré sur ce déploiement : les clés " +
  "Bictorys (BICTORYS_API_KEY, BICTORYS_WEBHOOK_SECRET) doivent être posées " +
  "avec `npx convex env set`. En attendant, l'école peut régler par un autre " +
  "moyen et la tranche se constate à la main depuis sa fiche.";

/**
 * Ouvre un paiement Bictorys pour une tranche, et rend l'URL de paiement.
 *
 * SANS `payment_type`, ET C'EST LE POINT. Leur documentation dit : « quand une
 * requête est initiée sans préciser le moyen de paiement, le système crée un
 * objet charge et redirige vers une page de paiement ». On reçoit alors un
 * **202** portant un `CheckoutLinkObject` — `{ link, chargeId, opToken }` — et
 * le directeur choisit lui-même entre Wave, Orange Money, Free Money ou carte.
 * Préciser le moyen ici reviendrait à choisir à sa place, et à refuser un
 * paiement parce qu'il n'a pas le portefeuille qu'on a supposé.
 *
 * LE MONTANT NE VIENT PAS DE L'APPELANT. `invoiceTarget` le relit en base avec
 * la garde d'`admin` — même règle que partout : un prix reçu en argument serait
 * une facture que n'importe qui pourrait ramener à cent francs.
 *
 * `merchantReference` PORTE L'IDENTIFIANT DE LA TRANCHE. Leur documentation
 * promet qu'il est « renvoyé dans la réponse ET dans la charge utile du
 * webhook » : c'est l'équivalent exact du `custom_data` de PayDunya, et c'est
 * par lui que le webhook retrouve la tranche si notre ligne `payments` manque.
 * `paymentReference`, lui, est AFFICHÉ sur la page de paiement — on y met une
 * phrase lisible, pas un identifiant.
 *
 * L'ORDRE DES DEUX ÉCRITURES EST DÉLIBÉRÉ, comme chez PayDunya : la charge
 * d'abord — elle seule produit le `chargeId` — puis la ligne `payments`. Si
 * l'action meurt entre les deux, le webhook rattrape par `merchantReference`.
 *
 * PAS D'URL DE RETOUR NI D'ANNULATION. Leur API les accepte
 * (`successRedirectUrl`, `errorRedirectUrl`) mais elles devraient venir du
 * navigateur, donc d'un appelant, et une redirection fournie par l'appelant est
 * une redirection ouverte posée sur la page de paiement d'un tiers (règle D26).
 * L'accès s'ouvre par le webhook, pas par le retour du navigateur : un paiement
 * réussi dont l'onglet est fermé est encaissé quand même.
 */
export const openInvoice = internalAction({
  args: { installmentId: v.id("installments") },
  handler: async (ctx, args): Promise<{ paymentUrl: string }> => {
    const config = bictorysConfig();
    if (!config) throw new ConvexError(NOT_CONFIGURED);

    const target = await ctx.runQuery(internal.billing.invoiceTarget, {
      installmentId: args.installmentId,
    });
    if (!target) {
      // Introuvable, déjà soldée, ou hors de portée de l'appelant : les trois
      // se disent pareil, distinguer renseignerait sur les contrats d'autrui.
      throw new ConvexError(
        "Cette tranche est introuvable, déjà réglée, ou hors de votre portée.",
      );
    }

    const response = await fetch(`${config.base}/charges`, {
      method: "POST",
      headers: bictorysHeaders(config),
      body: JSON.stringify({
        amount: target.amountFcfa,
        currency: "XOF",
        // « Recommandé » par leur documentation : pour le mobile money c'est le
        // pays du CLIENT, et nos clients sont des écoles sénégalaises. Omis, le
        // pays du marchand s'applique — ce qui donnerait la même chose, mais on
        // ne fait pas reposer un paiement sur un défaut.
        country: "SN",
        paymentReference: bictorysReference(
          `Jotna School - ${target.schoolName}, tranche ${target.index}`,
        ),
        merchantReference: target.installmentId,
      }),
    });

    // 201 comme 202 sont des succès chez eux ; sans `payment_type` c'est 202 et
    // un `CheckoutLinkObject` qu'on attend. On accepte les deux plutôt que de
    // refuser un paiement pour un code de retour qu'ils auraient fait évoluer.
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ConvexError(
        `Bictorys a refusé d'ouvrir le paiement (HTTP ${response.status}). ` +
          (detail ? `${detail.slice(0, 200)} ` : "") +
          "Réessayez dans un instant ; si cela persiste, vérifiez les clés du " +
          "déploiement.",
      );
    }

    const body = (await response.json()) as {
      link?: string;
      chargeId?: string;
      transactionId?: string;
    };

    // `chargeId` sur un 202, `transactionId` sur un 201 : c'est l'identifiant
    // que le webhook renverra, et notre clé d'idempotence.
    const providerToken = body.chargeId ?? body.transactionId;
    if (!body.link || !providerToken) {
      throw new ConvexError(
        "Bictorys n'a pas rendu de lien de paiement exploitable. Réessayez.",
      );
    }

    await ctx.runMutation(internal.billing.recordInitiatedPayment, {
      subscriptionId: target.subscriptionId,
      installmentId: target.installmentId,
      provider: "bictorys",
      providerToken,
      amountFcfa: target.amountFcfa,
    });

    return { paymentUrl: body.link };
  },
});

/** Ce que Bictorys répond quand on lui redemande une transaction. */
export type ChargeConfirmation = {
  /** L'issue, DÉJÀ TRADUITE : la règle de décision ne lit aucun dialecte. */
  outcome: ProviderOutcome;
  /** Le montant BRUT reconstitué — voir le commentaire de `confirmCharge`. */
  amountFcfa: number;
  /** La tranche que la charge désignait, telle qu'elle revient. Chaîne brute. */
  installmentRef: string | null;
};

/**
 * Redemande une transaction à Bictorys — la deuxième ligne de défense.
 *
 * POURQUOI ELLE EXISTE, ET POURQUOI ELLE EST ENCORE PLUS NÉCESSAIRE ICI.
 * Bictorys ne signe PAS ses webhooks. Leur page « Comment valider les
 * webhooks » est explicite : chaque rappel porte un en-tête `X-Secret-Key`
 * contenant **le secret en clair**, et valider consiste à le comparer au sien.
 * Ce n'est pas une signature de la charge utile — elle ne prouve rien du
 * contenu — c'est un mot de passe transmis à chaque appel. Leur documentation
 * mentionne par ailleurs des en-têtes `X-Webhook-Signature` et
 * `X-Webhook-Timestamp` en HMAC-SHA256 qui, d'après les rapports
 * d'intégration publics, ne sont pas envoyés en pratique.
 *
 * Le statut et le montant qui décident viennent donc de CETTE réponse-ci,
 * redemandée avec notre clé d'API, jamais du corps du POST.
 *
 * ---------------------------------------------------------------------------
 * À ÉPROUVER AU PREMIER PAIEMENT — LE MONTANT EST NET DE FRAIS
 *
 * Leur OpenAPI décrit `amount`, sur CETTE réponse, comme « the amount received
 * or paid by the merchant, NET OF FEES ». Le webhook, lui, décrit son propre
 * `amount` comme le montant payé par le client. Les deux champs portent le même
 * nom et ne veulent pas dire la même chose.
 *
 * SI ON COMPARAIT `amount` TEL QUEL à ce que la tranche réclame, il serait
 * systématiquement inférieur du montant des frais — 6 250 FCFA sur une tranche
 * de 416 668 à 1,5 % — et `decidePaymentApplication` conclurait « paiement
 * partiel » sur CHAQUE paiement. Aucune tranche ne serait jamais soldée, aucun
 * accès jamais ouvert, et rien dans les journaux ne dirait pourquoi.
 *
 * On reconstitue donc le brut : `amount + merchantFees`. Les frais du client
 * (`customerFees`) n'entrent pas — ils s'ajoutent à ce qu'il paie, pas à ce que
 * nous encaissons — sauf si le compte est réglé pour faire supporter les frais
 * au client, cas où leur note dit que `amount` les inclut déjà.
 *
 * C'EST LE PREMIER PAIEMENT EN BAC À SABLE QUI TRANCHERA. Comparer le montant
 * reconstitué ici au montant de la tranche est la seule vérification qui
 * compte, et elle se fait avec de l'argent, pas avec un test unitaire.
 * ---------------------------------------------------------------------------
 *
 * Elle LÈVE quand Bictorys ne répond pas : la route renvoie alors une erreur et
 * le prestataire rejouera. Un paiement qu'on ne sait pas confirmer ne doit ni
 * être crédité, ni être perdu.
 */
export const confirmCharge = internalAction({
  args: { providerToken: v.string() },
  handler: async (_ctx, args): Promise<ChargeConfirmation> => {
    const config = bictorysConfig();
    if (!config) throw new Error("Bictorys non configuré");

    const response = await fetch(
      `${config.base}/transactions/${encodeURIComponent(args.providerToken)}`,
      { method: "GET", headers: bictorysHeaders(config) },
    );

    if (!response.ok) {
      throw new Error(`Bictorys confirm: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      status?: unknown;
      amount?: unknown;
      merchantFees?: unknown;
      merchantReference?: unknown;
    };

    const status = typeof payload.status === "string" ? payload.status : "";

    // Un montant illisible devient zéro, et zéro ne solde rien : un paiement
    // qu'on ne sait pas chiffrer ne doit jamais créditer une tranche (D42).
    const net = Number(payload.amount);
    const fees = Number(payload.merchantFees);
    const amountFcfa =
      (Number.isFinite(net) ? net : 0) + (Number.isFinite(fees) ? fees : 0);

    const reference = payload.merchantReference;
    const installmentRef = typeof reference === "string" ? reference : null;

    return { outcome: bictorysOutcome(status), amountFcfa, installmentRef };
  },
});
