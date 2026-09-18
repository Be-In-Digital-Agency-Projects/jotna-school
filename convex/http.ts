import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { expectedWebhookSecret } from "./billingBictorys";
import { expectedWebhookHash } from "./billingPaydunya";
import { constantTimeEquals, readBictorysWebhook } from "./billingRules";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/link-response",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const action = url.searchParams.get("action");

    if (!token || (action !== "accept" && action !== "reject")) {
      return new Response(htmlPage("Lien invalide", "Ce lien est invalide ou mal forme."), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const result: { error: string } | { success: boolean; action: string } =
      await ctx.runMutation(internal.linkRequests.resolveByToken, {
        token,
        action,
      });

    if ("error" in result) {
      return new Response(htmlPage("Erreur", result.error), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const title = action === "accept" ? "Liaison acceptee !" : "Demande refusee";
    const message =
      action === "accept"
        ? "Ton parent peut maintenant suivre ta progression sur Jotna School. Tu peux fermer cette page."
        : "La demande a ete refusee. Le parent ne sera pas lie a ton compte. Tu peux fermer cette page.";

    return new Response(htmlPage(title, message), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }),
});

/**
 * LE WEBHOOK DE PAYDUNYA — spec §8.2, et les quatre règles de §8.3.
 *
 * UN `httpAction`, DONC PAS DE `ctx.db` (règle 4). Il vérifie, il reconfirme,
 * puis il DÉLÈGUE à une mutation interne — exactement comme `/link-response`
 * juste au-dessus. Rien de ce qui touche la base ne s'écrit ici.
 *
 * L'ORDRE DES TROIS TEMPS EST LA SÉCURITÉ ELLE-MÊME :
 *
 *   1. l'empreinte d'abord (règle 1). Un appel non authentifié n'atteint pas la
 *      base du tout — un webhook non vérifié qui active des abonnements est un
 *      générateur d'abonnements gratuits ;
 *   2. la RECONFIRMATION ensuite (D39), parce que cette empreinte n'est pas une
 *      signature : c'est le SHA-512 de la clé maîtresse, la même chaîne à
 *      chaque appel, donc un mot de passe partagé qu'une seule fuite de journal
 *      rend forgeable. Le statut et le montant qui comptent viennent de
 *      PayDunya, redemandés avec nos clés, jamais du corps du POST ;
 *   3. la mutation enfin, qui compare ce montant à ce que la base dit devoir
 *      (règle 2) et qui est idempotente sur le jeton (règle 3).
 *
 * LES CODES DE RÉPONSE SONT DES INSTRUCTIONS AU PRESTATAIRE, pas des politesses.
 * 200 veut dire « c'est traité, n'y reviens pas » — y compris pour un rejeu, un
 * paiement partiel ou une tranche introuvable, que rejouer ne changerait pas.
 * 401 refuse sans rien faire. 503 et 500 disent « rappelle-moi » : clés
 * absentes, ou prestataire injoignable au moment de reconfirmer. Répondre 200 à
 * un paiement qu'on n'a pas su confirmer le perdrait pour de bon.
 */
http.route({
  path: "/paydunya-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const expected = await expectedWebhookHash();
    if (expected === null) {
      // Rien n'est configuré : on ne peut RIEN vérifier, donc on ne traite
      // rien. 503 pour que PayDunya rappelle quand les clés seront posées.
      return new Response("paydunya non configuré", { status: 503 });
    }

    // `application/x-www-form-urlencoded`, tout sous l'index `data` : c'est la
    // forme documentée du rappel. `URLSearchParams` défait l'encodage des
    // crochets, donc les clés se lisent telles qu'elles sont écrites.
    const form = new URLSearchParams(await req.text());

    const hash = form.get("data[hash]") ?? "";
    if (!constantTimeEquals(hash, expected)) {
      return new Response("signature invalide", { status: 401 });
    }

    const providerToken =
      form.get("data[invoice][token]") ?? form.get("data[token]") ?? "";
    if (providerToken === "") {
      // Authentifié mais inexploitable : il n'y a aucune facture à confirmer,
      // et rejouer ne produira pas un jeton qui n'était pas là.
      return new Response("jeton absent", { status: 200 });
    }

    // Peut lever : prestataire injoignable, réponse inattendue. On laisse
    // remonter en 500 plutôt que d'avaler l'erreur — PayDunya rejouera, et un
    // paiement qu'on ne sait pas confirmer ne doit ni être crédité ni perdu.
    const confirmation = await ctx.runAction(
      internal.billingPaydunya.confirmInvoice,
      { providerToken },
    );

    const result = await ctx.runMutation(internal.billing.applyPayment, {
      provider: "paydunya",
      providerToken,
      providerOutcome: confirmation.outcome,
      confirmedAmountFcfa: confirmation.amountFcfa,
      ...(confirmation.installmentRef
        ? { fallbackInstallmentRef: confirmation.installmentRef }
        : {}),
      // La charge utile BRUTE, telle qu'elle est arrivée : c'est elle qui
      // tranchera un litige, et un objet que nous aurions déjà interprété ne
      // dirait plus que notre lecture.
      rawPayload: Object.fromEntries(form.entries()),
    });

    return new Response(result.outcome, { status: 200 });
  }),
});

/**
 * LE WEBHOOK DE BICTORYS — spec §8.2, et les quatre règles de §8.3.
 *
 * MÊME ARCHITECTURE QUE LA ROUTE PAYDUNYA juste au-dessus, à une différence
 * près : vérifier, LIRE LE CORPS SIGNÉ, déléguer. La route PayDunya reconfirme la
 * facture au prestataire ; ici on ne le fait plus (plan B, D47).
 *
 * POURQUOI ON NE RECONFIRME PLUS. La reconfirmation `GET /transactions/{id}/status`
 * rend en bac à sable un corps minimal `{ id, status }` — sans `amount`, donc
 * incapable de solder une tranche — et tombe par intermittence en production, où
 * la rappeler à chaque webhook risquerait de perdre un paiement réussi. Le corps
 * du webhook, lui, porte le montant. `readBictorysWebhook` le traduit sans quitter
 * la route, et le corps est du JSON (pas du `x-www-form-urlencoded` de PayDunya).
 *
 * CE QUI TIENT LA FRONTIÈRE, ALORS. Trois choses, plus la reconfirmation :
 *   1. `X-Secret-Key` — le secret partagé, comparé à temps constant. Bictorys NE
 *      SIGNE PAS la charge utile ; ce secret voyage en clair DANS TLS à chaque
 *      appel. Il authentifie l'appelant, il ne prouve pas le contenu. Écrire
 *      `===` ici laisserait un exemple à copier là où ce serait grave ;
 *   2. le montant est RELU EN BASE avant de créditer (`decidePaymentApplication`,
 *      règle 2) — un corps forgé devrait déjà connaître le montant exact ET
 *      l'identifiant de tranche, tous deux non publics ;
 *   3. la devise est vérifiée (`readBictorysWebhook`), et la charge utile brute
 *      est journalisée pour tout litige.
 *
 * LE RISQUE RÉSIDUEL, DIT FRANCHEMENT : si le secret de webhook fuite (journaux,
 * TLS compromis), un tiers peut forger un corps « succeeded » et solder une
 * tranche qu'il sait nommer, sans qu'un franc soit arrivé. La reconfirmation
 * fermait ce trou ; plan B l'accepte pour que le montant soit vérifiable dès le
 * bac à sable. Durcissement disponible si on le veut : vérifier l'en-tête
 * `X-Webhook-Signature` (HMAC-SHA256) QUAND il est présent — leur documentation
 * le décrit, leurs rapports d'intégration disent qu'il n'est pas toujours envoyé.
 *
 * LES CODES DE RÉPONSE SONT DES INSTRUCTIONS AU PRESTATAIRE : 200 veut dire
 * « traité, n'y reviens pas », 401 refuse sans rien faire, 503 dit « rappelle-moi
 * quand les clés seront posées ».
 */
http.route({
  path: "/bictorys-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const expected = expectedWebhookSecret();
    if (expected === null) {
      // Rien n'est configuré : on ne peut RIEN vérifier, donc on ne traite
      // rien. 503 pour que Bictorys rappelle quand les clés seront posées.
      return new Response("bictorys non configuré", { status: 503 });
    }

    const presented = req.headers.get("X-Secret-Key") ?? "";
    if (!constantTimeEquals(presented, expected)) {
      return new Response("secret invalide", { status: 401 });
    }

    // Le corps est lu APRÈS l'authentification : un appel non authentifié ne
    // doit rien nous coûter, pas même une analyse syntaxique.
    let payload: {
      id?: unknown;
      status?: unknown;
      amount?: unknown;
      currency?: unknown;
      merchantReference?: unknown;
    };
    try {
      payload = (await req.json()) as typeof payload;
    } catch {
      return new Response("corps illisible", { status: 200 });
    }

    // Leur charge utile nomme `id` l'identifiant de transaction. C'est lui
    // qu'on a stocké comme `providerToken` à l'ouverture du paiement, et c'est
    // la clé d'idempotence de tout ce qui suit (§8.3, règle 3).
    const providerToken = typeof payload.id === "string" ? payload.id : "";
    if (providerToken === "") {
      // Authentifié mais inexploitable : rejouer ne produira pas un
      // identifiant qui n'était pas là.
      return new Response("identifiant absent", { status: 200 });
    }

    // LE CORPS SIGNÉ EST LA SOURCE DE VÉRITÉ (plan B). Il est déjà authentifié
    // par `X-Secret-Key` ci-dessus, et lui seul porte le montant : la
    // reconfirmation `/status` rend en bac à sable un corps sans `amount`, qui ne
    // solderait jamais rien. `readBictorysWebhook` est PURE et ne lève pas — plus
    // de reconfirmation réseau, donc plus de 500 sur cette route.
    const confirmation = readBictorysWebhook(payload);
    const installmentRef = confirmation.installmentRef;

    const result = await ctx.runMutation(internal.billing.applyPayment, {
      provider: "bictorys",
      providerToken,
      providerOutcome: confirmation.outcome,
      confirmedAmountFcfa: confirmation.amountFcfa,
      ...(installmentRef ? { fallbackInstallmentRef: installmentRef } : {}),
      // La charge utile BRUTE, telle qu'elle est arrivée : c'est elle qui
      // tranchera un litige, et un objet que nous aurions déjà interprété ne
      // dirait plus que notre lecture. Leur documentation prévient que des
      // champs peuvent apparaître sans préavis — raison de plus pour tout
      // garder.
      rawPayload: payload,
    });

    return new Response(result.outcome, { status: 200 });
  }),
});

function htmlPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} — Jotna School</title>
<style>
  body{margin:0;font-family:Arial,sans-serif;background:#f3f4f6;display:flex;justify-content:center;align-items:center;min-height:100vh}
  .card{background:#fff;border-radius:12px;padding:40px;max-width:440px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  h1{color:#0d9488;font-size:24px;margin:0 0 12px}
  p{color:#374151;font-size:16px;line-height:1.5;margin:0}
</style>
</head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body>
</html>`;
}

export default http;
