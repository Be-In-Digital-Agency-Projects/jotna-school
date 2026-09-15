/**
 * Les règles du profil — ce qu'une modification a le droit d'écrire, et ce que
 * les préférences écrites commandent. Fonctions pures, sans aucun import,
 * alimentées en documents déjà lus par leurs enveloppes Convex.
 *
 * Le découpage est celui d'`accessRules`, `linkRules` et `roleRules`, et pour
 * la même raison : ce dépôt n'utilise pas `convex-test` et vitest tourne en
 * `jsdom`, donc un handler Convex n'est pas testable directement. Extraire la
 * décision est le seul moyen d'en avoir la preuve plutôt que d'en recopier le
 * corps dans un test — un test qui rejoue le handler ne prouve que lui-même.
 *
 * Ce module ne décide RIEN de l'autorisation : il ne voit ni session, ni rôle,
 * ni identifiant de cible. C'est voulu. `updateProfile` n'écrit que sur le
 * profil de sa propre session, et cette propriété tient à ce que la cible ne
 * soit nommée nulle part — pas à un contrôle qu'on pourrait poser ici et
 * oublier là.
 */

/** Ce qu'un écran de paramètres envoie. */
export type ProfileUpdateFields = {
  name?: string;
  avatar?: string;
  receiveReports?: boolean;
};

/** Ce que le handler passera à `db.patch` — jamais d'autre champ. */
export type ProfileUpdatePatch = {
  name?: string;
  avatar?: string;
  preferences?: Record<string, unknown>;
};

export type ProfileUpdateDecision =
  | { ok: true; patch: ProfileUpdatePatch }
  | { ok: false; reason: "empty_name" };

/**
 * Les préférences existantes, à condition qu'elles soient un objet.
 *
 * `profiles.preferences` est déclaré `v.any()` au schéma : rien n'y impose un
 * objet, et une ligne ancienne ou écrite de travers peut porter une chaîne, un
 * nombre ou un tableau. Les répandre serait pire que les ignorer — `{..."abc"}`
 * donne `{0:"a",1:"b",2:"c"}`, et le profil repart avec des préférences
 * inventées. Une valeur qui n'est pas un objet est donc REMPLACÉE, pas fusionnée.
 */
function objectPreferences(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

/**
 * Décide le patch à écrire à partir des champs reçus et des préférences
 * actuelles.
 *
 * Deux règles, et elles tiennent quels que soient les champs futurs :
 *
 * 1. UN CHAMP ABSENT N'EST PAS UN CHAMP VIDE. Seul `!== undefined` écrit ; le
 *    reste du document n'est pas touché. C'est ce qui permet à deux écrans
 *    différents d'envoyer chacun leur moitié sans s'effacer l'un l'autre.
 * 2. `preferences` SE FUSIONNE, il ne se remplace pas. C'est un fourre-tout
 *    partagé — série, badges, son y vivent aussi, écrits par d'autres modules
 *    qui fusionnent tous. Le remplacer effacerait leur travail, et cette
 *    fonction ne voit même pas les clés qu'elle préserverait.
 *
 * Un patch vide est un succès, pas un refus : il n'y avait rien à faire.
 */
export function decideProfileUpdate(
  fields: ProfileUpdateFields,
  currentPreferences: unknown,
): ProfileUpdateDecision {
  const patch: ProfileUpdatePatch = {};

  if (fields.name !== undefined) {
    const name = fields.name.trim();
    if (name.length === 0) return { ok: false, reason: "empty_name" };
    patch.name = name;
  }

  if (fields.avatar !== undefined) {
    patch.avatar = fields.avatar;
  }

  if (fields.receiveReports !== undefined) {
    patch.preferences = {
      ...objectPreferences(currentPreferences),
      receiveReports: fields.receiveReports,
    };
  }

  return { ok: true, patch };
}

/**
 * Ce tuteur veut-il recevoir les bulletins par courriel ?
 *
 * LE LECTEUR VIT À CÔTÉ DE SON ÉCRIVAIN, À DESSEIN. `decideProfileUpdate`
 * ci-dessus est la seule chose du dépôt qui ÉCRIT `receiveReports` ; cette
 * fonction est la seule qui le LIT pour décider d'un envoi. Les deux moitiés
 * d'une même préférence dans un même fichier ne peuvent pas diverger sans que
 * ça se voie.
 *
 * ABSENT VAUT OUI, et ce n'est pas un détail de confort : c'est ce qui rend le
 * correctif sûr. Le champ n'existe sur aucun profil créé avant lui, et l'écran
 * parent affiche la case COCHÉE dans ce cas (`prefs?.receiveReports ?? true`).
 * Traiter l'absence comme un refus couperait donc en silence les bulletins de
 * tous les parents existants, pendant que leur écran continuerait de leur dire
 * qu'ils y sont abonnés — un mensonge d'interface pire que le défaut corrigé.
 * Seul un `false` EXPLICITE, que seul un décochage délibéré produit, arrête
 * l'envoi.
 *
 * Tout ce qui n'est ni un objet ni un booléen est ignoré et vaut oui : `v.any()`
 * n'impose aucune forme, et une valeur abîmée ne doit pas priver quelqu'un de
 * ses bulletins.
 */
export function wantsReportEmail(preferences: unknown): boolean {
  return objectPreferences(preferences).receiveReports !== false;
}
