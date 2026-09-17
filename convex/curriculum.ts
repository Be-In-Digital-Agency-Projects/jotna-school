import { v, type Infer } from "convex/values";

// ---------------------------------------------------------------------------
// LES NIVEAUX SCOLAIRES, ET CEUX QU'ON NE MONTRE PAS ENCORE.
//
// `classEnum` (`convex/schema.ts`) énumère TOUT ce qu'un document a le droit de
// porter : l'élémentaire servi aujourd'hui, et le collège et le lycée, dont le
// déploiement de développement porte déjà 200 thématiques et 1882 exercices.
// Cette donnée est réelle et se garde — on y travaillera plus tard.
//
// CE FICHIER TRANCHE L'AUTRE QUESTION : ce que le CLIENT a le droit de voir.
// Aujourd'hui, l'élémentaire seul. Ni un élève, ni un parent, ni un professeur,
// ni une école n'atteint une thématique de collège ou de lycée — ni par une
// liste, ni par un identifiant deviné. Seul un `admin` les voit, parce que
// c'est lui qui les prépare.
//
// DEUX LISTES PLUTÔT QU'UN DRAPEAU PAR DOCUMENT. Masquer par niveau se décide
// ici, en une ligne, et vaut pour les 200 thématiques d'un coup ; un champ
// `hidden` demanderait une écriture par document, une reprise à chaque import,
// et divergerait au premier oubli.
//
// OUVRIR LE COLLÈGE, LE JOUR VENU : déplacer les niveaux voulus de
// `HIDDEN_CLASSES` vers `VISIBLE_CLASSES`. Rien d'autre à toucher — les gardes
// et les validateurs lisent ces deux listes.
// ---------------------------------------------------------------------------

/**
 * TOUT ce qu'un document a le droit de porter — élémentaire, collège, lycée.
 *
 * Le schéma l'importe (`convex/schema.ts`) plutôt que de le définir : le
 * vocabulaire des niveaux se décide ici, avec les deux listes qui disent
 * lesquels se montrent.
 */
export const classEnum = v.union(
  // Élémentaire — le programme servi aujourd'hui.
  v.literal("CI"),
  v.literal("CP"),
  v.literal("CE1"),
  v.literal("CE2"),
  v.literal("CM1"),
  v.literal("CM2"),

  // COLLÈGE ET LYCÉE — EN BASE, MASQUÉS CÔTÉ CLIENT.
  //
  // 200 thématiques, 200 paliers et 1882 exercices les portent déjà sur le
  // déploiement de développement. Ils viennent d'un code qui n'a jamais vécu
  // ici, et ils se gardent : le collège viendra, plus tard.
  //
  // CE QUE LEUR ABSENCE COÛTAIT. Convex refuse de pousser un schéma qu'un
  // document existant contredit : tant que ces sept niveaux manquaient, aucune
  // poussée ne passait sans couper `schemaValidation` — c'est-à-dire sans
  // renoncer à la validation de TOUTES les tables, production comprise.
  v.literal("6e"),
  v.literal("5e"),
  v.literal("4e"),
  v.literal("3e"),
  v.literal("2nde"),
  v.literal("1ere"),
  v.literal("Tle"),
);

export type ClassName = Infer<typeof classEnum>;

/** Un niveau que le client voit. */
export type VisibleClassName = (typeof VISIBLE_CLASSES)[number];

/** Ce que le client voit, dans l'ordre scolaire. */
export const VISIBLE_CLASSES = [
  "CI",
  "CP",
  "CE1",
  "CE2",
  "CM1",
  "CM2",
] as const satisfies readonly ClassName[];

/** Présent en base, masqué partout sauf pour un `admin`. */
export const HIDDEN_CLASSES = [
  "6e",
  "5e",
  "4e",
  "3e",
  "2nde",
  "1ere",
  "Tle",
] as const satisfies readonly ClassName[];

const HIDDEN: ReadonlySet<string> = new Set(HIDDEN_CLASSES);

/**
 * Vrai pour un niveau qu'on masque.
 *
 * UN NIVEAU ABSENT N'EST PAS MASQUÉ. `topics.class` et `profiles.class` sont
 * optionnels — les lignes semées avant la décision 14 n'en portent pas — et
 * elles appartiennent à l'élémentaire. Les masquer viderait le catalogue.
 */
export function isHiddenClass(klass: string | undefined | null): boolean {
  return typeof klass === "string" && HIDDEN.has(klass);
}

/**
 * Le validateur des ÉCRITURES : ce qu'une personne a le droit de poser.
 *
 * Plus étroit que `classEnum` à dessein. Le schéma doit accepter le collège et
 * le lycée, sans quoi les documents déjà en base deviennent invalides et toute
 * poussée échoue ; une classe d'école, elle, n'a aucune raison d'être créée en
 * `2nde` tant que le niveau n'est pas servi. Le refus arrive alors à l'entrée,
 * pas au moment où un écran vide laisse croire à une panne.
 *
 * REMPLACE DEUX COPIES : `convex/schools.ts` et `convex/paliers/index.ts`
 * portaient chacun la sienne, recopiée de `classEnum` faute d'export.
 */
export const visibleClassValidator = v.union(
  v.literal("CI"),
  v.literal("CP"),
  v.literal("CE1"),
  v.literal("CE2"),
  v.literal("CM1"),
  v.literal("CM2"),
);

/**
 * Rend le niveau s'il est visible, lève sinon.
 *
 * POUR LES CHEMINS QUI NE SAVENT PAS FAIRE AUTREMENT. Les invites de génération
 * (`convex/paliers/prompts.ts`) sont calibrées pour l'élémentaire : leur passer
 * une seconde ou une terminale produirait un exercice que personne n'a relu.
 * Aucun écran ne peut y mener — les validateurs d'écriture refusent déjà ces
 * niveaux — donc y arriver signale une donnée héritée, pas une action : on
 * s'arrête au lieu de générer n'importe quoi.
 */
export function assertVisibleClass(klass: ClassName): VisibleClassName {
  if (isHiddenClass(klass)) {
    throw new Error(
      `Le niveau « ${klass} » n'est pas encore servi : ` +
        "collège et lycée sont en base mais masqués (convex/curriculum.ts).",
    );
  }
  return klass as VisibleClassName;
}
