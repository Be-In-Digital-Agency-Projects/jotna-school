import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Class enum (curriculum stages, élémentaire sénégalais).
// MVP-1 ships CE2 + CM1 only; the full enum is here so the schema is
// forward-compatible with the public big-bang launch (Decision 14).
// ---------------------------------------------------------------------------
const classEnum = v.union(
  v.literal("CI"),
  v.literal("CP"),
  v.literal("CE1"),
  v.literal("CE2"),
  v.literal("CM1"),
  v.literal("CM2"),
);

// ---------------------------------------------------------------------------
// AI gateway purposes — mirrors aiGateway/registry.ts. Listed here as
// literal union so settings.modelOverrides (Decision 76) can validate keys.
// ---------------------------------------------------------------------------
const aiPurposeEnum = v.union(
  v.literal("palier_base"),
  v.literal("palier_personalized"),
  v.literal("verify_short_answer"),
  v.literal("explain_mistake"),
  v.literal("verify_math"),
  // `pdf_extract` ne passe pas par `aiGateway.generate` (API Responses +
  // fichier base64, forme que la passerelle ne connaît pas) mais dépense —
  // en `gpt-4o`, le poste le plus cher. Il doit donc exister ici pour être
  // compté. Ajout purement additif : élargir une union ne rend invalide
  // aucun document déjà écrit.
  v.literal("pdf_extract"),
);

export default defineSchema({
  ...authTables,
  // ---------------------------------------------------------------------------
  // profiles
  // ---------------------------------------------------------------------------
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
    // Parental consent for AI data processing (Loi 2008-12, Sénégal)
    aiDataConsentGranted: v.optional(v.boolean()),
    aiDataConsentGrantedAt: v.optional(v.number()),
    // Niveau de l'élève.
    //
    // ATTENTION — ce champ N'EST ENCORE LU PAR AUCUNE lecture de contenu.
    // `students.getStudentSubjectMap` charge tous les topics d'une matière par
    // `by_subjectId`, sans filtre de niveau : un élève voit donc toujours les
    // six niveaux, et l'ajout de ce champ n'y a rien changé. La session de
    // palier tient son niveau de `topic.class`, pas d'ici.
    //
    // Seule écriture à ce jour : `schools.enrollStudent`, qui l'aligne sur la
    // classe d'inscription. Le filtrage par niveau reste à faire — c'est la
    // décision D10 de la spec, déclarée mais non réalisée.
    class: v.optional(classEnum),
  }).index("by_userId", ["userId"]),

  // ---------------------------------------------------------------------------
  // studentGuardians
  // ---------------------------------------------------------------------------
  studentGuardians: defineTable({
    studentId: v.id("profiles"),
    guardianId: v.id("profiles"),
    relation: v.union(
      v.literal("parent"),
      v.literal("tuteur"),
      v.literal("professeur"),
    ),
  })
    .index("by_studentId", ["studentId"])
    .index("by_guardianId", ["guardianId"]),

  // ---------------------------------------------------------------------------
  // subjects
  // ---------------------------------------------------------------------------
  subjects: defineTable({
    name: v.string(),
    icon: v.string(),
    color: v.string(),
    order: v.number(),
  }),

  // ---------------------------------------------------------------------------
  // topics — added `class` (Decision 10 + 14)
  // ---------------------------------------------------------------------------
  topics: defineTable({
    subjectId: v.id("subjects"),
    name: v.string(),
    description: v.string(),
    order: v.number(),
    class: v.optional(classEnum), // optional for backward-compat with seeded rows
  })
    .index("by_subjectId", ["subjectId"])
    .index("by_subjectId_class", ["subjectId", "class"]),

  // ---------------------------------------------------------------------------
  // exercises — extended for paliers (Decisions 9, 10, 46, 52, 53, 71, 75)
  // ---------------------------------------------------------------------------
  exercises: defineTable({
    topicId: v.id("topics"),
    type: v.union(
      v.literal("qcm"),
      v.literal("drag-drop"),
      v.literal("match"),
      v.literal("order"),
      v.literal("short-answer"),
    ),
    prompt: v.string(),
    payload: v.any(),
    answerKey: v.string(),
    hints: v.array(v.string()),
    order: v.number(),
    status: v.union(v.literal("draft"), v.literal("published")),
    version: v.number(),
    sourcePdfUploadId: v.optional(v.id("pdfUploads")),
    generatedBy: v.union(v.literal("ai"), v.literal("manual")),
    reviewedBy: v.optional(v.id("profiles")),
    publishedAt: v.optional(v.number()),

    // ---------------- v2 palier extensions ----------------
    palierIndex: v.optional(v.number()), // 1..10
    palierId: v.optional(v.id("paliers")),
    personalizedFor: v.optional(v.id("profiles")), // "J'en veux encore" personalised pool
    palierAttemptId: v.optional(v.id("palierAttempts")), // attached to current attempt (regen)
    mathExpression: v.optional(v.string()), // Decision 71 — fact-check anchor
    needsManualReview: v.optional(v.boolean()), // Decision 53 — flagged by factCheck
    isVariation: v.optional(v.boolean()), // Decision 52
    originalExerciseId: v.optional(v.id("exercises")), // Decision 52 — traceability
  })
    .index("by_topicId", ["topicId"])
    .index("by_palierId", ["palierId"])
    .index("by_palierAttemptId", ["palierAttemptId"])
    .index("by_personalizedFor", ["personalizedFor"]),

  // ---------------------------------------------------------------------------
  // attempts — added gradedScore + palierAttemptId (Decisions 12, 51, 52)
  // ---------------------------------------------------------------------------
  attempts: defineTable({
    studentId: v.id("profiles"),
    exerciseId: v.id("exercises"),
    submittedAnswer: v.string(),
    isCorrect: v.boolean(),
    attemptNumber: v.number(),
    hintsUsedCount: v.number(),
    timeSpentMs: v.number(),
    submittedAt: v.number(),
    gradedScore: v.optional(v.number()), // 0..10 per scoring.computeExerciseScore
    palierAttemptId: v.optional(v.id("palierAttempts")),
  })
    .index("by_studentId_exerciseId", ["studentId", "exerciseId"])
    .index("by_studentId", ["studentId"])
    .index("by_palierAttemptId", ["palierAttemptId"])
    .index("by_palierAttempt_exercise", ["palierAttemptId", "exerciseId"]),

  // ---------------------------------------------------------------------------
  // studentTopicProgress
  // ---------------------------------------------------------------------------
  studentTopicProgress: defineTable({
    studentId: v.id("profiles"),
    topicId: v.id("topics"),
    completedExercises: v.number(),
    correctExercises: v.number(),
    totalHintsUsed: v.number(),
    masteryLevel: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_studentId", ["studentId"])
    .index("by_studentId_topicId", ["studentId", "topicId"]),

  // ---------------------------------------------------------------------------
  // badges
  // ---------------------------------------------------------------------------
  badges: defineTable({
    name: v.string(),
    description: v.string(),
    icon: v.string(),
    condition: v.string(),
    subjectId: v.optional(v.id("subjects")),
    catalogKey: v.optional(v.string()),
    category: v.optional(v.string()),
    conditionType: v.optional(v.string()),
    conditionParams: v.optional(v.any()),
    order: v.optional(v.number()),
    // D10 — Phase B narrow. Before deploying this validator, run once:
    //   npx convex run badges:normalizeRarities
    // Otherwise the schema push will reject existing rows whose rarity is a
    // legacy free-form string (e.g. "Bronze", "uncommon"). The migration is
    // idempotent so it's safe to re-run.
    rarity: v.optional(
      v.union(
        v.literal("common"),
        v.literal("rare"),
        v.literal("epic"),
        v.literal("legendary"),
      ),
    ),
    source: v.optional(v.string()),
    tierSystem: v.optional(v.string()),
    tiers: v.optional(v.any()),
    visibility: v.optional(v.string()),
    xpReward: v.optional(v.number()),
  }).index("by_rarity", ["rarity"]),

  // ---------------------------------------------------------------------------
  // earnedBadges
  // ---------------------------------------------------------------------------
  earnedBadges: defineTable({
    badgeId: v.id("badges"),
    studentId: v.id("profiles"),
    earnedAt: v.number(),
    currentTier: v.optional(v.number()),
    lastTierUpAt: v.optional(v.number()),
    progressValue: v.optional(v.number()),
  }).index("by_studentId", ["studentId"]),

  // ---------------------------------------------------------------------------
  // pdfUploads (legacy — kept while admin PDF flow is wound down)
  // ---------------------------------------------------------------------------
  pdfUploads: defineTable({
    adminId: v.id("profiles"),
    storageId: v.string(),
    originalFilename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    subjectId: v.id("subjects"),
    status: v.union(
      v.literal("uploaded"),
      v.literal("extracted"),
      v.literal("reviewed"),
      v.literal("published"),
    ),
    extractedRaw: v.optional(v.any()),
    extractedAt: v.optional(v.number()),
    reviewedAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
  }).index("by_status", ["status"]),

  // ---------------------------------------------------------------------------
  // topicReports
  // ---------------------------------------------------------------------------
  topicReports: defineTable({
    studentId: v.id("profiles"),
    topicId: v.id("topics"),
    score: v.number(),
    strengths: v.array(v.string()),
    weaknesses: v.array(v.string()),
    frequentMistakes: v.array(v.string()),
    emailSentAt: v.optional(v.number()),
  }).index("by_studentId_topicId", ["studentId", "topicId"]),

  // ===========================================================================
  // v2 NEW TABLES
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // paliers
  // (subject, class, topic, palierIndex) bucket with weekly cache.
  // Decisions 3, 9, 10, 46, 53, 56, 75
  // ---------------------------------------------------------------------------
  paliers: defineTable({
    subjectId: v.id("subjects"),
    topicId: v.id("topics"),
    class: classEnum,
    palierIndex: v.number(), // 1..10
    status: v.union(
      v.literal("cached"),
      v.literal("stale"),
      v.literal("generating"),
    ),
    qaStatus: v.optional(
      v.union(
        v.literal("auto_ok"),
        v.literal("pending_human"),
        v.literal("human_approved"),
        v.literal("rejected"),
      ),
    ),
    factCheckResults: v.optional(
      v.object({
        totalChecked: v.number(),
        divergences: v.number(),
      }),
    ),
    shuffleSeed: v.optional(v.string()), // Decision 75 — server-side deterministic shuffle seed prefix
    preGenerated: v.optional(v.boolean()), // Decision 73 — tagged by J0 pre-gen script
    generatedAt: v.number(),
    expiresAt: v.number(), // generatedAt + 7d
    generationTraceId: v.optional(v.string()),
  })
    .index("by_bucket", ["subjectId", "class", "topicId", "palierIndex"])
    .index("by_topic_class", ["topicId", "class"])
    .index("by_status", ["status"]),

  // ---------------------------------------------------------------------------
  // palierAttempts
  // Track a kid's run through a palier (10 exos). Status drives UI + regen.
  // Decisions 12, 13, 50, 52, 59, 78
  // ---------------------------------------------------------------------------
  palierAttempts: defineTable({
    userId: v.id("profiles"),
    palierId: v.id("paliers"),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    status: v.union(
      v.literal("in_progress"),
      v.literal("validated"),
      v.literal("failed"),
      v.literal("regen_failed"), // Decision 78
      v.literal("abandoned"),
    ),
    averageScore: v.optional(v.number()), // 0..10
    failedExerciseIds: v.optional(v.array(v.id("exercises"))),
    regenCount: v.number(), // 0..3, capped at submitPalier-level
  })
    .index("by_user", ["userId"])
    .index("by_user_palier", ["userId", "palierId"])
    .index("by_palier", ["palierId"]),

  // ---------------------------------------------------------------------------
  // palierAttemptHistory
  // Cumulative regen tracking per (user, palier) over a 7-day rolling window.
  // Decisions 60, 77, 88
  // ---------------------------------------------------------------------------
  palierAttemptHistory: defineTable({
    userId: v.id("profiles"),
    palierId: v.id("paliers"),
    regenCount: v.number(),
    lastRegenAt: v.number(),
    parentNotifiedAt: v.optional(v.number()), // Decision 88 — anti-spam
    createdAt: v.number(),
  })
    .index("by_user_palier", ["userId", "palierId"])
    .index("by_createdAt", ["createdAt"]),

  // ---------------------------------------------------------------------------
  // aiUsage
  // Per-call telemetry (success or failure) for budget + audit.
  // Decisions 4, 45, 69
  // ---------------------------------------------------------------------------
  aiUsage: defineTable({
    userId: v.optional(v.id("profiles")),
    purpose: aiPurposeEnum,
    modelUsed: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
    status: v.union(
      v.literal("ok"),
      v.literal("failed"),
      v.literal("rejected_budget"),
      v.literal("rejected_quota"),
      v.literal("rejected_access"),
    ),
    traceId: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    month: v.string(), // YYYY-MM, indexed for budget queries
    errorMessage: v.optional(v.string()),
  })
    .index("by_month", ["month"])
    .index("by_month_status", ["month", "status"])
    .index("by_user_month", ["userId", "month"])
    .index("by_traceId", ["traceId"]),

  // ---------------------------------------------------------------------------
  // aiSpendShards
  // Agrégat courant de la dépense du mois, fragmenté en
  // `SPEND_SHARD_COUNT` documents (aiGateway/spendShards.ts).
  //
  // Écrit dans la même mutation que la ligne `aiUsage` (recordUsage), donc la
  // ligne et l'agrégat ne peuvent pas diverger. Lu en temps constant par le
  // contrôle de budget et par l'écran admin : additionner `aiUsage` à la volée
  // coûterait de plus en plus cher au fil du mois, et le borner rendait la
  // somme fausse — c'est le défaut que cette table répare.
  //
  // L'index porte (month, shard) : une écriture lit un point de l'index, donc
  // deux écritures visant des fragments différents ne se conflictent pas, et
  // il existe au plus une ligne par couple. Comme `shard` est borné par
  // construction, un mois a au plus `SPEND_SHARD_COUNT` lignes.
  // ---------------------------------------------------------------------------
  aiSpendShards: defineTable({
    month: v.string(), // YYYY-MM
    shard: v.number(), // 0 .. SPEND_SHARD_COUNT-1
    costUsd: v.number(),
    calls: v.number(),
    failed: v.number(),
    rejectedBudget: v.number(),
    rejectedQuota: v.number(),
    rejectedAccess: v.number(),
    // Ventilation par usage. Borné : les clés sont l'enum ci-dessus.
    byPurpose: v.record(
      v.string(),
      v.object({ calls: v.number(), cost: v.number() }),
    ),
    updatedAt: v.number(),
  }).index("by_month_shard", ["month", "shard"]),

  // ---------------------------------------------------------------------------
  // aiUserQuota
  // Daily rate limit per (user, purpose, scope).
  // Decisions 47, 54
  // ---------------------------------------------------------------------------
  aiUserQuota: defineTable({
    userId: v.id("profiles"),
    purpose: aiPurposeEnum,
    quotaScope: v.union(
      v.literal("kid_initiated"),
      v.literal("system_regen"),
    ),
    count: v.number(),
    resetAt: v.number(), // unix ms; row is replaced on next day
    dayKey: v.string(), // YYYY-MM-DD for fast lookup
  })
    .index("by_user_scope_day", ["userId", "quotaScope", "dayKey"])
    .index("by_user_purpose_day", ["userId", "purpose", "dayKey"]),

  // ---------------------------------------------------------------------------
  // settings (singleton)
  // Decisions 4, 45, 69, 70, 76
  // ---------------------------------------------------------------------------
  settings: defineTable({
    singleton: v.literal("settings"), // always "settings"
    aiMonthlyBudgetUsd: v.number(), // default 100
    economyMode: v.boolean(), // default false (auto-on at 90%)
    dailyMoreLimitPerKid: v.number(), // default 3
    modelOverrides: v.optional(v.record(v.string(), v.string())), // purpose -> modelId
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("profiles")),
  }).index("by_singleton", ["singleton"]),

  // ---------------------------------------------------------------------------
  // exerciseExplanations
  // AI-generated step-by-step explanation cached per exercise. Triggered on
  // kid request after exhausting all 5 attempts. Cache-first to keep the
  // explain_mistake AI cost bounded — same explanation served to every kid
  // that bricks on the same exercise.
  // ---------------------------------------------------------------------------
  exerciseExplanations: defineTable({
    exerciseId: v.id("exercises"),
    intro: v.string(),
    steps: v.array(v.string()),
    conclusion: v.string(),
    generatedAt: v.number(),
    model: v.string(),
    traceId: v.optional(v.string()),
  }).index("by_exercise", ["exerciseId"]),

  // ---------------------------------------------------------------------------
  // exerciseReports
  // Kid-flagged exos via "Cet exo est bizarre" button. Decision 94
  // ---------------------------------------------------------------------------
  exerciseReports: defineTable({
    exerciseId: v.id("exercises"),
    userId: v.id("profiles"),
    reason: v.optional(
      v.union(
        v.literal("unclear"),
        v.literal("wrong_answer"),
        v.literal("too_hard"),
        v.literal("other"),
      ),
    ),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_exercise", ["exerciseId"])
    .index("by_user", ["userId"]),

  // ---------------------------------------------------------------------------
  // linkRequests
  // Parent→Student link requests awaiting student email confirmation.
  // ---------------------------------------------------------------------------
  linkRequests: defineTable({
    parentId: v.id("profiles"),
    studentId: v.id("profiles"),
    token: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_parentId", ["parentId"])
    .index("by_studentId", ["studentId"]),

  // ---------------------------------------------------------------------------
  // parentSettings
  // Per-kid wellbeing toggles, owned by the parent profile. Decision 84
  // ---------------------------------------------------------------------------
  parentSettings: defineTable({
    parentId: v.id("profiles"),
    kidId: v.id("profiles"),
    streaksEnabled: v.boolean(),
    dailyMissionEnabled: v.boolean(),
    kidPushNotifsEnabled: v.boolean(),
    parentLowScoreNotifEnabled: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_kid", ["kidId"])
    .index("by_parent_kid", ["parentId", "kidId"]),

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
    .index("by_school_class", ["schoolId", "class"])
    // « les classes de ce professeur » — l'arête qui relie un enseignant à ses
    // élèves (classe → schoolMemberships), sans balayer la table. `teacherId`
    // est optionnel : les classes sans professeur se rangent sous `undefined`
    // et ne répondent à aucune requête portant un vrai `Id<"profiles">`.
    .index("by_teacher", ["teacherId"]),

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
    .index("by_student_status", ["studentId", "status"])
    .index("by_class_status", ["schoolClassId", "status"]),

  // Journal des actes portés sur l'INSCRIPTION d'un élève — qui, quand, quoi.
  //
  // `enrolledAt` et `releasedAt` disent quand, jamais qui, pour deux actes qui
  // ouvrent et coupent l'accès d'un enfant sous abonnement payant ; le
  // transfert, lui, ne laissait aucune trace. Ces deux champs RESTENT : ils
  // sont lus (`schools.listClassStudents`) et ce journal les complète sans
  // les remplacer.
  //
  // UN JOURNAL, PAS DES CHAMPS. Inscrire et libérer sont uniques par
  // inscription — un `enrolledBy`/`releasedBy` aurait suffi. Mais un TRANSFERT
  // SE RÉPÈTE, et un champ « dernier transfert par » écraserait silencieusement
  // le précédent : un journal qui oublie n'est pas une traçabilité. Et deux
  // mécanismes — des champs pour deux actes, des lignes pour le troisième —
  // obligeraient qui demande « qu'est-il arrivé à cet enfant » à lire deux
  // endroits en sachant pourquoi.
  //
  // FRONTIÈRE — seuls les trois actes sur l'inscription d'un ÉLÈVE s'écrivent
  // ici. Ni les créations d'école ou de classe, ni les mouvements de personnel :
  // ce sont des actes administratifs qui ne touchent pas directement l'accès
  // d'un enfant, et les journaliser diluerait le registre dont l'objet est
  // précisément « qu'est-il arrivé à l'accès de cet enfant ».
  //
  // Le journal OBSERVE, il ne décide pas : aucune ligne d'ici n'entre dans
  // `accessRules.decideAccess`, qui juge l'accès sur `schoolMemberships` et
  // l'abonnement, et sur eux seuls.
  //
  // Insertions seules : aucune fonction du dépôt ne modifie ni ne supprime une
  // ligne de cette table.
  schoolMembershipEvents: defineTable({
    membershipId: v.id("schoolMemberships"),
    // Redondant avec `membershipId`, et délibérément : il ouvre
    // « qu'est-il arrivé à CET enfant » sans passer par ses inscriptions, y
    // compris quand elles sont plusieurs (une libérée, une réinscription).
    studentId: v.id("profiles"),
    schoolId: v.id("schools"),
    kind: v.union(
      v.literal("enrolled"),
      v.literal("released"),
      v.literal("transferred"),
    ),
    // L'auteur de l'acte : le profil `admin` qui a appelé la mutation. Copié
    // et jamais relu pour autoriser quoi que ce soit — c'est une trace.
    actorProfileId: v.id("profiles"),
    // L'instant de l'acte, et non celui de la ligne. `enrollStudent` et
    // `releaseStudent` écrivent ici le `Date.now()` EXACT qu'elles posent sur
    // `enrolledAt` et `releasedAt`, pour que la date du journal et celle de
    // l'inscription ne divergent jamais d'un battement d'horloge ; un
    // transfert, lui, ne date rien sur l'inscription — `at` est alors la
    // SEULE date de cet acte, et c'est bien pourquoi ce journal existe.
    // `_creationTime` existe aussi, mais il date l'insertion, pas l'acte.
    at: v.number(),
    fromSchoolClassId: v.optional(v.id("schoolClasses")), // transferts seulement
    toSchoolClassId: v.optional(v.id("schoolClasses")), // inscriptions et transferts
  })
    .index("by_membership", ["membershipId"])
    .index("by_student", ["studentId"]),

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
    // SIX valeurs au schéma, DEUX que le dépôt sait écrire aujourd'hui.
    // `schools.recordSubscription` n'accepte à la saisie que
    // `pending_payment` et `active` (ce dernier seulement sur un contrat déjà
    // commencé), et `schools.activateSubscription` est le seul `patch` du
    // statut : `pending_payment` → `active`, sur un contrat commencé et non
    // fini. Les quatre autres restent des valeurs valides que rien n'écrit —
    // `draft` attend un flux de devis, `past_due` le suivi des tranches,
    // `expired` se déduit de `endsAt` à la lecture, `cancelled` une
    // résiliation qui n'existe pas. Le validateur est la FORME du champ ; les
    // refus vivent dans les handlers, avec leur raison.
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
    .index("by_owner_startsAt", ["ownerType", "ownerId", "startsAt"])
    .index("by_status", ["status"])
    .index("by_endsAt", ["endsAt"]),

  // Journal des AVENANTS de sièges — qui a agrandi quel contrat, de combien,
  // et pour quel montant.
  //
  // POURQUOI IL EXISTE. `schools.amendSeats` est l'une des deux écritures du
  // dépôt qui MODIFIENT une ligne `subscriptions` — l'autre étant
  // `schools.activateSubscription`, qui n'écrit que le statut et a son propre
  // journal, juste en dessous. Elle augmente `seatsPurchased` et
  // `totalFcfa` d'un contrat déjà signé — celui en vigueur, ou à défaut le
  // prochain à commencer. Un `patch` écrase — sans ce journal, plus rien ne
  // dirait ce qui avait été signé, ni ce que l'école doit vraiment payer en
  // plus de son contrat d'origine. Le contrat lui-même ne porte plus que
  // l'état COURANT ; l'histoire vit ici.
  //
  // Mêmes principes que `schoolMembershipEvents`, et pour la même raison — un
  // acte qui engage de l'argent et ouvre des accès ne doit pas être anonyme :
  //   - `actorProfileId` est COPIÉ et jamais relu pour autoriser quoi que ce
  //     soit. C'est une trace, pas un droit ;
  //   - `at` date l'ACTE — le `Date.now()` exact que la mutation utilise aussi
  //     pour calculer le prorata — et non l'insertion de la ligne, que
  //     `_creationTime` porte déjà ;
  //   - le journal OBSERVE, il ne décide pas : aucune ligne d'ici n'entre dans
  //     `accessRules.decideAccess`, ni dans le plafond de sièges, ni dans la
  //     sélection du contrat courant. Les effacer toutes ne changerait rien à
  //     l'accès d'un seul enfant — seulement à ce qu'on peut expliquer.
  //
  // `seatsBefore` et `amountFcfa` suffisent à remonter la chaîne : les sièges
  // d'origine sont le `seatsBefore` du premier avenant, et le total d'origine
  // le `totalFcfa` courant moins la somme des montants.
  //
  // Insertions seules : aucune fonction du dépôt ne modifie ni ne supprime une
  // ligne de cette table.
  subscriptionAmendments: defineTable({
    subscriptionId: v.id("subscriptions"),
    // Redondant avec le contrat, et délibérément : il ouvre « qu'est-il arrivé
    // au contrat de CETTE école » sans passer par la ligne d'abonnement, y
    // compris quand elle a été renouvelée depuis.
    schoolId: v.id("schools"),
    seatsBefore: v.number(),
    seatsAfter: v.number(),
    // Ce qui a été AJOUTÉ au total du contrat, au prorata de la période
    // restante (`pricing.quoteSeatAmendment`) — jamais le total du contrat.
    amountFcfa: v.number(),
    actorProfileId: v.id("profiles"),
    at: v.number(),
  }).index("by_subscription", ["subscriptionId"]),

  // Journal des ACTIVATIONS — qui a ouvert l'accès de quelle école, et quand.
  //
  // POURQUOI IL EXISTE. `schools.activateSubscription` fait passer un contrat
  // de « en attente de paiement » à « actif ». C'est l'acte le plus conséquent
  // du module : il ouvre l'application à TOUS les élèves inscrits de l'école,
  // d'un coup, et rien ne sait le défaire — aucune mutation ne fait
  // redescendre un statut. Un acte irréversible qui engage une école entière
  // ne doit pas être anonyme, et le `patch` écrase le statut d'avant.
  //
  // Mêmes principes que `schoolMembershipEvents` et `subscriptionAmendments` :
  //   - `actorProfileId` est COPIÉ et jamais relu pour autoriser quoi que ce
  //     soit. C'est une trace, pas un droit ;
  //   - `at` date l'ACTE — le `Date.now()` exact sur lequel la mutation a jugé
  //     que le contrat avait commencé et n'était pas fini — et non l'insertion
  //     de la ligne, que `_creationTime` porte déjà ;
  //   - le journal OBSERVE, il ne décide pas : aucune ligne d'ici n'entre dans
  //     `accessRules.decideAccess`, ni dans le plafond de sièges, ni dans la
  //     sélection du contrat courant. Les effacer toutes ne changerait rien à
  //     l'accès d'un seul enfant — seulement à ce qu'on peut expliquer.
  //
  // `statusBefore` NE VAUT AUJOURD'HUI QU'UNE SEULE CHOSE, et son validateur le
  // dit : la règle d'activation (`convex/subscriptionRules.ts`) ne part que de
  // `pending_payment`. Ce n'est pas une redondance inutile — c'est le point où
  // un élargissement de la transition devra passer, en base et à la
  // compilation : la mutation recopie ici ce que la RÈGLE a établi, donc
  // ajouter un statut de départ sans toucher à cette ligne ne compilera pas.
  // Pas de `statusAfter` en revanche : il vaudrait « actif » sur toutes les
  // lignes, sans qu'aucun élargissement puisse jamais le changer — le statut
  // d'arrivée est un littéral du code, pas une donnée.
  //
  // PAS DE LECTEUR AUJOURD'HUI, et c'est assumé : aucune requête du dépôt ne
  // lit cette table, l'écran d'école n'affichant pas ce journal. Elle n'est pas
  // pour autant sans usage — c'est le seul endroit où se lit qui a ouvert
  // l'accès d'une école, question qui se pose contrat par contrat, d'où
  // l'index. Une ligne par contrat et par an : la table ne grandit pas.
  //
  // Insertions seules : aucune fonction du dépôt ne modifie ni ne supprime une
  // ligne de cette table.
  subscriptionActivations: defineTable({
    subscriptionId: v.id("subscriptions"),
    // Redondant avec le contrat, et délibérément, comme dans
    // `subscriptionAmendments` : il ouvre « qu'est-il arrivé au contrat de
    // CETTE école » sans passer par la ligne d'abonnement.
    schoolId: v.id("schools"),
    statusBefore: v.literal("pending_payment"),
    actorProfileId: v.id("profiles"),
    at: v.number(),
  }).index("by_subscription", ["subscriptionId"]),

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
});
