# Abonnement écoles — passage en 100 % payant

**Date** : 2026-09-14
**Statut** : design validé, en attente de relecture avant plan d'implémentation
**Branche** : `claude/epic-sagan-mdlnol`

---

## 1. Objectif

Permettre à une école de souscrire un abonnement annuel couvrant ses élèves, et
fermer l'accès gratuit : Jotna School devient intégralement payant. L'école est
le seul client payant de cette version ; l'architecture reste ouverte à un
abonnement parental ultérieur sans migration.

## 2. Décisions actées

| # | Décision | Portée |
|---|---|---|
| D1 | Seule l'école paie. Le parent garde son tableau de bord sans payer. | Produit |
| D2 | Tarif par élève, tranches dégressives **cumulatives**. | Produit |
| D3 | L'école importe sa liste d'élèves ; le parent se rattache ensuite par code. | Produit |
| D4 | Agrégateur de paiement intégré dès la v1 (pas de facturation manuelle). | Produit |
| D5 | Agrégateur retenu : **PayDunya**. | Technique |
| D6 | Base de données vide ou jetable : aucune clause de grandfather, tout est payant dès le premier jour. | Produit |
| D7 | Droits d'accès **dérivés** à l'appel, jamais matérialisés. Abonnement à propriétaire typé (`ownerType`). | Technique |
| D8 | Le directeur n'est jamais bloqué par le paywall. | Produit |
| D9 | Trois tranches de paiement (octobre / janvier / avril), délai de grâce de 21 jours. | Produit |
| D10 | Le niveau de l'élève (`class`) devient une donnée de premier plan. | Technique |

### Sur D6 — remise à zéro

La base est considérée vide ou jetable : aucune migration prudente n'est
nécessaire : `profiles.class` peut être introduit sans étape de
widen-migrate-narrow. Le validateur reste `v.optional` — parents, professeurs
et directeurs n'ont pas de niveau — et la règle « tout élève a un niveau » est
appliquée par le code de création, pas par le schéma. **Aucune donnée ne sera supprimée sans feu vert
explicite du propriétaire du projet, au moment de l'implémentation.**

---

## 3. État de l'existant

Relevé au 2026-09-14 sur `claude/epic-sagan-mdlnol`.

- Rôles : `admin`, `parent`, `student`, `professeur`. Auto-inscription ouverte
  pour les trois derniers ; `admin` réservé.
- Aucun code de facturation, d'abonnement ou de paiement. Aucun paywall.
- Aucune entité « école » ni « classe ». Le seul rattachement est
  `studentGuardians` (élève ↔ tuteur).
- `class` existe sur `topics` et `paliers`, **jamais sur `profiles`**.
  `getStudentSubjectMap` liste les topics sans filtre de niveau : un élève voit
  aujourd'hui les six niveaux mélangés. L'index `topics.by_subjectId_class` est
  défini mais jamais utilisé.
- Tous les inserts `studentGuardians` en production codent `relation: "parent"`
  en dur. Aucun flux ne crée `relation: "professeur"` : l'espace professeur
  (« Mes élèves ») est structurellement vide.
- `profiles.linkChild` est une mutation **publique sans aucun contrôle
  d'accès** : elle accepte `guardianId` en argument et lie n'importe quel élève
  à n'importe quel tuteur. À refermer dans ce chantier.
- `createChildAccount` exige un email et un mot de passe par enfant.
- La génération de paliers accepte les six niveaux (CI→CM2). CE2/CM1 est l'état
  du contenu semé, pas un plafond technique.
- `aiGateway.generate` est un `internalAction` unique par lequel passe tout
  appel IA payant ; il évalue déjà budget et quota.
- Aucun cron ne génère de contenu (`crons.ts` ne contient que la purge
  d'historique et le rollover de streak). **La génération est paresseuse** : le
  coût IA ne court que sur usage réel.
- `convex/http.ts` expose déjà une route qui délègue à
  `ctx.runMutation(internal…)` — motif directement réutilisable pour le webhook.

---

## 4. Modèle de données

### 4.1 Tables nouvelles

```ts
// ── L'école et son personnel ──────────────────────────────────────────
schools: {
  name, city?, contactName, contactEmail, contactPhone?,
  ninea?,                                   // identifiant fiscal SN (facture)
  status: "prospect" | "active" | "suspended",
  createdAt,
}.index("by_status", ["status"])

schoolStaff: {
  schoolId, profileId,
  staffRole: "directeur" | "professeur",
  status: "active" | "removed",
}.index("by_school", ["schoolId"])
 .index("by_profile", ["profileId"])

// Les classes réelles, pas les niveaux : une école a souvent CM1 A et CM1 B
schoolClasses: {
  schoolId,
  class: classEnum,                         // CI..CM2, réutilise l'enum existant
  label,                                    // "A", "B", "unique"
  teacherId?,                               // Id<"profiles"> — professeur titulaire
}.index("by_school", ["schoolId"])
 .index("by_school_class", ["schoolId", "class"])

schoolMemberships: {
  schoolId, studentId, schoolClassId,
  status: "active" | "released",
  enrolledAt, releasedAt?,
}.index("by_school_status", ["schoolId", "status"])
 .index("by_student", ["studentId"])
 .index("by_class_status", ["schoolClassId", "status"])

// Compteur de sièges dans SA PROPRE table : l'import en masse ne doit pas
// entrer en contention avec le document d'abonnement, qui est le plus lu.
schoolSeatUsage: {
  schoolId, activeCount, updatedAt,
}.index("by_school", ["schoolId"])

// ── L'abonnement et l'argent ──────────────────────────────────────────
subscriptions: {
  ownerType: "school" | "parent",           // "parent" non implémenté en v1
  ownerId,                                  // v.string() — Id<"schools"> aujourd'hui
  seatsPurchased,
  pricePerSeatFcfa,                         // effectif moyen, gelé à la signature
  totalFcfa,                                // gelé à la signature
  startsAt, endsAt,
  status: "draft" | "pending_payment" | "active"
        | "past_due" | "expired" | "cancelled",
  createdAt,
}.index("by_owner", ["ownerType", "ownerId"])
 .index("by_status", ["status"])
 .index("by_endsAt", ["endsAt"])

installments: {
  subscriptionId,
  index,                                    // 1..3
  amountFcfa, dueAt,
  status: "pending" | "paid" | "overdue" | "failed",
  paidAt?,
}.index("by_subscription", ["subscriptionId"])
 .index("by_status_dueAt", ["status", "dueAt"])

payments: {
  subscriptionId, installmentId?,
  provider: "paydunya",
  providerToken,                            // clé d'idempotence du webhook
  amountFcfa,
  status: "initiated" | "completed" | "failed" | "cancelled",
  rawPayload?,                              // réponse brute, audit et litige
  createdAt, completedAt?,
}.index("by_providerToken", ["providerToken"])
 .index("by_subscription", ["subscriptionId"])

// ── Import en masse ───────────────────────────────────────────────────
studentImportJobs: {
  schoolId, createdBy,                      // Id<"profiles"> du directeur
  totalRows, processedRows,
  status: "pending" | "running" | "completed" | "partial" | "failed",
  startedAt, finishedAt?, errorMessage?,
}.index("by_school", ["schoolId"])
 .index("by_status", ["status"])

studentImportRows: {
  jobId, schoolClassId, name,
  status: "pending" | "created" | "skipped" | "failed",
  studentId?,                               // rempli après création → idempotence
  loginCode?, failureReason?,
}.index("by_job_status", ["jobId", "status"])

// ── Rattachement du parent ────────────────────────────────────────────
parentLinkCodes: {
  studentId, schoolId, code, expiresAt,
  redeemedBy?, redeemedAt?,                 // usage unique
}.index("by_code", ["code"])
 .index("by_student", ["studentId"])
```

### 4.2 Modifications de l'existant

```ts
profiles: {
  // ...champs existants
  class: v.optional(classEnum),   // niveau de l'élève — requis pour tout
                                  // élève créé par une école ; optionnel au
                                  // niveau du validateur car parents,
                                  // professeurs, directeurs et admins n'en
                                  // ont pas.
  role: "admin" | "parent" | "student" | "professeur" | "directeur",
}
```

### 4.3 Justification des choix structurants

**Le personnel passe par une table, pas par un champ sur `profiles`.** Au
Sénégal un professeur enseigne couramment dans deux établissements, et un
directeur peut gérer un groupe scolaire. `schoolStaff` couvre les deux.

**`pricePerSeatFcfa` et `totalFcfa` sont gelés à la signature.** Le tarif
catalogue évoluera ; les contrats en cours ne doivent pas être revalorisés
rétroactivement.

**`installments` et `payments` sont distincts.** Une tranche est ce qui est *dû*,
un paiement est une *tentative*. Une tranche peut accumuler plusieurs échecs
avant d'aboutir : n lignes `payments`, une ligne `installments`. Les confondre
rend la réconciliation impossible.

**`payments.providerToken` est indexé** et sert de clé d'idempotence : PayDunya
rejoue ses webhooks. Sans cette clé, un paiement crédite plusieurs tranches.

**Le compteur de sièges est dans sa propre table.** Les guidelines Convex du
repo interdisent de compter via `.collect().length` et prescrivent un compteur
dénormalisé dans un document séparé. Le séparer de `subscriptions` évite la
contention d'écriture pendant l'import en masse.

**`subscriptions.ownerId` est `v.string()` et non un `v.id(...)`.** Les
guidelines demandent un typage strict des identifiants ; c'est ici impossible,
l'intérêt du champ étant précisément de porter un `Id<"schools">` aujourd'hui
et un `Id<"profiles">` le jour où le B2C ouvre. Le repo a déjà ce précédent
avec `profiles.userId`. Contrepartie à assumer : la cohérence entre
`ownerType` et `ownerId` n'est pas garantie par le schéma, elle doit l'être par
les fonctions qui écrivent et par un test.

**`status: "released"` plutôt qu'une suppression.** Un élève qui quitte l'école
libère son siège mais conserve son historique, et la traçabilité reste
disponible en cas de litige sur la facture.

**Les lignes d'import sont une table enfant**, pas un tableau sur le job : les
guidelines interdisent les listes non bornées dans un document (limite de 1 Mo,
et chaque écriture réécrit le document entier).

### 4.4 Convention de nommage des index

Les guidelines Convex recommandent `by_field1_and_field2`. Le repo utilise
déjà `by_subjectId_class`, `by_user_palier`, `by_month_status`. **On suit la
convention du repo** (`by_school_status`) pour rester homogène avec l'existant.

---

## 5. Couche de droits d'accès

### 5.1 Principe

Le contrôle est **côté serveur, dans chaque fonction**. Les fonctions Convex
sont une API HTTP publique : avec l'URL du déploiement et un jeton de session,
`paliers.getBucket` s'appelle directement sans passer par l'interface. Un
paywall vivant dans les layouts React n'est pas un paywall.

L'état d'accès est **dérivé à l'appel, jamais stocké** : pas de cache à
invalider, pas de cron d'expiration, aucune fenêtre où une école a payé mais
ses élèves restent bloqués.

### 5.2 `convex/access.ts`

```ts
type AccessState =
  | { ok: true;  schoolId: Id<"schools">; endsAt: number }
  | { ok: false; reason:
        | "not_authenticated"
        | "not_student"
        | "no_school"          // aucun rattachement école
        | "seat_released"      // a quitté l'école
        | "no_subscription"    // l'école n'a aucun abonnement
        | "pending_payment"    // contrat signé, rien encaissé
        | "past_due"           // tranche échue, grâce dépassée
        | "expired"            // année écoulée
        | "cancelled" };

// Fonction PURE — aucun accès base, reçoit les documents déjà lus.
// C'est elle que les tests ciblent (motif aiGateway/budget.ts).
export function decideAccess(input: AccessInput): AccessState;

// Wrappers minces : lire les documents, déléguer à decideAccess.
export const getAccessState = query({ ... });               // UI
export const getAccessStateInternal = internalQuery({...});  // depuis les actions
export async function requireActiveAccess(ctx, profileId);   // mutations → throw
```

Le découpage pur / wrapper n'est pas cosmétique : c'est ce qui rend les huit
branches de la section 5.3 testables sans base de données, conformément au
motif déjà en place dans le repo (cf. section 9).

### 5.3 Algorithme de dérivation

```
1. profile introuvable                          → not_authenticated
2. profile.role !== "student"                    → not_student
3. schoolMemberships by_student :
     aucune ligne                                → no_school
     ligne "released" uniquement                 → seat_released
4. subscriptions by_owner ("school", schoolId), couvrant maintenant :
     aucune                                      → no_subscription
5. selon subscription.status :
     "active"     → now < endsAt ? ok : expired
     "past_due"   → grâce non dépassée ? ok : past_due
     "draft" | "pending_payment"                 → pending_payment
     "expired"                                   → expired
     "cancelled"                                 → cancelled
```

Coût : 3 lectures de documents, 4 dans la branche `past_due` (lecture de la
tranche échue la plus ancienne pour calculer la grâce).

```ts
const PAST_DUE_GRACE_MS = 21 * 24 * 60 * 60 * 1000;   // 21 jours
```

### 5.4 Requêtes contre mutations

- **Mutations et actions** : lèvent une erreur. Le code appelant l'attrape.
- **Requêtes** : *retournent* un statut, ne lèvent jamais. C'est la convention
  déjà en place dans le repo (`return null` quand le rôle ne colle pas), et une
  requête qui lève casse l'arbre React — l'application n'a pas d'error boundary.

Le `reason` typé permet à l'interface de distinguer « l'école n'a pas encore
payé » de « tu as quitté cette école ».

### 5.5 Le verrou sur l'argent

Le contrôle est ajouté **à l'intérieur de `aiGateway.generate`**. Une fonction
future qui passerait par le gateway en oubliant son propre contrôle ne pourra
donc pas dépenser d'argent.

**Correction importante, établie à l'implémentation.** Une version antérieure de
cette section affirmait que `generate` était le point de passage unique de tout
appel IA payant. **C'est faux.** Trois modules appellent l'API OpenAI
directement, sans passer par le gateway :

| Module | Usage |
|---|---|
| `convex/attemptsVerify.ts` | vérification des réponses courtes |
| `convex/attemptsExplain.ts` | `generateExplanation` |
| `convex/pdfUploadsExtract.ts` | extraction PDF, côté administration |

Seuls trois sites d'appel passent réellement par `generate` :
`explainMistake.ts` et `paliers/index.ts` (deux fois).

**Et aucun des trois modules contournants n'écrit dans `aiUsage`** — vérifié,
zéro occurrence de `recordUsage` dans les trois. Leur dépense échappe donc au
suivi de coût, au plafond `aiMonthlyBudgetUsd`, au quota `dailyMoreLimitPerKid`
et au verrou de droits. Voir §7.4, qui s'appuyait sur la prémisse inverse.

Conséquence pour le paywall : le verrou du gateway est une ceinture partielle.
Le contrôle posé dans chaque fonction reste la protection principale, et pour
`attemptsExplain.generateExplanation` il est la **seule** protection.

Ramener ces trois modules derrière le gateway est un chantier à part entière,
hors du périmètre de ce plan, mais il conditionne la fiabilité des chiffres de
coût comme des plafonds de dépense.

### 5.6 Réserve : le directeur n'est jamais bloqué

Si l'abonnement expire et que l'espace école est barré, le directeur ne peut
plus se connecter **pour payer**. L'espace école et l'espace facturation
restent accessibles en permanence, quel que soit le statut de l'abonnement.
Seul le chemin d'apprentissage élève est protégé.

### 5.7 Surface à instrumenter — 34 fonctions

> **Correction (revue finale de branche).** Cette liste est **incomplète** :
> `convex/exercises.ts` en fait partie et n'y figurait pas. Ses quatre lectures
> (`listByTopic`, `listAllDrafts`, `listAllPublished`, `getById`) rendaient le
> document brut — corrigé, indices et bonne réponse compris — sans aucune
> authentification, alors que les exercices de palier générés par l'IA y sont
> insérés en `status: "published"`. Elles portent désormais un garde de rôle
> (professeur ou admin) ; c'est un contrôle de rôle et non de paywall, un élève
> payant n'ayant pas davantage à lire les corrigés. Le chemin élève légitime
> reste `paliers/index.ts` et son `stripAnswerFromExercise`.

| Fichier | Fonctions | n |
|---|---|---|
| `paliers/index.ts` | `getExercisesForPalier`, `getBucket`, `regenerateFailedExercises`, `startPalierAttempt` | 4 |
| `palierAttempts.ts` | `verifyAttempt`, `requestHint`, `submitPalier`, `getMyAttempt`, `getProgressForPalierAttempt`, `listMyAttempts` | 6 |
| `attempts.ts` | `getResumeIndex`, `submit`, `getAttemptsForExercise`, `getProgressForTopic` | 4 |
| `students.ts` | `getMyStats`, `getStudentSubjectMap`, `getMySoundEnabled`, `getMyEarnedBadges`, `markLevelSeen` | 5 |
| `badges.ts` | `list`, `getById`, `listEarnedByStudent`, `markBadgesSeen` | 4 |
| `topics.ts` | `listAll`, `listBySubject`, `getById` | 3 |
| `subjects.ts` | `list`, `getById` | 2 |
| `progress.ts` | `getStudentProgress`, `getSubjectProgress` | 2 |
| `attemptsExplain.ts` | `generateExplanation` | 1 |
| `explainMistake.ts` | `explainExercise` | 1 |
| `streak.ts` | `setSoundEnabled` | 1 |
| `attemptsVerify.ts` | `verifyShortAnswerWithAI` | 1 |

**`attemptsVerify.verifyShortAnswerWithAI` a été ajoutée après coup.** Elle
manquait au relevé initial : c'est une `action` **publique**, câblée au client
(`components/exercises/ExercisePlayer.tsx`), qui appelle OpenAI **en direct**
— donc hors du gateway et hors du verrou de §5.5. Sans contrôle, un élève sans
droits valides pouvait déclencher une dépense IA par ce chemin. Elle se
déclenche quand la vérification locale par comparaison de chaînes échoue, donc
sur les réponses fausses ou formulées autrement — pas à chaque soumission,
mais fréquemment dans une application d'entraînement.

Les quatre actions (`getBucket`, `regenerateFailedExercises`,
`explainExercise`, `generateExplanation`) n'ont pas de `ctx.db` : elles
appellent `ctx.runQuery(internal.access.getAccessStateInternal)`, motif déjà
utilisé partout dans `paliers/index.ts`.

### 5.8 Ce que chacun voit

- **L'élève** : message passant par `lib/kidCopy.ts`, sur le modèle du
  `budgetExceeded` existant. Ton encourageant, jamais culpabilisant, et **on ne
  parle pas d'argent à un enfant** : « Ton accès n'est pas encore ouvert —
  parle-en à ton maître ou ta maîtresse. »
- **Parent, professeur, directeur** : la vraie raison et la vraie échéance.
- **Chemins de lecture parent et professeur : laissés ouverts** même quand le
  siège de l'élève n'est pas couvert. Historique et bilans déjà générés, donc
  coût marginal nul ; rien de neuf n'est offert, et la pression se porte sur
  l'école plutôt que sur la famille. Décision réversible en une ligne.

---

## 6. Parcours école

### 6.1 Import en masse : un travail par lots, pas une mutation

Trois contraintes s'empilent :

1. `createAccount` ne fonctionne que depuis une `action` (cf.
   `profiles.createChildAccount`).
2. Une action n'est pas transactionnelle.
3. Une mutation Convex a un plafond de documents lus et écrits que 400 élèves
   × 4 documents dépasse.

Les guidelines prescrivent le motif : traiter un lot avec `.take(n)` puis se
replanifier via `ctx.scheduler.runAfter(0, …)`.

```
1. Le directeur colle ou téléverse sa liste (nom + classe).
2. Une mutation crée studentImportJobs + studentImportRows.
3. Vérification du plafond de sièges UNE FOIS, sur le lot entier,
   AVANT toute création : seatsPurchased − activeCount >= totalRows,
   sinon refus sans rien créer.
4. internalAction processImportBatch({ jobId }) :
     - .take(25) lignes "pending"
     - pour chacune : createAccount → patch ligne en "created" + studentId
                      → insert schoolMemberships
     - incrémente schoolSeatUsage.activeCount une fois pour le lot
     - s'il reste des lignes : ctx.scheduler.runAfter(0, …même action…)
5. Progression lisible dans la console : processedRows / totalRows.
```

**Idempotence** : une ligne en `"created"` n'est jamais retraitée. Si l'action
meurt à la ligne 213, la reprise repart exactement de là. Le compteur est
incrémenté une fois par lot, pas une fois par élève — ce qui évite la
contention.

### 6.2 Identifiants sans email

Une école de 400 élèves n'a pas 400 adresses email d'enfants. L'élève créé par
une école reçoit un **code de connexion** (forme `CM1A-4821`), mémorisable et
saisissable par un enfant de 8 ans.

Ce que le code du repo établit : `createAccount({ account: { id, secret } })`
prend une chaîne arbitraire comme identifiant de connexion, et rien dans le
repo n'exige que ce soit un email. `profile()` écrit cette valeur dans
`users.email`.

**Réinitialisation de mot de passe** : impossible en autonomie pour ces élèves
(pas de boîte mail). C'est le professeur ou le directeur qui réinitialise depuis
la console école — comportement souhaitable pour un enfant de cet âge.

**Vérifié dans la source du provider installé** (`@convex-dev/auth` 0.0.91,
`src/providers/Password.ts`) :

1. **Aucune validation du format email.** `defaultProfile` se contente de
   `email: params.email as string`, et le repo surcharge de toute façon
   `profile()`. La valeur part telle quelle dans `account: { id: email, secret }`.
   Un code `CM1A-4821` est donc un identifiant de connexion valide, et
   **l'adresse de synthèse de repli est inutile** — l'élève tape son code, point.

2. **La piste « seconde instance `Password({ id: "eleve" })` » ne marche pas**,
   et il faut l'abandonner. `Password()` retourne
   `ConvexCredentials({ id: "password", … })` avec cet identifiant **codé en
   dur** ; `config.id` n'alimente que le champ `provider` de l'enregistrement
   du compte, pas l'identifiant de connexion. Deux instances entreraient donc
   en collision sur le même `signIn("password", …)`.

**Conception retenue en conséquence** : **un seul** provider `Password`. Le
`profile()` existant distingue déjà les rôles ; il distinguera aussi les élèves
à la forme de leur identifiant. La réinitialisation reste configurée
globalement sur `ResendOTPPasswordReset` : pour un élève dont l'identifiant est
un code sans boîte mail, elle échouera naturellement — c'est le comportement
voulu, la réinitialisation passant par une mutation réservée au professeur ou
au directeur.

### 6.3 Rattachement du parent par code

L'élève créé par l'école n'a pas de vraie adresse : `linkRequests`, qui repose
sur l'email et va du parent vers l'élève, ne peut pas servir. Le sens est
d'ailleurs inversé — ici l'école pré-autorise, le parent consomme.

L'import génère un code par élève, imprimé sur le billet remis à la famille. Le
parent s'inscrit normalement (lui a un email), saisit le code, et la
consommation insère un `studentGuardians` avec `relation: "parent"` — le
mécanisme existant. **Conséquence : tout l'espace parent fonctionne sans
modification.**

Le code est à usage unique (`redeemedBy` / `redeemedAt`) et expire.

### 6.4 L'espace professeur se remplit

Aucun flux ne crée aujourd'hui de lien `relation: "professeur"` : « Mes
élèves » est structurellement vide. Avec `schoolClasses.teacherId`,
`profiles.getTeacherStudents` se réécrit pour lire les classes de l'école au
lieu de `studentGuardians`.

**Effet de bord** : le comportement de `getTeacherStudents` change ; son test
existant dans `convex/__tests__/` doit être mis à jour.

### 6.5 Sécurité

Les guidelines sont catégoriques : *« NEVER accept a userId or any user
identifier as a function argument for authorization purposes. Always derive the
user identity server-side. »*

- Chaque mutation école dérive le directeur de la session et vérifie son
  appartenance via `schoolStaff` à l'école visée. Jamais de confiance dans un
  `schoolId` reçu en argument seul.
- **`profiles.linkChild` est refermée** : elle accepte aujourd'hui `guardianId`
  en argument sans aucun contrôle d'accès. Correction incluse dans ce chantier.

---

## 7. Tarification

### 7.1 Grille

| Tranche | Prix / siège / an |
|---|---|
| 1 – 100 sièges | 3 000 FCFA |
| 101 – 300 sièges | 2 400 FCFA |
| 301 sièges et plus | 1 800 FCFA |

**Plancher : 50 sièges facturés minimum** (150 000 FCFA/an). Une école de 12
élèves rapporte moins que le temps consacré à l'accompagner.

### 7.2 Le calcul est cumulatif

Chaque tranche ne s'applique qu'à ses propres sièges. En prix de tranche unique
appliqué à tout le contrat, l'arithmétique se retourne : 100 × 3 000 =
300 000 FCFA contre 101 × 2 400 = 242 400 FCFA — acheter plus coûterait moins.
Non monotone, et un directeur le trouvera.

| École | Calcul | Total / an | Effectif / siège |
|---|---|---|---|
| 80 élèves | 80 × 3 000 | 240 000 FCFA | 3 000 |
| 250 élèves | (100 × 3 000) + (150 × 2 400) | 660 000 FCFA | 2 640 |
| 500 élèves | (100 × 3 000) + (200 × 2 400) + (200 × 1 800) | 1 140 000 FCFA | 2 280 |

Le calcul est fait côté serveur ; le directeur ne voit qu'un total.
`subscriptions.pricePerSeatFcfa` stocke le tarif effectif moyen
(`totalFcfa / seatsPurchased`), **arrondi à l'entier — le FCFA n'a pas de
sous-unité — et à usage d'affichage uniquement**. La valeur qui fait foi pour
la facturation est `totalFcfa`, jamais un produit recalculé depuis le tarif
moyen.

### 7.3 Fondement du tarif — à valider

Estimation de marché, **non vérifiée**, à confirmer par le propriétaire du
projet : la scolarité d'une école privée élémentaire sénégalaise se situe
approximativement entre 10 000 et 50 000 FCFA par mois, soit 100 000 à
500 000 FCFA par élève et par an. Un outil pédagogique complémentaire se
positionne typiquement entre 1 et 3 % de ce montant, soit 1 500 à
4 500 FCFA/élève/an. 3 000 FCFA est au milieu de cette fourchette.

**Argument de vente** : 240 000 FCFA/an pour une petite école, c'est
20 000 FCFA par mois — le prix d'un élève supplémentaire.

### 7.4 Plancher de coût

Le coût marginal réel n'a pas pu être calculé : la session de design n'a pas
accès à la base de production.

**Structure du coût.** Les paliers sont mis en cache 7 jours par
(matière, niveau, topic, index), et ce cache est partagé par tous les élèves de
ce niveau, dans toutes les écoles :

> coût par élève = (coût fixe du contenu du niveau ÷ élèves sur ce niveau)
>                  + variable par élève

La variable par élève est bornée par construction :
`settings.dailyMoreLimitPerKid` = 3, régénérations plafonnées à 3 par palier sur
7 jours, le tout sous `settings.aiMonthlyBudgetUsd`. Et la génération est
paresseuse : aucun cron ne pré-génère de contenu, donc rien ne se dépense de
façon récurrente à vide. À noter tout de même : le champ
`paliers.preGenerated` signale l'existence d'un script de pré-génération lancé
à la main (« Decision 73 »), qui dépense lui à la demande de l'opérateur — à
prendre en compte dans le calcul du plancher.

**Conséquence stratégique** : la première école d'un niveau paie le contenu, la
dixième n'ajoute presque rien. Le tarif doit viser à *remplir des niveaux*,
pas à couvrir un coût par élève.

**Mesure à lancer avant de figer la grille** : agréger `aiUsage.costUsd` par
`month` et `purpose`, diviser par le nombre d'élèves actifs distincts sur la
période. Le champ existe déjà, les index `by_month` et `by_user_month` aussi.

**Avertissement — ce chiffre sous-estimera le coût réel.** Comme établi en §5.5,
`convex/attemptsVerify.ts`, `convex/attemptsExplain.ts` et
`convex/pdfUploadsExtract.ts` appellent OpenAI directement et n'écrivent rien
dans `aiUsage`. La vérification des réponses courtes, qui tourne à chaque
soumission d'un exercice à réponse libre, est dans ce lot — ce n'est pas un
chemin marginal.

**Ne pas fixer le tarif sur ce seul agrégat.** Deux façons de fermer l'écart,
dans l'ordre de fiabilité : instrumenter les trois modules pour qu'ils écrivent
dans `aiUsage` (ou passent par le gateway), ce qui est de toute façon
souhaitable ; ou, en attendant, recouper l'agrégat avec la facture OpenAI réelle
de la même période, l'écart entre les deux donnant la mesure de ce qui échappe
au suivi.

---

## 8. Encaissement — PayDunya

### 8.1 Tranches

Trois échéances calées sur le calendrier scolaire sénégalais : **octobre,
janvier, avril**. Le total est divisé par trois, le reste de division tombe sur
la première tranche — le plus gros versement arrive quand le budget est le plus
frais.

Les trois lignes `installments` sont créées à la signature, avec leur `dueAt`.

### 8.2 Flux de paiement

```
signature → 3 lignes installments, subscription.status = "pending_payment"
            → aucun accès élève

le directeur clique « payer la tranche N »
  → action : créer la facture PayDunya MAINTENANT
             (une facture pré-créée expire avant son échéance)
  → insert payments { providerToken, status: "initiated" }
  → renvoyer l'URL de paiement

PayDunya POST → route dans convex/http.ts → httpAction
  → 1. vérifier la signature
  → 2. ctx.runMutation(internal.billing.applyPayment, { token, … })
```

### 8.3 Quatre règles non négociables

1. **Vérifier la signature avant toute chose.** Un webhook non authentifié qui
   active des abonnements est un générateur d'abonnements gratuits.
2. **Ne jamais croire le montant du payload.** Relire
   `installments.amountFcfa` et comparer. Un payload annonçant 100 FCFA ne doit
   pas solder une tranche de 400 000 FCFA.
3. **Idempotence sur `providerToken`.** PayDunya rejoue ses appels — tous les
   agrégateurs le font. Si le jeton est déjà `completed`, répondre 200 et ne
   rien faire. Sans cela, un paiement crédite plusieurs tranches.
4. **Le webhook est un `httpAction` : pas de `ctx.db`.** Il délègue à un
   `internalMutation`, exactement comme la route `/link-response` existante.

### 8.4 Machine à états de l'abonnement

| Statut | Accès élève | Transition |
|---|---|---|
| `draft` | non | devis créé, non signé |
| `pending_payment` | non | signé, aucune tranche encaissée |
| `active` | oui | tranche courante encaissée, `now < endsAt` |
| `past_due` | **oui pendant la grâce**, puis non | une tranche échue impayée |
| `expired` | non | `now >= endsAt` |
| `cancelled` | non | résiliation |

### 8.5 Délai de grâce — décision commerciale

Quand la tranche 2 a trois jours de retard, on ne coupe pas 400 enfants.
`past_due` **laisse l'accès ouvert pendant 21 jours** à compter du `dueAt` de la
tranche échue la plus ancienne, avec des rappels de plus en plus fermes au
directeur. L'accès ne se ferme qu'au-delà.

Une comptabilité d'école est lente, pas malveillante. Couper des enfants parce
qu'un intendant est en retard est cruel et commercialement suicidaire.

> **Trou de spec relevé par la revue finale de branche — à trancher.**
> Cette section ancre la grâce sur le `dueAt` de la tranche échue la plus
> ancienne, mais ne dit pas ce qu'il advient d'un abonnement `past_due` pour
> lequel **aucune tranche échue n'est identifiable**. L'implémentation
> (`convex/accessRules.ts`) accorde alors l'accès **sans limite de temps** :
> c'est la seule branche de `decideAccess` qui échoue en ouvert, toutes les
> autres échouant en fermé, et un test verrouille ce comportement.
>
> Ce n'est pas théorique pendant le plan 1/3 : les abonnements y sont insérés
> à la main **sans aucune ligne `installments`**, et le cron qui bascule les
> tranches en `overdue` n'arrive qu'au plan 3/3. Un `past_due` posé aujourd'hui
> donne donc un accès illimité. « Pas d'ancre » ne devrait pas valoir
> « grâce infinie ».
>
> Deux issues possibles, à arbitrer avec le client : refuser l'accès faute
> d'ancre (cohérent avec le reste, mais coupe une école dont les données de
> tranches seraient incomplètes), ou ancrer la grâce sur un champ de
> l'abonnement lui-même — `startsAt`, ou un `pastDueSince` à ajouter.

### 8.5 bis Message adulte — promesse non tenue par le plan 1/3

§5.8 promet à un adulte la vraie raison du refus, là où l'enfant ne voit qu'un
message encourageant. `lib/accessCopy.ts` fournit bien `accessMessageForAdult`,
couvrant les neuf raisons — mais **aucun écran ne l'appelle** :
`components/AccessGate.tsx` affiche le message enfant à tout le monde, y compris
à un parent connecté et à un visiteur déconnecté qui ouvrirait une route élève.
Le plan 1/3 n'a commandé que l'écran enfant. À reprendre au plan 2/3, en même
temps que les gardes de rôle côté layouts.

### 8.6 Cron

Un `crons.cron` quotidien marque les tranches échues (`pending` → `overdue`) et
fait basculer les abonnements concernés en `past_due`. `crons.cron` et non les
helpers `daily`/`weekly`, que les guidelines interdisent et que `crons.ts`
évite déjà.

### 8.7 À vérifier à l'implémentation

L'API PayDunya n'a pas pu être consultée dans la session de design (accès
réseau restreint). À confirmer sur la documentation officielle avant d'écrire
l'intégration : création de facture, champs du webhook, méthode exacte de
vérification de signature, durée de validité d'une facture, plafonds de montant
par moyen de paiement, et comportement en cas de paiement partiel.

---

## 9. Tests

**Motif de test du repo, à suivre.** Les guidelines Convex prescrivent
`convex-test` + `@edge-runtime/vm` ; **ce repo ne les utilise pas** et ne les
a pas en dépendances. `vitest.config.ts` tourne en `environment: "jsdom"`, et
les tests de `convex/__tests__/` importent des **fonctions pures exportées**
depuis les modules Convex (`evaluateBudget` et `projectMonthEndSpend` depuis
`aiGateway/budget`, `evaluateQuota` depuis `aiGateway/quota`,
`shuffleDeterministic` depuis `paliers`). Aucun handler `query`/`mutation`
n'est appelé directement.

On suit ce motif : **toute la logique de décision est extraite en fonction
pure**, le wrapper Convex se limitant à lire les documents et à déléguer.
`aiGateway/budget.ts` et `aiGateway/quota.ts` sont les modèles à imiter.
Introduire `convex-test` est hors périmètre de ce chantier ; ce serait un
changement d'outillage transverse, à traiter séparément.

**Dérivation des droits (`convex/__tests__/access.test.ts`)** — un cas par
branche de la section 5.3 : élève sans école, siège libéré, contrat signé non
payé, actif, échu, `past_due` dans la grâce (accès **ouvert**), `past_due`
au-delà (accès **fermé**), annulé. Plus : le directeur d'une école expirée
atteint toujours l'espace facturation.

**Tarification (`convex/__tests__/pricing.test.ts`)** — les trois exemples
chiffrés de la section 7.2, le plancher de 50 sièges, et une **propriété de
monotonie** : pour tout n, `total(n + 1) > total(n)`. C'est ce test qui empêche
la régression non monotone décrite en 7.2.

**Import en masse (`convex/__tests__/schoolImport.test.ts`)** — refus quand le
lot dépasse les sièges disponibles (et vérification qu'aucune ligne n'a été
créée), reprise après interruption sans doublon, compteur `activeCount` exact
après un import de plus d'un lot.

**Webhook (`convex/__tests__/billing.test.ts`)** — signature invalide rejetée,
montant divergent rejeté, jeton rejoué sans double crédit, tranche soldée
faisant passer l'abonnement en `active`.

**Paywall côté fonctions** — pour un échantillon représentatif des 34 fonctions
(au moins une par fichier) : un élève sans accès valide ne peut ni lire ni
écrire. Plus un test sur `aiGateway.generate` : aucun appel IA sans droit
valide.

**Bout en bout (Playwright)** — un parcours : création d'école, import de deux
élèves, paiement de la tranche 1, connexion élève avec son code, accès au
contenu.

---

## 10. Hors périmètre

- Abonnement parental (B2C). Le champ `ownerType` est prêt, la valeur
  `"parent"` n'est pas implémentée.
- Module de facturation (factures numérotées, mentions légales, PDF, avoirs).
- Renouvellement automatique d'une année sur l'autre.
- Multi-établissement pour un même contrat (groupe scolaire).
- Remboursement et avoir sur siège libéré en cours d'année.
- Ouverture du contenu au-delà de CE2/CM1 : indépendant de ce chantier, la
  génération accepte déjà les six niveaux.

---

## 11. Ordre d'implémentation proposé

Chaque étape est livrable et testable séparément.

1. **Schéma et rôle `directeur`** — les 11 tables, `profiles.class`, extension
   du rôle. Aucun comportement modifié.
2. **`convex/access.ts` et la dérivation** — avec ses tests, avant toute
   instrumentation. Une seule fonction protégée en démonstration.
3. **Instrumentation des 34 fonctions + `aiGateway.generate`** — mécanique et
   volumineux ; l'étape où un oubli est invisible.
4. **Écrans de blocage** — `kidCopy` pour l'élève, vraie raison pour les
   adultes.
5. **Espace école** — création d'école, classes, personnel ; jamais bloqué par
   le paywall.
6. **Import en masse** — job, lots, idempotence, codes de connexion.
   Réinitialisation de mot de passe par le professeur.
7. **Codes de rattachement parent** + réécriture de `getTeacherStudents`
   (mettre à jour son test).
8. **Correction de sécurité `profiles.linkChild`** — peut être avancée à tout
   moment, elle est indépendante.
9. **Tarification** — calcul cumulatif côté serveur, avec le test de monotonie.
10. **PayDunya** — tranches, facture, webhook, idempotence, cron d'échéance.
11. **Remise à zéro des comptes existants** — dernière étape, sur feu vert
    explicite uniquement.

---

## 12. Points à confirmer avant l'implémentation

| Point | Où | Comment |
|---|---|---|
| ~~Le provider `Password` valide-t-il le format email ?~~ | §6.2 | **Résolu** : non, aucune validation. Et la piste des deux providers est écartée, l'identifiant de connexion étant codé en dur. |
| API PayDunya : facture, webhook, signature, plafonds | §8.7 | Documentation officielle PayDunya |
| Coût IA réel par élève et par an | §7.4 | Agrégation `aiUsage.costUsd` sur la production |
| Fourchette de scolarité privée élémentaire au Sénégal | §7.3 | Connaissance marché du propriétaire du projet |
