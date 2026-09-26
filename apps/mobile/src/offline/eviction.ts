/**
 * QUE SUPPRIMER QUAND LA PLACE MANQUE — la décision, séparée de la base.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE SÉPARÉMENT DE `store.ts`.
 *
 * C'est le seul code de l'appareil qui puisse DÉTRUIRE le travail d'un enfant.
 * Une erreur ici ne se voit pas : elle efface un lot, la synchronisation se
 * met à rendre `null` sans rien dire, et des réponses déjà données
 * disparaissent. Ce code-là doit être éprouvable, et il ne peut pas l'être
 * tant qu'il vit à l'intérieur d'une requête SQLite — `expo-sqlite` n'existe
 * pas hors d'un appareil.
 *
 * Il ne dépend donc de RIEN : ni d'`expo`, ni de React, ni de la base. Il
 * reçoit une liste et rend une liste.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES TROIS PROTECTIONS, PAR ORDRE D'IMPORTANCE.
 *
 *   0. (depuis 6.7) UN LOT MORT — périmé, ou dont le schéma d'atomes ne
 *      correspond plus — n'est pas « protégé » : il part EN PREMIER, avant
 *      qu'on regarde la moindre taille. Ce n'est pas une protection, c'est
 *      l'inverse, et c'est listé ici pour que l'ordre soit lisible d'un bloc.
 *   1. DES RÉPONSES EN ATTENTE. `flushJournal` relit le lot pour y prendre sa
 *      DATE DE TÉLÉCHARGEMENT, borne basse du bornage d'horloge du serveur
 *      (D17). Sans le lot, elle n'envoie rien — jamais.
 *   2. UNE CLÔTURE EN ATTENTE. Le marqueur vit dans la ligne du lot : le
 *      perdre, c'est perdre le seul endroit où l'on sait que l'enfant a FINI
 *      ce palier. Les étoiles ne viendraient jamais.
 *   3. LE LOT EN COURS DE LECTURE, que l'appelant nomme.
 *
 * ET LE PLAFOND CÈDE DEVANT ELLES. Si tout ce qui reste est protégé, on rend
 * la main AU-DESSUS du plafond plutôt que de toucher à quoi que ce soit.
 * C'est l'arbitrage de D18, appliqué au disque : la place se reprend plus
 * tard, le travail d'un enfant ne se refait pas.
 */

import { isBundlePlayable } from "./bundle-validity";

export interface EvictionCandidate {
  palierAttemptId: string;
  /** Croissant : le plus ancien téléchargement d'abord. */
  downloadedAt: number;
  accessValidUntil: number;
  /** La version du schéma d'atomes du lot, `null` s'il est d'avant 6.7. */
  atomScheme: number | null;
  bytes: number;
  hasPending: boolean;
  awaitsClose: boolean;
}

export interface EvictionPlan {
  /** À supprimer, dans l'ordre où la décision les a pris. */
  remove: string[];
  /** Ce qui restera, en octets. Peut dépasser le plafond — voir l'en-tête. */
  remaining: number;
}

export function planEviction(
  candidates: readonly EvictionCandidate[],
  options: {
    keep?: readonly string[];
    now: number;
    maxBytes: number;
    /** Le schéma d'atomes de CET appareil — voir `bundle-validity.ts`. */
    currentScheme: number;
  },
): EvictionPlan {
  const kept = new Set(options.keep ?? []);
  const byAge = [...candidates].sort((a, b) => a.downloadedAt - b.downloadedAt);

  const evictable = byAge.filter(
    (b) => !b.hasPending && !b.awaitsClose && !kept.has(b.palierAttemptId),
  );

  const remove: string[] = [];
  const doomed = new Set<string>();
  let remaining = byAge.reduce((acc, b) => acc + b.bytes, 0);

  // 1) CE QUI NE SE JOUERA PLUS PART D'ABORD, sans regarder la taille.
  //
  //    Deux familles : les lots PÉRIMÉS, et depuis 6.7 ceux dont le SCHÉMA
  //    D'ATOMES ne correspond plus à celui de l'appareil. Les seconds sont
  //    aussi morts que les premiers — `findUsableBundle` les ignore — et les
  //    garder ne ferait que retenir de la place pour rien.
  //
  //    Leur place est décomptée TOUT DE SUITE : la décompter au fil de l'eau
  //    ferait condamner un lot encore valable alors que la place des morts
  //    suffisait à repasser sous le plafond.
  for (const b of evictable) {
    if (!isBundlePlayable(b, options.now, options.currentScheme)) {
      remove.push(b.palierAttemptId);
      doomed.add(b.palierAttemptId);
      remaining -= b.bytes;
    }
  }

  // 2) PUIS LES PLUS VIEUX, jusqu'à repasser sous le plafond.
  for (const b of evictable) {
    if (remaining <= options.maxBytes) break;
    if (doomed.has(b.palierAttemptId)) continue;
    remove.push(b.palierAttemptId);
    doomed.add(b.palierAttemptId);
    remaining -= b.bytes;
  }

  return { remove, remaining };
}
