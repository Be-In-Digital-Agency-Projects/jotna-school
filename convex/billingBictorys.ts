import { ConvexError, v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { bictorysOutcome, type ChargeConfirmation } from "./billingRules";

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
// CE QUI EST VÉRIFIÉ ICI, ET CE QUI NE L'EST PAS. La forme des appels vient de
// leur OpenAPI publique (`docs.bictorys.com`, lue le 16/09/2026). Le 17/09/2026,
// `openInvoice` a été essayée pour la première fois contre leur bac à sable : le
// format de `paymentReference` y a été corrigé sur un refus de leur part, détaillé
// au-dessus de la fonction. `confirmCharge` reste NON ÉPROUVÉE — aucun appelant ne
// l'invoque — et son hypothèse de montant brut est signalée « À ÉPROUVER ».
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
 * LES DEUX RÉFÉRENCES PORTENT L'IDENTIFIANT DE LA TRANCHE, et c'est ce que
 * Bictorys demande. `paymentReference` est leur clé de rapprochement — « your
 * internal order reference, returned in webhook and verify_transaction so you
 * can match the payment to your order » — et `merchantReference` une référence
 * de trace facultative. Les deux reviennent dans la charge utile du webhook,
 * qui retrouve ainsi la tranche même si notre ligne `payments` manque.
 *
 * CE CHAMP A PORTÉ UNE PHRASE LISIBLE, ET BICTORYS L'A REFUSÉE. Le premier
 * appel réel contre leur bac à sable, le 17/09/2026, a rendu :
 *
 *     HTTP 400 {"status":400,"title":"BAD_REQUEST",
 *               "details":"E400-46: Invalid paymentReference format",
 *               "source":"pay"}
 *
 * pour `paymentReference: "Jotna School — École de test Bictorys, tranche 1"`.
 * Le champ EST bien affiché sur leur page de paiement, l'ancien commentaire avait
 * raison sur ce point ; c'est « on y met une phrase lisible » qui était faux. Il
 * est contraint en format, et un libellé avec espaces, accents et tiret cadratin
 * le viole. L'identifiant Convex de la tranche, lui, est alphanumérique et passe.
 *
 * CONSÉQUENCE ASSUMÉE : la page de paiement montre cet identifiant, tronqué —
 * mesuré le 17/09/2026, elle affiche `ps7abmed33wqz60...` — et plus le nom de
 * l'école. Le directeur y arrive depuis SA fiche d'école, après avoir cliqué
 * « Payer » sur une tranche affichée avec son montant : le contexte est à
 * l'écran d'où il vient, pas à reconstruire depuis un libellé que le prestataire
 * peut refuser. Le montant, lui, s'affiche bien — « CFA 50000 » pour une tranche
 * de 50 000 FCFA — et c'est ce qu'il doit reconnaître avant de payer.
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
        paymentReference: target.installmentId,
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

    // `chargeId` sur un 202, `transactionId` sur un 201.
    //
    // CE N'EST PAS L'IDENTIFIANT QUE LE WEBHOOK RENVERRA, contrairement à ce
    // que ce commentaire affirmait. Mesuré le 17/09/2026 contre leur bac à
    // sable : la charge ouverte ici valait
    // `3949430b-ee5a-493d-8c8e-16e03a6f512a`, et le rappel est arrivé avec
    // `id: "f418ae93-5e49-49ba-9821-7f7e89b2e288"` — l'identifiant de la
    // TRANSACTION, que Bictorys crée quand le client choisit son opérateur.
    // Les deux UUID ne se recoupent jamais dans le parcours hébergé.
    //
    // ON L'ENREGISTRE QUAND MÊME : il nomme la charge chez eux, donc il sert au
    // rapprochement et au litige. Mais la clé d'idempotence réelle est celle
    // que porte le webhook, et `billing.applyPayment` réconcilie cette ligne
    // avec elle au premier rappel — le raisonnement est écrit là-bas.
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

/**
 * Redemande une transaction à Bictorys — DÉSORMAIS un outil de RAPPROCHEMENT,
 * plus la garde du webhook (plan B, D47).
 *
 * CE QUI A CHANGÉ. La route `/bictorys-webhook` ne l'appelle plus : elle lit le
 * montant et le statut dans le corps signé du webhook (`readBictorysWebhook`
 * ci-dessus), parce que `/status` rend en bac à sable un corps minimal sans
 * `amount` et tombe par intermittence en production. Cette fonction reste pour un
 * balayage de rapprochement — retrouver le sort d'un paiement dont le webhook
 * n'est jamais arrivé — le seul usage que Bictorys recommande pour cet endpoint
 * côté serveur.
 *
 * SON `amount` EST NET DE FRAIS, d'où le brut reconstitué `amount + merchantFees`
 * — à l'inverse du webhook, dont l'`amount` est déjà le montant payé par le
 * client. Un montant illisible devient zéro, et zéro ne solde rien (D42).
 *
 * DEUX PRÉREQUIS AVANT DE LA CÂBLER. Son chemin est `/transactions/{id}/status` :
 * sans `/status`, Bictorys répond 404 « this endpoint does not exist ». Et
 * `verify_transaction` exige la clé PRIVÉE (`BICTORYS_PRIVATE_KEY`), non la clé
 * publique que `bictorysHeaders` envoie pour la charge — le rapprochement devra
 * passer sa propre clé. Tant qu'aucun appelant ne l'invoque, ces deux points sont
 * documentés, pas réglés.
 */
export const confirmCharge = internalAction({
  args: { providerToken: v.string() },
  handler: async (_ctx, args): Promise<ChargeConfirmation> => {
    const config = bictorysConfig();
    if (!config) throw new Error("Bictorys non configuré");

    const response = await fetch(
      `${config.base}/transactions/${encodeURIComponent(args.providerToken)}/status`,
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
