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
  pricePerSeatFcfa,                         // effectif moyen, affichage seul
  totalFcfa,                                // fait foi ; avenant de sièges : §7.6
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

**Les sièges déjà signés ne sont jamais revalorisés.** Le tarif catalogue
évoluera, et un contrat en cours ne doit pas être recalculé au nouveau tarif.

Cette section disait « `pricePerSeatFcfa` et `totalFcfa` sont gelés à la
signature » ; l'avenant de sièges (§7.6) réécrit précisément ces deux champs, la
phrase est donc devenue fausse dans la lettre. Elle reste vraie dans le fond, et
c'est l'implémentation qui le garantit : un avenant part du `totalFcfa` **du
contrat** et y ajoute le prorata des seuls sièges ajoutés — il ne recalcule
jamais un devis neuf pour l'ensemble. Les sièges d'origine gardent donc à jamais
le prix auquel ils ont été vendus, quel que soit le barème du jour.

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

### 4.5 Invariant : les contrats d'une école sont disjoints

**Deux contrats d'une même école ne se chevauchent jamais.** Ce n'est pas une
convenance de modélisation : c'est ce qui rend correcte la lecture qui décide de
l'accès de chaque enfant.

Le paywall (`convex/access.ts`) et le plafond de sièges (`convex/schools.ts`)
désignent le contrat en vigueur par **une seule lecture de document** — le plus
grand `startsAt` parmi les contrats déjà commencés, sur `by_owner_startsAt` :

```ts
.withIndex("by_owner_startsAt", (q) =>
  q.eq("ownerType", "school").eq("ownerId", schoolId).lte("startsAt", now))
.order("desc")
.first()
```

Sous disjointness, ce document est **le** contrat qui couvre `now` s'il en
existe un, et le dernier contrat échu sinon — ce qui donne `expired` plutôt que
`no_subscription` pour une école qui a laissé son contrat s'éteindre. Sans
disjointness, la lecture peut retenir un contrat court et échu niché dans un
contrat long et actif, et **couper une école qui a payé**.

L'invariant est maintenu à l'écriture : `recordSubscription` refuse toute
période croisant un contrat existant, et c'est la seule mutation qui crée une
période. Les deux mutations qui modifient une ligne existante — `amendSeats`
(§7.6) et `activateSubscription` (§8.4 bis) — **ne touchent ni `startsAt` ni
`endsAt`** : elles ne peuvent donc pas créer de chevauchement, puisqu'elles ne
déplacent aucune borne. Le contrôle est **exact en une lecture** —
le candidat est la ligne de plus grand `startsAt` parmi celles qui commencent
avant la fin proposée, et il y a conflit si et seulement si son `endsAt` dépasse
le début proposé. Une fenêtre de lecture bornée ne prouverait rien : n'importe
quel nombre de lignes intercalées en évincerait le vrai conflit.

**Corollaire : `cancelled` n'est pas enregistrable.** Une première version
exemptait les contrats résiliés du contrôle de chevauchement, au motif qu'une
période résiliée doit pouvoir être recontractée. Le motif ne tient pas : aucune
mutation ne sait résilier un contrat existant — les deux `patch` sur
`subscriptions` sont celui d'`amendSeats` (§7.6), qui **n'écrit jamais
`status`**, et celui d'`activateSubscription` (§8.4 bis), qui **n'écrit que
`status` et une seule valeur**, `active` — donc une ligne ne peut jamais
*devenir* résiliée. L'exemption ne
s'appliquait qu'aux lignes saisies résiliées d'emblée, et celles-là
empoisonnaient la sélection : enregistrées avant le
contrat annuel et datées après lui, elles gagnaient la sélection et coupaient
l'école, sans borne — la ligne résiliée continue de gagner jusqu'à ce qu'un
contrat au début encore plus tardif soit enregistré.

**Ce que la facturation devra faire.** Le jour où une vraie résiliation existera
(un `patch` du statut vers `cancelled`), l'invariant change de nature : il ne
portera plus que sur les contrats non résiliés. Deux choses devront suivre
**ensemble**, l'une sans l'autre rouvrant le défaut :

1. la **sélection** devra ignorer les contrats résiliés ;
2. le **contrôle de chevauchement** aura besoin d'un index portant `status` pour
   rester exact — `by_owner_startsAt` ne le porte pas, donc aucune lecture
   bornée par cet index ne distingue un conflit réel d'une ligne résiliée.

---

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

### 7.1 Grille — **5 000 FCFA par élève et par année scolaire**

Tarif **plat**, tranché par le propriétaire du projet, et provisoire de son
propre aveu (« pour le moment »). Aucune remise au volume : la 500e école paie
le même prix par élève que la première.

| Effectif | Total / an | Effectif / siège |
|---|---|---|
| 80 élèves | 400 000 FCFA | 5 000 |
| 250 élèves | 1 250 000 FCFA | 5 000 |
| 500 élèves | 2 500 000 FCFA | 5 000 |

**Plancher : 30 sièges facturés minimum** (150 000 FCFA/an). Une école de 12
élèves rapporte moins que le temps consacré à l'accompagner.

**Pourquoi 30 et non 50.** Le plancher a été posé à 50 quand le premier palier
valait 3 000 FCFA : le contrat minimum valait alors 150 000 FCFA. Le passage au
tarif plat de 5 000 l'aurait porté à 250 000 FCFA — **+67 % sans décision**, par
simple effet de bord. Le plancher a donc été ramené à 30, ce qui rétablit
exactement le seuil voulu à l'origine. Ce qui est calibré, c'est le **revenu
minimum** qui justifie l'accompagnement d'une école, pas le nombre de sièges :
si le tarif change encore, c'est le nombre de sièges qu'il faut recalculer.

**Grille antérieure, non retenue** — trois tranches dégressives cumulatives
(3 000 / 2 400 / 1 800 FCFA aux bornes 100 et 300). Elle reste la référence si
une remise au volume est un jour consentie, et §7.2 explique pourquoi sa forme
cumulative n'est pas négociable.

### 7.2 Le calcul reste cumulatif, même à une seule tranche

Le tarif plat de §7.1 est implémenté comme un barème à **une** tranche, et le
moteur cumulatif demeure. Ce n'est pas du zèle : il ne coûte rien tant qu'il n'y
a qu'une tranche, il rend le retour à un barème dégressif éditable en une
constante, et surtout le piège qu'il évite **redevient réel à la seconde
tranche**.

Ce piège : chaque tranche ne doit facturer que ses propres sièges. En prix de
tranche unique appliqué à tout le contrat, l'arithmétique se retourne —
100 × 3 000 = 300 000 FCFA contre 101 × 2 400 = 242 400 FCFA — et acheter plus
coûterait moins. Non monotone, et un directeur le trouvera.

| École | Calcul dégressif | Total / an | Effectif / siège |
|---|---|---|---|
| 80 élèves | 80 × 3 000 | 240 000 FCFA | 3 000 |
| 250 élèves | (100 × 3 000) + (150 × 2 400) | 660 000 FCFA | 2 640 |
| 500 élèves | (100 × 3 000) + (200 × 2 400) + (200 × 1 800) | 1 140 000 FCFA | 2 280 |

Ces trois lignes ne sont plus facturées, mais elles restent **testées** :
`quoteWithScale` prend un barème en argument, et les tests exercent le calcul
cumulatif sur ce barème dégressif de démonstration. Sans cela, une remise au
volume arriverait un jour sur un moteur que plus aucun test ne couvre.

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

**Structure du coût.** Les paliers sont mis en cache **un trimestre** (90 jours,
`PALIER_TTL_MS`) par (matière, niveau, topic, index), et ce cache est partagé par
tous les élèves de ce niveau, dans toutes les écoles :

> coût par élève = (coût fixe du contenu du niveau ÷ élèves sur ce niveau)
>                  + variable par élève

La variable par élève est bornée par construction :
`settings.dailyMoreLimitPerKid` = 3, régénérations plafonnées à 3 par palier et
par élève sur 7 jours (`REGEN_WINDOW_MS`, à ne pas confondre avec la péremption
du contenu ci-dessus). Et la génération est paresseuse : aucun cron ne
pré-génère, donc un palier que personne ne demande ne coûte rien, même expiré.

**Le plafond mensuel ne borne pas ce qu'il prétend borner.** Deux défauts, tous
deux vérifiés :

1. `aiGateway/db.ts:getMonthSpend` additionne la dépense du mois avec un
   `.take(1000)`. Au-delà de mille appels IA dans le mois, la somme est
   tronquée, la dépense est sous-estimée, et `aiMonthlyBudgetUsd` **cesse de
   mordre**. À quelques centaines d'élèves, mille lignes se franchissent en
   quelques jours.
2. Les trois modules de §5.5 n'appellent pas la passerelle : ils sont donc hors
   du plafond **et** hors de la mesure. `attemptsVerify` tourne à chaque réponse
   libre, et `pdfUploadsExtract` utilise `gpt-4o`, environ 16 fois le prix du
   mini.

Le plafond doit être réparé avant de servir d'argument de rentabilité.

**Correction — le script de pré-génération n'existe pas.** Une version
antérieure de cette section déduisait du champ `paliers.preGenerated`
(« Decision 73 ») l'existence d'un script lancé à la main, et demandait d'en
tenir compte dans le plancher. Vérification faite : **rien ne pose jamais ce
champ à `true`**, aucun script n'est présent dans le dépôt. Il n'y a rien à
compter.

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

### 7.5 Le plancher ouvre des sièges, il ne facture pas seulement

§7.1 pose un minimum facturé sans dire ce que l'école reçoit. **Elle reçoit
autant de sièges qu'elle en paie.** `quoteSubscription` rend un nombre de sièges
facturés égal à `max(demandé, seatFloor)`, et c'est ce nombre qui est enregistré
dans `seatsPurchased` puis plafonné à l'inscription.

L'autre lecture — facturer 50, n'en ouvrir que 30 — ferait payer un droit qu'on
ne rend pas, et donnerait un `pricePerSeatFcfa` de 5 000 pour une école du plus
petit palier : un tarif moyen qui **augmente** quand l'école rapetisse, soit
exactement la non-monotonie que §7.2 existe pour interdire.

La grille vit dans `convex/pricing.ts`, module pur sans aucun import, testé sur
les trois exemples de §7.2, les bornes de palier, le plancher, et la monotonie
prouvée par balayage de 0 à 420 sièges — pas par trois points choisis.

### 7.6 Avenant de sièges — faire grossir une école en cours d'année

Une école qui recrute vingt élèves en février ne pouvait rien obtenir avant la
fin de son contrat (§10, désormais corrigé). La solution évidente — enregistrer
un second contrat de février à juillet — est exactement ce que **§4.5
interdit** : un contrat court niché dans un contrat long gagne la sélection du
paywall, puis expire, et coupe une école qui a payé.

`schools.amendSeats` **modifie un contrat déjà signé** plutôt que d'en créer un
second, et sa sûreté tient tout entière à son étroitesse. Il écrit trois
champs :

| Champ | Écrit | Pourquoi |
|---|---|---|
| `seatsPurchased` | à la hausse seulement | ce que l'école achète |
| `totalFcfa` | ancien **+** prorata | fait foi pour la facturation (§7.2) |
| `pricePerSeatFcfa` | recalculé | conséquence des deux autres, affichage seul |

et **jamais `status`, jamais `startsAt`, jamais `endsAt`** :

- les dates ne bougeant pas, la disjointness de §4.5 est **inchangée** : aucun
  chevauchement ne peut naître d'un avenant ;
- le statut ne bougeant pas **ici**, et ne bougeant ailleurs que d'une seule
  façon (`activateSubscription`, §8.4 bis : `pending_payment` → `active`),
  **aucune ligne ne peut *devenir* `cancelled` ni `past_due`** — la propriété
  dont dépendent le refus de `cancelled` à la saisie (§4.5) et le raisonnement
  de §8.5.

**Le prix est proratisé sur la période restante** :

```
delta   = quote(nouveauxSièges).totalFcfa − quote(siègesActuels).totalFcfa
part    = (endsAt − now) / (endsAt − startsAt),  BORNÉE À [0, 1]
montant = arrondi(delta × part)
```

Le delta passe par `quote` **des deux côtés** et non par une multiplication : le
coût marginal de vingt sièges dépend de la tranche où ils tombent, et une
multiplication redeviendrait fausse au retour d'un barème dégressif, exactement
comme en §7.2. La borne à 1 n'est pas décorative, et ce n'est plus une seconde
ligne : amender le prochain contrat à commencer est un chemin de production, et
sans elle `now < startsAt` donnerait une part supérieure à 1 et surfacturerait.
Bornée, l'école paie le plein tarif d'une période qu'elle a tout entière
devant. La borne à 0 interdit l'avoir silencieux sur un contrat échu — celle-là
reste une seconde ligne, la sélection ne rendant jamais un contrat échu.

**Quel contrat — celui EN VIGUEUR, ou à défaut le PROCHAIN à commencer**
(`amendableSubscription`). Amender le contrat que retient le paywall est juste
tant qu'il court : c'est lui qui décide de l'accès et du plafond. Échu, il ne
décide plus rien, et refuser à ce titre enfermait l'école qui avait signé son
année suivante pendant l'été — ce que `recordSubscription` encourage : le
contrat neuf que le refus conseillait, `recordSubscription` le refuse à son
tour, puisqu'il chevaucherait celui qu'elle venait de signer. La lecture du
contrat à venir est exacte et bornée par `by_owner_startsAt` — `gt("startsAt",
now)`, ordre croissant, **un document** — et c'est la disjointness de §4.5 qui
fait de ce document *le* prochain contrat. Un contrat échu n'est jamais rendu :
la première branche exige `now < endsAt`, la seconde `now < startsAt < endsAt`.

**L'écran vise le même contrat.** `getEnrollmentOutlook` l'expose sous
`amendable` — ses sièges, son total, ses dates — et l'aperçu du formulaire s'y
calcule. Deux sélections divergentes remplaceraient un message trompeur par un
**montant** trompeur, ce qui est pire : l'administrateur validerait une somme
qu'il n'a pas vue. Quand le contrat visé n'a pas commencé, l'écran dit que
l'avenant **n'ouvrira les sièges qu'à sa date de début** : le plafond
d'inscription lit le contrat du paywall, donc le précédent jusque-là.

**Refus** — réservé à l'`admin`, comme tout le module : une baisse de sièges
(le remboursement appartient à la facturation), l'absence de tout contrat à
amender — ni en vigueur, ni à venir (c'est un contrat neuf qu'il faut, et rien
ne le chevauche plus, donc `recordSubscription` l'acceptera) — et les entrées
absurdes.

**Pas de garde d'effectif**, et c'est vérifié plutôt que supposé : un avenant
n'augmente que `seatsPurchased`, `used` ne bouge pas, donc `used <= purchased`
se conserve. Une garde serait en outre **nuisible** — une école déjà au-delà de
son contrat n'en est rapprochée que par un avenant, et c'est le remède même que
`enrollStudent` et l'écran d'école recommandent.

**La trace** — `subscriptionAmendments` (`convex/schema.ts`), même farine que
`schoolMembershipEvents` : contrat, école, sièges avant et après, montant,
auteur, instant. Un `patch` écrase : sans elle, plus rien ne dirait ce qui avait
été signé.

**Deux avenants concurrents** ne se perdent pas : une mutation Convex est une
transaction sérialisable, le second voit son ensemble de lecture invalidé et
rejoue sur la ligne déjà amendée. Les deux prorata s'additionnent.

---

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

Tant que l'encaissement n'existe pas, **une seule de ces transitions est
écrite** : celle de §8.4 bis, posée à la main par un administrateur. Les autres
attendent le plan 3.

### 8.4 bis Activation manuelle — l'unique transition de statut

`recordSubscription` refuse d'enregistrer `active` un contrat qui n'a pas
commencé (§4.5) : `decideAccess` ne lit jamais `startsAt`, donc la ligne
ouvrirait l'accès le jour de sa saisie, pour une année que l'école n'a pas
commencé à payer. Elle conseille donc d'enregistrer le contrat en
`pending_payment` — **encore faut-il que quelque chose sache l'activer le jour
venu.** Rien ne le savait : aucune mutation n'écrivait `status`, et
réenregistrer le contrat en `active` était refusé pour chevauchement avec
lui-même. Une école qui signait son année en juillet n'avait **jamais** l'accès
de l'année qu'elle avait payée.

`schools.activateSubscription` ferme ce trou, et **son étroitesse est ce qui
l'autorise à exister** — c'est le premier `patch` du dépôt sur
`subscriptions.status`, et le refus de `cancelled` (§4.5) comme le raisonnement
de §8.5 reposaient sur l'absence d'un tel `patch` :

| | |
|---|---|
| Statut de départ | `pending_payment`, **et lui seul** |
| Statut d'arrivée | `active`, **littéral dans le code**, jamais un argument |
| Période | le contrat doit avoir commencé et ne pas être fini : `startsAt <= now < endsAt` |
| Champs écrits | **`status` seul.** Ni les dates, ni les sièges, ni les montants |

Les deux raisonnements survivent mot pour mot : aucune ligne ne peut devenir
`cancelled` ni `past_due`, et les dates ne bougeant pas, la disjointness de
§4.5 est intacte.

**Pas `draft`.** « Brouillon » veut dire non conclu, et activer ouvre
l'application à toute une école sans que rien ne sache la refermer ; « en
attente de paiement » atteste au moins qu'un accord existe. Et parce qu'un
brouillon ne pourrait plus avancer, **`recordSubscription` ne l'accepte plus à
la saisie** : une ligne immobile occuperait pourtant sa période, et le vrai
contrat de ces dates serait refusé pour chevauchement — l'école n'aurait plus
jamais d'accès sur cette année-là. Les deux décisions vont ensemble, et donnent
l'invariante suivante : **tout contrat enregistrable peut avancer**
(`pending_payment` s'active, `active` est déjà en vigueur). `draft` reste une
valeur du schéma — un flux de devis en créera peut-être — et `decideAccess`
garde sa branche, désormais inatteignable par la saisie.

**Quel contrat — celui qui couvre `now`**, rendu par
`access.currentSchoolSubscription`, le même helper que le paywall, le plafond
de sièges et l'avenant. Aucune seconde lecture : deux sélections divergentes
activeraient un autre contrat que celui dont l'écran montre les dates. S'il ne
couvre pas `now`, il n'y a rien à activer.

**La règle est pure et testée** (`convex/subscriptionRules.ts`,
`decideActivation`), suivant §9 : le wrapper Convex lit le document et délègue.
L'écran lit la **même** fonction par `getEnrollmentOutlook.contract
.canActivate`, donc le bouton s'affiche exactement quand la mutation accepte —
jamais sur une comparaison de dates faite dans le navigateur, dont l'horloge
est figée au montage.

**La trace** — `subscriptionActivations` (`convex/schema.ts`), même farine que
`schoolMembershipEvents` et `subscriptionAmendments` : contrat, école, statut
d'avant, auteur copié et jamais relu pour autoriser, instant de l'acte.
Activer ouvre l'accès d'une école entière ; l'acte ne doit pas être anonyme, et
le `patch` écrase ce qu'il y avait.

**Rien ne DÉSACTIVE un contrat**, et c'est assumé : aucune mutation ne fait
redescendre un statut. Couper une école est une décision commerciale, avec la
question du montant déjà facturé, et elle appartient à la facturation (§10).
L'écran le dit **avant** le clic.

### 8.5 Délai de grâce — décision commerciale

Quand la tranche 2 a trois jours de retard, on ne coupe pas 400 enfants.
`past_due` **laisse l'accès ouvert pendant 21 jours** à compter du `dueAt` de la
tranche échue la plus ancienne, avec des rappels de plus en plus fermes au
directeur. L'accès ne se ferme qu'au-delà.

Une comptabilité d'école est lente, pas malveillante. Couper des enfants parce
qu'un intendant est en retard est cruel et commercialement suicidaire.

> **Trou de spec relevé par la revue finale de branche — TRANCHÉ : refus.**
> Cette section ancre la grâce sur le `dueAt` de la tranche échue la plus
> ancienne, sans dire ce qu'il advient d'un `past_due` pour lequel **aucune
> tranche échue n'est identifiable**. L'implémentation accordait alors l'accès
> **sans limite de temps** : la seule branche de `decideAccess` à échouer en
> ouvert, toutes les autres échouant en fermé.
>
> **Une grâce se compte à partir de quelque chose.** Sans ancre il n'y a pas de
> date à laquelle la rattacher, et accorder l'accès n'était pas de la clémence
> mais l'ABSENCE de règle. Un `past_due` sans ancre n'est pas un état
> légitime : le statut est posé par une machine, et la machine qui le posera
> est celle-là même qui marque la tranche impayée. C'est donc une incohérence
> de données, et un paywall ne doit pas ouvrir sans limite sur des données
> incohérentes. `decideAccess` refuse désormais, avec le motif `past_due`.
>
> L'autre issue envisagée — ancrer la grâce sur un champ de l'abonnement, un
> `pastDueSince` à ajouter — a été écartée : **rien ne l'écrirait**. Ce chantier
> a déjà retiré deux branches qui protégeaient des flux inatteignables
> (l'exemption `cancelled` de §4.5, l'exemption `human_approved` du cache) ;
> ajouter un champ que personne ne renseigne referait la même faute.
>
> **Invariante que le plan 3 doit tenir.** Le cron qui fera basculer un
> abonnement en `past_due` doit, **dans la même transaction**, créer ou marquer
> la tranche échue qui ancre la grâce. S'il pose le statut sans l'ancre, l'école
> est coupée immédiatement au lieu de disposer de ses 21 jours. C'est le prix de
> fermer ce trou, et il se paie là-bas.
>
> **Et la borne de lecture en fait partie.** `access.ts` cherche l'ancre par
> `by_subscription` avec un `.take(12)`, sur un modèle qui prévoit trois
> tranches par abonnement (§8.1) — quatre fois la marge. Si le plan 3 écrivait
> plus de douze tranches pour un même abonnement, la plus ancienne échue
> pourrait sortir de la fenêtre, l'ancre remonterait `null`, et l'école serait
> coupée. Même exigence qu'en §4.5 : une borne ne vaut que par l'invariante qui
> la garantit, jamais parce qu'elle « devrait suffire ».
>
> Sans effet aujourd'hui : `recordSubscription` refuse `past_due` à la saisie
> (§4.5), et aucun des deux `patch` de la table ne peut le poser — `amendSeats`
> (§7.6) ne touche qu'aux sièges et au montant, `activateSubscription`
> (§8.4 bis) n'écrit qu'`active` — et **rien n'écrit jamais d'`installments`** :
> le statut est donc inatteignable et l'ancre toujours absente. La branche
> décide de ce qui arrivera au plan 3, pas de ce qui arrive maintenant.
>
> L'arrivée d'une activation manuelle (§8.4 bis) ne l'entame pas : une personne
> écrit désormais `status`, mais une seule valeur, `active`. Le raisonnement
> ci-dessus tient **mot pour mot** — `past_due` reste posé par une machine, et
> ce sera la même qui marquera la tranche.

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
chiffrés de la section 7.2, le plancher de sièges, et une **propriété de
monotonie** : pour tout n, `total(n + 1) > total(n)`. C'est ce test qui empêche
la régression non monotone décrite en 7.2.

**Avenant de sièges (même fichier)** — le prorata sur la période restante, les
**deux bornes** de la part (1 avant le début du contrat, 0 après sa fin : ni
surfacturation ni avoir silencieux), l'accumulation `ancien + montant` qui
interdit de recalculer le total depuis un devis neuf, le refus de rétrécir un
contrat quelle que soit la demande, et — sur le barème dégressif de
démonstration — un ajout **à cheval sur deux paliers**, qu'aucune
multiplication par un prix unitaire ne rend. C'est le seul endroit du dépôt où
l'avenant est testable : le reste vit dans une mutation, et le repo n'a pas
`convex-test`.

**Activation (`convex/__tests__/subscriptionRules.test.ts`)** — la transition
de §8.4 bis, prise par les deux bouts : le seul statut de départ accepté (les
cinq autres refusés, chacun avec son motif), les deux bornes de période
(refusée avant `startsAt`, acceptée dès `startsAt`, refusée dès `endsAt`), et
le statut rendu à l'acceptation, que la trace recopie. C'est l'étroitesse
elle-même qui est testée : elle est ce qui autorise la mutation à exister, et
le reste vit dans une mutation que le repo n'a pas de quoi appeler.

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
- ~~**Amender un contrat en cours.**~~ **LEVÉ — voir §7.6.** Cette section
  tenait l'amendement pour une limite de produit assumée : l'invariant de §4.5
  refuse tout contrat chevauchant, et aucune mutation ne modifiait une ligne
  existante. La limite a été levée avant la mise en service, sous la forme
  **étroite** qui ne coûte rien à §4.5 : `schools.amendSeats` fait grossir un
  contrat déjà signé — celui en vigueur, ou à défaut le prochain à commencer ;
  sièges, montant au prorata de la période restante — **sans jamais toucher au
  statut ni aux dates**. Reste hors périmètre, et pour la
  raison d'origine (le sort du montant déjà facturé appartient à la
  facturation) : **réduire** les sièges d'un contrat en cours, en déplacer les
  dates, et le résilier.
- **DÉSACTIVER un contrat activé.** Corollaire du précédent, et à lire avec
  §8.4 bis : une activation manuelle existe désormais, mais rien ne fait
  redescendre un statut. Refermer l'accès d'une école est une décision
  commerciale — que devient le montant déjà facturé ? — et elle appartient au
  plan de facturation, avec la résiliation. L'écran d'école prévient donc, en
  toutes lettres, que le geste est sans retour.
- **Corriger une ligne d'abonnement saisie par erreur.** Rien ne supprime ni ne
  redate une ligne `subscriptions`. Un contrat enregistré sur de mauvaises
  dates tient donc sa période contre tout autre contrat (§4.5), et la seule
  correction possible aujourd'hui porte sur les sièges, à la hausse (§7.6).
  §8.4 bis a supprimé le cas le plus grave — la ligne qui ne pouvait même pas
  avancer — en retirant `draft` de la saisie ; le reste attend la même décision
  de facturation que la résiliation.

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
| ~~Le tarif par siège et le plancher~~ | §7.1 | **Tranchés : 5 000 FCFA par élève et par année scolaire**, plat, provisoire (« pour le moment »), et **plancher ramené à 30 sièges** — soit 150 000 FCFA de contrat minimum, le seuil voulu à l'origine. |
| ~~`past_due` sans échéance impayée identifiable~~ | **§8.5** | **Tranché : refus.** C'était la seule branche de `decideAccess` à échouer en ouvert. Une grâce sans ancre n'est pas une grâce. (Référence corrigée : l'arbitrage était en §8.5, pas en §8.5 bis, qui traite du message adulte.) |
| ~~**Une école peut-elle grossir en cours d'année ?**~~ | §10 | **Tranché : oui**, par l'avenant ÉTROIT de §7.6 — sièges à la hausse, au prorata, sans toucher au statut ni aux dates, donc sans rien coûter à l'invariant de §4.5. |
| ~~Qui active un contrat signé à l'avance ?~~ | **§8.4 bis** | **Tranché : un administrateur**, par une transition unique `pending_payment` → `active` sur un contrat commencé et non fini. Et `draft` sort de la saisie : une ligne que rien ne peut faire avancer bloquerait sa période pour toujours. |
