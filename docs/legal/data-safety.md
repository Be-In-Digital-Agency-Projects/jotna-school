# Formulaire *Data safety* et étiquettes de confidentialité — application élève

**Périmètre : l'application mobile ÉLÈVE** (`apps/mobile`, `com.jotna.school`),
celle qui est soumise aux boutiques. Le site web collecte en plus l'adresse
électronique des adultes ; il n'est pas soumis.

Chaque réponse ci-dessous a été vérifiée dans le code. Les sources sont citées
pour que la prochaine personne puisse les revérifier plutôt que me croire.

---

## 1. Ce que l'application collecte

| Catégorie Google Play | Collectée ? | Partagée ? | Obligatoire ? | Finalité | Source |
|---|---|---|---|---|---|
| **Nom** | Oui | Non | Oui | Fonctionnalité de l'app | `profiles.name`, saisi par l'école |
| **Adresse électronique** | **Non** | — | — | — | l'élève se connecte par un CODE, pas une adresse (`importCodes.loginCredentials`) |
| **Numéro de téléphone** | Non | — | — | — | absent du schéma pour un élève |
| **Adresse, position** | Non | — | — | — | aucune permission de localisation |
| **Photos, vidéos, fichiers** | Non | — | — | — | `profiles.avatar` existe mais aucun écran élève ne le renseigne |
| **Contacts, calendrier, SMS** | Non | — | — | — | aucune permission |
| **Contenu créé par l'utilisateur** | **Oui** | **Oui, sous condition** | Oui | Fonctionnalité + personnalisation | `attempts.submittedAnswer` — les réponses de l'enfant |
| **Actions dans l'app** | Oui | Non | Oui | Fonctionnalité | progression, paliers, badges, série |
| **Identifiants d'appareil** | Non | — | — | — | aucun SDK publicitaire, aucun identifiant collecté |
| **Diagnostic, plantages** | **Non** | — | — | — | **aucun outil de rapport de plantage n'est installé** |
| **Historique de navigation, achats** | Non | — | — | — | pas de navigateur, pas d'achat |

### Le seul partage à déclarer

Le **contenu créé par l'utilisateur** — la réponse de l'enfant sur un exercice,
ou ses réponses fausses — est transmis à **OpenAI** pour deux fonctions :
expliquer une erreur, et proposer des exercices adaptés.

**Ce partage est conditionnel**, et le formulaire ne sait pas dire « parfois » :
il faut donc cocher *partagée*. Le détail se met dans la politique de
confidentialité, qui dit qui consent et comment refuser. Rien n'est transmis
sous le nom de l'enfant : ni son nom, ni son école, ni son code
(`convex/attemptsExplain.ts`, `convex/attemptsVerify.ts`,
`convex/paliers/index.ts`).

`explainMistake.explainExercise` n'entre PAS dans ce partage : son invite ne
porte que l'énoncé et le corrigé de l'exercice, jamais la réponse de l'enfant.

---

## 2. Les questions de sécurité

| Question | Réponse | Pourquoi |
|---|---|---|
| Données chiffrées en transit ? | **Oui** | HTTPS/WSS vers Convex, pas de trafic en clair en production |
| L'utilisateur peut-il demander la suppression ? | **Oui, par écrit** | `contact@jotnaschool.com`. **Il n'existe aucun chemin DANS l'application**, ce qui est déclarable ainsi mais reste un manque — voir §4 |
| Traitement éphémère uniquement ? | **Non** | la progression est conservée, c'est l'objet du service |
| Engagement envers la politique *Families* | **Oui** | voir `docs/legal/kids-category.md` |

---

## 3. Étiquettes Apple (*App Privacy*)

**Données liées à l'utilisateur**
- *Identité* → Nom
- *Contenu utilisateur* → « Autre contenu utilisateur » (les réponses)

**Données non liées à l'utilisateur** : aucune.

**Données servant au suivi publicitaire** : **aucune**. L'application ne
contient aucun SDK publicitaire, aucun identifiant de suivi, et ne demande
donc jamais `App Tracking Transparency`.

---

## 4. Ce qu'il faut savoir avant de remplir

**Il n'y a AUCUN rapport de plantage.** Ni Sentry, ni Crashlytics, ni rien.
C'est une bonne nouvelle pour ce formulaire — rien à déclarer en *Diagnostic* —
et un vrai manque en exploitation : un plantage chez un enfant au village ne
laissera aucune trace. À décider séparément, en sachant qu'ajouter un tel outil
rouvre cette déclaration et, en catégorie Enfants, demande une attention
particulière.

**La suppression du compte ne s'exerce que par courriel.** L'application élève
ne permet pas de créer un compte (les codes viennent de l'école), ce qui rend
la règle App Store 5.1.1(v) inapplicable en l'état. Le jour où une application
PARENT avec inscription sort, le chemin de suppression devient obligatoire et
il n'existe nulle part.

**Des données d'exercice résident sur l'appareil.** Ce n'est pas une question
du formulaire, mais la politique de confidentialité doit le dire, et elle le
dit : exercices préparés (sans corrigé), réponses hors ligne non encore
envoyées, jeton de connexion dans le coffre du système. Taire le stockage local
sur une application dont c'est la fonction principale serait une déclaration
incomplète.
