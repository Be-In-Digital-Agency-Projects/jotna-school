/**
 * CE QUE `expo-network` EST SEUL À SAVOIR : LE TYPE DE CONNEXION.
 *
 * Ce module portait aussi `useNetworkOnline`, qui répondait à « y a-t-il du
 * réseau ? ». La phase 5 l'a retiré : son propre commentaire admettait que ce
 * n'était pas la bonne question — « "Connecté" ne veut pas dire "Convex est
 * joignable" ». `session/reach.ts` pose la bonne, à partir de l'état réel de
 * la socket Convex, et deux sources de vérité sur le même sujet valent moins
 * qu'une seule qui a raison.
 *
 * Reste ici ce que la socket ne peut pas dire : si la connexion est décomptée
 * d'un forfait.
 */

import { NetworkStateType, getNetworkStateAsync } from "expo-network";

/**
 * « Cette connexion est-elle décomptée d'un forfait ? » (tâche 3.11)
 *
 * WI-FI ET ETHERNET SONT TENUS POUR NON DÉCOMPTÉS ; TOUT LE RESTE L'EST,
 * `UNKNOWN` COMPRIS. Le défaut penche ici du côté prudent, et pour une raison
 * qui n'est pas technique : se tromper en croyant du Wi-Fi coûte le crédit
 * prépayé d'une famille, se tromper dans l'autre sens coûte un téléchargement
 * remis à plus tard. Certains Android ne
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
