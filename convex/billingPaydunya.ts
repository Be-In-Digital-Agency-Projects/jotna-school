import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha512Hex } from "./billingRules";

// ---------------------------------------------------------------------------
// LE SEUL MODULE DU DÉPÔT QUI PARLE À PAYDUNYA — spec §8.2 et §8.7.
//
// TOUT LE RÉSEAU EST ICI, et rien d'autre : la base est dans `billing.ts`, les
// règles dans `billingRules.ts`, la route du webhook dans `http.ts`. Ce
// découpage n'est pas cosmétique — une action n'est PAS transactionnelle, elle
// peut mourir entre deux appels, et mêler ses écritures à celles d'une mutation
// ferait croire que tout s'exécute sous les mêmes garanties. C'est exactement
// la séparation déjà faite entre `studentImport.ts` et `studentImportRun.ts`.
//
// CE QUI A ÉTÉ VÉRIFIÉ DANS LA DOCUMENTATION, et ce qui ne l'a pas été : §8.7
// listait six questions restées ouvertes à la conception. Les réponses sont
// dans le plan (`docs/superpowers/plans/2026-09-15-encaissement-paydunya.md`),
// avec pour chacune la mention « vérifié » ou « supposé ». Deux points restent
// SUPPOSÉS et se paieraient ici s'ils étaient faux : la durée de validité d'une
// facture (d'où la création au clic, D41) et les plafonds de montant par moyen
// de paiement (non documentés — une école au contrat très élevé pourrait devoir
// payer en plusieurs fois, ce que l'échéancier permet déjà).
// ---------------------------------------------------------------------------

/** Production. Ne sert QUE si `PAYDUNYA_MODE` vaut exactement « live ». */
const LIVE_BASE = "https://app.paydunya.com/api/v1";

/** Bac à sable — le défaut, et c'est délibéré (D46). */
const SANDBOX_BASE = "https://app.paydunya.com/sandbox-api/v1";

type PaydunyaConfig = {
  base: string;
  masterKey: string;
  privateKey: string;
  token: string;
};

/**
 * Les clés, ou `null` si l'encaissement n'est pas configuré.
 *
 * `null` PLUTÔT QU'UNE EXCEPTION ici : l'appelant sait mieux quoi en dire — le
 * directeur qui clique reçoit une phrase d'adulte, le webhook répond 503 pour
 * que PayDunya rejoue quand les clés seront posées. Un message technique
 * remonté brut à l'écran ne dirait rien à personne (D45).
 *
 * BAC À SABLE PAR DÉFAUT. L'inverse ferait d'une faute de frappe dans une
 * variable d'environnement un prélèvement réel sur le compte d'une école : le
 * mode production se demande, il ne se déduit pas.
 */
function paydunyaConfig(): PaydunyaConfig | null {
  const masterKey = process.env.PAYDUNYA_MASTER_KEY;
  const privateKey = process.env.PAYDUNYA_PRIVATE_KEY;
  const token = process.env.PAYDUNYA_TOKEN;
  if (!masterKey || !privateKey || !token) return null;

  return {
    base: process.env.PAYDUNYA_MODE === "live" ? LIVE_BASE : SANDBOX_BASE,
    masterKey,
    privateKey,
    token,
  };
}

/**
 * L'empreinte que PayDunya doit nous présenter, ou `null` si rien n'est posé.
 *
 * ELLE VIT ICI ET NON DANS LA ROUTE, pour que les noms des variables
 * d'environnement n'aient qu'un seul endroit où être écrits : deux lectures de
 * la configuration finiraient par diverger, et une route qui lirait une clé
 * absente laisserait passer les webhooks au lieu de les refuser.
 *
 * C'est le SHA-512 de la clé maîtresse — la même chaîne à chaque appel. Ce que
 * cela vaut, et pourquoi la reconfirmation existe malgré tout, est expliqué sur
 * `confirmInvoice`.
 */
export async function expectedWebhookHash(): Promise<string | null> {
  const config = paydunyaConfig();
  if (!config) return null;
  return await sha512Hex(config.masterKey);
}

/** Les trois en-têtes d'authentification, identiques sur tous les appels. */
function paydunyaHeaders(config: PaydunyaConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "PAYDUNYA-MASTER-KEY": config.masterKey,
    "PAYDUNYA-PRIVATE-KEY": config.privateKey,
    "PAYDUNYA-TOKEN": config.token,
  };
}

/** La phrase que lit un adulte quand les clés ne sont pas posées. */
const NOT_CONFIGURED =
  "L'encaissement en ligne n'est pas configuré sur ce déploiement : les clés " +
  "PayDunya (PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY, PAYDUNYA_TOKEN) " +
  "doivent être posées avec `npx convex env set`. En attendant, l'école peut " +
  "régler par un autre moyen et le contrat s'active à la main depuis sa fiche.";

/**
 * Ouvre une facture PayDunya pour une tranche, et rend l'URL de paiement.
 *
 * LA FACTURE EST CRÉÉE AU CLIC, jamais d'avance (D41). Trois factures ouvertes
 * à la signature pour des échéances espacées d'un trimestre auraient toutes les
 * chances d'être périmées le jour où on les présente — la durée de validité
 * n'est pas documentée publiquement, et supposer qu'elle est longue coûterait
 * un paiement refusé au moment où l'école veut payer.
 *
 * LE MONTANT NE VIENT PAS DE L'APPELANT. `invoiceTarget` le relit en base avec
 * la garde d'`admin` : une facture dont le prix serait un argument serait une
 * facture que n'importe qui pourrait ramener à cent francs. C'est la même règle
 * que pour le prix d'un contrat (`pricing.ts`), et elle vaut d'autant plus ici
 * que la somme part chez un tiers.
 *
 * L'ORDRE DES DEUX ÉCRITURES EST DÉLIBÉRÉ : la facture d'abord — elle seule
 * produit le jeton — puis la ligne `payments`. Si l'action meurt entre les
 * deux, une facture existe chez PayDunya sans ligne chez nous ; le webhook sait
 * le rattraper en créant la ligne à partir du `custom_data` de la facture
 * confirmée (`billing.applyPayment`). L'ordre inverse aurait laissé une ligne
 * sans jeton, donc sans clé d'idempotence, ce que rien ne rattrape.
 *
 * PAS D'URL DE RETOUR NI D'ANNULATION, et c'est un refus assumé : elles
 * devraient venir du navigateur, donc d'un appelant, et une URL de redirection
 * fournie par l'appelant est une redirection ouverte posée sur la page de
 * paiement d'un prestataire (règle D26 du plan 1/3). PayDunya affiche son
 * propre reçu ; l'accès, lui, s'ouvre par le webhook, pas par le retour du
 * navigateur — un paiement réussi dont l'utilisateur ferme l'onglet est encaissé
 * quand même.
 */
export const openInvoice = action({
  args: { installmentId: v.id("installments") },
  handler: async (ctx, args): Promise<{ paymentUrl: string }> => {
    const config = paydunyaConfig();
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

    const description = `Jotna School — ${target.schoolName}, tranche ${target.index}`;

    const response = await fetch(`${config.base}/checkout-invoice/create`, {
      method: "POST",
      headers: paydunyaHeaders(config),
      body: JSON.stringify({
        invoice: {
          total_amount: target.amountFcfa,
          description,
        },
        store: { name: "Jotna School" },
        actions: {
          // La route de ce déploiement, jamais une URL reçue en argument :
          // `CONVEX_SITE_URL` est posée par Convex lui-même, comme dans
          // `convex/auth.config.ts`.
          callback_url: `${process.env.CONVEX_SITE_URL}/paydunya-webhook`,
        },
        // C'est ce que le webhook retrouvera si notre ligne `payments` manque.
        // Jamais le montant : ce qui revient de l'extérieur ne fait pas foi.
        custom_data: {
          installmentId: target.installmentId,
          subscriptionId: target.subscriptionId,
        },
      }),
    });

    if (!response.ok) {
      throw new ConvexError(
        `PayDunya a refusé d'ouvrir la facture (HTTP ${response.status}). ` +
          "Réessayez dans un instant ; si cela persiste, vérifiez les clés du " +
          "déploiement.",
      );
    }

    const payload: unknown = await response.json();
    const body = payload as {
      response_code?: string;
      response_text?: string;
      token?: string;
    };

    // `response_code` vaut « 00 » en cas de succès. Le tester AVANT de lire le
    // jeton : une réponse d'erreur porte elle aussi `response_text`, et s'en
    // servir comme URL de paiement enverrait le directeur sur un message
    // d'erreur en croyant l'envoyer payer.
    if (body.response_code !== "00" || !body.token || !body.response_text) {
      throw new ConvexError(
        "PayDunya n'a pas ouvert la facture : " +
          (body.response_text ?? "réponse inattendue du prestataire") +
          ".",
      );
    }

    await ctx.runMutation(internal.billing.recordInitiatedPayment, {
      subscriptionId: target.subscriptionId,
      installmentId: target.installmentId,
      providerToken: body.token,
      amountFcfa: target.amountFcfa,
    });

    return { paymentUrl: body.response_text };
  },
});

/** Ce que PayDunya répond quand on lui redemande une facture. */
export type InvoiceConfirmation = {
  /** `completed`, `pending`, `cancelled`, `failed` — tel quel, jugé plus loin. */
  status: string;
  /** Le montant que PAYDUNYA dit avoir encaissé. Fait foi contre notre base. */
  amountFcfa: number;
  /**
   * La tranche que la facture désignait, telle qu'elle revient — une CHAÎNE
   * brute, jamais transtypée en identifiant ici. C'est `billing.applyPayment`
   * qui la normalise contre la table, seul endroit qui puisse le faire sans
   * mentir : un `as Id<…>` sur du texte venu du réseau est une affirmation que
   * rien ne vérifie.
   */
  installmentRef: string | null;
};

/**
 * Redemande une facture à PayDunya — la deuxième ligne de défense du webhook.
 *
 * POURQUOI ELLE EXISTE (D39). L'« empreinte » de PayDunya est le SHA-512 de la
 * clé maîtresse : LA MÊME CHAÎNE À CHAQUE APPEL. Ce n'est pas une signature de
 * la charge utile — elle ne prouve RIEN de son contenu — c'est un mot de passe
 * partagé. Une seule ligne de journal fuitée, et n'importe qui fabrique des
 * webhooks valides pour toujours, avec le statut et le montant qu'il choisit.
 *
 * On ne croit donc pas le corps du POST : on redemande la facture au
 * prestataire, avec NOS clés, et ce sont ces valeurs-là qui décident. Un
 * attaquant devrait alors non seulement connaître l'empreinte, mais posséder un
 * vrai jeton de facture réellement payée du bon montant — c'est-à-dire avoir
 * payé.
 *
 * Elle LÈVE quand PayDunya ne répond pas : la route renvoie alors une erreur,
 * et le prestataire rejouera. Un paiement qu'on ne sait pas confirmer ne doit
 * ni être crédité, ni être perdu.
 */
export const confirmInvoice = internalAction({
  args: { providerToken: v.string() },
  handler: async (_ctx, args): Promise<InvoiceConfirmation> => {
    const config = paydunyaConfig();
    if (!config) throw new Error("PayDunya non configuré");

    const response = await fetch(
      `${config.base}/checkout-invoice/confirm/${encodeURIComponent(args.providerToken)}`,
      { method: "GET", headers: paydunyaHeaders(config) },
    );

    if (!response.ok) {
      throw new Error(`PayDunya confirm: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      response_code?: string;
      status?: string;
      invoice?: { total_amount?: unknown; status?: unknown };
      custom_data?: { installmentId?: unknown };
    };

    if (payload.response_code !== "00") {
      throw new Error(
        `PayDunya confirm: réponse ${payload.response_code ?? "absente"}`,
      );
    }

    // Le statut est documenté au premier niveau ; on lit aussi celui de la
    // facture, parce qu'une réponse qui ne porterait QUE ce dernier vaut mieux
    // qu'un statut vide traité comme « pas payé » sur un paiement réel.
    const status =
      typeof payload.status === "string"
        ? payload.status
        : typeof payload.invoice?.status === "string"
          ? payload.invoice.status
          : "";

    // Le montant peut revenir en nombre ou en chaîne selon les intégrations :
    // `Number` couvre les deux, et `NaN` devient zéro — un montant illisible ne
    // doit jamais solder une tranche, et zéro ne solde rien (D42).
    const parsed = Number(payload.invoice?.total_amount);
    const amountFcfa = Number.isFinite(parsed) ? parsed : 0;

    const custom = payload.custom_data?.installmentId;
    const installmentRef = typeof custom === "string" ? custom : null;

    return { status, amountFcfa, installmentRef };
  },
});
