import { useConvexConnectionState } from "convex/react";
import { useEffect, useState } from "react";

/**
 * « LE SERVEUR RÉPOND-IL ? » — et non « y a-t-il du réseau ? » (tâche 5.1).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE HOOK REMPLACE `useNetworkOnline`, ET LE REMPLACEMENT EST UNE CORRECTION.
 *
 * L'ancien interrogeait `expo-network`, qui répond à la question du SYSTÈME :
 * « une interface réseau est-elle active ? » Son propre commentaire disait
 * déjà que ce n'était pas la bonne : « "Connecté" ne veut pas dire "Convex est
 * joignable" — un portail captif d'hôtel, une 3G qui ne passe plus, un serveur
 * en panne. »
 *
 * `useConvexConnectionState` répond à la vraie question. `isWebSocketConnected`
 * est vrai quand la socket vers Convex est OUVERTE : derrière un portail
 * captif elle ne s'ouvre pas, et l'appareil le sait tout de suite au lieu de
 * lancer des requêtes qui ne reviendront jamais.
 *
 * On ne garde donc pas deux sources de vérité sur la même question. `expo-
 * network` reste employé pour ce qu'il est SEUL à savoir : le TYPE de
 * connexion, donc si elle est décomptée d'un forfait (`isUnmeteredNow`).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS ÉTATS, PAS DEUX, ET C'EST LE CŒUR.
 *
 * Un booléen forcerait à trancher au démarrage, quand la socket n'est pas
 * encore ouverte et qu'on n'en sait rien. Les deux réponses sont mauvaises :
 * « en ligne » lance des requêtes qui pendent, « hors ligne » envoie l'enfant
 * sur un lot local alors que le réseau arrivait dans la seconde.
 *
 *   `connecting`  — on ne sait pas encore. C'est un état D'ATTENTE, et l'écran
 *                   doit le montrer comme tel.
 *   `online`      — la socket est ouverte.
 *   `offline`     — elle ne s'est pas ouverte dans le délai de grâce.
 *
 * LE DÉLAI DE GRÂCE N'EST PAS UN CONFORT. Une socket qui se rétablit en deux
 * secondes — ce qui arrive sans arrêt en 3G — ferait autrement clignoter un
 * écran « pas de connexion » sous les yeux d'un enfant au milieu d'un
 * exercice. Cinq secondes, c'est plus long qu'un hoquet et plus court qu'un
 * abandon.
 */
export type Reach = "connecting" | "online" | "offline";

export const DEFAULT_GRACE_MS = 5_000;

export function useServerReach(graceMs: number = DEFAULT_GRACE_MS): Reach {
  const connected = useConvexConnectionState().isWebSocketConnected;
  const [patienceOver, setPatienceOver] = useState(false);

  useEffect(() => {
    // Le compteur repart à CHAQUE bascule, dans les deux sens : une socket
    // qui retombe rouvre un délai de grâce entier, sinon la première coupure
    // de la séance ferait passer toutes les suivantes en « hors ligne »
    // instantanément.
    setPatienceOver(false);
    if (connected) return;
    const timer = setTimeout(() => setPatienceOver(true), graceMs);
    return () => clearTimeout(timer);
  }, [connected, graceMs]);

  if (connected) return "online";
  return patienceOver ? "offline" : "connecting";
}

/**
 * « Peut-on parler au serveur MAINTENANT ? »
 *
 * Le raccourci pour les appels qui n'ont pas d'écran à dessiner : on tente si
 * et seulement si la socket est ouverte. `connecting` répond NON — tenter
 * pendant qu'elle s'ouvre, c'est une requête qui pend.
 */
export function isOnline(reach: Reach): boolean {
  return reach === "online";
}
