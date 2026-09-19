/**
 * LES MODULES OPTIONNELS — ce qu'une école peut allumer, et ce que ça ouvre.
 *
 * UN MODULE N'EST PAS UNE MATIÈRE. Les matières (`subjects`) sont le tronc
 * commun : toute école abonnée les a, aucune ne les choisit. Un module est un
 * ENSEIGNEMENT EN PLUS, qu'une école prend ou ne prend pas — ici l'arabe et la
 * lecture du Coran, que toutes les écoles du Sénégal ne donnent pas, et que
 * celles qui le donnent ne veulent pas forcément dans la même application.
 *
 * L'ÉTAT PAR DÉFAUT EST « ÉTEINT », et c'est la décision qui compte : une
 * école qui n'a rien demandé ne doit pas découvrir un enseignement religieux
 * dans l'espace de ses élèves. L'absence de ligne dans `schoolModules` vaut
 * donc « non », et `modules.enabledForSchool` le lit ainsi.
 *
 * CE FICHIER EST PUR — le schéma l'importe pour son validateur, les écrans
 * pour leurs libellés, `modules.ts` pour ses gardes. Même motif que
 * `convex/curriculum.ts`, qui tient les niveaux scolaires.
 */

import { v, type Infer } from "convex/values";

/**
 * Les clés de module, fermées au schéma.
 *
 * Une union d'UN SEUL littéral aujourd'hui, et c'est volontaire : la table est
 * générique parce qu'un deuxième module viendra (l'anglais renforcé revient
 * dans les discussions), mais tant qu'il n'existe pas, le schéma refuse toute
 * autre valeur — une clé inventée par un client ne peut pas s'écrire en base.
 * Élargir une union est additif : aucune ligne déjà écrite n'en devient
 * invalide.
 */
export const moduleKeyValidator = v.union(v.literal("arabe_coran"));

export type ModuleKey = Infer<typeof moduleKeyValidator>;

export interface ModuleDescriptor {
  key: ModuleKey;
  /** Le nom tel qu'il s'affiche à une école et à un enfant. */
  title: string;
  /** Une phrase, pour la case à cocher de l'écran d'école. */
  summary: string;
  /** L'adresse de l'espace élève que le module ouvre. */
  studentHref: string;
  emoji: string;
  color: string;
}

export const MODULES: readonly ModuleDescriptor[] = [
  {
    key: "arabe_coran",
    title: "Arabe & Coran",
    summary:
      "Apprentissage de l'alphabet arabe (écoute, prononciation, écriture au " +
      "doigt) puis lecture progressive de l'arabe et de sourates courtes.",
    studentHref: "/student/arabe",
    emoji: "🕌",
    color: "#15803d",
  },
];

const BY_KEY: ReadonlyMap<string, ModuleDescriptor> = new Map(
  MODULES.map((module) => [module.key, module]),
);

/** Le descripteur, ou `null` si la clé ne désigne aucun module. */
export function getModule(key: string): ModuleDescriptor | null {
  return BY_KEY.get(key) ?? null;
}
