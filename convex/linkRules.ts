/**
 * Règle d'autorisation du rattachement élève ↔ tuteur — fonction PURE.
 *
 * Aucune lecture de base ici : `profiles.linkChild` lit l'appelant et la cible,
 * puis passe les scalaires sur lesquels la décision porte. Même découpage que
 * accessRules.ts (pur, testé) / access.ts (I/O).
 *
 * Ce que cette fonction décide : QUI peut déclarer QUELLE relation, et sur
 * quelle sorte de profil. Ce qu'elle ne décide PAS, faute de donnée capable de
 * l'établir : si l'appelant a un droit sur CET élève-là. Voir le commentaire de
 * `profiles.linkChild`.
 */

/** Relations stockées dans `studentGuardians.relation` (convex/schema.ts). */
export type LinkRelation = "parent" | "tuteur" | "professeur";

export type LinkDenyReason = "relation_role_mismatch" | "target_not_student";

export type LinkDecision = { ok: true } | { ok: false; reason: LinkDenyReason };

export interface LinkInput {
  /** `profiles.role` de l'appelant, dérivé de la session par le handler. */
  guardianRole: string;
  /** Relation que l'appelant déclare vouloir créer. */
  relation: LinkRelation;
  /** `profiles.role` de la cible, ou null si le profil est introuvable. */
  targetRole: string | null;
}

/**
 * Rôle exigé pour déclarer une relation donnée.
 *
 * `profiles.role` ne contient pas "tuteur" : un tuteur légal est un profil de
 * rôle `parent` qui déclare la relation "tuteur". "directeur" et "admin" ne
 * correspondent à aucune relation — le rattachement d'un élève à une école
 * passe par `schoolMemberships`, pas par `studentGuardians`.
 */
function requiredRoleFor(relation: LinkRelation): string {
  return relation === "professeur" ? "professeur" : "parent";
}

export function decideLinkChild(input: LinkInput): LinkDecision {
  // Règle 1 — la relation déclarée doit correspondre au rôle réel de
  // l'appelant. Cette seule comparaison refuse aussi tout rôle étranger au
  // couple parent/professeur : une liste blanche séparée ne refuserait rien de
  // plus. Elle passe avant la règle 2 pour qu'un appelant non autorisé
  // n'apprenne rien sur l'existence du profil visé.
  if (input.guardianRole !== requiredRoleFor(input.relation)) {
    return { ok: false, reason: "relation_role_mismatch" };
  }

  // Règle 2 — la cible doit être un profil élève. Absente et non-élève sont
  // volontairement confondues : l'appelant n'a pas à distinguer les deux.
  // Cette règle couvre aussi le cas où l'appelant se désigne lui-même, son
  // propre rôle valant alors `parent` ou `professeur`, jamais `student`.
  if (input.targetRole !== "student") {
    return { ok: false, reason: "target_not_student" };
  }

  return { ok: true };
}
