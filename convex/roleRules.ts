/**
 * Le rôle qu'un profil reçoit à sa création, et rien d'autre.
 *
 * Fonction pure, sans aucun import : c'est ce qui la rend testable, le dépôt
 * n'ayant pas `convex-test` et vitest tournant en `jsdom`. `convex/auth.ts`
 * l'appelle depuis `createOrUpdateUser`, qui n'est pas atteignable par un test.
 *
 * LA RÈGLE A CHANGÉ DE NATURE. Elle disait : « un rôle qui confère une autorité
 * ne s'attribue pas soi-même », et laissait donc passer `parent` et `student`.
 * Elle dit maintenant : « aucun compte ne se crée tout seul ». C'est l'école qui
 * crée les comptes de ses professeurs, de ses parents et de ses élèves — par
 * `convex/schoolAccounts.ts` pour les adultes, par l'import pour les élèves.
 *
 * POURQUOI FERMER AUSSI `parent` ET `student`. Un parent qui s'inscrivait seul
 * obtenait un compte vide, puis devait saisir un code de rattachement pour voir
 * quoi que ce soit : le compte précédait le droit, et un compte sans droit n'est
 * qu'une impasse que l'école ne voit pas. Désormais l'école crée le compte ET le
 * lien dans le même geste, et la personne ne fait que l'activer.
 */

/** Les rôles qu'une école peut poser sur un compte qu'elle crée. */
export type SchoolCreatedRole =
  | "directeur"
  | "professeur"
  | "parent"
  | "student";

const SCHOOL_CREATABLE: readonly string[] = [
  "directeur",
  "professeur",
  "parent",
  "student",
];

/** La phrase que lit quiconque tente encore de s'inscrire seul. */
export const SELF_SIGNUP_CLOSED =
  "La création de compte libre est fermée : c'est votre école qui crée votre " +
  "compte. Si vous avez reçu un code d'activation, utilisez-le sur la page " +
  "d'activation ; sinon, demandez-le à votre école.";

/**
 * Le rôle d'un profil qui naît, ou une erreur.
 *
 * `schoolCreated` DIT D'OÙ VIENT L'APPEL, et il n'est pas falsifiable. Sur une
 * inscription client, `createOrUpdateUser` ne reçoit que ce que retourne le
 * `profile(params)` de `convex/auth.ts` — exactement `{ email, name, role }`.
 * Un client ne peut donc pas faire apparaître un quatrième champ dans cet
 * objet. Seul un appel serveur à `createAccount`, qui passe son `profile`
 * directement, peut porter le marqueur.
 *
 * ELLE LÈVE PLUTÔT QUE DE RETOMBER SUR UN REPLI. Le code d'origine ramenait
 * tout rôle inconnu à `student` : demander un compte professeur donnait
 * silencieusement un compte élève, et la personne ne l'apprenait que bien plus
 * tard. Un refus se lit.
 *
 * `admin` N'EST NULLE PART, ni ici ni ailleurs. Il administre la plateforme
 * entière, y compris les écoles concurrentes d'une même ville : il se pose hors
 * de l'application, et `convex/devAdmin.ts` est le seul chemin du dépôt qui le
 * fasse.
 */
export function decideProfileRole(input: {
  rawRole: string | undefined;
  schoolCreated: boolean;
}): SchoolCreatedRole {
  if (!input.schoolCreated) {
    throw new Error(SELF_SIGNUP_CLOSED);
  }
  if (input.rawRole === undefined) {
    throw new Error("Rôle manquant sur un compte créé par une école");
  }
  if (!SCHOOL_CREATABLE.includes(input.rawRole)) {
    throw new Error("Rôle non autorisé");
  }
  return input.rawRole as SchoolCreatedRole;
}
