import type { ReactNode } from "react";

/**
 * LE FAUX `@convex-dev/auth/react` — même règle que son voisin : aperçu
 * seulement, et rien ne s'écrit.
 *
 * `ConvexAuthProvider` laisse simplement passer ses enfants. `signIn` et
 * `signOut` ne font rien : en aperçu, `useConvexAuth` répond déjà qu'on est
 * authentifié, et l'on ne peut donc ni entrer ni sortir. Le pavé de code
 * s'affiche toujours à son URL propre, mais il ne mène nulle part — c'est
 * assez pour le regarder, et honnête sur ce qu'il fait.
 */
export function ConvexAuthProvider({
  children,
}: {
  children: ReactNode;
  client?: unknown;
  storage?: unknown;
}): ReactNode {
  return children;
}

export function useAuthActions(): {
  signIn: (...args: unknown[]) => Promise<void>;
  signOut: () => Promise<void>;
} {
  return { signIn: async () => {}, signOut: async () => {} };
}

export type TokenStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};
