import { randomUUID } from "expo-crypto";
import * as SQLite from "expo-sqlite";

import { planEviction } from "./eviction";

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
        CREATE TABLE IF NOT EXISTS settings (
          key    TEXT PRIMARY KEY NOT NULL,
          value  TEXT NOT NULL
        );
      `);
      await migrate(database);
      return database;
    })();
  }
  return dbPromise;
}

/**
 * LES MIGRATIONS, ET POURQUOI IL EN FAUT DÉJÀ.
 *
 * `CREATE TABLE IF NOT EXISTS` ne fait RIEN sur une base existante : une
 * colonne ajoutée au schéma ci-dessus n'apparaîtrait jamais chez quelqu'un qui
 * a déjà lancé une version précédente. L'application n'est pas publiée, mais
 * les appareils de développement, eux, portent déjà l'ancienne base — et le
 * jour de la publication, ce même code devra servir aux mises à jour.
 *
 * `ALTER TABLE … ADD COLUMN` lève si la colonne existe : on lit donc
 * `PRAGMA table_info` d'abord, plutôt que d'avaler une erreur au passage, ce
 * qui masquerait les vraies.
 */
async function migrate(database: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>(
    `PRAGMA table_info(bundles)`,
  );
  const names = new Set(columns.map((c) => c.name));
  if (!names.has("pendingCloseAt")) {
    await database.execAsync(
      `ALTER TABLE bundles ADD COLUMN pendingCloseAt INTEGER`,
    );
  }
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
 * LE MÉNAGE DE « CHANGER D'ÉLÈVE » (D10) — ET IL N'EFFACE PAS TOUT.
 *
 * La première version de cette fonction s'appelait `wipeAll` et faisait ce que
 * son nom disait. C'était une faute, et voici pourquoi.
 *
 * L'ENFANT PRÉCÉDENT PEUT AVOIR DU TRAVAIL NON ENVOYÉ. Une tablette d'école
 * n'a pas toujours de réseau au moment où l'enfant suivant s'assied. Tout
 * effacer jetterait alors des réponses qu'il a vraiment données — exactement
 * ce que D18 interdit, à un autre endroit.
 *
 * ET LE GARDER NE RISQUE RIEN, parce que le serveur ne peut pas se tromper de
 * propriétaire : `syncOfflineJournal` relit la tentative et refuse
 * (« Accès refusé ») dès que `attempt.userId` n'est pas le profil qui appelle.
 * Les lignes de l'enfant précédent sont donc INENVOYABLES par le suivant, et
 * repartiront le jour où leur auteur se reconnectera sur cette tablette.
 *
 * ON EFFACE DONC LES LOTS DONT RIEN N'ATTEND — ni réponse, ni clôture — ET
 * LEUR JOURNAL AVEC EUX.
 *
 * ATTENTION AU RAFFINEMENT QUI PARAÎT ÉVIDENT : « tant qu'on y est, effaçons
 * partout les lignes déjà confirmées ». C'EST FAUX, et ça coûterait des points
 * à l'enfant. Le serveur ENREGISTRE le `attemptNumber` que l'appareil déclare,
 * et `scoreExerciseFromAttempts` note selon le RANG du premier succès. Or ce
 * rang, l'appareil le calcule en comptant ses propres lignes (`countAttempts`).
 * Effacer les lignes envoyées d'un lot encore jouable ferait repartir le compte
 * à un : l'enfant qui reprend son palier verrait sa quatrième tentative
 * enregistrée comme la première, et le serveur la noterait 10 au lieu de 3.
 *
 * Un lot qui survit garde donc TOUT son journal. Un lot qui part emmène le
 * sien, puisque plus rien ne pourra le rejouer.
 */
export async function purgeSyncedWork(): Promise<void> {
  const database = await db();
  await database.execAsync(`
    DELETE FROM bundles
     WHERE pendingCloseAt IS NULL
       AND palierAttemptId NOT IN (
         SELECT palierAttemptId FROM journal WHERE syncedAt IS NULL
       );
    DELETE FROM journal
     WHERE palierAttemptId NOT IN (SELECT palierAttemptId FROM bundles);
  `);
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

// ---------------------------------------------------------------------------
// Réglages (tâche 3.11)
// ---------------------------------------------------------------------------

/**
 * Les réglages vivent DANS LA MÊME BASE que les lots, pas dans `SecureStore`.
 *
 * `SecureStore` s'adosse au trousseau iOS et au Keystore Android : c'est fait
 * pour un jeton, pas pour une case à cocher. Et surtout, ces réglages-ci ne
 * suivent PAS l'enfant : « ne télécharger qu'en Wi-Fi » est une propriété de
 * l'APPAREIL et de son forfait, pas de l'élève. Ils survivent donc à
 * « changer d'élève » (D10) — `wipeAll` n'y touche pas, et c'est voulu.
 */
async function getSetting(key: string): Promise<string | null> {
  const database = await db();
  const row = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE key = ?`,
    key,
  );
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const database = await db();
  await database.runAsync(
    `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
    key,
    value,
  );
}

const WIFI_ONLY_KEY = "wifiOnly";

/**
 * « Préparer seulement en Wi-Fi » — VRAI PAR DÉFAUT, et ce défaut se justifie.
 *
 * Au Sénégal, la connexion d'une famille est massivement un forfait mobile
 * prépayé. Un téléchargement délibéré de plusieurs mégaoctets qui part sur les
 * données de la mère sans qu'elle l'ait voulu, c'est du crédit dépensé pour
 * rien — et la prochaine fois, c'est l'application qu'on désinstalle.
 *
 * Le réglage ne concerne QUE le téléchargement DÉLIBÉRÉ. Le lot du palier en
 * cours continue de descendre pendant qu'on y joue : l'enfant a déjà consenti
 * à cette connexion-là en ouvrant le palier, et c'est elle qui fait qu'une
 * coupure en pleine séance ne l'arrête pas.
 */
export async function getWifiOnly(): Promise<boolean> {
  return (await getSetting(WIFI_ONLY_KEY)) !== "0";
}

export async function setWifiOnly(value: boolean): Promise<void> {
  await setSetting(WIFI_ONLY_KEY, value ? "1" : "0");
}

// ---------------------------------------------------------------------------
// Plafond de stockage (tâche 3.11)
// ---------------------------------------------------------------------------

/**
 * Le plafond, en octets de contenu d'exercices.
 *
 * Huit mégaoctets, parce que la cible est un Android d'entrée de gamme dont le
 * stockage est souvent plein. Un lot de dix exercices avec ses indices et ses
 * empreintes pèse quelques dizaines de kilooctets : le plafond laisse donc
 * largement de quoi préparer une semaine, et empêche qu'un enfant qui prépare
 * tout, tous les jours, finisse par remplir la tablette de l'école.
 */
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

export interface BundleSummary {
  palierAttemptId: string;
  topicId: string;
  palierIndex: number;
  downloadedAt: number;
  accessValidUntil: number;
  bytes: number;
  /** Des réponses de ce lot attendent encore d'être envoyées. */
  hasPending: boolean;
  /** Le palier a été fini hors ligne et n'est pas encore clos (3.7). */
  awaitsClose: boolean;
}

/**
 * `LENGTH(CAST(… AS BLOB))` compte des OCTETS ; `LENGTH` seul compte des
 * caractères, et les deux diffèrent dès qu'il y a un accent — c'est-à-dire
 * dans chaque énoncé de cette application.
 */
export async function listBundles(): Promise<BundleSummary[]> {
  const database = await db();
  const rows = await database.getAllAsync<{
    palierAttemptId: string;
    topicId: string;
    palierIndex: number;
    downloadedAt: number;
    accessValidUntil: number;
    bytes: number;
    pending: number;
    pendingCloseAt: number | null;
  }>(
    `SELECT b.palierAttemptId, b.topicId, b.palierIndex, b.downloadedAt,
            b.accessValidUntil, b.pendingCloseAt,
            LENGTH(CAST(b.exercises AS BLOB)) AS bytes,
            (SELECT COUNT(*) FROM journal j
              WHERE j.palierAttemptId = b.palierAttemptId
                AND j.syncedAt IS NULL) AS pending
       FROM bundles b
      ORDER BY b.downloadedAt ASC`,
  );
  return rows.map(({ pending, pendingCloseAt, ...rest }) => ({
    ...rest,
    hasPending: pending > 0,
    awaitsClose: pendingCloseAt !== null,
  }));
}

/**
 * FAIT DE LA PLACE — la décision est dans `eviction.ts`, ici c'est le SQL.
 *
 * La séparation n'est pas cosmétique : ce qui décide quoi supprimer est le
 * seul code de l'appareil capable de détruire le travail d'un enfant, et il
 * doit pouvoir être éprouvé sans appareil. `planEviction` dit pourquoi, et
 * quelles sont les trois protections.
 */
export async function enforceStorageCap(
  keep: readonly string[] = [],
  now: number = Date.now(),
  maxBytes: number = MAX_BUNDLE_BYTES,
): Promise<{ removed: number; bytes: number }> {
  const database = await db();
  const plan = planEviction(await listBundles(), { keep, now, maxBytes });

  if (plan.remove.length > 0) {
    const holes = plan.remove.map(() => "?").join(",");
    await database.runAsync(
      `DELETE FROM bundles WHERE palierAttemptId IN (${holes})`,
      ...plan.remove,
    );
    // Le journal d'un lot supprimé part avec lui : ses lignes sont toutes
    // confirmées (c'est la condition pour évincer) et plus rien ne peut
    // rejouer ce lot. Les laisser ferait grossir la base sans fin — le seul
    // endroit où elles comptaient était le compte des tentatives du lot.
    await database.runAsync(
      `DELETE FROM journal WHERE palierAttemptId IN (${holes})`,
      ...plan.remove,
    );
  }
  return { removed: plan.remove.length, bytes: plan.remaining };
}

/** La place occupée par les lots, en octets. */
export async function bundleBytes(): Promise<number> {
  const database = await db();
  const row = await database.getFirstAsync<{ n: number | null }>(
    `SELECT SUM(LENGTH(CAST(exercises AS BLOB))) AS n FROM bundles`,
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Clôture différée (tâche 3.7)
// ---------------------------------------------------------------------------

/**
 * « L'ENFANT A FINI CE PALIER SANS RÉSEAU, IL RESTE À LE CLORE. »
 *
 * POURQUOI UN MARQUEUR EXPLICITE, ET SURTOUT PAS UNE DÉDUCTION. On pourrait
 * croire qu'il suffit de regarder si chaque exercice du lot porte une réponse.
 * Ce serait faux et COÛTEUX POUR L'ENFANT : celui qui répond à huit exercices
 * sur dix puis s'arrête n'a pas fini son palier, et le clore à sa place ferait
 * noter les deux derniers à zéro — donc, très probablement, échouer un palier
 * qu'il n'a jamais rendu.
 *
 * Le marqueur se pose au SEUL endroit où l'on sait : quand l'enfant passe le
 * dernier exercice.
 *
 * IL S'EFFACE À LA CLÔTURE, et c'est ce qui le rend idempotent : sans cela,
 * chaque retour du réseau reclôrait les mêmes paliers.
 */
export async function markPendingClose(
  palierAttemptId: string,
  at: number = Date.now(),
): Promise<void> {
  const database = await db();
  await database.runAsync(
    `UPDATE bundles SET pendingCloseAt = ? WHERE palierAttemptId = ?`,
    at,
    palierAttemptId,
  );
}

export async function clearPendingClose(palierAttemptId: string): Promise<void> {
  const database = await db();
  await database.runAsync(
    `UPDATE bundles SET pendingCloseAt = NULL WHERE palierAttemptId = ?`,
    palierAttemptId,
  );
}

/**
 * Les paliers finis hors ligne qui attendent leur clôture — et dont TOUT est
 * déjà parti.
 *
 * LA CONDITION SUR LE JOURNAL N'EST PAS UNE PRÉCAUTION, C'EST LE CŒUR.
 * `submitPalier` recalcule la note depuis les lignes `attempts` du serveur :
 * clore avant que la dernière réponse soit arrivée noterait le palier sur ce
 * qui a été reçu, et l'enfant perdrait les points des réponses en retard.
 */
export async function pendingCloses(): Promise<
  { palierAttemptId: string; topicId: string; palierIndex: number }[]
> {
  const database = await db();
  return database.getAllAsync<{
    palierAttemptId: string;
    topicId: string;
    palierIndex: number;
  }>(
    `SELECT b.palierAttemptId, b.topicId, b.palierIndex
       FROM bundles b
      WHERE b.pendingCloseAt IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM journal j
           WHERE j.palierAttemptId = b.palierAttemptId
             AND j.syncedAt IS NULL
        )
      ORDER BY b.pendingCloseAt ASC`,
  );
}
