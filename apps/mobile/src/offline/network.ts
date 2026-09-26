import { getNetworkStateAsync } from "expo-network";
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
