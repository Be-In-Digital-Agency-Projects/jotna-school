import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const BATCH_SIZE = 100;

// One-shot migration to lowercase email values written before
// `convex/auth.ts` started normalizing on every signIn/signUp/reset.
// Run via Convex dashboard: `npx convex run migrations:lowercaseEmails`.
//
// Order matters: we migrate `users.email` first, then chain into
// `authAccounts.providerAccountId` (where provider === "password"),
// since the auth library uses the latter as the canonical lookup key.
export const lowercaseEmails = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    updated: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("users").paginate({
      numItems: BATCH_SIZE,
      cursor: args.cursor ?? null,
    });

    let updated = args.updated ?? 0;
    for (const user of result.page) {
      if (!user.email) continue;
      const lower = user.email.toLowerCase();
      if (lower === user.email) continue;
      await ctx.db.patch(user._id, { email: lower });
      updated++;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.lowercaseEmails, {
        cursor: result.continueCursor,
        updated,
      });
      return { phase: "users", updated, isDone: false };
    }

    await ctx.scheduler.runAfter(
      0,
      internal.migrations.lowercaseAuthAccounts,
      { cursor: null, updated: 0 },
    );
    return { phase: "users", updated, isDone: true };
  },
});

export const lowercaseAuthAccounts = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    updated: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("authAccounts").paginate({
      numItems: BATCH_SIZE,
      cursor: args.cursor ?? null,
    });

    let updated = args.updated ?? 0;
    for (const account of result.page) {
      if (account.provider !== "password") continue;
      const lower = account.providerAccountId.toLowerCase();
      if (lower === account.providerAccountId) continue;

      // Refuse to silently merge two accounts that differ only in casing.
      const collision = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", lower),
        )
        .unique();
      if (collision !== null) {
        throw new Error(
          `Email collision on lowercase: account ${account._id} (${account.providerAccountId}) ` +
            `would clash with existing account ${collision._id} (${lower}). ` +
            `Resolve manually before re-running the migration.`,
        );
      }

      await ctx.db.patch(account._id, { providerAccountId: lower });
      updated++;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.lowercaseAuthAccounts,
        { cursor: result.continueCursor, updated },
      );
    }

    return { phase: "authAccounts", updated, isDone: result.isDone };
  },
});

// ---------------------------------------------------------------------------
// LES CINQ CHAMPS HÉRITÉS — la migration qui rend vraie la promesse du schéma.
//
// `exerciseExplanations` porte `audio`, `boardSpecs` et `video` ; `exercises`
// porte `promptAudio` et `promptAudioRequestedAt`. Ils viennent de l'ancienne
// application — celle que Vercel appelle encore « help-courses » — et AUCUN
// code de ce dépôt ne les écrit ni ne les lit.
//
// POURQUOI ELLE EXISTE. Le schéma ne les déclare plus. Convex refuse alors de
// pousser tant qu'un document les porte, et il s'arrête au premier fautif :
// sans cette migration, un déploiement qui les traîne encore est GELÉ — plus
// aucune poussée n'y passe, correctif de sécurité compris. La production n'a
// pas été inspectée ; si elle les porte, elle est dans ce cas.
//
// ELLE SUPPRIME AUSSI LES FICHIERS. Les narrations `gpt-4o-mini-tts` et les
// vidéos rendues vivent dans le stockage, désignées par ces seuls champs. Les
// retirer des documents sans supprimer les fichiers laisserait des orphelins
// que plus rien ne sait retrouver — et qui restent facturés.
//
//     npx convex run migrations:stripLegacyMediaFields
//
// Elle s'enchaîne toute seule, table après table, lot après lot.
//
// ATTENTION : irréversible. `npx convex export --include-file-storage` AVANT.
// ---------------------------------------------------------------------------

/** Assez petit pour que les suppressions de fichiers d'un lot tiennent dans une transaction. */
const MEDIA_BATCH_SIZE = 25;

/**
 * Les identifiants de stockage cachés dans une valeur de forme inconnue.
 *
 * Ces champs n'ont jamais eu de forme garantie — `boardSpecs` seul a montré
 * cinq `kind` différents. On cherche donc par le NOM de la clé, à toute
 * profondeur, plutôt que de parier sur une structure.
 */
function collectStorageIds(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectStorageIds(item, found);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "storageId" && typeof child === "string" && child !== "") {
      found.add(child);
    } else {
      collectStorageIds(child, found);
    }
  }
}

/**
 * Supprime les fichiers désignés, sans s'arrêter sur un fichier déjà absent.
 *
 * Un lot rejoué — la migration est relançable — retrouverait des identifiants
 * dont le fichier est déjà parti. Ce n'est pas une erreur, c'est le signe que
 * le travail avait été fait.
 */
async function deleteStoredFiles(
  ctx: { storage: { delete: (id: Id<"_storage">) => Promise<void> } },
  ids: Set<string>,
): Promise<number> {
  let deleted = 0;
  for (const id of ids) {
    try {
      await ctx.storage.delete(id as Id<"_storage">);
      deleted++;
    } catch {
      // Déjà supprimé, ou jamais stocké.
    }
  }
  return deleted;
}

/**
 * LE `as never` EST VOLONTAIRE, et il dit quelque chose de vrai.
 *
 * Ces clés ne sont plus dans le schéma — c'est le but. Le type du document ne
 * les connaît donc plus, alors que les DOCUMENTS, eux, les portent encore :
 * c'est exactement l'écart que cette migration ferme. Convex retire un champ
 * quand on lui passe `undefined`.
 */
function removalPatch(fields: readonly string[]): never {
  return Object.fromEntries(fields.map((field) => [field, undefined])) as never;
}

export const stripLegacyMediaFields = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    updated: v.optional(v.number()),
    filesDeleted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("exerciseExplanations").paginate({
      numItems: MEDIA_BATCH_SIZE,
      cursor: args.cursor ?? null,
    });

    let updated = args.updated ?? 0;
    let filesDeleted = args.filesDeleted ?? 0;

    for (const doc of result.page) {
      const legacy = doc as unknown as Record<string, unknown>;
      const present = ["audio", "boardSpecs", "video"].filter(
        (field) => legacy[field] !== undefined,
      );
      if (present.length === 0) continue;

      const storageIds = new Set<string>();
      for (const field of present) collectStorageIds(legacy[field], storageIds);
      filesDeleted += await deleteStoredFiles(ctx, storageIds);

      await ctx.db.patch(doc._id, removalPatch(present));
      updated++;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.stripLegacyMediaFields,
        { cursor: result.continueCursor, updated, filesDeleted },
      );
      return {
        phase: "exerciseExplanations",
        updated,
        filesDeleted,
        isDone: false,
      };
    }

    await ctx.scheduler.runAfter(
      0,
      internal.migrations.stripLegacyPromptAudio,
      { cursor: null, updated: 0, filesDeleted: 0 },
    );
    return {
      phase: "exerciseExplanations",
      updated,
      filesDeleted,
      isDone: true,
      next: "Enchaîne sur `exercises` — suivre `npx convex logs`.",
    };
  },
});

export const stripLegacyPromptAudio = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    updated: v.optional(v.number()),
    filesDeleted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("exercises").paginate({
      numItems: MEDIA_BATCH_SIZE,
      cursor: args.cursor ?? null,
    });

    let updated = args.updated ?? 0;
    let filesDeleted = args.filesDeleted ?? 0;

    for (const doc of result.page) {
      const legacy = doc as unknown as Record<string, unknown>;
      const present = ["promptAudio", "promptAudioRequestedAt"].filter(
        (field) => legacy[field] !== undefined,
      );
      if (present.length === 0) continue;

      const storageIds = new Set<string>();
      for (const field of present) collectStorageIds(legacy[field], storageIds);
      filesDeleted += await deleteStoredFiles(ctx, storageIds);

      await ctx.db.patch(doc._id, removalPatch(present));
      updated++;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.stripLegacyPromptAudio,
        { cursor: result.continueCursor, updated, filesDeleted },
      );
    }

    return {
      phase: "exercises",
      updated,
      filesDeleted,
      isDone: result.isDone,
    };
  },
});
