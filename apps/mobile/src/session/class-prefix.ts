import * as SecureStore from "expo-secure-store";

const KEY = "jotna.classPrefix";

/**
 * Le préfixe de classe, retenu d'une connexion à l'autre.
 *
 * POURQUOI LE RETENIR. Un enfant revient dans la même classe toute l'année, et
 * son code commence toujours par le même `CM1A`. Ne lui faire retaper que les
 * quatre chiffres réduit la saisie de neuf caractères à quatre — sur une
 * tablette partagée où trente élèves se succèdent, c'est la différence entre
 * une séance qui commence et une séance qui s'enlise.
 *
 * POURQUOI IL SURVIT À « CHANGER D'ÉLÈVE » (décision D10). Le suivant est
 * presque toujours de la même classe : effacer le préfixe le punirait d'un
 * geste qui ne le concerne pas. L'écran offre séparément de le corriger, pour
 * la tablette qui passe d'une classe à l'autre.
 *
 * POURQUOI `expo-secure-store` POUR UNE DONNÉE QUI N'EST PAS UN SECRET. Il est
 * déjà là pour le jeton, et ajouter `@react-native-async-storage` pour ranger
 * quatre caractères serait une dépendance de plus à faire monter de version
 * chaque année. Un préfixe de classe dans le trousseau ne coûte rien.
 *
 * AUCUNE DE CES FONCTIONS NE LÈVE : un préfixe qu'on ne sait pas relire fait
 * retomber sur la saisie complète, ce qui marche toujours.
 */
export async function readClassPrefix(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function writeClassPrefix(prefix: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, prefix);
  } catch {
    // Sans mémoire, l'enfant retape son préfixe : désagréable, jamais bloquant.
  }
}

export async function forgetClassPrefix(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // idem
  }
}
