/**
 * LE DOMAINE DE LA MARQUE — UN SEUL EXEMPLAIRE, POUR LE WEB ET LE MOBILE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE : LA MÊME PANNE, DEUX FOIS.
 *
 * `lib/email-brand.ts` raconte la première. Cinq actions d'envoi écrivaient
 * `jotnaschool.app`, un domaine que personne ne possède. Resend refusait
 * chaque envoi — bulletins, demandes de liaison, codes de réinitialisation,
 * reçus — et rien ne le disait : l'application ne plantait pas, elle
 * n'envoyait simplement rien.
 *
 * La seconde vient d'être trouvée en préparant les fiches de boutique. Trois
 * surfaces donnaient `jotna.school`, un domaine dont RIEN dans ce dépôt
 * n'atteste la possession :
 *
 *   • les quatre pages légales, pour écrire à propos de ses données ;
 *   • les deux dossiers de boutique, dont l'URL de politique de
 *     confidentialité qu'Apple et Google vont RÉELLEMENT visiter ;
 *   • l'écran que l'application mobile montre à un adulte, pour lui dire où
 *     retrouver son espace.
 *
 * Pendant ce temps le pied de page du site donnait `jotnaschool.com`, et
 * c'est ce domaine-là que Resend a vérifié. `com.jotna.school` n'est pas une
 * contre-preuve : c'est un identifiant de paquet en DNS inversé, une
 * convention de nommage, pas une adresse.
 *
 * LA CONSÉQUENCE EST PIRE QU'UN COURRIEL PERDU. Une fiche de boutique dont
 * l'URL de politique ne résout pas est refusée à la revue. Et un parent qui
 * exerce son droit de suppression — Loi 2008-12, que la politique lui promet
 * — écrirait dans le vide, sans rebond, sans le savoir.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI EMPÊCHE LA TROISIÈME FOIS.
 *
 * Une seule constante, importée partout. Le mobile y accède par l'alias
 * `@lib/*`, déjà en service pour `kidCopy`, `badges` et `accessCopy` ; le web
 * par `@/lib`. `EMAIL_FROM` en descend désormais aussi, pour que l'adresse
 * d'envoi ne puisse plus diverger de l'adresse de réponse.
 *
 * Les documents de `docs/legal/` ne compilent pas et ne peuvent donc pas
 * importer ceci. C'est le seul endroit où l'adresse reste recopiée à la main,
 * et c'est dit là-bas.
 */

/**
 * Le domaine. Il est vérifié chez Resend — c'est la seule preuve de
 * possession dont ce dépôt dispose, et elle vaut mieux qu'une préférence
 * esthétique.
 */
export const SITE_DOMAIN = "jotnaschool.com";

/** L'adresse publique : contact, exercice des droits, signalement. */
export const CONTACT_EMAIL = `contact@${SITE_DOMAIN}`;

/**
 * La racine du site, sans barre oblique finale.
 *
 * Elle sert à construire les URL que les BOUTIQUES visitent — politique de
 * confidentialité en tête. Une URL absolue est obligatoire là-bas : un
 * chemin relatif ne se soumet pas.
 */
export const SITE_URL = `https://${SITE_DOMAIN}`;

/** L'URL de la politique de confidentialité, telle qu'on la soumet. */
export const PRIVACY_URL = `${SITE_URL}/legal/confidentialite`;
