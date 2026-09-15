/**
 * Library de copy bienveillant kid-friendly (Decision 82).
 *
 * Tous les messages affichés à l'enfant (8-11 ans, contexte Sénégal) passent par ici.
 * Reste cohérent : ton encourageant, jamais culpabilisant, ouverture vers une suite.
 */

export const kidMessages = {
  // Validation palier
  palierValidated: (stars: number) =>
    `🎉 Bravo ! Tu as gagné ${stars}⭐ ! Palier validé.`,
  palierValidatedShort: '🎉 Palier validé !',
  palierFailed: (stars: number) =>
    `Palier non validé (${stars}⭐ sur 30). Pas grave, on va réessayer ensemble !`,

  // Régénération (Decision 87)
  regenIntro:
    "On va te proposer des nouveaux exercices similaires pour t'aider à mieux comprendre 💡",
  regenLoading: 'Aïssatou prépare tes nouveaux exos...',
  regenCta: 'Allez !',

  // Limites budget / quota (Decision 82)
  budgetExceeded:
    "Oh, on a beaucoup travaillé aujourd'hui ! 🌙 Reviens demain, des nouveaux exos t'attendent.",
  jenVeuxEncoreLimit:
    "Tu as déjà fait 3 séries d'exos en bonus aujourd'hui ! Reviens demain pour en faire d'autres 🌟",

  // Accès non ouvert par l'école (spec §5.8)
  accessNotOpen:
    "Ton espace n'est pas encore ouvert 🌱 Parle-en à ton maître ou à ta maîtresse, ils vont s'en occuper !",

  // 3 alternatives sur cap regen atteint (Decision 83)
  capRegenReached: {
    intro: "On t'a vu galérer 💪. Voici ce que tu peux faire :",
    options: [
      { icon: '📖', label: 'Voir un exo corrigé en détail', cta: 'Voir' },
      { icon: '🔄', label: 'Refaire le palier précédent', cta: 'Y aller' },
      { icon: '🆘', label: 'Demander de l\'aide à ton parent', cta: 'Prévenir' },
    ],
  },

  // Réseau / erreurs (Decisions 90, 64)
  networkLost:
    "On a perdu la connexion, mais ne t'inquiète pas, on garde tes réponses ! 💾",
  networkBack: 'On est de retour ! Tu peux continuer 🚀',
  genTimeout:
    'Ça prend un peu de temps... attends-moi ou réessaie dans quelques secondes.',
  genFailed: 'Petit souci ! On essaie autre chose 🔧',

  // Hints (Decision 93)
  hintLevel: (i: number, total: number) =>
    `Indice ${i}/${total} utilisé — un peu moins d'étoiles cette fois 🌟`,

  // Loader rotating messages
  loaderMessages: [
    'Aïssatou prépare tes exos...',
    'On charge tes exercices...',
    'Modou écrit les questions...',
    'Encore quelques secondes...',
    'Tes exos arrivent !',
  ],

  // CTAs récurrents
  cta: {
    submit: 'Valider',
    next: 'Suivant',
    retry: 'Réessayer',
    quit: 'Sauvegarder et quitter',
    seeMore: "J'en veux encore !",
  },

  // Footer / mention programme officiel (Decision 91 — pour parent dashboard)
  inspiredByProgram: 'Inspiré du programme officiel sénégalais',
} as const;

export type KidMessages = typeof kidMessages;
