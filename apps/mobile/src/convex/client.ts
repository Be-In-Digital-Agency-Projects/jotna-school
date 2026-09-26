import { ConvexReactClient } from "convex/react";

/**
 * L'adresse du déploiement Convex.
 *
 * `EXPO_PUBLIC_*` est la seule forme qu'Expo injecte dans le paquet à la
 * construction. Le nom diffère donc de celui du web (`NEXT_PUBLIC_CONVEX_URL`)
 * alors que la VALEUR est la même : c'est le même déploiement, décision D2.
 *
 * ON NE LÈVE PAS ICI. Une variable manquante est une erreur de configuration,
 * pas un état d'exécution : lever au chargement du module donnerait un écran
 * blanc sans un mot. On rend `null`, et `app/_layout.tsx` affiche ce qui
 * manque et où le poser.
 */
export const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL ?? null;

export const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;
