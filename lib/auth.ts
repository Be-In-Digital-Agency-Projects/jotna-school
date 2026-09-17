/**
 * Client-side auth utilities for Convex Auth with email/password.
 *
 * These functions wrap the Convex Auth signIn/signOut actions
 * for use in React components via useAuthActions().
 *
 * Usage (inside a component rendered within ConvexAuthNextjsProvider):
 *
 *   import { useAuthActions } from "@convex-dev/auth/react";
 *   import { register, login, logout } from "@/lib/auth";
 *
 *   const { signIn, signOut } = useAuthActions();
 *   await register(signIn, { email, password, name, role: "student" });
 *   await login(signIn, { email, password });
 *   await logout(signOut);
 */

type SignIn = (
  provider: string,
  params?: Record<string, unknown>,
) => Promise<{ signingIn: boolean }>;

type SignOut = () => Promise<void>;

// ── Inscription ─────────────────────────────────────────────────────────────
//
// IL N'Y A PLUS DE FONCTION `register`, ET C'EST VOLONTAIRE. Aucun compte ne se
// crée depuis le navigateur : c'est l'école qui crée ceux de ses professeurs, de
// ses parents et de ses élèves, et la personne ne fait que les ACTIVER
// (`convex/schoolAccounts.activateAccount`). Le serveur refuse désormais toute
// inscription libre — voir `convex/roleRules.decideProfileRole` — donc un
// helper client aurait promis un geste que l'API rejette.
//
// Ce helper typait par ailleurs `role: "parent" | "student" | "professeur"`
// alors que `professeur` était déjà refusé côté serveur : le formulaire offrait
// un rôle impossible.

// ── Login ───────────────────────────────────────────────────────────────────

export interface LoginParams {
  email: string;
  password: string;
}

/**
 * Sign in an existing user with email and password.
 */
export async function login(
  signIn: SignIn,
  params: LoginParams,
): Promise<{ signingIn: boolean }> {
  return signIn("password", {
    flow: "signIn",
    email: params.email,
    password: params.password,
  });
}

// ── Logout ──────────────────────────────────────────────────────────────────

/**
 * Sign out the current user (invalidates the session).
 */
export async function logout(signOut: SignOut): Promise<void> {
  return signOut();
}

// ── Clear cached tokens ────────────────────────────────────────────────────

/**
 * Remove all Convex Auth tokens from localStorage.
 * Call this on logout so the next sign-in starts clean — prevents the
 * ConvexReactClient from re-using a stale JWT from the previous session.
 */
export function clearConvexAuthTokens(): void {
  if (typeof window === "undefined") return;
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith("__convexAuth")) {
      localStorage.removeItem(key);
    }
  }
}

// ── Role-based home path ────────────────────────────────────────────────────

export type Role = "admin" | "parent" | "student" | "professeur" | "directeur";

/**
 * L'écran d'accueil d'un rôle, celui vers lequel `/post-auth` renvoie.
 *
 * `directeur` MANQUAIT, ET LE RÔLE ÉTAIT DONC INUTILISABLE. Il existe au schéma,
 * `schools.addStaff` l'accepte, mais tout directeur qui se connectait retombait
 * sur le `default` — donc sur `/login`, donc en boucle. Le rôle était posable et
 * la personne ne pouvait jamais entrer.
 *
 * TOUT RÔLE CONNU DOIT AVOIR SA LIGNE ICI, et le `default` ne doit rester que
 * pour l'absence de profil. Un rôle ajouté au schéma sans être ajouté ici
 * produit exactement la même boucle, silencieusement.
 */
export function roleHomePath(role: Role | null | undefined): string {
  switch (role) {
    case "admin":
      return "/admin/dashboard";
    case "parent":
      return "/parent/dashboard";
    case "professeur":
      return "/teacher/dashboard";
    case "directeur":
      return "/directeur/dashboard";
    case "student":
      return "/student/home";
    default:
      return "/login";
  }
}
