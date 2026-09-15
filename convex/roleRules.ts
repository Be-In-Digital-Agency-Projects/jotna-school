/**
 * Le rôle qu'une INSCRIPTION peut poser, et lui seul.
 *
 * Fonction pure, sans aucun import : c'est ce qui la rend testable, le dépôt
 * n'ayant pas `convex-test` et vitest tournant en `jsdom`. `convex/auth.ts`
 * l'appelle depuis `createOrUpdateUser`, qui n'est pas atteignable par un test.
 *
 * LA RÈGLE : un rôle qui confère une AUTORITÉ ne s'attribue pas soi-même.
 * `admin` administre la plateforme, `directeur` engage une école, `professeur`
 * lit et réécrit le catalogue — énoncés, corrigés, indices — que des élèves
 * payants jouent. Aucun des trois n'est ici.
 *
 * ELLE LÈVE PLUTÔT QUE DE RETOMBER SUR UN REPLI. Le code d'origine ramenait
 * tout rôle inconnu à `student` : demander un compte professeur donnait
 * silencieusement un compte élève, et la personne ne l'apprenait que bien plus
 * tard. Seule l'ABSENCE de rôle retombe sur `student` — c'est un formulaire
 * incomplet, pas une demande refusée.
 */
export type SelfAssignableRole = "parent" | "student";

const SELF_ASSIGNABLE: readonly string[] = ["parent", "student"];

export function decideSignupRole(
  rawRole: string | undefined,
): SelfAssignableRole {
  if (rawRole === undefined) return "student";
  if (!SELF_ASSIGNABLE.includes(rawRole)) {
    throw new Error("Rôle non autorisé");
  }
  return rawRole as SelfAssignableRole;
}
