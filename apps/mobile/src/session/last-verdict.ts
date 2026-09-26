import * as SecureStore from "expo-secure-store";

import type { CachedVerdict } from "./verdict-rules";

// Un seul endroit où importer ce sujet, même si la règle vit à côté.
export {
  VERDICT_MAX_AGE_MS,
  verdictStillOpens,
  type CachedVerdict,
} from "./verdict-rules";

const KEY = "jotna.lastAccessVerdict";

/**
 * LE DERNIER VERDICT D'ACCÈS CONNU — ce qui rend l'application utilisable
 * quand elle DÉMARRE sans réseau (tâche 5.1).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT QU'IL CORRIGE, ET IL EST GRAVE.
 *
 * `SessionGate` attend `api.access.getAccessState` avant de montrer quoi que
 * ce soit. Sans socket, cette requête ne revient JAMAIS : l'enfant reste sur
 * « Un instant… » jusqu'à ce qu'il abandonne.
 *
 * Autrement dit, toute la phase 3 — le lot téléchargé, le journal local, les
 * paliers notés jouables sans réseau — tombait À LA PORTE D'ENTRÉE. L'enfant
 * qui prépare ses paliers le vendredi à l'école et ouvre l'application le
 * samedi au village n'atteignait jamais ce qu'il avait préparé. Le hors-ligne
 * fonctionnait pour une coupure EN COURS de séance, et pour rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE CACHE AUTORISE, ET SURTOUT CE QU'IL N'AUTORISE PAS.
 *
 * Il autorise UNE chose : franchir la porte pour atteindre ce qui est DÉJÀ sur
 * l'appareil. Rien d'autre ne passe par lui. Chaque lecture et chaque écriture
 * côté serveur garde ses propres gardes — `getOfflineBundle` refuse toujours
 * d'ouvrir un lot neuf quand l'accès est fermé, `submitPalier` garde son
 * `requireAccess`. Un verdict périmé ne peut donc rien débloquer qui ne soit
 * pas déjà là.
 *
 * ET CE QUI EST DÉJÀ LÀ EST DÉJÀ BORNÉ, deux fois : par `endsAt` ci-dessous,
 * et par `accessValidUntil` que chaque lot porte — le plus proche de la fin
 * d'abonnement et de quatorze jours (`OFFLINE_LEASE_MS`). Ce cache n'allonge
 * aucune des deux.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IL S'EFFACE À « CHANGER D'ÉLÈVE » (D10), et ce n'est pas négociable : le
 * verdict appartient à l'enfant qui était connecté. Le laisser ferait entrer
 * le suivant sur l'accès du précédent — et comme le jeton part en même temps,
 * il entrerait sans identité du tout.
 */

export async function rememberVerdict(endsAt: number): Promise<void> {
  try {
    const value: CachedVerdict = { endsAt, askedAt: Date.now() };
    await SecureStore.setItemAsync(KEY, JSON.stringify(value));
  } catch {
    // Sans mémoire, l'enfant retombe sur l'écran « pas de connexion » au
    // prochain démarrage sans réseau. Désagréable, jamais destructeur.
  }
}

export async function readVerdict(): Promise<CachedVerdict | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as CachedVerdict).endsAt !== "number" ||
      typeof (parsed as CachedVerdict).askedAt !== "number"
    ) {
      return null;
    }
    return parsed as CachedVerdict;
  } catch {
    // Illisible vaut absent : on redemandera au serveur.
    return null;
  }
}

export async function forgetVerdict(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // idem
  }
}
