import { randomUUID } from "expo-crypto";
import * as SQLite from "expo-sqlite";

/**
 * LA BASE LOCALE — lots téléchargés et journal des réponses (tâche 3.3).
 *
 * DEUX TABLES, ET UNE SEULE RAISON D'ÊTRE POUR CHACUNE :
 *
 *   `bundles` — ce qu'il faut pour JOUER sans réseau : les exercices assainis,
 *   leurs indices, leurs empreintes, et l'échéance d'accès (D18).
 *
 *   `journal` — ce qu'il faut pour RENDRE COMPTE ensuite : une ligne par
 *   réponse et par indice, dans la forme exacte que `attempts` attend (D13).
 *   Rien de plus : le serveur recalcule tout le reste.
 *
 * LE JOURNAL EST APPEND-ONLY, et les lignes envoyées ne sont pas effacées mais
 * MARQUÉES. Une suppression après envoi laisserait une fenêtre où la ligne
 * n'existe plus localement alors que le serveur ne l'a peut-être pas commise —
 * coupure au mauvais moment, réponse perdue. Marquer coûte un octet et ne perd
 * rien ; le nettoyage se fait plus tard, sur ce qui est confirmé.
 *
 * `clientAttemptId` EST TIRÉ ICI, une fois, et c'est lui qui rend la
 * synchronisation idempotente (D15). Il ne doit JAMAIS être régénéré au
 * renvoi : ce serait exactement le doublon qu'il existe pour empêcher.
 */

const DB_NAME = "jotna-offline.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (dbPromise === null) {
    dbPromise = (async () => {
      const database = await SQLite.openDatabaseAsync(DB_NAME);
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS bundles (
          palierAttemptId   TEXT PRIMARY KEY NOT NULL,
          topicId           TEXT NOT NULL,
          palierIndex       INTEGER NOT NULL,
          downloadedAt      INTEGER NOT NULL,
          accessValidUntil  INTEGER NOT NULL,
          exercises         TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS journal (
          clientAttemptId   TEXT PRIMARY KEY NOT NULL,
          palierAttemptId   TEXT NOT NULL,
          exerciseId        TEXT NOT NULL,
          submittedAnswer   TEXT NOT NULL,
          attemptNumber     INTEGER NOT NULL,
          hintsUsedCount    INTEGER NOT NULL,
          timeSpentMs       INTEGER NOT NULL,
          submittedAt       INTEGER NOT NULL,
          localVerdict      INTEGER,
          syncedAt          INTEGER
        );
        CREATE INDEX IF NOT EXISTS journal_pending
          ON journal (palierAttemptId, syncedAt);
      `);
      return database;
    })();
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------

export interface StoredBundle {
  palierAttemptId: string;
  topicId: string;
  palierIndex: number;
  downloadedAt: number;
  accessValidUntil: number;
  /** Les exercices du lot, tels que `getOfflineBundle` les a rendus. */
  exercises: unknown[];
}

export async function saveBundle(bundle: StoredBundle): Promise<void> {
  const database = await db();
  await database.runAsync(
    `INSERT OR REPLACE INTO bundles
       (palierAttemptId, topicId, palierIndex, downloadedAt, accessValidUntil, exercises)
     VALUES (?, ?, ?, ?, ?, ?)`,
    bundle.palierAttemptId,
    bundle.topicId,
    bundle.palierIndex,
    bundle.downloadedAt,
    bundle.accessValidUntil,
    JSON.stringify(bundle.exercises),
  );
}

export async function loadBundle(
  palierAttemptId: string,
): Promise<StoredBundle | null> {
  const database = await db();
  const row = await database.getFirstAsync<{
    palierAttemptId: string;
    topicId: string;
    palierIndex: number;
    downloadedAt: number;
    accessValidUntil: number;
    exercises: string;
  }>(`SELECT * FROM bundles WHERE palierAttemptId = ?`, palierAttemptId);
  if (row == null) return null;
  try {
    return { ...row, exercises: JSON.parse(row.exercises) as unknown[] };
  } catch {
    // Un lot illisible vaut un lot absent : l'enfant redemandera le réseau.
    return null;
  }
}

/** Le lot téléchargé pour cette thématique et ce palier, s'il est encore valable. */
export async function findUsableBundle(
  topicId: string,
  palierIndex: number,
  now: number,
): Promise<StoredBundle | null> {
  const database = await db();
  const row = await database.getFirstAsync<{ palierAttemptId: string }>(
    `SELECT palierAttemptId FROM bundles
      WHERE topicId = ? AND palierIndex = ? AND accessValidUntil > ?
      ORDER BY downloadedAt DESC LIMIT 1`,
    topicId,
    palierIndex,
    now,
  );
  return row == null ? null : loadBundle(row.palierAttemptId);
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export interface JournalEntry {
  clientAttemptId: string;
  palierAttemptId: string;
  exerciseId: string;
  submittedAnswer: string;
  attemptNumber: number;
  hintsUsedCount: number;
  timeSpentMs: number;
  submittedAt: number;
  localVerdict: boolean | null;
}

/** Ajoute une ligne au journal et rend son identifiant d'idempotence. */
export async function appendJournal(
  entry: Omit<JournalEntry, "clientAttemptId">,
): Promise<string> {
  const database = await db();
  const clientAttemptId = randomUUID();
  await database.runAsync(
    `INSERT INTO journal
       (clientAttemptId, palierAttemptId, exerciseId, submittedAnswer,
        attemptNumber, hintsUsedCount, timeSpentMs, submittedAt, localVerdict, syncedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    clientAttemptId,
    entry.palierAttemptId,
    entry.exerciseId,
    entry.submittedAnswer,
    entry.attemptNumber,
    entry.hintsUsedCount,
    entry.timeSpentMs,
    entry.submittedAt,
    entry.localVerdict === null ? null : entry.localVerdict ? 1 : 0,
  );
  return clientAttemptId;
}

/** Ce qui n'a pas encore été confirmé par le serveur. */
export async function pendingEntries(
  palierAttemptId: string,
): Promise<JournalEntry[]> {
  const database = await db();
  const rows = await database.getAllAsync<{
    clientAttemptId: string;
    palierAttemptId: string;
    exerciseId: string;
    submittedAnswer: string;
    attemptNumber: number;
    hintsUsedCount: number;
    timeSpentMs: number;
    submittedAt: number;
    localVerdict: number | null;
  }>(
    `SELECT clientAttemptId, palierAttemptId, exerciseId, submittedAnswer,
            attemptNumber, hintsUsedCount, timeSpentMs, submittedAt, localVerdict
       FROM journal
      WHERE palierAttemptId = ? AND syncedAt IS NULL
      ORDER BY submittedAt ASC`,
    palierAttemptId,
  );
  return rows.map((r) => ({
    ...r,
    localVerdict: r.localVerdict === null ? null : r.localVerdict === 1,
  }));
}

/** Combien de lignes attendent encore, TOUS paliers confondus. */
export async function pendingCount(): Promise<number> {
  const database = await db();
  const row = await database.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM journal WHERE syncedAt IS NULL`,
  );
  return row?.n ?? 0;
}

/** Marque comme envoyées — on n'efface pas, voir l'en-tête. */
export async function markSynced(
  clientAttemptIds: readonly string[],
  at: number,
): Promise<void> {
  if (clientAttemptIds.length === 0) return;
  const database = await db();
  const holes = clientAttemptIds.map(() => "?").join(",");
  await database.runAsync(
    `UPDATE journal SET syncedAt = ? WHERE clientAttemptId IN (${holes})`,
    at,
    ...clientAttemptIds,
  );
}

/**
 * Efface TOUT — « changer d'élève » (D10).
 *
 * L'appelant doit avoir tenté la synchronisation AVANT : le travail déjà fait
 * par l'enfant précédent ne se jette pas (même principe que D18). Ce que cette
 * fonction garantit, c'est qu'il n'en reste rien pour le suivant — ses
 * réponses ne doivent en aucun cas partir sous le nom d'un autre.
 */
export async function wipeAll(): Promise<void> {
  const database = await db();
  await database.execAsync(`DELETE FROM journal; DELETE FROM bundles;`);
}

/**
 * Combien de VRAIES tentatives l'enfant a déjà faites sur cet exercice.
 *
 * Le serveur compte la même chose (`verifyAttempt` lit les lignes de la
 * tentative), et il faut que les deux comptes coïncident : c'est lui qui
 * décide du rang du premier succès, donc du score.
 *
 * `attemptNumber > 0` exclut les lignes d'INDICE, dont la sentinelle est zéro.
 */
export async function countAttempts(
  palierAttemptId: string,
  exerciseId: string,
): Promise<number> {
  const database = await db();
  const row = await database.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM journal
      WHERE palierAttemptId = ? AND exerciseId = ? AND attemptNumber > 0`,
    palierAttemptId,
    exerciseId,
  );
  return row?.n ?? 0;
}

/** Combien d'indices déjà demandés sur cet exercice. */
export async function countHints(
  palierAttemptId: string,
  exerciseId: string,
): Promise<number> {
  const database = await db();
  const row = await database.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM journal
      WHERE palierAttemptId = ? AND exerciseId = ? AND attemptNumber = 0`,
    palierAttemptId,
    exerciseId,
  );
  return row?.n ?? 0;
}
