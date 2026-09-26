import type { FunctionReturnType } from "convex/server";

import { api } from "@convex/_generated/api";
import type { Id, TableNames } from "@convex/_generated/dataModel";

/**
 * UN ÉLÈVE QUI N'EXISTE PAS, POUR REGARDER DES ÉCRANS QUI EXISTENT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE C'EST, ET CE QUE CE N'EST PAS.
 *
 * Ce sont les VRAIS écrans, les vrais composants, la vraie mise en page — avec
 * des données FABRIQUÉES à la place du serveur. Rien ici n'est du produit :
 * `preview/` n'entre jamais dans le paquet natif, et l'aiguillage qui le
 * substitue à `convex/react` ne s'arme que sous `JOTNA_PREVIEW=1`
 * (`metro.config.js`).
 *
 * POURQUOI IL A FALLU EN VENIR LÀ. Sans dorsale, `SessionGate` ne laisse voir
 * que le pavé de code : tout le reste est derrière l'authentification. Et un
 * backend Convex local n'est pas téléchargeable depuis ce conteneur, dont la
 * politique de sortie refuse `api.convex.dev`. Restait à mentir à la couche de
 * données plutôt qu'aux écrans.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LES FORMES NE SONT PAS DEVINÉES, ELLES SONT TYPÉES.
 *
 * Chaque valeur est annotée `FunctionReturnType<typeof api.X>` : c'est le type
 * que le SERVEUR rend réellement, et le compilateur refuse le moindre champ
 * manquant ou mal nommé. Une donnée d'aperçu qui dériverait du serveur
 * montrerait un écran que personne ne verra jamais — ce qui est pire que pas
 * d'aperçu du tout, parce que ça se croit.
 *
 * DEUX CORRECTIONS VENUES DU RENDU, et elles disent ce que vaut l'exercice.
 * Ces données avaient d'abord `nextPalierIndex: 0` pour une thématique
 * neuve, et des EMOJIS dans `badge.icon`. Les deux sont impossibles : le
 * serveur numérote les paliers de 1 à 10 en partant de
 * `maxValidatedPalierIndex = 0`, et `badgeIcon` attend un nom d'icône
 * Lucide. L'aperçu montrait donc « Palier 0 à faire » et sept trophées
 * identiques — deux défauts qui n'existaient que dans le jeu d'épreuve.
 * Une donnée d'aperçu fausse accuse le code à tort, et c'est la seule
 * façon dont cet outil peut nuire.
 *
 * LE COMPTE EST GARNI À DESSEIN. Un démarrage à froid affiche trois zéros et
 * ne montre rien de ce qui a été construit — c'est d'ailleurs la consigne des
 * captures de boutique (`docs/legal/fiches-boutique.md`).
 */

const id = <T extends TableNames>(v: string): Id<T> => v as Id<T>;

const NOW = Date.UTC(2026, 8, 26, 10, 0, 0);

export const accessState: FunctionReturnType<typeof api.access.getAccessState> =
  { ok: true, schoolId: "ecole-demo", endsAt: NOW + 120 * 24 * 3600 * 1000 };

export const myStats: FunctionReturnType<typeof api.students.getMyStats> = {
  student: {
    _id: id<"profiles">("profile-aminata"),
    _creationTime: NOW - 90 * 24 * 3600 * 1000,
    name: "Aminata Diallo",
    userId: "user-aminata",
    role: "student",
    class: "CM1",
    avatar: undefined,
  },
  totalExercises: 214,
  totalCorrectExercises: 178,
  totalStars: 47,
  totalTimeMs: 6_420_000,
  completedTopics: 6,
  badgeCount: 5,
  level: 5,
  exosToNextLevel: 36,
  currentStreak: 4,
  longestStreak: 11,
  streaksEnabled: true,
  favoriteSubject: "Mathématiques",
  soundEnabled: true,
  soundOptInDecided: true,
  unseenBadges: [],
  unseenLevelUp: null,
  recentBadges: [],
};

export const subjects: FunctionReturnType<typeof api.subjects.list> = [
  {
    _id: id<"subjects">("sub-maths"),
    _creationTime: NOW,
    name: "Mathématiques",
    icon: "Calculator",
    color: "#4f46e5",
    order: 1,
  },
  {
    _id: id<"subjects">("sub-francais"),
    _creationTime: NOW,
    name: "Français",
    icon: "Book",
    color: "#db2777",
    order: 2,
  },
  {
    _id: id<"subjects">("sub-sciences"),
    _creationTime: NOW,
    name: "Sciences",
    icon: "Flask",
    color: "#10b981",
    order: 3,
  },
  {
    // L'EMC est là EXPRÈS : c'est elle qui affichait « US » avant que la table
    // d'emojis connaisse `Users`. Un aperçu qui ne montre que les cas qui
    // marchent ne sert à rien.
    _id: id<"subjects">("sub-emc"),
    _creationTime: NOW,
    name: "EMC",
    icon: "Users",
    color: "#6b7280",
    order: 4,
  },
];

export const subjectMap: FunctionReturnType<
  typeof api.students.getStudentSubjectMap
> = {
  subject: {
    _id: id<"subjects">("sub-maths"),
    name: "Mathématiques",
    icon: "Calculator",
    color: "#4f46e5",
  },
  topics: [
    {
      _id: id<"topics">("topic-add"),
      name: "Additions et soustractions",
      description: "Poser et calculer jusqu'à 1 000.",
      order: 1,
      class: "CM1",
      status: "completed",
      validatedPaliers: 10,
      nextPalierIndex: 10,
      starsApprox: 27,
      completedExercises: 50,
      correctExercises: 45,
    },
    {
      _id: id<"topics">("topic-frac"),
      name: "Les fractions",
      description: "Lire, comparer et additionner des fractions simples.",
      order: 2,
      class: "CM1",
      status: "in_progress",
      validatedPaliers: 6,
      nextPalierIndex: 6,
      starsApprox: 14,
      completedExercises: 31,
      correctExercises: 24,
    },
    {
      _id: id<"topics">("topic-geo"),
      name: "Géométrie : les angles",
      description: "Reconnaître et mesurer un angle droit.",
      order: 3,
      class: "CM1",
      status: "available",
      validatedPaliers: 0,
      nextPalierIndex: 1,
      starsApprox: 0,
      completedExercises: 0,
      correctExercises: 0,
    },
    {
      _id: id<"topics">("topic-mesures"),
      name: "Les mesures de longueur",
      description: "Du millimètre au kilomètre.",
      order: 4,
      class: "CM1",
      status: "locked",
      validatedPaliers: 0,
      nextPalierIndex: 1,
      starsApprox: 0,
      completedExercises: 0,
      correctExercises: 0,
    },
  ],
  totalStarsApprox: 41,
};

type BadgeDoc = FunctionReturnType<typeof api.badges.list>[number];

const badge = (
  key: string,
  name: string,
  description: string,
  icon: string,
  rarity: BadgeDoc["rarity"],
  criteriaText: string,
  order: number,
): BadgeDoc => ({
  _id: id<"badges">(key),
  _creationTime: NOW,
  name,
  description,
  icon,
  rarity,
  criteriaText,
  condition: key,
  order,
});

const catalogue: BadgeDoc[] = [
  badge(
    "premier-pas",
    "Premier pas",
    "Ton tout premier exercice réussi.",
    "Footprints",
    "common",
    "Réussir 1 exercice",
    1,
  ),
  badge(
    "serie-3",
    "Trois jours de suite",
    "Tu es venu trois jours d'affilée.",
    "Zap",
    "common",
    "3 jours de série",
    2,
  ),
  badge(
    "palier-parfait",
    "Sans faute",
    "Un palier entier sans une seule erreur.",
    "Star",
    "rare",
    "10 sur 10 à un palier",
    3,
  ),
  badge(
    "cent-exos",
    "Cent exercices",
    "Cent exercices, déjà.",
    "Target",
    "rare",
    "100 exercices réussis",
    4,
  ),
  badge(
    "theme-fini",
    "Thématique bouclée",
    "Les dix paliers d'une thématique.",
    "Trophy",
    "epic",
    "Terminer une thématique",
    5,
  ),
  badge(
    "matin",
    "Lève-tôt",
    "Un exercice avant huit heures.",
    "Sunrise",
    "epic",
    "Travailler avant 8 h",
    6,
  ),
  badge(
    "serie-30",
    "Un mois entier",
    "Trente jours de série.",
    "Medal",
    "legendary",
    "30 jours de série",
    7,
  ),
];

export const badgeList: FunctionReturnType<typeof api.badges.list> = catalogue;

export const earnedBadges: FunctionReturnType<typeof api.badges.listMyEarned> =
  catalogue.slice(0, 5).map((b, i) => ({
    _id: id<"earnedBadges">(`earned-${b._id}`),
    _creationTime: NOW,
    studentId: id<"profiles">("profile-aminata"),
    badgeId: b._id,
    earnedAt: NOW - (i + 1) * 3 * 24 * 3600 * 1000,
    badge: b,
  }));

export const topicById: FunctionReturnType<typeof api.topics.getById> = {
  _id: id<"topics">("topic-frac"),
  _creationTime: NOW,
  name: "Les fractions",
  description: "Lire, comparer et additionner des fractions simples.",
  order: 2,
  subjectId: id<"subjects">("sub-maths"),
  class: "CM1",
};

export const soundEnabled = true;
