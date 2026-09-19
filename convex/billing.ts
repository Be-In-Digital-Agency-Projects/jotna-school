import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  callerAdminProfile,
  callerIsAdmin,
  currentSchoolSubscription,
  graceAnchorFor,
} from "./access";
import {
  decideOverdue,
  decidePaymentApplication,
  decidePostPayment,
} from "./billingRules";

// ---------------------------------------------------------------------------
// ENCAISSEMENT — la partie qui touche à la base. Spec §8.
//
// CE MODULE NE PARLE À AUCUN PRESTATAIRE. Le réseau vit dans les adaptateurs —
// `convex/billingPaydunya.ts`, `convex/billingBictorys.ts` — et les routes de
// webhook dans `convex/http.ts` : aucun d'eux n'a de `ctx.db`, c'est la règle 4
// de §8.3. Ici, tout est transactionnel, et c'est ce qui rend l'idempotence
// démontrable plutôt qu'espérée.
//
// ET IL NE CONNAÎT LE DIALECTE D'AUCUN D'EUX : les adaptateurs traduisent leurs
// statuts en quatre issues communes (`billingRules.ProviderOutcome`) avant
// d'arriver ici. Changer de prestataire ne touche donc pas une ligne de ce
// fichier.
//
// ET IL NE DÉCIDE RIEN NON PLUS : les règles sont dans `convex/billingRules.ts`,
// module pur et testé. Ce fichier lit des documents, appelle une règle, écrit ce
// qu'elle rend. Même découpage que `access.ts` / `accessRules.ts` et
// `schools.ts` / `pricing.ts`.
// ---------------------------------------------------------------------------

/**
 * Les prestataires d'encaissement que le dépôt sait piloter.
 *
 * `manual` n'est PAS ici : un règlement constaté à la main n'ouvre aucune
 * facture et n'a pas d'adaptateur. Il vit dans le schéma de `payments`, pas
 * dans les arguments d'un appel réseau.
 */
const chargeProviderValidator = v.union(
  v.literal("paydunya"),
  v.literal("bictorys"),
);

/**
 * L'issue normalisée que l'adaptateur a traduite depuis le dialecte de son
 * prestataire (`billingRules.paydunyaOutcome`, `bictorysOutcome`).
 */
const providerOutcomeValidator = v.union(
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed"),
  v.literal("pending"),
);

/**
 * Tranches rendues à l'écran au plus.
 *
 * Trois à la signature, plus une par avenant (§7.6) : vingt-quatre couvre une
 * école qui achèterait des sièges trois fois par mois toute l'année. Au-delà,
 * `truncated` le dit — la liste est un affichage, jamais une source de
 * décision, et aucune règle du dépôt ne compte les tranches par cette lecture.
 * L'ancre de la grâce, elle, se lit en un document exact (`graceAnchorFor`).
 */
const SCHEDULE_LIMIT = 24;

/** Paiements rendus à l'écran au plus — tentatives comprises. */
const PAYMENTS_LIMIT = 50;

/** Tranches traitées par passe du cron, pour ne pas tenir une transaction trop longtemps. */
const OVERDUE_BATCH = 50;

export type ScheduleRow = {
  installmentId: Id<"installments">;
  index: number;
  amountFcfa: number;
  dueAt: number;
  status: "pending" | "paid" | "overdue" | "failed";
  paidAt: number | null;
};

export type PaymentRow = {
  paymentId: Id<"payments">;
  installmentId: Id<"installments"> | null;
  /** D'où vient l'argent : un prestataire, ou un règlement constaté à la main. */
  provider: "paydunya" | "bictorys" | "manual";
  amountFcfa: number;
  status: "initiated" | "completed" | "failed" | "cancelled";
  createdAt: number;
  completedAt: number | null;
};

export type BillingSchedule = {
  subscriptionId: Id<"subscriptions">;
  /** Ce que le contrat dit devoir — `Σ installments.amountFcfa` doit l'égaler. */
  totalFcfa: number;
  /** La somme réellement portée par l'échéancier, pour que l'écart se VOIE. */
  scheduledFcfa: number;
  paidFcfa: number;
  installments: ScheduleRow[];
  payments: PaymentRow[];
  truncated: boolean;
};

/**
 * L'échéancier du contrat de cette école, et ce qui a été encaissé dessus.
 *
 * LE MÊME CONTRAT QUE LA FICHE, et non un autre : `currentSchoolSubscription`,
 * celui dont `getEnrollmentOutlook` affiche déjà les dates et le statut juste
 * au-dessus. Un échéancier qui porterait sur un autre contrat que celui montré
 * ferait payer une année pour une autre — et c'est la règle D18 du plan 1/3,
 * la même qui impose une seule sélection au paywall, au plafond de sièges et à
 * l'avenant.
 *
 * `scheduledFcfa` EST RENDU EXPRÈS À CÔTÉ DE `totalFcfa`. Les deux doivent être
 * égaux (invariante de D34) ; les afficher ensemble fait qu'un écart se voit au
 * lieu de dormir. Un échéancier qui ne couvre pas le contrat est une école qui
 * paiera moins que ce qu'elle doit, ou plus.
 *
 * Réservée à l'`admin` comme tout le parcours école, et ne lève jamais : `null`
 * pour tout autre appelant, comme les autres lectures du module.
 */
export const getSchedule = query({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, args): Promise<BillingSchedule | null> => {
    if (!(await callerIsAdmin(ctx))) return null;

    const school = await ctx.db.get(args.schoolId);
    if (!school) return null;

    const contract = await currentSchoolSubscription(
      ctx,
      args.schoolId,
      Date.now(),
    );
    if (!contract) return null;

    // Par `index` croissant : c'est l'ordre dans lequel un directeur lit son
    // échéancier (« tranche 1, tranche 2… »), et il vient de l'index, pas d'un
    // tri en mémoire.
    const rows = await ctx.db
      .query("installments")
      .withIndex("by_subscription_index", (q) =>
        q.eq("subscriptionId", contract._id),
      )
      .take(SCHEDULE_LIMIT);

    const payments = await ctx.db
      .query("payments")
      .withIndex("by_subscription", (q) => q.eq("subscriptionId", contract._id))
      .take(PAYMENTS_LIMIT);

    return {
      subscriptionId: contract._id,
      totalFcfa: contract.totalFcfa,
      scheduledFcfa: rows.reduce((sum, row) => sum + row.amountFcfa, 0),
      paidFcfa: rows
        .filter((row) => row.status === "paid")
        .reduce((sum, row) => sum + row.amountFcfa, 0),
      installments: rows.map((row) => ({
        installmentId: row._id,
        index: row.index,
        amountFcfa: row.amountFcfa,
        dueAt: row.dueAt,
        status: row.status,
        paidAt: row.paidAt ?? null,
      })),
      payments: payments.map((row) => ({
        paymentId: row._id,
        installmentId: row.installmentId ?? null,
        provider: row.provider,
        amountFcfa: row.amountFcfa,
        status: row.status,
        createdAt: row.createdAt,
        completedAt: row.completedAt ?? null,
      })),
      truncated: rows.length === SCHEDULE_LIMIT,
    };
  },
});

/**
 * LE PRESTATAIRE ACTIF, et le seul endroit du dépôt qui le choisit.
 *
 * `BILLING_PROVIDER` bascule d'un encaisseur à l'autre SANS DÉPLOIEMENT DE
 * CODE — une variable d'environnement Convex, et le prochain clic part
 * ailleurs. C'est ce qui rend la migration réversible : si le premier paiement
 * en bac à sable révèle un défaut chez le nouveau, on revient à l'ancien le
 * temps de comprendre, au lieu de découvrir le problème avec l'argent d'une
 * école.
 *
 * BICTORYS PAR DÉFAUT : c'est le prestataire retenu — 1,5 % en mobile money
 * contre 2,25 %. PayDunya reste entièrement câblé et testé tant que le premier
 * encaissement réel n'a pas eu lieu chez Bictorys ; le retirer avant serait
 * jeter le seul chemin dont on sait qu'il a été écrit contre une documentation
 * complète.
 *
 * L'HISTORIQUE, LUI, N'EST PAS RÉÉCRIT : chaque ligne `payments` garde le
 * prestataire par lequel son argent est passé. Basculer ne change que l'avenir.
 */
function activeProvider(): "paydunya" | "bictorys" {
  return process.env.BILLING_PROVIDER === "paydunya" ? "paydunya" : "bictorys";
}

/**
 * Ouvre un paiement pour une tranche — LE point d'entrée de l'écran.
 *
 * UNE SEULE FONCTION PUBLIQUE, quel que soit le nombre d'adaptateurs. L'écran
 * ne nomme aucun prestataire : il demande à payer une tranche, et le
 * déploiement décide chez qui. Exposer les deux adaptateurs aurait doublé la
 * surface publique pour rien, et laissé l'écran choisir ce qu'il n'a pas à
 * savoir.
 *
 * LA GARDE N'EST PAS ICI, et ce n'est pas un oubli : chaque adaptateur passe par
 * `invoiceTarget`, qui vérifie l'`admin` et relit le montant en base. Une garde
 * de plus ici ferait croire que celle de là-bas est facultative.
 */
export const openPayment = action({
  args: { installmentId: v.id("installments") },
  handler: async (ctx, args): Promise<{ paymentUrl: string }> => {
    return activeProvider() === "paydunya"
      ? await ctx.runAction(internal.billingPaydunya.openInvoice, args)
      : await ctx.runAction(internal.billingBictorys.openInvoice, args);
  },
});

export type InvoiceTarget = {
  installmentId: Id<"installments">;
  subscriptionId: Id<"subscriptions">;
  schoolName: string;
  index: number;
  amountFcfa: number;
};

/**
 * La tranche à facturer, si l'appelant a le droit de la faire payer.
 *
 * APPELÉE DEPUIS UNE ACTION, qui n'a pas de `ctx.db` : `ctx.runQuery` conserve
 * l'identité de la session, donc la garde d'`admin` mord ici exactement comme
 * dans une requête ordinaire. Même montage que `studentCredentials.resetTarget`.
 *
 * ELLE REND LE MONTANT DÛ, et c'est lui qui part chez PayDunya : le prix d'une
 * facture ne se reçoit jamais en argument, pas plus que celui d'un contrat
 * (`pricing.ts`). Un montant fourni par l'appelant serait une facture que
 * n'importe qui pourrait ramener à cent francs.
 *
 * `null` couvre l'introuvable comme l'interdit, sans les distinguer : savoir
 * qu'une tranche existe est déjà une information sur une école.
 */
export const invoiceTarget = internalQuery({
  args: { installmentId: v.id("installments") },
  handler: async (ctx, args): Promise<InvoiceTarget | null> => {
    if (!(await callerIsAdmin(ctx))) return null;

    const installment = await ctx.db.get(args.installmentId);
    if (!installment) return null;
    if (installment.status === "paid") return null;

    const contract = await ctx.db.get(installment.subscriptionId);
    if (!contract) return null;

    // `ownerId` est un `v.string()` au schéma (§4.3 : la cohérence
    // ownerType/ownerId est garantie par le code). On ne le relit comme école
    // que pour un contrat d'école.
    if (contract.ownerType !== "school") return null;
    const school = await ctx.db.get(contract.ownerId as Id<"schools">);

    return {
      installmentId: installment._id,
      subscriptionId: contract._id,
      schoolName: school?.name ?? "École",
      index: installment.index,
      amountFcfa: installment.amountFcfa,
    };
  },
});

/**
 * Ce que le reçu doit dire, relu en base au moment de l'envoi.
 *
 * ELLE N'A PAS DE GARDE, et c'est correct : son seul appelant est l'action
 * d'envoi, déclenchée par `creditInstallment`, jamais par un navigateur. Une
 * garde d'`admin` ici empêcherait le reçu de partir, puisque personne n'est
 * connecté quand le webhook solde une tranche à trois heures du matin.
 *
 * ELLE REND `null` PLUTÔT QUE DE LEVER quand une pièce manque. Un reçu qu'on
 * ne sait pas composer ne doit pas faire échouer une tranche déjà encaissée.
 *
 * LE MONTANT VIENT DE LA TRANCHE, pas du versement : le reçu constate la
 * créance éteinte. Un paiement partiel ne solde pas, donc n'arrive jamais ici.
 */
export const invoiceEmailData = internalQuery({
  args: { installmentId: v.id("installments") },
  handler: async (ctx, args) => {
    const installment = await ctx.db.get(args.installmentId);
    if (!installment) return null;

    const contract = await ctx.db.get(installment.subscriptionId);
    if (!contract || contract.ownerType !== "school") return null;

    const school = await ctx.db.get(contract.ownerId as Id<"schools">);
    if (!school) return null;

    // Le dernier versement encaissé sur cette tranche : c'est lui qui nomme le
    // moyen et porte la référence que l'école citera en cas de litige.
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_subscription", (q) =>
        q.eq("subscriptionId", contract._id),
      )
      .collect();
    const payment = payments
      .filter(
        (p) =>
          p.installmentId === installment._id && p.status === "completed",
      )
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];

    // LES DEUX NOMBRES, ET PAS UN SEUL. `seatsPurchased` est ce que l'école a
    // ACHETÉ, donc ce que la tranche facture ; les inscriptions actives sont ce
    // qu'elle UTILISE. N'afficher que le premier laisserait croire qu'on
    // facture des sièges vides ; n'afficher que le second ferait douter du
    // montant. Les deux côte à côte se répondent, et l'écart se voit.
    const activeStudents = (
      await ctx.db
        .query("schoolMemberships")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", school._id).eq("status", "active"),
        )
        .collect()
    ).length;

    return {
      schoolName: school.name,
      contactName: school.contactName,
      contactEmail: school.contactEmail,
      ninea: school.ninea,
      installmentIndex: installment.index,
      amountFcfa: installment.amountFcfa,
      paidAt: installment.paidAt ?? Date.now(),
      seatsPurchased: contract.seatsPurchased,
      activeStudents,
      provider: payment?.provider ?? "manual",
      providerToken: payment?.providerToken ?? `installment:${installment._id}`,
    };
  },
});

/**
 * Enregistre la facture qu'on vient d'ouvrir chez PayDunya.
 *
 * ELLE NE CRÉDITE RIEN : une facture ouverte n'est pas un paiement, et le
 * statut `initiated` le dit. Seul le webhook solde une tranche, et seulement
 * après avoir reconfirmé auprès de PayDunya (D39).
 *
 * Le jeton est la clé d'idempotence de tout ce qui suit (§8.3, règle 3) : il
 * vient du prestataire, il identifie la facture, et `by_providerToken` le
 * retrouve en une lecture.
 */
export const recordInitiatedPayment = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    installmentId: v.id("installments"),
    provider: chargeProviderValidator,
    providerToken: v.string(),
    amountFcfa: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("payments", {
      subscriptionId: args.subscriptionId,
      installmentId: args.installmentId,
      provider: args.provider,
      providerToken: args.providerToken,
      amountFcfa: args.amountFcfa,
      status: "initiated",
      createdAt: Date.now(),
    });
  },
});

/** Ce que le webhook a fait, pour le journal de la route HTTP. */
export type ApplyPaymentResult = {
  outcome:
    | "credited"
    | "replayed"
    | "already_paid"
    | "amount_short"
    | "not_completed"
    | "unknown_installment";
  activatedSubscription: boolean;
};

/**
 * Applique un paiement CONFIRMÉ — l'unique écriture d'argent du dépôt.
 *
 * TOUT SE PASSE DANS UNE TRANSACTION, et c'est ce qui rend l'idempotence
 * démontrable : la lecture du jeton, la décision, l'écriture de la ligne de
 * paiement, celle de la tranche et celle du contrat sont sérialisées ensemble.
 * Deux webhooks simultanés pour le même jeton ne peuvent pas se croiser — le
 * second voit son ensemble de lecture invalidé et rejoue, sur une ligne déjà
 * `completed`, donc ne fait rien.
 *
 * LE STATUT ET LE MONTANT VIENNENT DE PAYDUNYA, PAS DU POST. L'appelant
 * (`convex/http.ts`) a d'abord vérifié l'empreinte, puis REDEMANDÉ la facture
 * au prestataire ; ce sont ces valeurs-là qui arrivent ici. Le montant est
 * ensuite comparé à ce que la base dit devoir : la règle 2 de §8.3 est donc
 * tenue deux fois.
 *
 * LA LIGNE DE PAIEMENT PEUT MANQUER, et on ne jette pas l'argent pour autant :
 * une action n'est pas transactionnelle, donc l'insertion qui suit la création
 * de la facture peut mourir entre les deux. On la crée alors à partir de la
 * tranche que le `custom_data` de la facture désigne. MAIS QUAND ELLE EXISTE,
 * C'EST ELLE QUI DIT QUELLE TRANCHE SOLDER : ce que nous avons écrit prime
 * toujours sur ce qui nous revient de l'extérieur, et l'empreinte de PayDunya
 * n'est qu'un secret partagé, pas une signature de la charge utile (D39).
 *
 * ELLE NE LÈVE JAMAIS. Une exception renverrait 500 à PayDunya, qui rejouerait
 * indéfiniment ; chaque refus est une valeur de retour, et la route répond 200
 * avec ce que la mutation a décidé.
 */
export const applyPayment = internalMutation({
  args: {
    provider: chargeProviderValidator,
    providerToken: v.string(),
    providerOutcome: providerOutcomeValidator,
    confirmedAmountFcfa: v.number(),
    /**
     * La tranche désignée par le `custom_data` de la facture — UNE CHAÎNE, et
     * pas un `v.id`.
     *
     * Ce texte revient de l'extérieur. Déclaré `v.id("installments")`, un
     * identifiant mal formé ferait échouer la VALIDATION de la mutation, donc
     * lever, donc répondre 500 à PayDunya, qui rejouerait sans fin un appel qui
     * ne pourra jamais aboutir. Reçu en chaîne puis passé par `normalizeId`, il
     * vaut simplement `null` et le paiement est traité comme non attribuable —
     * un refus, pas une boucle.
     */
    fallbackInstallmentRef: v.optional(v.string()),
    rawPayload: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<ApplyPaymentResult> => {
    const now = Date.now();

    // `.first()` ET NON `.unique()`, bien qu'on soit dans une mutation. Le
    // jeton est unique chez le prestataire et nous n'insérons qu'une ligne par
    // facture ouverte ; mais si un doublon existait malgré tout, `.unique()`
    // lèverait à CHAQUE rejeu, et PayDunya rappellerait sans fin une route qui
    // ne crédite plus rien. Un invariant qu'on fait entendre ne doit pas
    // bloquer un encaissement réel.
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_providerToken", (q) =>
        q.eq("providerToken", args.providerToken),
      )
      .first();

    const fallbackId = args.fallbackInstallmentRef
      ? ctx.db.normalizeId("installments", args.fallbackInstallmentRef)
      : null;
    const installmentId = payment?.installmentId ?? fallbackId;
    const installment = installmentId ? await ctx.db.get(installmentId) : null;

    const decision = decidePaymentApplication({
      existingPaymentStatus: payment?.status ?? null,
      providerOutcome: args.providerOutcome,
      confirmedAmountFcfa: args.confirmedAmountFcfa,
      dueAmountFcfa: installment?.amountFcfa ?? null,
      installmentStatus: installment?.status ?? null,
    });

    if (decision.outcome === "replayed") {
      return { outcome: "replayed", activatedSubscription: false };
    }

    // LA CHARGE UTILE EST CONSERVÉE DÈS QU'IL Y A UNE LIGNE OÙ L'ÉCRIRE : un
    // litige se règle sur ce que le prestataire a dit, pas sur ce que nous en
    // avons compris. Quand il n'y a ni ligne de paiement ni tranche, il n'y a
    // rien à quoi la rattacher — ce cas-là part aux journaux, juste en dessous.
    if (payment) {
      await ctx.db.patch(payment._id, {
        rawPayload: args.rawPayload,
        ...(decision.paymentStatus ? { status: decision.paymentStatus } : {}),
        ...(decision.paymentStatus === "completed" ? { completedAt: now } : {}),
      });
    } else if (installment) {
      await ctx.db.insert("payments", {
        subscriptionId: installment.subscriptionId,
        installmentId: installment._id,
        provider: args.provider,
        providerToken: args.providerToken,
        // Le montant CONFIRMÉ, pas le montant dû : la ligne doit dire ce qui
        // est réellement entré, y compris quand c'est trop peu.
        amountFcfa: args.confirmedAmountFcfa,
        status: decision.paymentStatus ?? "initiated",
        rawPayload: args.rawPayload,
        createdAt: now,
        ...(decision.paymentStatus === "completed" ? { completedAt: now } : {}),
      });
    }

    if (decision.outcome === "unknown_installment") {
      // Rien n'a pu être écrit : sans tranche, la ligne de paiement n'a même
      // pas d'abonnement à porter. De l'argent est pourtant arrivé — on le dit
      // aux journaux du déploiement, seul endroit qui restera pour le
      // retrouver. Se taire ici perdrait un versement réel.
      console.error(
        "[billing] paiement sans tranche identifiable",
        args.provider,
        args.providerToken,
      );
    }

    if (!decision.creditsInstallment || !installment) {
      return { outcome: decision.outcome, activatedSubscription: false };
    }

    const activated = await creditInstallment(ctx, installment, now);
    return { outcome: decision.outcome, activatedSubscription: activated };
  },
});

/**
 * Solde une tranche et en tire les conséquences sur le contrat.
 *
 * DEUX APPELANTS, UNE SEULE ÉCRITURE : le webhook quand PayDunya confirme, et
 * le règlement constaté à la main quand l'école a payé par virement. Les deux
 * doivent solder de la même façon — une tranche réglée hors ligne qui
 * n'ouvrirait pas l'accès, ou qui ne sortirait pas l'école de l'impayé, serait
 * un piège que rien ne signale. Deux copies de ce bloc auraient fini par
 * diverger (règle D18 du plan 1/3).
 *
 * L'ANCRE EST RELUE APRÈS LE `patch`, et c'est ce qui rend la réponse exacte :
 * la tranche qu'on vient de solder ne compte plus parmi les impayées. L'ancre
 * qui reste, s'il en reste une, est celle d'une AUTRE tranche en retard — et
 * une école en retard de deux tranches qui n'en paie qu'une est toujours en
 * retard.
 *
 * LE `patch` DU CONTRAT N'ÉCRIT QU'`active`, littéral, et aucun autre champ :
 * ni les dates, ni les sièges, ni les montants. La disjointness de §4.5 reste
 * intacte, et aucune ligne ne peut devenir `cancelled` par ce chemin.
 *
 * PAS DE LIGNE DANS `subscriptionActivations`, et ce n'est pas un oubli : ce
 * journal existe pour qu'un acte HUMAIN irréversible ne soit pas anonyme, et
 * son schéma exige un `actorProfileId` autant qu'un `statusBefore` valant « en
 * attente de paiement ». Ici, le départ peut être « impayé », et l'acte est la
 * conséquence d'un versement. La trace, c'est la ligne `payments` : elle dit
 * quel versement a ouvert l'accès, pour quel montant, à quelle seconde, et —
 * pour un règlement constaté — par qui.
 */
async function creditInstallment(
  ctx: MutationCtx,
  installment: Doc<"installments">,
  now: number,
): Promise<boolean> {
  await ctx.db.patch(installment._id, { status: "paid", paidAt: now });

  // LE REÇU PART D'ICI, et d'ici seulement — même raison que tout le reste de
  // cette fonction (règle D18). Le webhook et le règlement constaté à la main
  // soldent par ce chemin unique ; y accrocher le courriel une seule fois
  // garantit qu'une école payée par virement reçoit le même reçu qu'une école
  // payée par Wave. Deux appels séparés auraient fini par diverger.
  //
  // `runAfter(0)` ET NON UN APPEL DIRECT : une mutation ne peut pas parler au
  // réseau, et un envoi qui échoue ne doit pas annuler un encaissement. La
  // tranche est soldée quoi qu'il arrive au courriel.
  await ctx.scheduler.runAfter(0, internal.billingInvoiceEmail.sendInvoiceEmail, {
    installmentId: installment._id,
  });

  const contract = await ctx.db.get(installment.subscriptionId);
  if (!contract) return false;

  const remainingAnchor = await graceAnchorFor(ctx, contract._id);

  const post = decidePostPayment({
    status: contract.status,
    startsAt: contract.startsAt,
    endsAt: contract.endsAt,
    now,
    hasRemainingOverdue: remainingAnchor !== null,
  });

  if (!post.activate) return false;

  await ctx.db.patch(contract._id, { status: "active" });
  return true;
}

/**
 * Constate un règlement reçu HORS LIGNE — virement, espèces, chèque.
 *
 * POURQUOI ELLE EXISTE, ET POURQUOI S'EN PASSER SERAIT UNE FAUTE. Une école
 * sénégalaise règle souvent par virement. Sans ce chemin, sa tranche resterait
 * `pending`, le cron la marquerait impayée la nuit venue, le contrat passerait
 * en `past_due`, et vingt et un jours plus tard l'application se refermerait
 * sur des enfants dont l'école ne doit RIEN. L'encaissement en ligne introduit
 * ce risque ; il doit donc introduire son remède, sans quoi il vaut mieux ne
 * pas l'introduire du tout.
 *
 * ELLE NE FIXE AUCUN MONTANT. Le versement est enregistré pour ce que la
 * tranche vaut, relu en base : « constaté » veut dire « cette créance-là est
 * éteinte », pas « voici une somme que je décide ». Un montant en argument
 * serait une facture réécrite depuis le navigateur.
 *
 * ELLE NOMME SON AUTEUR — `callerAdminProfile`, une seule lecture qui sert de
 * garde et de source. Déclarer qu'une tranche est réglée engage l'école autant
 * qu'activer son contrat, et le geste ne doit pas être anonyme.
 *
 * ELLE NE PEUT PAS ÊTRE JOUÉE DEUX FOIS : le jeton d'idempotence est
 * `manual:<id de tranche>`, et une tranche déjà réglée est refusée avant tout.
 * Elle ne DÉFAIT rien non plus — annuler un règlement constaté à tort est une
 * question de facturation, avec celle du remboursement (§10).
 */
export const settleInstallmentOffline = mutation({
  args: { installmentId: v.id("installments") },
  handler: async (ctx, args): Promise<{ activatedSubscription: boolean }> => {
    const actor = await callerAdminProfile(ctx);
    if (!actor) throw new ConvexError("Rôle non autorisé");

    const installment = await ctx.db.get(args.installmentId);
    if (!installment) throw new ConvexError("Tranche introuvable");
    if (installment.status === "paid") {
      throw new ConvexError(
        "Cette tranche est déjà réglée : il n'y a rien à constater.",
      );
    }

    const now = Date.now();

    await ctx.db.insert("payments", {
      subscriptionId: installment.subscriptionId,
      installmentId: installment._id,
      provider: "manual",
      providerToken: `manual:${installment._id}`,
      actorProfileId: actor._id,
      amountFcfa: installment.amountFcfa,
      status: "completed",
      createdAt: now,
      completedAt: now,
    });

    const activated = await creditInstallment(ctx, installment, now);
    return { activatedSubscription: activated };
  },
});

/**
 * Le cron quotidien des échéances (§8.6).
 *
 * IL MARQUE, IL NE COUPE PAS. Il écrit `overdue` sur la tranche et `past_due`
 * sur le contrat ; l'accès, lui, s'éteint tout seul vingt et un jours plus tard
 * parce que `decideAccess` compare `now` à l'ancre à chaque lecture. Aucun
 * second cron ne referme quoi que ce soit, et rien n'écrit jamais `expired` —
 * l'échéance se déduit de `endsAt`.
 *
 * LES DEUX ÉCRITURES SONT DANS LA MÊME TRANSACTION, et c'est l'invariante que
 * la spec §8.5 lègue en toutes lettres à ce plan : un `past_due` posé sans la
 * tranche qui l'ancre coupe l'école IMMÉDIATEMENT au lieu de lui laisser ses
 * vingt et un jours, `decideAccess` refusant faute de date à laquelle rattacher
 * la grâce. La règle rend les deux décisions ensemble (`decideOverdue`), et la
 * seconde ne peut pas être vraie sans la première.
 *
 * PAS DE CURSEUR, ET PAS PAR PARESSE : chaque passe fait SORTIR de la fenêtre
 * les lignes qu'elle traite — `pending` devient `overdue`, et la fenêtre ne
 * porte que sur `pending`. Reprendre la première page suffit donc, et se
 * termine : l'ensemble rétrécit strictement à chaque tour. Un curseur, lui,
 * paginerait un index dont on retire les lignes sous ses pieds.
 */
export const markOverdueInstallments = internalMutation({
  args: { marked: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ marked: number; done: boolean }> => {
    const now = Date.now();

    const due = await ctx.db
      .query("installments")
      .withIndex("by_status_dueAt", (q) =>
        q.eq("status", "pending").lte("dueAt", now),
      )
      .take(OVERDUE_BATCH);

    let marked = args.marked ?? 0;

    for (const installment of due) {
      const contract: Doc<"subscriptions"> | null = await ctx.db.get(
        installment.subscriptionId,
      );

      const decision = decideOverdue({
        installmentStatus: installment.status,
        dueAt: installment.dueAt,
        now,
        // Un contrat disparu ne peut pas basculer : la règle reçoit un statut
        // qui n'ouvre rien, et seule la tranche sera marquée. Une tranche
        // orpheline reste une créance exacte.
        subscriptionStatus: contract?.status ?? "expired",
        subscriptionStartsAt: contract?.startsAt ?? 0,
        subscriptionEndsAt: contract?.endsAt ?? 0,
      });

      if (!decision.marksInstallment) continue;

      await ctx.db.patch(installment._id, { status: "overdue" });
      marked++;

      if (decision.marksSubscription && contract) {
        await ctx.db.patch(contract._id, { status: "past_due" });
      }
    }

    if (due.length === OVERDUE_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.billing.markOverdueInstallments,
        { marked },
      );
      return { marked, done: false };
    }

    return { marked, done: true };
  },
});
