import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { TableNames } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// REMISE À ZÉRO D'UN DÉPLOIEMENT — outil de développement, destructeur.
//
// POURQUOI IL EXISTE. Le déploiement de développement porte les restes d'une
// fonctionnalité de génération de médias qui n'a jamais vécu dans ce dépôt :
// `audio`, `boardSpecs` et `video` sur `exerciseExplanations`, `promptAudio` et
// `promptAudioRequestedAt` sur `exercises`. Convex refuse de pousser tant qu'un
// document porte un champ absent du validateur, et il s'arrête au PREMIER champ
// fautif du PREMIER document fautif : chaque tentative n'en révèle qu'un. Après
// trois tours, repartir d'une base propre coûte moins cher que de continuer.
//
// CE N'EST PAS `resetContent.ts`. Celui-là n'efface que sept tables de contenu
// — `exerciseExplanations` n'en fait pas partie, or c'est là que la dérive a
// commencé — et s'arrête à cinq cents lignes par table. Il laisserait
// exactement le problème qu'on veut supprimer.
//
// COMMENT ON L'APPELLE. `npx convex run` s'authentifie avec la clé
// d'administration du déploiement (`client.setAdminAuth` dans le code de la
// CLI) : une fonction `internalMutation` lui est donc accessible, contrairement
// à ce qu'affirme le commentaire de `resetContent.ts`, qui a tort sur ce point.
// La rendre publique l'exposerait à quiconque connaît l'URL du déploiement —
// c'est précisément le trou qu'on a bouché dans `resetContent.ts`.
//
//     npx convex run resetDeployment:wipeEverything \
//       '{"confirmDeployment":"<nom-du-déploiement>","includeAccounts":false}'
//
// SANS `--prod`, LA CLI VISE LE DÉPLOIEMENT DE DÉVELOPPEMENT. Mais une garantie
// qui repose sur l'attention de celui qui tape n'est pas une garantie : voir
// `assertTargetedDeployment` plus bas.
// ---------------------------------------------------------------------------

/**
 * Les sept tables posées par `@convex-dev/auth`, plus `profiles`.
 *
 * ELLES SONT À PART PARCE QUE LES EFFACER ENFERME DEHORS. `convex/roleRules.ts`
 * n'autorise à l'inscription que `parent` ou `student` et lève sur tout autre
 * rôle ; `convex/auth.ts` le dit en toutes lettres : aucun chemin applicatif ne
 * crée un profil `admin`, `directeur` ou `professeur`. Qui efface ces tables se
 * réinscrit donc en ÉLÈVE, et l'espace d'administration — celui des écoles et
 * des paiements — lui devient inatteignable. La seule sortie est manuelle :
 * tableau de bord Convex → Data → `profiles` → passer `role` à `"admin"`.
 *
 * D'où `includeAccounts`, et son défaut de fait dans la documentation ci-dessus
 * : `false`. On repart d'une base propre SANS perdre son propre accès.
 */
const ACCOUNT_TABLES: readonly TableNames[] = [
  "users",
  "authSessions",
  "authAccounts",
  "authRefreshTokens",
  "authVerificationCodes",
  "authVerifiers",
  "authRateLimits",
  "profiles",
];

/**
 * Tout le reste — contenu pédagogique, écoles, facturation, imports.
 *
 * LE TYPE `TableNames` FAIT LE TRAVAIL DE VIGILANCE. Cette liste est un doublon
 * du schéma, et un doublon finit toujours par diverger : une table ajoutée
 * demain serait oubliée ici, et survivrait silencieusement à une remise à zéro
 * censée être totale. Le typage ne rattrape pas l'oubli, mais il rattrape
 * l'autre moitié du problème — une table RENOMMÉE ou SUPPRIMÉE casse la
 * compilation au lieu d'être ignorée à l'exécution.
 */
const DATA_TABLES: readonly TableNames[] = [
  // Contenu pédagogique
  "subjects",
  "topics",
  "exercises",
  "exerciseExplanations",
  "exerciseReports",
  "attempts",
  "studentTopicProgress",
  "topicReports",
  "paliers",
  "palierAttempts",
  "palierAttemptHistory",
  "pdfUploads",
  "badges",
  "earnedBadges",
  // Liens famille
  "studentGuardians",
  "parentSettings",
  "linkRequests",
  "parentLinkCodes",
  // Écoles
  "schools",
  "schoolStaff",
  "schoolClasses",
  "schoolMemberships",
  "schoolMembershipEvents",
  "schoolSeatUsage",
  // Facturation
  "subscriptions",
  "subscriptionAmendments",
  "subscriptionActivations",
  "installments",
  "payments",
  // Imports
  "studentImportJobs",
  "studentImportRows",
  // Dépense IA et réglages
  "aiUsage",
  "aiSpendShards",
  "aiUserQuota",
  "settings",
];

/**
 * Le nombre de documents qu'un seul appel s'autorise à effacer.
 *
 * UNE MUTATION CONVEX EST UNE TRANSACTION, avec des plafonds de lecture et
 * d'écriture. Effacer quarante et une tables d'un coup les dépasserait sur un
 * déploiement vivant, et une transaction qui dépasse n'efface RIEN : on aurait
 * un outil qui échoue d'autant plus sûrement qu'on en a besoin. D'où un budget
 * par appel et une fonction à relancer — c'est le motif que recommandent les
 * consignes Convex du dépôt pour toute suppression en masse.
 */
const BUDGET_PER_CALL = 2_000;

/** Ce qu'un seul passage prend dans une table donnée. */
const BATCH_PER_TABLE = 200;

/**
 * Le nom du déploiement réellement visé, ou `null` si on n'a pas pu le lire.
 *
 * Convex expose `CONVEX_CLOUD_URL` aux fonctions, de la forme
 * `https://<nom>.convex.cloud`.
 */
function currentDeploymentName(): string | null {
  const url = process.env.CONVEX_CLOUD_URL;
  if (!url) return null;
  const match = /^https:\/\/([^.]+)\./.exec(url.trim());
  return match ? match[1] : null;
}

/**
 * Refuse de continuer si le déploiement visé n'est pas celui qu'on a nommé.
 *
 * C'EST LA GARANTIE « DEV ET PAS PROD », ET ELLE NE REPOSE PAS SUR L'ATTENTION.
 * `npx convex run` vise le développement par défaut et la production avec
 * `--prod` : un seul drapeau de trop, ou une variable d'environnement oubliée
 * dans un terminal, et on efface l'application. Exiger que l'appelant ÉCRIVE le
 * nom du déploiement qu'il croit viser transforme cette erreur silencieuse en
 * refus : pour effacer la production il faut taper son nom à elle, ce qui n'est
 * plus un accident mais une décision.
 *
 * ELLE ÉCHOUE FERMÉ. Si `CONVEX_CLOUD_URL` est absente ou d'une forme
 * inattendue, on ne sait pas où l'on est — et ne pas savoir où l'on est n'est
 * pas une raison d'effacer. On refuse plutôt que de supposer.
 */
function assertTargetedDeployment(confirmDeployment: string): string {
  const actual = currentDeploymentName();

  if (actual === null) {
    throw new Error(
      "Impossible d'identifier le déploiement (CONVEX_CLOUD_URL illisible). " +
        "Rien n'a été effacé : sans certitude sur la cible, on ne supprime pas.",
    );
  }

  const expected = confirmDeployment.trim();
  if (expected !== actual) {
    throw new Error(
      `Refus : cette commande vise le déploiement « ${actual} », alors que ` +
        `« ${expected} » a été confirmé. Rien n'a été effacé. Vérifiez si un ` +
        "`--prod` s'est glissé dans la commande.",
    );
  }

  return actual;
}

/**
 * Efface les documents du déploiement, par lots, jusqu'à ce que `done` soit vrai.
 *
 * À RELANCER TANT QUE `done` EST FAUX. Le compte rendu donne le détail par
 * table : tant qu'une ligne y figure, il reste du travail.
 *
 * ELLE NE TOUCHE PAS AUX FICHIERS. Supprimer un document ne supprime pas le
 * fichier qu'il désignait : les narrations audio et les vidéos héritées
 * survivraient, orphelines et facturées. `wipeStorage` s'en charge, séparément
 * et après — l'ordre importe peu, mais deux fonctions valent mieux qu'une qui
 * dépasse son budget.
 *
 * ATTENTION : irréversible. `npx convex export --include-file-storage` AVANT,
 * si l'on tient à pouvoir revenir en arrière.
 */
export const wipeEverything = internalMutation({
  args: {
    confirmDeployment: v.string(),
    includeAccounts: v.boolean(),
  },
  handler: async (ctx, args) => {
    const deployment = assertTargetedDeployment(args.confirmDeployment);

    const tables = args.includeAccounts
      ? [...DATA_TABLES, ...ACCOUNT_TABLES]
      : DATA_TABLES;

    const deleted: Record<string, number> = {};
    let budget = BUDGET_PER_CALL;
    let done = true;

    for (const table of tables) {
      if (budget <= 0) {
        // Budget épuisé avant d'avoir vu toutes les tables : celles qui
        // restent n'ont même pas été regardées, donc on ne peut pas conclure.
        done = false;
        break;
      }

      const rows = await ctx.db
        .query(table)
        .take(Math.min(BATCH_PER_TABLE, budget));

      for (const row of rows) {
        await ctx.db.delete(row._id);
      }

      if (rows.length > 0) {
        deleted[table] = rows.length;
        budget -= rows.length;
      }

      // Un lot plein signifie qu'il en reste probablement : on ne prétend pas
      // avoir fini tant qu'une table n'a pas rendu moins que ce qu'on demandait.
      if (rows.length === BATCH_PER_TABLE) done = false;
    }

    return {
      deployment,
      accountsIncluded: args.includeAccounts,
      deleted,
      totalDeleted: Object.values(deleted).reduce((sum, n) => sum + n, 0),
      done,
      next: done
        ? "Terminé pour les documents. Enchaînez sur resetDeployment:wipeStorage."
        : "Relancez la même commande : il reste des documents.",
    };
  },
});

/**
 * Supprime les fichiers stockés, par lots, jusqu'à ce que `done` soit vrai.
 *
 * POURQUOI SÉPARÉMENT DES DOCUMENTS. Les médias hérités — narrations `gpt-4o-
 * mini-tts`, vidéos rendues — sont l'essentiel de ce qui est facturé au stockage,
 * et ils ne disparaissent pas avec les documents qui les désignaient. Mais les
 * effacer dans la même transaction ferait dépasser le budget d'écriture bien
 * avant la fin.
 *
 * ON ÉNUMÈRE LA TABLE SYSTÈME `_storage`, comme l'imposent les consignes Convex
 * du dépôt : il n'existe pas d'autre inventaire des fichiers, et surtout pas la
 * liste des documents qui les référencent — c'est justement ceux qui ne sont
 * plus référencés qu'on veut atteindre.
 */
export const wipeStorage = internalMutation({
  args: { confirmDeployment: v.string() },
  handler: async (ctx, args) => {
    const deployment = assertTargetedDeployment(args.confirmDeployment);

    const files = await ctx.db.system.query("_storage").take(BATCH_PER_TABLE);
    for (const file of files) {
      await ctx.storage.delete(file._id);
    }

    const done = files.length < BATCH_PER_TABLE;
    return {
      deployment,
      deleted: files.length,
      done,
      next: done
        ? "Terminé. Le déploiement est vide."
        : "Relancez la même commande : il reste des fichiers.",
    };
  },
});
