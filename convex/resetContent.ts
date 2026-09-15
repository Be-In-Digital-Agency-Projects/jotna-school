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
 * CONSÉQUENCE ASSUMÉE, IDENTIQUE À CELLE DE `seedDefaults` : elle n'a plus
 * aucun appelant, et une fonction interne ne s'appelle que depuis une autre
 * fonction Convex. Tant que personne ne la câble explicitement, elle ne
 * s'exécute pas. C'est voulu : mieux vaut un effacement à rebrancher à dessein
 * qu'un effacement que n'importe qui déclenche. La ligne d'usage
 * `pnpx convex run resetContent:wipeAll` a donc été retirée plutôt que laissée
 * à vérifier par le prochain lecteur.
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
