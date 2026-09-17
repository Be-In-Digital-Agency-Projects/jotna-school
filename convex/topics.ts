import { query, mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { catalogAccess, callerIsAdmin } from "./access";
import { isHiddenClass } from "./curriculum";

// ---------------------------------------------------------------------------
// Queries — IDENTITÉ ET DROIT D'ACCÈS, en une seule décision.
//
// `catalogReadable` (`access.ts`) réunit les deux, et c'est bien DEUX
// questions qu'il pose, pas une :
//
// 1. L'IDENTITÉ. Le paywall seul ne suffit pas : `blockedStudent` rend false
//    pour un appelant NON authentifié, par conception — il ne doit bloquer ni
//    un adulte ni un visiteur. Sans exigence de profil, il se contournait en
//    RETIRANT simplement le jeton de session.
// 2. Le DROIT D'ACCÈS (paywall, spec §5.4). Lecture partagée avec
//    l'administration et les professeurs : seul un élève sans droit valide est
//    bloqué, jamais un adulte.
//
// La première ne remplace pas la seconde — un élève impayé a bien un profil.
// Tous les appelants sont des écrans authentifiés, donc exiger un profil n'en
// casse aucun.
//
// LES DEUX SE POSAIENT EN DEUX APPELS, donc en DEUX résolutions du profil pour
// chaque abonnement au catalogue — et en deux fois la surface d'invalidation,
// `profiles.preferences` étant réécrit à chaque série, badge ou réglage de son.
// Une lecture, deux questions, même réponse qu'avant.
//
// Une requête ne lève jamais : même valeur vide que le chemin nominal.
// ---------------------------------------------------------------------------

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    // Identité, paywall ET niveaux masqués en une lecture — voir `catalogAccess`.
    const access = await catalogAccess(ctx);
    if (!access.readable) return [];

    // LE PLAFOND A MONTÉ AVEC LA BASE. Le collège et le lycée ajoutent 200
    // thématiques que le client ne verra pas : à 200 lignes lues, le filtre
    // ci-dessous pouvait n'en laisser passer qu'une poignée d'élémentaire.
    const topics = await ctx.db.query("topics").take(1000);
    if (access.hiddenClasses) return topics;
    return topics.filter((topic) => !isHiddenClass(topic.class));
  },
});

export const listBySubject = query({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, args) => {
    // Identité, paywall ET niveaux masqués en une lecture — voir `catalogAccess`.
    const access = await catalogAccess(ctx);
    if (!access.readable) return [];

    const topics = await ctx.db
      .query("topics")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", args.subjectId))
      .take(1000);
    const visible = access.hiddenClasses
      ? topics
      : topics.filter((topic) => !isHiddenClass(topic.class));
    return visible.sort((a, b) => a.order - b.order);
  },
});

export const getById = query({
  args: { id: v.id("topics") },
  handler: async (ctx, args) => {
    // Identité, paywall ET niveaux masqués en une lecture — voir `catalogAccess`.
    const access = await catalogAccess(ctx);
    if (!access.readable) return null;

    const topic = await ctx.db.get(args.id);
    if (topic === null) return null;

    // C'EST ICI QUE LE MASQUAGE TIENT VRAIMENT. Retirer une thématique des
    // listes ne la rend pas inatteignable : son identifiant suffit à ouvrir
    // l'écran de session. Un niveau masqué répond donc comme une thématique
    // absente, et non comme un refus — il n'y a rien à faire deviner.
    if (!access.hiddenClasses && isHiddenClass(topic.class)) return null;

    return topic;
  },
});

// ---------------------------------------------------------------------------
// Mutations — garde de RÔLE, pas garde de paywall.
//
// Les cinq écritures ci-dessous créent, modifient et suppriment le curriculum
// lui-même. Elles n'ont rien à voir avec le droit d'accès d'un élève :
// `blockedStudent` et `requireAccess` jugent un abonnement, pas la qualité de
// l'appelant.
//
// `callerIsAdmin` POUR LES CINQ, SANS EXCEPTION. Le curriculum est le bien
// commun de la plateforme : une thématique n'appartient à personne — `topics`
// n'a aucun champ de propriétaire — donc il n'existe ici aucune garde de LIEN
// capable de dire « celle-ci est à vous ». Faute de pouvoir restreindre la
// cible, on restreint l'appelant, et au rôle le plus étroit.
//
// `removeWithExercises` FUT L'EXCEPTION, en `callerIsStaff`, au motif que son
// unique appelant est un écran professeur. L'argument était faux dans les deux
// sens. Une garde ne protège pas un écran, elle protège une fonction : la
// mutation est appelable directement, et le rôle `professeur` ouvrait le
// pouvoir le PLUS destructeur du module à qui `topics.remove` — qui n'efface
// qu'une thématique VIDE — refusait déjà. Le pouvoir le plus large portait la
// garde la plus faible.
//
// Une mutation peut lever, et le garde est la toute première instruction :
// rien n'est lu avant d'avoir établi le rôle. Un seul message pour tous les
// refus de rôle, comme `profiles.linkChild`.
//
// CES REFUS SONT DES `ConvexError`, PARCE QU'UN LECTEUR LES AFFICHE. La règle
// se juge au LECTEUR, jamais au module : hors développement Convex occulte le
// `message` d'une erreur, et seul `data` est transmis TEL QUEL, donc un refus
// qu'un écran montre doit voyager par là. Les écrans le lisent avec
// `refusalMessage` (`lib/refusalMessage.ts`). Sans cette bascule leur repli
// serait INATTEIGNABLE — ils attrapent en `err instanceof Error`, test que
// toute erreur passe puisque `ConvexError` étend `Error` — et l'administrateur
// lirait un message enveloppé et vidé à la place de la phrase écrite ici.
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    subjectId: v.id("subjects"),
    name: v.string(),
    description: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");

    // Verify subject exists
    const subject = await ctx.db.get(args.subjectId);
    if (!subject) {
      throw new ConvexError("Matière introuvable");
    }
    return await ctx.db.insert("topics", {
      subjectId: args.subjectId,
      name: args.name,
      description: args.description,
      order: args.order,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("topics"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");

    const { id, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new ConvexError("Thématique introuvable");
    }
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates[key] = value;
      }
    }
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("topics") },
  handler: async (ctx, args) => {
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");

    // Check if any exercises reference this topic
    const exercise = await ctx.db
      .query("exercises")
      .withIndex("by_topicId", (q) => q.eq("topicId", args.id))
      .first();
    if (exercise) {
      throw new ConvexError(
        "Impossible de supprimer cette thématique car elle contient des exercices. Supprimez-les d'abord — sachant qu'un exercice déjà tenté par un élève ne peut pas être supprimé.",
      );
    }
    await ctx.db.delete(args.id);
  },
});

/**
 * NE PLUS DÉCRIRE CETTE FONCTION COMME UNE CASCADE. Ce bloc l'a fait — « every
 * exercise + attempt + progress + report attached to it » — et c'est resté vrai
 * du contrat exactement aussi longtemps que le contrat était faux : elle
 * effaçait mal, et incomplètement. Le commentaire détaillé se trouve sur la
 * mutation elle-même, plus bas.
 *
 * CE QU'ELLE SERT : écarter un dossier thématique indésirable — typiquement un
 * « Général » auto-créé par une extraction hâtive. Ce besoin est né dans
 * l'espace professeur, d'où son unique appelant ; il n'y appartient pas pour
 * autant, et c'est l'administrateur qui le porte désormais.
 *
 * C'était la pire des onze écritures ouvertes — publique et sans aucune
 * authentification, un simple `Id<"topics">` suffisait à effacer un chapitre,
 * jusqu'à 500 de ses exercices et le travail des élèves dessus. Elle est
 * désormais `callerIsAdmin`, comme les quatre autres écritures du module ; le
 * raisonnement est dans le bloc d'en-tête des mutations.
 *
 * CE QUE CE RESSERREMENT COÛTE, mesuré et non supposé : rien aujourd'hui.
 * L'écran professeur qui l'appelle liste `exercises.listByTeacher`, laquelle
 * filtre sur `exercise.reviewedBy` — un champ que le schéma déclare et que RIEN
 * dans le dépôt n'écrit. La liste est donc vide pour tout le monde, et le
 * bouton de suppression ne s'affiche jamais. Il est en outre réservé aux
 * administrateurs côté écran, pour que la règle se voie au lieu de se
 * découvrir par un refus.
 */
/** Exercices lus au plus pour une suppression. */
const TOPIC_EXERCISES_LIMIT = 500;

/**
 * Supprime une thématique et ses exercices — et REFUSE si quoi que ce soit
 * d'autre les référence.
 *
 * CE N'EST PLUS UNE CASCADE, ET C'EST DÉLIBÉRÉ. Elle en fut une, et elle
 * mentait deux fois. D'abord sur ce qu'elle effaçait : sa boucle lisait
 * `query("attempts").take(500)` — les cinq cents tentatives LES PLUS ANCIENNES
 * de toute la table — une fois PAR exercice, puis filtrait en mémoire, si bien
 * qu'au-delà de cinq cents tentatives celles des exercices supprimés
 * survivaient en pointant vers un exercice effacé. Ensuite sur sa complétude :
 * elle ne connaissait que trois des tables qui référencent une thématique ou
 * ses exercices, sur les huit que porte le schéma.
 *
 * ET UNE CASCADE COMPLÈTE N'EST PAS ATTEIGNABLE ICI. Le graphe n'a aucune
 * intégrité référentielle, et chaque arête suivie en découvre une autre :
 * supprimer les `paliers` d'une thématique orphelinerait les `palierAttempts`
 * qui les désignent, dont ceux qu'un enfant vient d'ouvrir sans avoir encore
 * répondu. Une suppression transitive correcte est un travail de migration,
 * pas un bouton d'écran.
 *
 * LA FONCTION NE DÉTRUIT DONC QUE CE QU'ELLE PEUT PROUVER ISOLÉ : les
 * exercices de la thématique, et la thématique. Tout le reste la fait refuser.
 * C'est exact par construction, et c'est vérifiable en relisant le schéma —
 * là où une cascade demande de faire confiance à une liste.
 *
 * LES CINQ REFUS COUVRENT LES HUIT RÉFÉRENCES, et voici pourquoi :
 *   - `attempts.exerciseId`, `topicReports.topicId`, `paliers.topicId`,
 *     `studentTopicProgress.topicId`, `exerciseExplanations.exerciseId` sont
 *     contrôlés directement, un par un.
 *   - `palierAttempts.failedExerciseIds` ne peut exister sans un `paliers` de
 *     cette thématique, que le troisième refus exclut déjà.
 *   - `exercises.originalExerciseId` désigne une variation, créée avec le
 *     `topicId` de son original (`paliers/index.ts`) : les deux partent donc
 *     ensemble.
 *   - `exerciseReports.exerciseId` n'a AUCUN écrivain dans le dépôt — table
 *     morte. Le jour où elle en gagne un, il faudra un sixième refus ici.
 *
 * `studentTopicProgress` EST CONTRÔLÉE, et l'ancienne version de ce
 * commentaire prétendait à tort que c'était inutile. Le raisonnement était :
 * ses deux seuls écrivains exigent une tentative, donc le refus sur les
 * tentatives la couvre. Il est faux, parce qu'une progression peut SURVIVRE à
 * son exercice, et la boucle ci-dessous n'itère que sur les exercices ENCORE
 * présents.
 *
 * La porte qui produisait ces survivantes est désormais fermée —
 * `pdfUploads.remove` effaçait des exercices sans toucher aux tentatives ni
 * aux progressions, elle refuse maintenant — MAIS LE CONTRÔLE RESTE. Fermer
 * une porte n'efface pas ce qui est déjà passé : les lignes créées avant ce
 * correctif survivent en base, et rien ne les nettoie. Un contrôle qui ne
 * vaudrait que pour les données futures n'est pas un contrôle.
 */
export const removeWithExercises = mutation({
  args: { id: v.id("topics") },
  handler: async (ctx, { id }) => {
    if (!(await callerIsAdmin(ctx))) throw new ConvexError("Rôle non autorisé");

    const topic = await ctx.db.get(id);
    if (!topic) throw new ConvexError("Thématique introuvable");

    const exercises = await ctx.db
      .query("exercises")
      .withIndex("by_topicId", (q) => q.eq("topicId", id))
      .take(TOPIC_EXERCISES_LIMIT + 1);

    // La ligne de plus distingue « exactement à la borne » de « au-delà ». Une
    // suppression partielle laisserait une thématique vidée à moitié, pire que
    // pas de suppression du tout.
    if (exercises.length > TOPIC_EXERCISES_LIMIT) {
      throw new ConvexError(
        `Cette thématique contient plus de ${TOPIC_EXERCISES_LIMIT} exercices et ne peut pas être supprimée d'un seul geste.`,
      );
    }

    for (const exercise of exercises) {
      const attempt = await ctx.db
        .query("attempts")
        .withIndex("by_exerciseId", (q) => q.eq("exerciseId", exercise._id))
        .first();
      if (attempt) {
        throw new ConvexError(
          "Impossible de supprimer cette thématique car des élèves ont déjà travaillé sur ses exercices.",
        );
      }

      const explanation = await ctx.db
        .query("exerciseExplanations")
        .withIndex("by_exercise", (q) => q.eq("exerciseId", exercise._id))
        .first();
      if (explanation) {
        throw new ConvexError(
          "Impossible de supprimer cette thématique car un élève a demandé une explication sur l'un de ses exercices.",
        );
      }
    }

    const report = await ctx.db
      .query("topicReports")
      .withIndex("by_topicId", (q) => q.eq("topicId", id))
      .first();
    if (report) {
      throw new ConvexError(
        "Impossible de supprimer cette thématique car elle porte déjà un bulletin d'élève.",
      );
    }

    const progress = await ctx.db
      .query("studentTopicProgress")
      .withIndex("by_topicId", (q) => q.eq("topicId", id))
      .first();
    if (progress) {
      throw new ConvexError(
        "Impossible de supprimer cette thématique car elle porte déjà la progression d'un élève.",
      );
    }

    // `by_topic_class` commence par `topicId`, donc il répond sans la classe.
    const palier = await ctx.db
      .query("paliers")
      .withIndex("by_topic_class", (q) => q.eq("topicId", id))
      .first();
    if (palier) {
      throw new ConvexError(
        "Impossible de supprimer cette thématique car des paliers ont été générés pour elle.",
      );
    }

    for (const exercise of exercises) {
      await ctx.db.delete(exercise._id);
    }
    await ctx.db.delete(id);

    return { deletedExercises: exercises.length };
  },
});
