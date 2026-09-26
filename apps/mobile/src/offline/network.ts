import { NetworkStateType, getNetworkStateAsync } from "expo-network";
import { useEffect, useState } from "react";

/**
 * « Y a-t-il du réseau ? » — une question à laquelle on répond par défaut OUI.
 *
 * POURQUOI CE DÉFAUT-LÀ. Se croire hors ligne à tort envoie l'enfant sur un
 * lot périmé ou sur un écran « il faut du réseau » alors qu'il y en a. Se
 * croire en ligne à tort coûte un appel qui échoue, et le code de la séance
 * retombe alors sur le chemin hors ligne. La seconde erreur se rattrape, la
 * première non.
 *
 * CE N'EST QU'UNE INDICATION, JAMAIS UNE GARANTIE. « Connecté » ne veut pas
 * dire « Convex est joignable » : un portail captif d'hôtel, une 3G qui ne
 * passe plus, un serveur en panne. C'est pourquoi la séance essaie ET
 * retombe, plutôt que de faire confiance à cette valeur.
 */
export function useNetworkOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const read = () => {
      void getNetworkStateAsync()
        .then((state) => {
          if (!alive) return;
          setOnline(state.isInternetReachable ?? state.isConnected ?? true);
        })
        .catch(() => {
          // Une lecture impossible ne doit pas déclarer l'enfant hors ligne.
          if (alive) setOnline(true);
        });
    };
    read();
    // `expo-network` n'expose pas d'abonnement stable sur toutes les
    // plateformes : on relit périodiquement, sans agitation.
    const timer = setInterval(read, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return online;
}

/**
 * « Cette connexion est-elle décomptée d'un forfait ? » (tâche 3.11)
 *
 * WI-FI ET ETHERNET SONT TENUS POUR NON DÉCOMPTÉS ; TOUT LE RESTE L'EST,
 * `UNKNOWN` COMPRIS. Le défaut penche ici dans l'autre sens que
 * `useNetworkOnline`, et pour une raison qui n'est pas technique : se tromper
 * en croyant du Wi-Fi coûte le crédit prépayé d'une famille, se tromper dans
 * l'autre sens coûte un téléchargement remis à plus tard. Certains Android ne
 * savent pas dire le type de leur connexion active ; les mettre du côté
 * « gratuit » ferait payer ceux-là même qu'on protège.
 *
 * C'EST POURQUOI L'INTERRUPTEUR EXISTE. Sans lui, un appareil qui rend
 * toujours `UNKNOWN` ne pourrait jamais rien préparer.
 */
export async function isUnmeteredNow(): Promise<boolean> {
  try {
    const state = await getNetworkStateAsync();
    return (
      state.type === NetworkStateType.WIFI ||
      state.type === NetworkStateType.ETHERNET
    );
  } catch {
    return false;
  }
}
