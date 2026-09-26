import {
  loadBundle,
  markSynced,
  pendingEntries,
  type JournalEntry,
} from "./store";

export interface SyncResult {
  inserted: number;
  skipped: number;
  divergences: number;
}

/** La signature de `api.palierSync.syncOfflineJournal`, vue d'ici. */
export type SyncFn = (args: {
  palierAttemptId: string;
  bundleDownloadedAt: number;
  entries: Omit<JournalEntry, "palierAttemptId">[];
}) => Promise<SyncResult>;

/**
 * ENVOIE CE QUI ATTEND, PUIS MARQUE.
 *
 * L'ORDRE COMPTE, ET IL EST DANS CE SENS-LÀ. Marquer avant d'envoyer perdrait
 * les réponses si l'envoi échoue. Marquer après, au pire, les renvoie — et le
 * serveur les ignore, puisque `clientAttemptId` rend l'opération idempotente
 * (D15). Entre perdre et répéter, on répète.
 *
 * ON N'EFFACE PAS, ON MARQUE : voir l'en-tête de `store.ts`.
 *
 * RIEN NE LÈVE VERS L'APPELANT. Une synchronisation qui échoue n'est pas un
 * événement dont l'enfant doit être informé : ses réponses sont toujours là,
 * et la prochaine tentative les reprendra. On rend `null`, et l'écran continue.
 */
export async function flushJournal(
  palierAttemptId: string,
  sync: SyncFn,
): Promise<SyncResult | null> {
  try {
    const pending = await pendingEntries(palierAttemptId);
    if (pending.length === 0) return { inserted: 0, skipped: 0, divergences: 0 };

    // LA DATE DE TÉLÉCHARGEMENT VIENT DU LOT STOCKÉ, JAMAIS DE `Date.now()`.
    // Elle est la borne BASSE du bornage d'horloge côté serveur (D17) :
    // annoncer « maintenant » ramènerait TOUTES les réponses à l'instant de la
    // synchronisation, et l'enfant qui a joué lundi sans réseau perdrait son
    // lundi — exactement ce que D17 existe pour empêcher.
    const bundle = await loadBundle(palierAttemptId);
    if (bundle === null) return null;

    const result = await sync({
      palierAttemptId,
      bundleDownloadedAt: bundle.downloadedAt,
      entries: pending.map(({ palierAttemptId: _ignored, ...rest }) => rest),
    });

    await markSynced(
      pending.map((e) => e.clientAttemptId),
      Date.now(),
    );
    return result;
  } catch {
    return null;
  }
}
