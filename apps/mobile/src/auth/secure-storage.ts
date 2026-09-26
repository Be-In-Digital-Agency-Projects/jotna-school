import * as SecureStore from "expo-secure-store";
import type { TokenStorage } from "@convex-dev/auth/react";

/**
 * Le stockage du jeton de session, adossé au trousseau de l'appareil.
 *
 * POURQUOI IL FAUT L'ÉCRIRE — ce n'est pas un raffinement. Vérifié dans le
 * paquet publié `@convex-dev/auth@0.0.91`, `dist/react/index.d.ts` :
 *
 *     Optional custom storage object that implements the TokenStorage
 *     interface, otherwise localStorage is used.
 *
 *     You must set this for React Native.
 *
 * et, sur `TokenStorage` : « In React Native we recommend wrapping
 * `expo-secure-store` ». Sans cet objet, la bibliothèque cherche
 * `localStorage`, qui n'existe pas ici.
 *
 * AUCUNE RÉÉCRITURE DE CLÉ, ET C'EST DÉLIBÉRÉ. `expo-secure-store` n'accepte
 * que `[A-Za-z0-9._-]`, et la tentation serait de remplacer le reste par `_`.
 * On ne le fait pas, pour deux raisons. La bibliothèque s'en charge déjà — le
 * même fichier de types dit de `storageNamespace` : « Any non-alphanumeric
 * characters will be ignored (for RN compatibility) ». Et une réécriture
 * FABRIQUE un risque qui n'existait pas : deux clés distinctes peuvent se
 * réduire à la même, et deux jetons se marcheraient dessus sans rien signaler.
 *
 * ON NE LÈVE JAMAIS. Un enfant de huit ans qui ouvre l'application ne doit pas
 * voir un écran blanc parce que le trousseau a refusé une lecture. Une lecture
 * qui échoue rend `null` — l'enfant retape son code, ce qu'il sait faire. Une
 * écriture qui échoue laisse la session vivante pour cette fois et se
 * signale au développeur : il faudra retaper le code au prochain lancement,
 * ce qui est désagréable mais jamais bloquant.
 */
function warn(operation: string, key: string, error: unknown): void {
  if (__DEV__) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[jotna][secure-storage] ${operation} « ${key} » : ${reason}`);
  }
}

export const secureStorage: TokenStorage = {
  async getItem(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      warn("lecture", key, error);
      return null;
    }
  },

  async setItem(key, value) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      warn("écriture", key, error);
    }
  },

  async removeItem(key) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      warn("effacement", key, error);
    }
  },
};

/**
 * Efface le jeton de session — « changer d'élève » (décision D10).
 *
 * `signOut()` de Convex Auth efface déjà ce qu'il a écrit. Cette fonction
 * existe pour le cas où l'on doit repartir propre SANS session valide à
 * révoquer : jeton corrompu, ou compte supprimé côté école pendant que la
 * tablette était éteinte. Elle prend donc la liste des clés en argument
 * plutôt que de deviner leur forme, qui appartient à la bibliothèque.
 */
export async function wipeKeys(keys: readonly string[]): Promise<void> {
  await Promise.all(keys.map((key) => secureStorage.removeItem(key)));
}
