import { internalMutation } from "./_generated/server";

/**
 * Efface le contenu pédagogique — PDF, thématiques, exercices, tentatives,
 * progressions, bulletins, badges obtenus — en laissant intacts les comptes,
 * les matières et les définitions de badges.
 *
 * ELLE ÉTAIT PUBLIQUE, ET SA SEULE PROTECTION ÉTAIT UNE PHRASE. Le commentaire
 * disait « ne pas exposer depuis l'interface », ce qui ne protège de rien :
 * une `mutation` Convex publique est appelable par quiconque connaît l'URL du
 * déploiement, écran ou pas. Un appelant NON AUTHENTIFIÉ pouvait donc effacer
 * le travail de tous les élèves d'une application devenue payante, d'un seul
 * appel et sans laisser de trace.
 *
 * Elle est désormais INTERNE, donc hors de l'API publique, comme
 * `subjects.seedDefaults` l'est déjà pour la même raison : un outil de
 * développement n'a pas d'appelant porteur de session à qui demander un rôle,
 * donc on ne le garde pas — on le retire de la surface.
 *
 * CE QU'« INTERNE » VEUT DIRE, EXACTEMENT. Ce commentaire affirmait qu'une
 * fonction interne « ne s'appelle que depuis une autre fonction Convex » et que
 * la ligne `convex run resetContent:wipeAll` ne marchait donc plus. C'est FAUX,
 * et la CLI le montre : `convex run` pose une authentification d'ADMINISTRATION
 * (`client.setAdminAuth`, dans `convex/dist/cjs/cli/lib/run.js`), qui atteint
 * les fonctions internes comme le fait le tableau de bord. La commande marche.
 *
 * Ce qui change vraiment — et c'était bien le but — est ailleurs : une
 * `mutation` publique est appelable par QUICONQUE connaît l'URL du déploiement,
 * sans rien posséder. Une fonction interne exige la clé d'administration, que
 * seul le propriétaire du déploiement détient. On n'a pas fermé la porte, on
 * l'a mise sous clé. C'est la protection recherchée ; la formulation précédente
 * en promettait une autre, plus forte, qui n'existe pas.
 *
 * POUR UNE REMISE À ZÉRO COMPLÈTE, CE N'EST PAS ICI. Voir
 * `convex/resetDeployment.ts` : `wipeAll` ne couvre que les sept tables
 * ci-dessous — ni `exerciseExplanations`, ni les écoles, ni la facturation.
 *
 * SON NOM PROMET PLUS QU'ELLE NE FAIT, et c'était déjà vrai : `.take(500)` par
 * table, donc au plus cinq cents lignes chacune. Au-delà, elle laisse des
 * restes — et comme elle efface les tables filles avant les mères sans garantir
 * d'avoir tout pris, ces restes peuvent pointer vers des documents effacés. À
 * relancer jusqu'à ce que les compteurs rendus tombent à zéro.
 *
 * ATTENTION : irréversible.
 */
export const wipeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const deletedCounts: Record<string, number> = {};

    const wipe = async (
      table:
        | "pdfUploads"
        | "exercises"
        | "topics"
        | "attempts"
        | "studentTopicProgress"
        | "topicReports"
        | "earnedBadges",
    ) => {
      const rows = await ctx.db.query(table).take(500);
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      deletedCounts[table] = rows.length;
    };

    // Tables filles d'abord, puis leurs mères.
    await wipe("attempts");
    await wipe("studentTopicProgress");
    await wipe("topicReports");
    await wipe("earnedBadges");
    await wipe("exercises");
    await wipe("pdfUploads");
    await wipe("topics");

    return deletedCounts;
  },
});
