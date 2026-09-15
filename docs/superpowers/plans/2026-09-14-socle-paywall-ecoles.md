# Socle de données et paywall — Plan d'implémentation (1/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Note d'environnement : ces deux sous-skills ne sont **pas installées** dans la
> session qui a produit ce plan. À défaut, exécuter les tâches dans l'ordre, une
> par une, en respectant le cycle test-rouge → implémentation → test-vert →
> commit de chaque tâche.

**Goal:** Fermer l'application : plus aucun élève ne peut apprendre sans un siège couvert par un abonnement d'école valide.

**Architecture:** Le droit d'accès est **dérivé à chaque appel** depuis la chaîne élève → inscription → école → abonnement, jamais stocké ni mis en cache. Toute la décision vit dans une fonction **pure** (`convex/accessRules.ts`) que des wrappers Convex minces (`convex/access.ts`) alimentent en documents déjà lus — le même découpage que `aiGateway/budget.ts` (pur) et `aiGateway/db.ts` (I/O). Un verrou est posé dans `aiGateway.generate`, point de passage unique de toute dépense IA, pour qu'une fonction future qui oublierait le contrôle ne puisse pas dépenser d'argent.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, Convex 1.35.1, `@convex-dev/auth` 0.0.91, TypeScript 5, Vitest 4.1.4 (`environment: "jsdom"`), Tailwind 4. **Gestionnaire de paquets : pnpm** — la CI fait `pnpm install --frozen-lockfile` ; `npm install` échoue sur ce dépôt.

**Spec:** `docs/superpowers/specs/2026-09-14-abonnement-ecoles-design.md`

## Découpage en trois plans

La spec couvre trois sous-systèmes livrables séparément. Chacun produit un
logiciel qui fonctionne et se teste seul.

| Plan | Périmètre (sections de la spec) | Livrable |
|---|---|---|
| **1/3 — celui-ci** | §4, §5, §6.5 (étapes 1-4 et 8 de §11) | L'app est fermée. Un abonnement inséré à la main ouvre l'accès. |
| **2/3** | §6.1 à §6.4 (étapes 5-7) | Une école se crée, s'alimente en élèves, distribue ses codes. |
| **3/3** | §7, §8 (étapes 9-10) | Les écoles paient réellement, par tranches, via PayDunya. |

L'étape 11 de la spec (remise à zéro des comptes existants) est une opération,
pas un plan : elle s'exécute à la main, sur feu vert explicite.

## Global Constraints

Valeurs reprises telles quelles de la spec. Elles s'appliquent à **toutes** les
tâches ci-dessous.

- **Le contrôle d'accès est côté serveur, dans chaque fonction.** Les fonctions
  Convex sont une API HTTP publique ; un paywall vivant dans les layouts React
  n'est pas un paywall (spec §5.1).
- **Les requêtes ne lèvent jamais** : elles retournent un statut. Les mutations
  et actions lèvent. Une requête qui lève casse l'arbre React, et le repo n'a
  pas d'error boundary (spec §5.4).
- **Le directeur n'est jamais bloqué** par le paywall : sinon une école expirée
  ne peut plus se connecter pour payer (spec §5.6).
- **Délai de grâce `past_due` : 21 jours**, soit `PAST_DUE_GRACE_MS = 21 * 24 * 60 * 60 * 1000` (spec §8.5).
- **Aucun message d'argent à un enfant.** Tout texte affiché à l'élève passe par
  `lib/kidCopy.ts`, ton encourageant, jamais culpabilisant (spec §5.8).
- **Tests : fonctions pures exportées + Vitest.** Le repo n'utilise **pas**
  `convex-test` et ne l'a pas en dépendance ; ne pas l'introduire. Modèles à
  imiter : `convex/aiGateway/budget.ts` et `convex/aiGateway/quota.ts`
  (spec §9).
- **Jamais `.collect()`** : utiliser `.take(n)`. Jamais `ctx.db.query().filter()` :
  passer par un index, puis filtrer en mémoire. Jamais `.collect().length` pour
  compter (guidelines Convex du repo).
- **Ne jamais accepter un identifiant d'utilisateur en argument pour autoriser.**
  L'identité se dérive côté serveur (guidelines Convex ; spec §6.5).
- **Nommage des index : convention du repo** (`by_school_status`), pas
  `by_school_and_status` des guidelines (spec §4.4).
- **pnpm, jamais npm.** Le dépôt a un `pnpm-lock.yaml` et la CI fait
  `pnpm install --frozen-lockfile`. `npm install` y échoue
  (`Cannot read properties of null (reading 'edgesOut')`).
- **Base de référence avant modification : 282 tests dans 16 fichiers,
  typecheck propre.** Toute tâche doit laisser ce compte au moins intact.
- Convex peut importer depuis `lib/` par chemin relatif : `import { kidMessages } from "../lib/kidCopy";`
  (précédent : `convex/reportsEmail.ts`).

---

## Structure des fichiers

| Fichier | Rôle | Action |
|---|---|---|
| `convex/schema.ts` | 11 tables nouvelles, `profiles.class`, rôle `directeur`, élargissement de `aiUsage.status` | Modifier |
| `convex/accessRules.ts` | **Pure.** Types d'accès et `decideAccess`. Aucun import Convex. | Créer |
| `convex/__tests__/accessRules.test.ts` | Les 15 branches de décision + bornes de grâce | Créer |
| `convex/access.ts` | Wrappers minces : lecture des documents, délégation à `decideAccess` | Créer |
| `convex/aiGateway/index.ts` | Verrou de dépense dans `generate` | Modifier |
| `convex/paliers/index.ts` | 4 fonctions instrumentées | Modifier |
| `convex/palierAttempts.ts` | 6 fonctions instrumentées | Modifier |
| `convex/attempts.ts` | 4 fonctions instrumentées | Modifier |
| `convex/attemptsExplain.ts` | 1 action instrumentée | Modifier |
| `convex/explainMistake.ts` | 1 action instrumentée | Modifier |
| `convex/students.ts` | 5 fonctions instrumentées | Modifier |
| `convex/badges.ts` | 4 fonctions instrumentées | Modifier |
| `convex/topics.ts` | 3 fonctions instrumentées | Modifier |
| `convex/subjects.ts` | 2 fonctions instrumentées | Modifier |
| `convex/progress.ts` | 2 fonctions instrumentées | Modifier |
| `convex/streak.ts` | 1 fonction instrumentée | Modifier |
| `convex/profiles.ts` | Correction de sécurité de `linkChild` | Modifier |
| `lib/kidCopy.ts` | Message de blocage pour l'élève | Modifier |
| `lib/accessCopy.ts` | Messages de blocage pour les adultes, par raison | Créer |
| `components/AccessGate.tsx` | Écran de blocage élève | Créer |
| `app/(student)/layout.tsx` | Branchement de l'écran de blocage | Modifier |

**Pourquoi `accessRules.ts` séparé de `access.ts`** : le fichier pur n'importe
rien de Convex, donc il se teste sans runtime et sans mock. C'est exactement la
séparation `aiGateway/budget.ts` (pur, testé) / `aiGateway/db.ts` (I/O, non
testé) déjà en place.

---

## Task 1: Schéma — tables, niveau de l'élève, rôle directeur

**Files:**
- Modify: `convex/schema.ts`

**Interfaces:**
- Consumes: rien (première tâche).
- Produces: les tables `schools`, `schoolStaff`, `schoolClasses`,
  `schoolMemberships`, `schoolSeatUsage`, `subscriptions`, `installments`,
  `payments`, `studentImportJobs`, `studentImportRows`, `parentLinkCodes` ;
  `profiles.class` ; `profiles.role` acceptant `"directeur"` ;
  `aiUsage.status` acceptant `"rejected_access"`.

- [ ] **Step 1: Ajouter les tables école dans `convex/schema.ts`**

Insérer ce bloc juste avant la fermeture `});` de `defineSchema`. `classEnum`
est déjà défini en haut du fichier : le réutiliser, ne pas le redéclarer.

```ts
  // ===========================================================================
  // ABONNEMENT ÉCOLES — spec docs/superpowers/specs/2026-09-14-abonnement-ecoles-design.md
  // ===========================================================================

  schools: defineTable({
    name: v.string(),
    city: v.optional(v.string()),
    contactName: v.string(),
    contactEmail: v.string(),
    contactPhone: v.optional(v.string()),
    ninea: v.optional(v.string()), // identifiant fiscal SN, requis sur la facture
    status: v.union(
      v.literal("prospect"),
      v.literal("active"),
      v.literal("suspended"),
    ),
    createdAt: v.number(),
  }).index("by_status", ["status"]),

  schoolStaff: defineTable({
    schoolId: v.id("schools"),
    profileId: v.id("profiles"),
    staffRole: v.union(v.literal("directeur"), v.literal("professeur")),
    status: v.union(v.literal("active"), v.literal("removed")),
  })
    .index("by_school", ["schoolId"])
    .index("by_profile", ["profileId"]),

  // Les classes réelles, pas les niveaux : une école a souvent CM1 A et CM1 B.
  schoolClasses: defineTable({
    schoolId: v.id("schools"),
    class: classEnum,
    label: v.string(), // "A", "B", "unique"
    teacherId: v.optional(v.id("profiles")),
  })
    .index("by_school", ["schoolId"])
    .index("by_school_class", ["schoolId", "class"]),

  schoolMemberships: defineTable({
    schoolId: v.id("schools"),
    studentId: v.id("profiles"),
    schoolClassId: v.id("schoolClasses"),
    status: v.union(v.literal("active"), v.literal("released")),
    enrolledAt: v.number(),
    releasedAt: v.optional(v.number()),
  })
    .index("by_school_status", ["schoolId", "status"])
    .index("by_student", ["studentId"])
    .index("by_class_status", ["schoolClassId", "status"]),

  // Compteur de sièges dans sa PROPRE table : l'import en masse ne doit pas
  // entrer en contention d'écriture avec le document d'abonnement.
  schoolSeatUsage: defineTable({
    schoolId: v.id("schools"),
    activeCount: v.number(),
    updatedAt: v.number(),
  }).index("by_school", ["schoolId"]),

  subscriptions: defineTable({
    // "parent" n'est pas implémenté en v1 : le champ existe pour ouvrir le B2C
    // sans migration. Cohérence ownerType/ownerId garantie par le code, pas
    // par le schéma (spec §4.3).
    ownerType: v.union(v.literal("school"), v.literal("parent")),
    ownerId: v.string(),
    seatsPurchased: v.number(),
    pricePerSeatFcfa: v.number(), // tarif effectif moyen, affichage seul
    totalFcfa: v.number(), // fait foi pour la facturation
    startsAt: v.number(),
    endsAt: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("pending_payment"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerType", "ownerId"])
    .index("by_status", ["status"])
    .index("by_endsAt", ["endsAt"]),

  installments: defineTable({
    subscriptionId: v.id("subscriptions"),
    index: v.number(), // 1..3
    amountFcfa: v.number(),
    dueAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("overdue"),
      v.literal("failed"),
    ),
    paidAt: v.optional(v.number()),
  })
    .index("by_subscription", ["subscriptionId"])
    .index("by_status_dueAt", ["status", "dueAt"]),

  payments: defineTable({
    subscriptionId: v.id("subscriptions"),
    installmentId: v.optional(v.id("installments")),
    provider: v.literal("paydunya"),
    providerToken: v.string(), // clé d'idempotence du webhook
    amountFcfa: v.number(),
    status: v.union(
      v.literal("initiated"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    rawPayload: v.optional(v.any()), // audit et litige
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_providerToken", ["providerToken"])
    .index("by_subscription", ["subscriptionId"]),

  studentImportJobs: defineTable({
    schoolId: v.id("schools"),
    createdBy: v.id("profiles"),
    totalRows: v.number(),
    processedRows: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_school", ["schoolId"])
    .index("by_status", ["status"]),

  // Table enfant, pas un tableau sur le job : les guidelines interdisent les
  // listes non bornées dans un document.
  studentImportRows: defineTable({
    jobId: v.id("studentImportJobs"),
    schoolClassId: v.id("schoolClasses"),
    name: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("created"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    studentId: v.optional(v.id("profiles")), // rempli après création → idempotence
    loginCode: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  }).index("by_job_status", ["jobId", "status"]),

  parentLinkCodes: defineTable({
    studentId: v.id("profiles"),
    schoolId: v.id("schools"),
    code: v.string(),
    expiresAt: v.number(),
    redeemedBy: v.optional(v.id("profiles")),
    redeemedAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_student", ["studentId"]),
```

- [ ] **Step 2: Ajouter `class` et le rôle `directeur` sur `profiles`**

Dans la définition existante de `profiles`, remplacer le validateur de `role`
et ajouter `class`. Le validateur de `class` reste `v.optional` : parents,
professeurs, directeurs et admins n'ont pas de niveau. La règle « tout élève a
un niveau » est appliquée par le code de création (plan 2/3), pas par le schéma.

```ts
  profiles: defineTable({
    userId: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("parent"),
      v.literal("student"),
      v.literal("professeur"),
      v.literal("directeur"),
    ),
    name: v.string(),
    avatar: v.optional(v.string()),
    preferences: v.optional(v.any()),
    aiDataConsentGranted: v.optional(v.boolean()),
    aiDataConsentGrantedAt: v.optional(v.number()),
    // Niveau de l'élève. Absent jusqu'ici : getStudentSubjectMap listait les
    // topics sans filtre de niveau, donc un élève voyait les six niveaux.
    class: v.optional(classEnum),
  }).index("by_userId", ["userId"]),
```

- [ ] **Step 3: Élargir `aiUsage.status` pour tracer les refus de droits**

Dans la table `aiUsage` existante, ajouter la valeur `"rejected_access"` au
validateur de `status`. Sans elle, le verrou de la tâche 4 ne pourrait pas
journaliser son refus.

```ts
    status: v.union(
      v.literal("ok"),
      v.literal("failed"),
      v.literal("rejected_budget"),
      v.literal("rejected_quota"),
      v.literal("rejected_access"),
    ),
```

- [ ] **Step 4: Vérifier que le typage et la construction passent**

```bash
pnpm install --frozen-lockfile
pnpm tsc --noEmit
```

Attendu : aucune erreur. Si `pnpm tsc --noEmit` signale `classEnum` non défini
dans le bloc école, c'est que le bloc a été inséré avant la déclaration de
`classEnum` — la remonter n'est pas nécessaire, `classEnum` est déclaré en tête
de fichier, hors de `defineSchema`.

- [ ] **Step 5: Vérifier l'absence de régression sur les tests existants**

```bash
pnpm test --run
```

Attendu : la suite existante passe comme avant cette tâche. Aucun test nouveau
n'est attendu ici — une définition de schéma n'a pas de logique à tester ; sa
vérification est le typage et la non-régression.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): tables école, abonnement, paiement et import élèves

Ajoute les 11 tables du sous-système abonnement écoles, le niveau de
l'élève sur profiles (absent jusqu'ici, d'où un contenu non filtré par
niveau), le rôle directeur, et la valeur rejected_access sur aiUsage.status
pour tracer les refus de droits.

Aucun comportement modifié : ces tables ne sont encore lues par personne."
```

---

## Task 2: `decideAccess` — la fonction pure de décision

**Files:**
- Create: `convex/accessRules.ts`
- Test: `convex/__tests__/accessRules.test.ts`

**Interfaces:**
- Consumes: rien de la tâche 1 au niveau du code (types réécrits en local pour
  rester purs, sans import de `_generated`).
- Produces:
  - `PAST_DUE_GRACE_MS: number`
  - `type AccessReason` = `"not_authenticated" | "not_student" | "no_school" | "seat_released" | "no_subscription" | "pending_payment" | "past_due" | "expired" | "cancelled"`
  - `type AccessState` = `{ ok: true; schoolId: string; endsAt: number } | { ok: false; reason: AccessReason }`
  - `type SubscriptionStatus` = `"draft" | "pending_payment" | "active" | "past_due" | "expired" | "cancelled"`
  - `interface AccessInput` (voir étape 3)
  - `function decideAccess(input: AccessInput): AccessState`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `convex/__tests__/accessRules.test.ts`. Ce fichier suit le motif du repo :
il importe une fonction pure et l'appelle directement, sans mock de base.

```ts
import { describe, it, expect } from "vitest";
import {
  decideAccess,
  PAST_DUE_GRACE_MS,
  type AccessInput,
} from "../accessRules";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_780_000_000_000;

/** Entrée de base : élève couvert par un abonnement actif. */
function base(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    now: NOW,
    role: "student",
    activeMembership: { schoolId: "school_1" },
    hasReleasedMembership: false,
    subscription: { status: "active", endsAt: NOW + 100 * DAY },
    oldestOverdueDueAt: null,
    ...overrides,
  };
}

describe("decideAccess — identité", () => {
  it("refuse un profil absent", () => {
    expect(decideAccess(base({ role: null }))).toEqual({
      ok: false,
      reason: "not_authenticated",
    });
  });

  it("refuse un non-élève", () => {
    for (const role of ["parent", "professeur", "directeur", "admin"]) {
      expect(decideAccess(base({ role }))).toEqual({
        ok: false,
        reason: "not_student",
      });
    }
  });
});

describe("decideAccess — rattachement école", () => {
  it("refuse un élève sans aucune inscription", () => {
    expect(
      decideAccess(base({ activeMembership: null, hasReleasedMembership: false })),
    ).toEqual({ ok: false, reason: "no_school" });
  });

  it("distingue un siège libéré d'une absence d'école", () => {
    expect(
      decideAccess(base({ activeMembership: null, hasReleasedMembership: true })),
    ).toEqual({ ok: false, reason: "seat_released" });
  });
});

describe("decideAccess — abonnement", () => {
  it("refuse quand l'école n'a aucun abonnement", () => {
    expect(decideAccess(base({ subscription: null }))).toEqual({
      ok: false,
      reason: "no_subscription",
    });
  });

  it("accorde l'accès sur un abonnement actif non échu", () => {
    expect(decideAccess(base())).toEqual({
      ok: true,
      schoolId: "school_1",
      endsAt: NOW + 100 * DAY,
    });
  });

  it("refuse un abonnement actif dont la date de fin est passée", () => {
    expect(
      decideAccess(
        base({ subscription: { status: "active", endsAt: NOW - DAY } }),
      ),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuse un devis et un contrat signé non payé", () => {
    for (const status of ["draft", "pending_payment"] as const) {
      expect(
        decideAccess(base({ subscription: { status, endsAt: NOW + 100 * DAY } })),
      ).toEqual({ ok: false, reason: "pending_payment" });
    }
  });

  it("refuse un abonnement expiré ou résilié avec la bonne raison", () => {
    expect(
      decideAccess(
        base({ subscription: { status: "expired", endsAt: NOW + 100 * DAY } }),
      ),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      decideAccess(
        base({ subscription: { status: "cancelled", endsAt: NOW + 100 * DAY } }),
      ),
    ).toEqual({ ok: false, reason: "cancelled" });
  });
});

describe("decideAccess — délai de grâce past_due", () => {
  const pastDue = { status: "past_due" as const, endsAt: NOW + 100 * DAY };

  it("laisse l'accès ouvert pendant la grâce", () => {
    const state = decideAccess(
      base({ subscription: pastDue, oldestOverdueDueAt: NOW - 5 * DAY }),
    );
    expect(state.ok).toBe(true);
  });

  it("ferme l'accès au-delà de la grâce", () => {
    expect(
      decideAccess(
        base({ subscription: pastDue, oldestOverdueDueAt: NOW - 30 * DAY }),
      ),
    ).toEqual({ ok: false, reason: "past_due" });
  });

  it("est inclusif à la borne : l'accès tient à la dernière milliseconde", () => {
    const dueAt = NOW - PAST_DUE_GRACE_MS + 1;
    expect(
      decideAccess(base({ subscription: pastDue, oldestOverdueDueAt: dueAt })).ok,
    ).toBe(true);
  });

  it("ferme pile à l'expiration de la grâce", () => {
    const dueAt = NOW - PAST_DUE_GRACE_MS;
    expect(
      decideAccess(base({ subscription: pastDue, oldestOverdueDueAt: dueAt })),
    ).toEqual({ ok: false, reason: "past_due" });
  });

  it("accorde l'accès si past_due sans tranche échue identifiée", () => {
    expect(
      decideAccess(base({ subscription: pastDue, oldestOverdueDueAt: null })).ok,
    ).toBe(true);
  });

  it("fait primer la fin d'année sur la grâce", () => {
    expect(
      decideAccess(
        base({
          subscription: { status: "past_due", endsAt: NOW - DAY },
          oldestOverdueDueAt: NOW - DAY,
        }),
      ),
    ).toEqual({ ok: false, reason: "expired" });
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
pnpm test --run convex/__tests__/accessRules.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "../accessRules"`, le fichier
n'existe pas encore.

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `convex/accessRules.ts`. Ce fichier **n'importe rien** : ni `convex/values`,
ni `./_generated/*`. C'est ce qui le rend testable sans runtime Convex, comme
`aiGateway/budget.ts`.

```ts
/**
 * Règles de droit d'accès — fonction PURE.
 *
 * Aucune lecture de base ici : les documents sont lus par les wrappers de
 * `convex/access.ts` et passés en entrée. Même découpage que
 * aiGateway/budget.ts (pur, testé) / aiGateway/db.ts (I/O).
 *
 * Spec : docs/superpowers/specs/2026-09-14-abonnement-ecoles-design.md §5
 */

/** Délai de grâce sur tranche échue : 21 jours (spec §8.5). */
export const PAST_DUE_GRACE_MS = 21 * 24 * 60 * 60 * 1000;

export type AccessReason =
  | "not_authenticated"
  | "not_student"
  | "no_school"
  | "seat_released"
  | "no_subscription"
  | "pending_payment"
  | "past_due"
  | "expired"
  | "cancelled";

export type AccessState =
  | { ok: true; schoolId: string; endsAt: number }
  | { ok: false; reason: AccessReason };

export type SubscriptionStatus =
  | "draft"
  | "pending_payment"
  | "active"
  | "past_due"
  | "expired"
  | "cancelled";

export interface AccessInput {
  now: number;
  /** Rôle du profil, ou null si aucun profil n'a pu être résolu. */
  role: string | null;
  /** Inscription active de l'élève, ou null. */
  activeMembership: { schoolId: string } | null;
  /** Vrai si l'élève a une inscription passée en "released". */
  hasReleasedMembership: boolean;
  /** Abonnement le plus récent de l'école, quel que soit son statut. */
  subscription: { status: SubscriptionStatus; endsAt: number } | null;
  /** `dueAt` de la tranche échue la plus ancienne. Lu seulement si past_due. */
  oldestOverdueDueAt: number | null;
}

export function decideAccess(input: AccessInput): AccessState {
  if (input.role === null) {
    return { ok: false, reason: "not_authenticated" };
  }
  if (input.role !== "student") {
    return { ok: false, reason: "not_student" };
  }

  if (input.activeMembership === null) {
    return input.hasReleasedMembership
      ? { ok: false, reason: "seat_released" }
      : { ok: false, reason: "no_school" };
  }

  const sub = input.subscription;
  if (sub === null) {
    return { ok: false, reason: "no_subscription" };
  }

  // La fin d'année prime sur tout : un abonnement échu ne couvre plus rien,
  // quel que soit son statut nominal.
  if (input.now >= sub.endsAt) {
    return { ok: false, reason: "expired" };
  }

  const granted: AccessState = {
    ok: true,
    schoolId: input.activeMembership.schoolId,
    endsAt: sub.endsAt,
  };

  switch (sub.status) {
    case "active":
      return granted;

    case "past_due": {
      // Couper des enfants parce qu'un intendant est en retard est cruel et
      // commercialement suicidaire : on laisse 21 jours (spec §8.5).
      if (input.oldestOverdueDueAt === null) return granted;
      return input.now < input.oldestOverdueDueAt + PAST_DUE_GRACE_MS
        ? granted
        : { ok: false, reason: "past_due" };
    }

    case "draft":
    case "pending_payment":
      return { ok: false, reason: "pending_payment" };

    case "expired":
      return { ok: false, reason: "expired" };

    case "cancelled":
      return { ok: false, reason: "cancelled" };
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
pnpm test --run convex/__tests__/accessRules.test.ts
```

Attendu : SUCCÈS, 15 tests passants.

- [ ] **Step 5: Commit**

```bash
git add convex/accessRules.ts convex/__tests__/accessRules.test.ts
git commit -m "feat(access): fonction pure de décision des droits d'accès

decideAccess couvre les neuf raisons de refus et le délai de grâce de 21
jours sur tranche échue. Fonction pure sans import Convex, testable sans
runtime — même découpage que aiGateway/budget.ts.

La fin d'année prime sur le statut nominal de l'abonnement : un contrat
past_due dont endsAt est passé rend expired, pas past_due."
```

---

## Task 3: Wrappers Convex d'accès

**Files:**
- Create: `convex/access.ts`

**Interfaces:**
- Consumes de la tâche 1 : les tables `schoolMemberships` (index `by_student`),
  `subscriptions` (index `by_owner`), `installments` (index `by_subscription`).
- Consumes de la tâche 2 : `decideAccess`, `AccessInput`, `AccessState`,
  `SubscriptionStatus`.
- Produces :
  - `async function loadAccessInput(ctx: QueryCtx | MutationCtx, profile: Doc<"profiles"> | null): Promise<AccessInput>`
  - `async function checkAccess(ctx: QueryCtx | MutationCtx, profile: Doc<"profiles"> | null): Promise<AccessState>` — pour les requêtes, ne lève jamais
  - `async function requireAccess(ctx: QueryCtx | MutationCtx, profile: Doc<"profiles"> | null): Promise<{ schoolId: string; endsAt: number }>` — pour les mutations, lève
  - `const getAccessState = query({ args: {} })` → `AccessState` — pour l'UI
  - `async function blockedStudent(ctx: QueryCtx): Promise<boolean>` — vrai seulement si l'appelant est un élève SANS droit valide ; faux pour tout adulte et pour un visiteur non authentifié
  - `const getAccessStateForProfile = internalQuery({ args: { profileId: v.id("profiles") } })` → `AccessState` — pour les actions

- [ ] **Step 1: Écrire l'implémentation**

Créer `convex/access.ts`.

Deux points importants. Le premier : `loadAccessInput` reçoit un profil **déjà
lu**. Chaque fonction à instrumenter commence déjà par résoudre son profil
(`getAuthUserId` puis `profiles` par `by_userId`) ; lui repasser ce profil évite
une seconde lecture identique à chaque appel. Le second : `installments` n'est lu
que si l'abonnement est `past_due`, ce qui garde le chemin courant à trois
lectures.

```ts
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  query,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  decideAccess,
  type AccessInput,
  type AccessState,
  type SubscriptionStatus,
} from "./accessRules";

/**
 * Construit l'entrée de decideAccess depuis un profil DÉJÀ lu.
 *
 * Passer le profil plutôt que de le relire évite une seconde lecture de la
 * table profiles dans chacune des fonctions instrumentées : elles ont toutes
 * déjà fait ce travail pour leur propre contrôle de rôle.
 */
export async function loadAccessInput(
  ctx: QueryCtx | MutationCtx,
  profile: Doc<"profiles"> | null,
): Promise<AccessInput> {
  const now = Date.now();

  const empty: AccessInput = {
    now,
    role: null,
    activeMembership: null,
    hasReleasedMembership: false,
    subscription: null,
    oldestOverdueDueAt: null,
  };

  if (!profile) return empty;
  if (profile.role !== "student") return { ...empty, role: profile.role };

  // Un élève n'a normalement qu'une inscription active ; on en prend 10 pour
  // détecter aussi les sièges libérés sans lecture supplémentaire.
  const memberships = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_student", (q) => q.eq("studentId", profile._id))
    .take(10);

  const active = memberships.find((m) => m.status === "active") ?? null;
  const hasReleased = memberships.some((m) => m.status === "released");

  if (!active) {
    return {
      ...empty,
      role: "student",
      hasReleasedMembership: hasReleased,
    };
  }

  // Abonnement le PLUS RÉCENT, sans filtrer sur la couverture temporelle :
  // c'est decideAccess qui juge l'expiration via endsAt. Filtrer ici ferait
  // remonter "no_subscription" au lieu de "expired" pour une école échue.
  const subs = await ctx.db
    .query("subscriptions")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", "school").eq("ownerId", active.schoolId as string),
    )
    .take(20);

  const latest =
    subs.length === 0
      ? null
      : subs.reduce((best, s) => (s.startsAt > best.startsAt ? s : best));

  if (!latest) {
    return {
      ...empty,
      role: "student",
      activeMembership: { schoolId: active.schoolId as string },
      hasReleasedMembership: hasReleased,
    };
  }

  // Lecture des tranches seulement dans la branche past_due : le chemin
  // courant reste à trois lectures de documents.
  let oldestOverdueDueAt: number | null = null;
  if (latest.status === "past_due") {
    const rows = await ctx.db
      .query("installments")
      .withIndex("by_subscription", (q) => q.eq("subscriptionId", latest._id))
      .take(12);
    const dues = rows
      .filter((r) => r.status === "overdue")
      .map((r) => r.dueAt);
    oldestOverdueDueAt = dues.length > 0 ? Math.min(...dues) : null;
  }

  return {
    now,
    role: "student",
    activeMembership: { schoolId: active.schoolId as string },
    hasReleasedMembership: hasReleased,
    subscription: {
      status: latest.status as SubscriptionStatus,
      endsAt: latest.endsAt,
    },
    oldestOverdueDueAt,
  };
}

/** Résout le profil de la session courante. */
async function currentProfile(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"profiles"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId as string))
    .unique();
}

/** Pour les REQUÊTES : retourne un statut, ne lève jamais (spec §5.4). */
export async function checkAccess(
  ctx: QueryCtx | MutationCtx,
  profile: Doc<"profiles"> | null,
): Promise<AccessState> {
  return decideAccess(await loadAccessInput(ctx, profile));
}

/**
 * Vrai seulement si l'appelant est un ÉLÈVE sans droit valide.
 *
 * Destiné aux lectures partagées (subjects, topics, badges) qui servent aussi
 * l'administration et les professeurs : eux ne doivent jamais être bloqués
 * (spec §5.6 et §5.8). Un visiteur non authentifié renvoie false — c'est le
 * garde-fou propre à chaque fonction qui s'en occupe, pas le paywall.
 *
 * Exporté ici plutôt que recopié dans chaque fichier : trois copies
 * verbatim de la même logique d'autorisation, c'est trois endroits où la
 * corriger.
 */
export async function blockedStudent(ctx: QueryCtx): Promise<boolean> {
  const profile = await currentProfile(ctx);
  if (!profile || profile.role !== "student") return false;
  const access = await checkAccess(ctx, profile);
  return !access.ok;
}

/** Pour les MUTATIONS et ACTIONS : lève si l'accès n'est pas ouvert. */
export async function requireAccess(
  ctx: QueryCtx | MutationCtx,
  profile: Doc<"profiles"> | null,
): Promise<{ schoolId: string; endsAt: number }> {
  const state = await checkAccess(ctx, profile);
  if (!state.ok) {
    throw new Error(`ACCESS_DENIED:${state.reason}`);
  }
  return { schoolId: state.schoolId, endsAt: state.endsAt };
}

/** Consommée par l'UI pour afficher le bon écran de blocage. */
export const getAccessState = query({
  args: {},
  handler: async (ctx): Promise<AccessState> => {
    return await checkAccess(ctx, await currentProfile(ctx));
  },
});

/**
 * Consommée par les actions, qui n'ont pas de ctx.db.
 *
 * Prendre profileId en argument est sans danger ici : la fonction ne fait
 * qu'évaluer un droit, elle n'autorise rien et n'expose aucune donnée. Elle
 * est internalQuery, donc inatteignable depuis le réseau public.
 */
export const getAccessStateForProfile = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args): Promise<AccessState> => {
    return await checkAccess(ctx, await ctx.db.get(args.profileId));
  },
});
```

- [ ] **Step 2: Vérifier le typage**

```bash
pnpm tsc --noEmit
```

Attendu : aucune erreur. Si `by_owner` est refusé sur la chaîne
`.eq("ownerType", ...).eq("ownerId", ...)`, vérifier que l'index de la tâche 1
est bien déclaré dans cet ordre : `["ownerType", "ownerId"]`.

- [ ] **Step 3: Vérifier l'absence de régression**

```bash
pnpm test --run
```

Attendu : toute la suite passe, y compris les 15 tests de la tâche 2. Aucun test
nouveau ici : ce fichier n'est que de la lecture de documents et de la
délégation ; la logique qu'il sert est déjà couverte.

- [ ] **Step 4: Commit**

```bash
git add convex/access.ts
git commit -m "feat(access): wrappers Convex de lecture des droits

loadAccessInput reçoit le profil déjà lu par l'appelant, ce qui évite une
seconde lecture de profiles dans chaque fonction instrumentée. Les
tranches ne sont lues que dans la branche past_due, donc le chemin courant
tient en trois lectures.

L'abonnement le plus récent est retenu sans filtre de couverture : c'est
decideAccess qui juge l'expiration, sinon une école échue remonterait
no_subscription au lieu d'expired."
```

---

## Task 4: Verrou sur la dépense IA

**Files:**
- Modify: `convex/aiGateway/index.ts`

**Interfaces:**
- Consumes de la tâche 1 : `aiUsage.status` acceptant `"rejected_access"`.
- Consumes de la tâche 3 : `internal.access.getAccessStateForProfile`.
- Produces : `generate` renvoie `{ ok: false, traceId, reason: "NO_ACCESS" }`
  quand `args.userId` désigne un profil sans droit valide.

Pourquoi ici : `generate` est le point de passage **unique** de tout appel IA
payant. Une fonction future qui oublierait son contrôle d'entrée ne pourra
toujours pas dépenser d'argent. C'est une ceinture en plus des bretelles des
tâches 5 à 7, pas un remplacement.

- [ ] **Step 1: Ajouter le contrôle après la résolution des settings**

Dans `convex/aiGateway/index.ts`, à l'intérieur du handler de `generate`,
insérer ce bloc **juste après** le bloc `// 1) Settings (auto-init).` et
**avant** le bloc `// 2) Daily quota`.

```ts
    // 1bis) Droit d'accès — verrou sur la dépense.
    //
    // generate est le seul chemin par lequel de l'argent se dépense. Le
    // contrôle est ici pour qu'une fonction future qui oublierait son propre
    // contrôle d'entrée ne puisse pas facturer une école qui n'a pas payé.
    //
    // Sans userId, l'appel est système ou administrateur : aucun élève à
    // vérifier, on laisse passer.
    if (args.userId) {
      const access = await ctx.runQuery(
        internal.access.getAccessStateForProfile,
        { profileId: args.userId },
      );
      if (!access.ok) {
        await ctx.runMutation(internal.aiGateway.db.recordUsage, {
          userId: args.userId,
          purpose,
          modelUsed: cfg.defaultModel,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          status: "rejected_access",
          traceId,
          month,
          errorMessage: `access:${access.reason}`,
        });
        return { ok: false, traceId, reason: "NO_ACCESS" };
      }
    }
```

- [ ] **Step 2: Vérifier que `reason: "NO_ACCESS"` est accepté par le type de retour**

Ouvrir le type `GenerateResult` dans `convex/aiGateway/index.ts`. S'il contraint
`reason` à une union de littéraux (comme `"SETTINGS_MISSING"`), y ajouter
`"NO_ACCESS"`. S'il s'agit d'un `string`, aucun changement n'est nécessaire.

```bash
grep -n "GenerateResult" convex/aiGateway/index.ts
```

- [ ] **Step 3: Vérifier que `recordUsage` accepte bien ces arguments**

```bash
grep -n -A 20 "export const recordUsage" convex/aiGateway/db.ts
```

Attendu : un validateur d'arguments contenant `userId`, `purpose`, `modelUsed`,
`inputTokens`, `outputTokens`, `costUsd`, `latencyMs`, `status`, `traceId`,
`month`, `errorMessage`. Si `status` y est redéclaré comme union de littéraux,
y ajouter `v.literal("rejected_access")` — le validateur de la table (tâche 1)
et celui de la mutation doivent concorder.

- [ ] **Step 4: Vérifier le typage**

```bash
pnpm tsc --noEmit
```

Attendu : aucune erreur. Une erreur sur `status: "rejected_access"` signifie que
l'étape 3 n'a pas été faite.

- [ ] **Step 5: Vérifier l'absence de régression**

```bash
pnpm test --run
```

Attendu : toute la suite passe. `convex/__tests__/budget.test.ts` et
`quota.test.ts` testent des fonctions pures que ce changement ne touche pas.

- [ ] **Step 6: Commit**

```bash
git add convex/aiGateway/index.ts convex/aiGateway/db.ts
git commit -m "feat(ai): verrou de droit d'accès dans aiGateway.generate

generate est le point de passage unique de toute dépense IA : y placer le
contrôle garantit qu'une fonction future qui oublierait son propre
contrôle ne peut pas facturer une école qui n'a pas payé.

Les refus sont journalisés dans aiUsage avec status rejected_access, donc
visibles dans la télémétrie au même titre que les refus de budget et de
quota. Un appel sans userId reste autorisé : c'est un appel système."
```

---

## Task 5: Instrumenter le chemin palier — 14 fonctions

**Files:**
- Modify: `convex/paliers/index.ts` (`getExercisesForPalier`, `getBucket`, `regenerateFailedExercises`, `startPalierAttempt`)
- Modify: `convex/palierAttempts.ts` (`verifyAttempt`, `requestHint`, `submitPalier`, `getMyAttempt`, `getProgressForPalierAttempt`, `listMyAttempts`)
- Modify: `convex/attempts.ts` (`getResumeIndex`, `submit`, `getAttemptsForExercise`, `getProgressForTopic`)

**Interfaces:**
- Consumes de la tâche 3 : `checkAccess(ctx, profile)` et `requireAccess(ctx, profile)`.
- Produces : ces 14 fonctions refusent tout élève sans droit valide.

Règle à appliquer partout : le contrôle se place **juste après** la résolution du
profil que la fonction fait déjà, et **avant** toute autre lecture. Les requêtes
utilisent `checkAccess` et retournent la même valeur vide qu'elles retournaient
déjà pour un profil invalide (`null` ou `[]`, selon la fonction). Les mutations
et actions utilisent `requireAccess`, qui lève.

- [ ] **Step 1: Instrumenter une requête — `getExercisesForPalier`**

Dans `convex/paliers/index.ts`, ajouter l'import en tête de fichier :

```ts
import { checkAccess, requireAccess } from "../access";
```

Puis, dans `getExercisesForPalier`, insérer le contrôle après le `if (!profile) return null;`
existant et avant `const attempt = await ctx.db.get(...)` :

```ts
    if (!profile) return null;

    // Paywall — la requête retourne null comme pour un profil invalide, elle
    // ne lève pas : une requête qui lève casse l'arbre React (spec §5.4).
    const access = await checkAccess(ctx, profile);
    if (!access.ok) return null;

    const attempt = await ctx.db.get(args.palierAttemptId);
```

- [ ] **Step 2: Instrumenter une mutation — `startPalierAttempt`**

Toujours dans `convex/paliers/index.ts`, dans `startPalierAttempt`, après la
résolution du profil et avant la première écriture :

```ts
    // Paywall — une mutation lève, l'appelant attrape (spec §5.4).
    await requireAccess(ctx, profile);
```

- [ ] **Step 3: Instrumenter les deux actions de `paliers/index.ts`**

`getBucket` et `regenerateFailedExercises` sont des `action` : elles n'ont pas
de `ctx.db` et ne peuvent pas appeler `requireAccess`. Elles passent par la
requête interne de la tâche 3. Ajouter l'import :

```ts
import { internal } from "../_generated/api";
```

(déjà présent dans ce fichier — vérifier avant d'ajouter un doublon), puis dans
chaque action, après avoir résolu le `profileId` de l'appelant et avant tout
appel au gateway :

```ts
    // Paywall — une action n'a pas de ctx.db, elle interroge la requête
    // interne. Même motif que les runQuery déjà utilisés dans ce fichier.
    const access = await ctx.runQuery(internal.access.getAccessStateForProfile, {
      profileId,
    });
    if (!access.ok) {
      throw new Error(`ACCESS_DENIED:${access.reason}`);
    }
```

Si l'action ne résout pas de `profileId` aujourd'hui, l'ajouter en s'appuyant
sur le motif déjà employé dans ce fichier : `getAuthUserId(ctx)` puis une
requête interne qui lit `profiles` par `by_userId`. Ne **pas** accepter de
`profileId` en argument public — les guidelines l'interdisent pour autoriser.

- [ ] **Step 4: Instrumenter les six fonctions de `palierAttempts.ts`**

Ajouter en tête de `convex/palierAttempts.ts` :

```ts
import { checkAccess, requireAccess } from "./access";
```

Appliquer, après la résolution du profil de chaque fonction :

- `verifyAttempt` (mutation) → `await requireAccess(ctx, profile);`
- `requestHint` (mutation) → `await requireAccess(ctx, profile);`
- `submitPalier` (mutation) → `await requireAccess(ctx, profile);`
- `getMyAttempt` (requête) → `const a = await checkAccess(ctx, profile); if (!a.ok) return null;`
- `getProgressForPalierAttempt` (requête) → `const a = await checkAccess(ctx, profile); if (!a.ok) return null;`
- `listMyAttempts` (requête) → `const a = await checkAccess(ctx, profile); if (!a.ok) return [];`

Pour chaque requête, **reprendre la valeur vide que la fonction retourne déjà**
dans son propre garde-fou de rôle : `null` si elle retourne `null`, `[]` si elle
retourne un tableau. Vérifier au cas par cas plutôt que de supposer.

- [ ] **Step 5: Instrumenter les quatre fonctions de `attempts.ts`**

Ajouter en tête de `convex/attempts.ts` :

```ts
import { checkAccess, requireAccess } from "./access";
```

- `submit` (mutation) → `await requireAccess(ctx, profile);`
- `getResumeIndex` (requête) → `checkAccess`, valeur vide identique à celle du garde-fou existant
- `getAttemptsForExercise` (requête) → `checkAccess`, idem
- `getProgressForTopic` (requête) → `checkAccess`, idem

Ne **pas** toucher `listByTeacherStudents` : c'est une lecture de professeur, et
la spec §5.8 laisse les chemins de lecture adultes ouverts.

- [ ] **Step 6: Vérifier le typage et la non-régression**

```bash
pnpm tsc --noEmit && pnpm test --run
```

Attendu : aucune erreur de typage, toute la suite passe. Les tests existants de
`convex/__tests__/attempts.test.ts` et `regen.test.ts` portent sur des fonctions
pures et des mocks qui ne traversent pas `checkAccess` : s'ils échouent, c'est
que le contrôle a été inséré **avant** la résolution du profil au lieu
d'**après**.

- [ ] **Step 7: Vérifier qu'aucune fonction n'a été oubliée**

```bash
grep -c "checkAccess\|requireAccess\|getAccessStateForProfile" convex/paliers/index.ts convex/palierAttempts.ts convex/attempts.ts
```

Attendu : `convex/paliers/index.ts` au moins 5 (1 import + 4 usages),
`convex/palierAttempts.ts` au moins 7 (1 import + 6 usages),
`convex/attempts.ts` au moins 5 (1 import + 4 usages).

- [ ] **Step 8: Commit**

```bash
git add convex/paliers/index.ts convex/palierAttempts.ts convex/attempts.ts
git commit -m "feat(paywall): fermer le chemin palier aux élèves sans droit

Instrumente les 14 fonctions du parcours d'apprentissage : génération et
lecture de paliers, tentatives, indices, soumissions.

Les requêtes retournent la valeur vide qu'elles retournaient déjà pour un
profil invalide plutôt que de lever : une requête qui lève casse l'arbre
React, et le repo n'a pas d'error boundary. Les mutations lèvent.

listByTeacherStudents reste ouverte : la spec laisse les lectures des
adultes accessibles, leur coût marginal étant nul."
```

---

## Task 6: Instrumenter les deux actions d'explication IA

**Files:**
- Modify: `convex/attemptsExplain.ts` (`generateExplanation`)
- Modify: `convex/explainMistake.ts` (`explainExercise`)

**Interfaces:**
- Consumes de la tâche 3 : `internal.access.getAccessStateForProfile`.
- Produces : ces deux actions refusent tout élève sans droit valide, avant tout
  appel au gateway IA.

Elles sont séparées de la tâche 5 pour une raison : ce sont les deux fonctions
qui dépensent le plus par appel, et un reviewer peut vouloir les juger seules.
Le verrou de la tâche 4 les couvre déjà en dernier recours ; ce contrôle-ci
évite la dépense **avant** d'entrer dans le gateway.

- [ ] **Step 1: Instrumenter `generateExplanation`**

Dans `convex/attemptsExplain.ts`, vérifier la présence de
`import { internal } from "./_generated/api";` puis, dans le handler, après la
résolution du profil de l'appelant et avant le premier appel au gateway :

```ts
    const access = await ctx.runQuery(internal.access.getAccessStateForProfile, {
      profileId,
    });
    if (!access.ok) {
      throw new Error(`ACCESS_DENIED:${access.reason}`);
    }
```

Si le handler ne résout pas de `profileId` aujourd'hui, l'ajouter en s'appuyant
sur le motif employé dans `convex/paliers/index.ts` : `getAuthUserId(ctx)` puis
une requête interne qui lit `profiles` par `by_userId`. Ne **pas** accepter de
`profileId` en argument public : les guidelines l'interdisent pour autoriser.

- [ ] **Step 2: Instrumenter `explainExercise`**

Appliquer le même bloc dans `convex/explainMistake.ts`, mêmes conditions.

- [ ] **Step 3: Vérifier le typage et la non-régression**

```bash
pnpm tsc --noEmit && pnpm test --run
```

Attendu : aucune erreur, toute la suite passe.

- [ ] **Step 4: Commit**

```bash
git add convex/attemptsExplain.ts convex/explainMistake.ts
git commit -m "feat(paywall): fermer les deux actions d'explication IA

Ce sont les appels les plus coûteux par unité. Le contrôle est posé avant
l'entrée dans le gateway, pour éviter la dépense plutôt que la refuser
après coup — le verrou de aiGateway.generate reste le dernier recours."
```

---

## Task 7: Instrumenter les lectures élève — 17 fonctions

**Files:**
- Modify: `convex/students.ts` (`getMyStats`, `getStudentSubjectMap`, `getMySoundEnabled`, `getMyEarnedBadges`, `markLevelSeen`)
- Modify: `convex/badges.ts` (`list`, `getById`, `listEarnedByStudent`, `markBadgesSeen`)
- Modify: `convex/topics.ts` (`listAll`, `listBySubject`, `getById`)
- Modify: `convex/subjects.ts` (`list`, `getById`)
- Modify: `convex/progress.ts` (`getStudentProgress`, `getSubjectProgress`)
- Modify: `convex/streak.ts` (`setSoundEnabled`)

**Interfaces:**
- Consumes de la tâche 3 : `checkAccess(ctx, profile)`, `requireAccess(ctx, profile)` et `blockedStudent(ctx)`.
- Produces : ces 17 fonctions refusent tout élève sans droit valide.

Attention particulière sur `subjects.ts`, `topics.ts` et `badges.ts` : leurs
fonctions de lecture servent **aussi** l'administration et les professeurs.
Le contrôle ne doit s'appliquer **que** lorsque l'appelant est un élève, sinon
la tâche casse l'espace admin.

- [ ] **Step 1: Instrumenter `students.ts`**

Ajouter en tête :

```ts
import { checkAccess, requireAccess } from "./access";
```

Exemple complet sur `getMyStats`, à reproduire sur les quatre autres en
adaptant la valeur de retour vide :

```ts
export const getMyStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!profile || profile.role !== "student") return null;

    // Paywall — même valeur de retour que le garde-fou de rôle au-dessus.
    const access = await checkAccess(ctx, profile);
    if (!access.ok) return null;

    const studentId = profile._id;
    // ...suite inchangée
```

`markLevelSeen` est une mutation : `await requireAccess(ctx, profile);` au même
emplacement.

- [ ] **Step 2: Instrumenter les lectures partagées avec l'administration**

Pour `subjects.list`, `subjects.getById`, `topics.listAll`, `topics.listBySubject`,
`topics.getById`, `badges.list`, `badges.getById`, `badges.listEarnedByStudent` :
n'appliquer le contrôle que si l'appelant est un élève. `blockedStudent` est
**déjà exporté par `convex/access.ts`** (tâche 3) — l'importer, ne pas le
recopier :

```ts
import { blockedStudent } from "./access";
```

Puis, au début de chaque handler concerné :

```ts
    if (await blockedStudent(ctx)) return null;   // ou [] selon la fonction
```

`badges.markBadgesSeen` est une mutation d'élève : utiliser
`await requireAccess(ctx, profile)` après sa résolution de profil, pas
`blockedStudent`.

- [ ] **Step 3: Instrumenter `progress.ts` et `streak.ts`**

`progress.getStudentProgress` et `progress.getSubjectProgress` sont des lectures
d'élève : `checkAccess` avec la valeur vide existante.
`streak.setSoundEnabled` est une mutation d'élève : `requireAccess`.

- [ ] **Step 4: Vérifier le typage et la non-régression**

```bash
pnpm tsc --noEmit && pnpm test --run
```

Attendu : aucune erreur, toute la suite passe. Les tests
`convex/__tests__/subjects.test.ts`, `topics.test.ts`, `badges.test.ts`,
`subjectMap.test.ts` et `streak.test.ts` existent : s'ils échouent, c'est que
`blockedStudent` a été appliqué à une fonction d'administration, ou que le
contrôle précède la résolution du profil.

- [ ] **Step 5: Vérifier le compte total d'instrumentation**

```bash
grep -c "checkAccess\|requireAccess\|blockedStudent" \
  convex/students.ts convex/badges.ts convex/topics.ts \
  convex/subjects.ts convex/progress.ts convex/streak.ts
```

Attendu : au moins 6 pour `students.ts`, 6 pour `badges.ts`, 5 pour `topics.ts`,
4 pour `subjects.ts`, 3 pour `progress.ts`, 2 pour `streak.ts`.

- [ ] **Step 6: Commit**

```bash
git add convex/students.ts convex/badges.ts convex/topics.ts \
        convex/subjects.ts convex/progress.ts convex/streak.ts
git commit -m "feat(paywall): fermer les lectures élève aux comptes sans droit

Instrumente les 17 lectures restantes du chemin élève. Les fonctions de
subjects, topics et badges servant aussi l'administration et les
professeurs, le contrôle n'y bloque que les élèves — sinon la tâche
casserait l'espace admin.

Avec les tâches 5 et 6, les 34 fonctions de la section 5.7 de la spec sont
couvertes."
```

---

## Task 8: Copy enfant et écran de blocage

**Files:**
- Modify: `lib/kidCopy.ts`
- Create: `lib/accessCopy.ts`
- Create: `components/AccessGate.tsx`
- Modify: `app/(student)/layout.tsx`

**Interfaces:**
- Consumes de la tâche 2 : `type AccessReason`.
- Consumes de la tâche 3 : `api.access.getAccessState`.
- Produces :
  - `kidMessages.accessNotOpen: string`
  - `function accessMessageForAdult(reason: AccessReason): { title: string; body: string }`
  - `<AccessGate>{children}</AccessGate>`

- [ ] **Step 1: Ajouter le message enfant dans `lib/kidCopy.ts`**

Dans l'objet `kidMessages` existant, ajouter cette entrée. Elle suit la règle du
fichier — ton encourageant, jamais culpabilisant — et le modèle de
`budgetExceeded`, qui dit déjà « pas maintenant » sans accuser personne. **On ne
parle pas d'argent à un enfant** : il n'a pas à apprendre que son école ou ses
parents n'ont pas payé.

```ts
  // Accès non ouvert par l'école (spec §5.8)
  accessNotOpen:
    "Ton espace n'est pas encore ouvert 🌱 Parle-en à ton maître ou à ta maîtresse, ils vont s'en occuper !",
```

- [ ] **Step 2: Créer `lib/accessCopy.ts` pour les adultes**

Les adultes, eux, reçoivent la vraie raison.

```ts
import type { AccessReason } from "@/convex/accessRules";

/**
 * Messages de blocage destinés aux ADULTES (parent, professeur, directeur).
 * Pour l'élève, passer par kidMessages.accessNotOpen : on ne parle pas
 * d'argent à un enfant (spec §5.8).
 */
export function accessMessageForAdult(reason: AccessReason): {
  title: string;
  body: string;
} {
  switch (reason) {
    case "not_authenticated":
      return {
        title: "Session expirée",
        body: "Reconnectez-vous pour continuer.",
      };
    case "not_student":
      return {
        title: "Espace réservé aux élèves",
        body: "Ce contenu n'est accessible qu'avec un compte élève.",
      };
    case "no_school":
      return {
        title: "Aucune école rattachée",
        body: "Cet élève n'est rattaché à aucune école. Contactez l'établissement pour qu'il l'inscrive.",
      };
    case "seat_released":
      return {
        title: "Élève retiré de l'école",
        body: "Cet élève a quitté son école : son siège a été libéré. Son historique reste conservé.",
      };
    case "no_subscription":
      return {
        title: "École sans abonnement",
        body: "Cette école n'a pas encore d'abonnement Jotna School.",
      };
    case "pending_payment":
      return {
        title: "Abonnement en attente de paiement",
        body: "L'abonnement est enregistré mais aucune tranche n'a encore été encaissée. Les accès s'ouvriront dès le premier règlement.",
      };
    case "past_due":
      return {
        title: "Tranche impayée",
        body: "Une tranche est échue depuis plus de 21 jours et les accès sont suspendus. Ils se rouvrent dès le règlement.",
      };
    case "expired":
      return {
        title: "Abonnement terminé",
        body: "L'année couverte par l'abonnement est écoulée. Un renouvellement rouvrira les accès.",
      };
    case "cancelled":
      return {
        title: "Abonnement résilié",
        body: "L'abonnement de cette école a été résilié.",
      };
  }
}
```

- [ ] **Step 3: Créer `components/AccessGate.tsx`**

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { kidMessages } from "@/lib/kidCopy";
import { Sprout } from "lucide-react";

/**
 * Barre l'espace élève quand l'accès n'est pas ouvert.
 *
 * Ce composant est du confort, PAS une sécurité : le vrai contrôle est dans
 * chaque fonction Convex (spec §5.1). Les fonctions Convex sont une API HTTP
 * publique et se contournent sans passer par cette interface.
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const access = useQuery(api.access.getAccessState);

  // En cours de chargement : ne rien barrer, l'app affiche déjà ses loaders.
  if (access === undefined) return <>{children}</>;
  if (access.ok) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
        <Sprout className="mx-auto h-12 w-12 text-emerald-500" />
        <p className="mt-4 text-lg font-medium text-gray-900">
          {kidMessages.accessNotOpen}
        </p>
      </div>
    </div>
  );
}
```

Note : le composant n'affiche **jamais** `access.reason` à l'élève. La raison
sert aux écrans adultes, via `accessMessageForAdult`.

- [ ] **Step 4: Brancher `AccessGate` dans le layout élève**

Dans `app/(student)/layout.tsx`, envelopper le contenu rendu par le layout :

```tsx
import { AccessGate } from "@/components/AccessGate";

// ...dans le JSX retourné, autour du contenu principal :
<AccessGate>{children}</AccessGate>
```

- [ ] **Step 5: Vérifier le typage et la construction**

```bash
pnpm tsc --noEmit && pnpm build
```

Attendu : aucune erreur. Si `@/convex/accessRules` n'est pas résolu, vérifier
l'alias `@` dans `tsconfig.json` — `vitest.config.ts` le déclare déjà vers la
racine du projet.

- [ ] **Step 6: Vérifier l'absence de régression**

```bash
pnpm test --run
```

Attendu : toute la suite passe.

- [ ] **Step 7: Commit**

```bash
git add lib/kidCopy.ts lib/accessCopy.ts components/AccessGate.tsx \
        "app/(student)/layout.tsx"
git commit -m "feat(paywall): écran de blocage élève et messages adultes

L'élève reçoit un message via kidCopy, sans jamais lire la raison
technique ni un mot d'argent : un enfant n'a pas à apprendre que son école
n'a pas payé. Les adultes reçoivent la vraie raison via accessCopy.

AccessGate est du confort, pas une sécurité : le contrôle qui compte est
dans chaque fonction Convex."
```

---

## Task 9: Correction de sécurité — `profiles.linkChild`

**Files:**
- Modify: `convex/profiles.ts` (`linkChild`, lignes 256-296)

**Interfaces:**
- Consumes : rien des tâches précédentes. Cette tâche est **indépendante** et
  peut être exécutée à tout moment, y compris en premier.
- Produces : `linkChild` n'accepte plus `guardianId` en argument.

Le défaut : `linkChild` est une mutation **publique** qui accepte `studentId`,
`guardianId` et `relation` en arguments, et ne vérifie **rien** — ni
authentification, ni rôle, ni lien avec l'appelant. N'importe qui peut donc
rattacher n'importe quel élève à n'importe quel tuteur, et lire ensuite sa
progression via l'espace parent. Les guidelines Convex du repo l'interdisent
explicitement : *« NEVER accept a userId or any user identifier as a function
argument for authorization purposes. »*

- [ ] **Step 1: Remplacer `linkChild` par une version qui dérive l'appelant**

Remplacer intégralement la mutation `linkChild` de `convex/profiles.ts` par :

```ts
/**
 * Rattache un élève existant au tuteur AUTHENTIFIÉ.
 *
 * `guardianId` n'est plus un argument : il se dérive de la session. La version
 * précédente acceptait n'importe quel couple (élève, tuteur) sans aucun
 * contrôle, ce qui permettait à n'importe qui de s'attribuer l'accès à la
 * progression de n'importe quel élève.
 */
export const linkChild = mutation({
  args: {
    studentId: v.id("profiles"),
    relation: v.union(
      v.literal("parent"),
      v.literal("tuteur"),
      v.literal("professeur"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Non authentifié");
    }

    const guardian = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId as string))
      .unique();
    if (!guardian) {
      throw new Error("Profil tuteur introuvable");
    }

    // Un élève ne peut pas se rattacher lui-même un tuteur, et un tuteur ne
    // peut pas se rattacher à lui-même.
    if (guardian.role !== "parent" && guardian.role !== "professeur") {
      throw new Error("Rôle non autorisé");
    }
    if (guardian._id === args.studentId) {
      throw new Error("Lien invalide");
    }

    // La relation déclarée doit correspondre au rôle réel de l'appelant.
    if (args.relation === "professeur" && guardian.role !== "professeur") {
      throw new Error("Rôle non autorisé");
    }
    if (args.relation !== "professeur" && guardian.role !== "parent") {
      throw new Error("Rôle non autorisé");
    }

    const student = await ctx.db.get(args.studentId);
    if (!student || student.role !== "student") {
      throw new Error("Profil étudiant introuvable");
    }

    const existing = await ctx.db
      .query("studentGuardians")
      .withIndex("by_guardianId", (q) => q.eq("guardianId", guardian._id))
      .take(200);
    if (existing.some((link) => link.studentId === args.studentId)) {
      throw new Error("Ce lien existe déjà");
    }

    return await ctx.db.insert("studentGuardians", {
      studentId: args.studentId,
      guardianId: guardian._id,
      relation: args.relation,
    });
  },
});
```

- [ ] **Step 2: Vérifier qu'aucun appelant ne casse**

```bash
grep -rn "linkChild" app/ lib/ components/ convex/ --include="*.ts" --include="*.tsx"
```

Attendu : aucun appel dans `app/`, `lib/` ou `components/` — la mutation n'était
câblée à aucune interface. Si un test la référence avec `guardianId`, mettre ce
test à jour : l'argument n'existe plus.

- [ ] **Step 3: Vérifier le typage et la non-régression**

```bash
pnpm tsc --noEmit && pnpm test --run
```

Attendu : aucune erreur, toute la suite passe. `convex/__tests__/profiles.test.ts`
insère directement dans `studentGuardians` via son mock plutôt que d'appeler
`linkChild` : il ne devrait pas être affecté.

- [ ] **Step 4: Commit**

```bash
git add convex/profiles.ts
git commit -m "fix(security): linkChild dérive le tuteur de la session

linkChild était une mutation publique acceptant studentId, guardianId et
relation sans aucun contrôle : n'importe qui pouvait rattacher n'importe
quel élève à n'importe quel tuteur, puis lire sa progression via l'espace
parent.

guardianId disparaît des arguments et se dérive de la session. La relation
déclarée doit désormais correspondre au rôle réel de l'appelant.

Les guidelines Convex du repo l'exigent : ne jamais accepter un
identifiant d'utilisateur en argument pour autoriser."
```

---

## Vérification de fin de plan

À lancer après la dernière tâche, avant d'ouvrir la revue.

- [ ] **Toute la suite passe**

```bash
pnpm tsc --noEmit && pnpm test --run && pnpm build && pnpm lint
```

- [ ] **Les 34 fonctions de la spec §5.7 sont couvertes**

> **Correction.** Le plan disait « 33 » là où la spec en liste 34 : il
> n'assignait `attemptsVerify.verifyShortAnswerWithAI` à aucune tâche. La
> fonction a bien été verrouillée (tâche 6), et la revue finale a recompté les
> 34 une par une sur les 12 fichiers concernés.

```bash
grep -c "checkAccess\|requireAccess\|blockedStudent\|getAccessStateForProfile" \
  convex/paliers/index.ts convex/palierAttempts.ts convex/attempts.ts \
  convex/attemptsExplain.ts convex/explainMistake.ts convex/students.ts \
  convex/badges.ts convex/topics.ts convex/subjects.ts convex/progress.ts \
  convex/streak.ts
```

Attendu : aucun fichier à 0.

- [ ] **Le directeur et les adultes ne sont pas barrés (spec §5.6)**

`AccessGate` ne doit être branché que dans l'espace élève. S'il atteint un
layout adulte, une école dont l'abonnement a expiré ne peut plus se connecter
pour payer — on enferme le client dehors avec son chéquier.

```bash
grep -rn "AccessGate" app/
```

Attendu : une seule correspondance, dans `app/(student)/layout.tsx`. Aucune dans
`app/(parent)/`, `app/(teacher)/` ni `app/(admin)/`.

```bash
grep -rn "checkAccess\|requireAccess" convex/reports.ts convex/linkRequests.ts convex/pdfUploads.ts
```

Attendu : aucune correspondance. Ces fichiers servent les parents, les
professeurs et l'administration, que la spec laisse passer.

> **Correction (revue finale de branche).** `convex/exercises.ts` figurait dans
> cette liste, présenté comme un chemin adulte. C'était **faux**, et cette
> ligne du plan rendait le défaut introuvable pour qui suivait le plan :
> `listByTopic`, `listAllDrafts`, `listAllPublished` et `getById` n'avaient
> aucune authentification et rendaient le document `exercises` brut —
> `answerKey`, `hints` complets, `payload` avec la bonne réponse. Or les
> exercices de palier générés par l'IA y sont insérés en `status: "published"`,
> donc `listAllPublished` appelée **sans session** rendait jusqu'à 1000
> exercices payants avec leurs corrigés. Le paywall et l'anti-triche tombaient
> par la même porte.
>
> Ces quatre lectures portent désormais un garde de **rôle** (professeur ou
> admin), pas un garde de paywall : un élève, payant ou non, ne doit pas lire
> les corrigés. Vérification à lancer à la place :

```bash
grep -n "callerIsStaff" convex/exercises.ts
```

Attendu : cinq correspondances — la définition du garde et son appel en tête
des quatre lectures.

- [ ] **Le verrou de dépense est en place**

```bash
grep -n "rejected_access\|NO_ACCESS" convex/aiGateway/index.ts
```

Attendu : au moins deux correspondances.

- [ ] **Contrôle manuel de bout en bout**

Avec `pnpm convex dev` puis `pnpm dev` :

1. Insérer à la main, via le tableau de bord Convex, une `schools`, une
   `schoolClasses`, une `schoolMemberships` active pour un élève de test, et une
   `subscriptions` `{ ownerType: "school", ownerId: <schoolId>, status: "active", startsAt: <hier>, endsAt: <dans 1 an> }`.
2. Se connecter avec cet élève : le contenu doit s'afficher normalement.
3. Passer l'abonnement en `pending_payment` : l'élève doit voir l'écran de
   blocage, et le message ne doit contenir **aucune** mention d'argent.
4. Passer l'inscription en `released` : même blocage.
5. Remettre `active` : l'accès revient **sans redéploiement ni vidage de cache**
   — c'est la propriété que le calcul dérivé garantit.

---

## Ce que ce plan ne fait pas

Reporté au plan 2/3 : création d'école par l'interface, import en masse des
élèves, identifiants de connexion sans email, codes de rattachement parent,
réécriture de `getTeacherStudents`.

Reporté au plan 3/3 : calcul cumulatif du tarif, tranches, intégration
PayDunya, webhook, cron d'échéance.

Reporté à une opération manuelle : la remise à zéro des comptes existants,
sur feu vert explicite.

Pendant la durée du plan 1/3, un abonnement s'insère **à la main** via le
tableau de bord Convex. C'est voulu : ça découple la fermeture de
l'application de la mécanique de vente, et ça permet de tester la première
sans attendre la seconde.
