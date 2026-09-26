import type { ReactNode } from "react";
import { getFunctionName } from "convex/server";

import { api } from "@convex/_generated/api";
import {
  accessState,
  badgeList,
  earnedBadges,
  myStats,
  soundEnabled,
  subjectMap,
  subjects,
  topicById,
} from "./fixtures";

/**
 * LE FAUX `convex/react` — substitué au vrai, et SEULEMENT en aperçu.
 *
 * `metro.config.js` n'arme cet aiguillage que sous `JOTNA_PREVIEW=1`. Le
 * paquet natif ne le voit jamais : il n'y a pas de drapeau à oublier en
 * production, il y a un drapeau à POSER pour l'aperçu.
 *
 * Il ne simule pas Convex. Il rend une valeur figée par requête, tout de
 * suite, sans chargement — c'est assez pour que les écrans s'affichent, et
 * c'est tout ce qu'on lui demande. Les mutations ne font rien et rendent
 * `undefined` : un aperçu ne doit RIEN pouvoir écrire, pas même en mémoire,
 * sans quoi on finirait par croire qu'on a testé un parcours.
 */
const RESULTS = new Map<string, unknown>([
  [getFunctionName(api.access.getAccessState), accessState],
  [getFunctionName(api.students.getMyStats), myStats],
  [getFunctionName(api.students.getStudentSubjectMap), subjectMap],
  [getFunctionName(api.students.getMySoundEnabled), soundEnabled],
  [getFunctionName(api.subjects.list), subjects],
  [getFunctionName(api.badges.list), badgeList],
  [getFunctionName(api.badges.listMyEarned), earnedBadges],
  [getFunctionName(api.topics.getById), topicById],
]);

/** `"skip"` doit rendre `undefined`, comme le vrai. */
export function useQuery(ref: unknown, args?: unknown): unknown {
  if (args === "skip") return undefined;
  const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
  if (!RESULTS.has(name)) {
    // Un écran qui demande une requête non fournie doit se VOIR, pas se
    // deviner : `undefined` est l'état « en chargement », qu'un écran affiche
    // volontiers pour toujours sans que personne comprenne pourquoi.
    console.warn(`[aperçu] aucune donnée pour ${name}`);
  }
  return RESULTS.get(name);
}

export function useMutation(): () => Promise<undefined> {
  return async () => undefined;
}

export function useAction(): () => Promise<undefined> {
  return async () => undefined;
}

export function useConvexAuth(): {
  isLoading: boolean;
  isAuthenticated: boolean;
} {
  return { isLoading: false, isAuthenticated: true };
}

/** `session/reach.ts` n'en lit que ce champ. */
export function useConvexConnectionState(): { isWebSocketConnected: boolean } {
  return { isWebSocketConnected: true };
}

export function useConvex(): unknown {
  return null;
}

export class ConvexReactClient {
  constructor(public readonly address: string) {}
}

export function ConvexProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return children;
}
