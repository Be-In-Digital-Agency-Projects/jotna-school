import {
  clearPendingClose,
  listBundles,
  loadBundle,
  markSynced,
  pendingCloses,
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

// ---------------------------------------------------------------------------
// Clôture différée (tâche 3.7)
// ---------------------------------------------------------------------------

/**
 * La signature de `api.palierAttempts.submitPalier`, vue d'ici.
 *
 * Le RÉSULTAT reste générique : ce fichier n'a aucune raison de connaître la
 * forme d'un résultat de palier, et la séance, elle, a besoin de la vraie —
 * celle que `PalierResult` affiche. Le typer ici en obligerait une à mentir.
 */
export type SubmitFn<R> = (args: { palierAttemptId: string }) => Promise<R>;

export interface ClosedPalier<R> {
  palierAttemptId: string;
  result: R;
}

/**
 * CLÔT LES PALIERS FINIS HORS LIGNE, UNE FOIS LE JOURNAL PARTI.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE FONCTION RÈGLE, ET CE QU'ELLE NE RÈGLE PAS.
 *
 * Elle appelle `submitPalier` TEL QUEL, depuis l'appareil, au retour du
 * réseau. Aucune modification du serveur : la mutation recalcule la note
 * depuis les lignes `attempts` que la synchronisation vient d'écrire (D13),
 * ce qui est exactement ce qu'elle fait pour une séance en ligne.
 *
 * Elle couvre donc le cas ORDINAIRE — l'enfant a joué sans réseau, l'école est
 * abonnée, il retrouve ses étoiles en revenant. Elle NE couvre PAS le cas où
 * l'abonnement a expiré pendant qu'il jouait : `submitPalier` commence par
 * `requireAccess` et lèvera. Ce cas-là demande de séparer la garde d'accès du
 * calcul de la note côté serveur — c'est au §5 du plan, et c'est une décision
 * qui n'est pas la mienne.
 *
 * CE N'EST PAS GRAVE, ET C'EST TOUT L'INTÉRÊT DU MARQUEUR : un échec laisse le
 * palier marqué. Les réponses sont déjà au serveur, rien n'est perdu, et la
 * clôture se retentera à chaque retour du réseau — y compris le jour où
 * l'école renouvelle.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN SEUL ÉCHEC EFFACE LE MARQUEUR : « Tentative introuvable ». Il dit que la
 * tentative n'existe pas côté serveur, donc qu'aucun retour ne la clôra
 * jamais ; garder le marqueur y bloquerait un lot pour rien. Tous les autres
 * le gardent, et l'on assume la place que cela retient : perdre les étoiles
 * d'un enfant coûte plus cher que quelques dizaines de kilooctets.
 */
export async function closePendingPaliers<R>(
  submit: SubmitFn<R>,
): Promise<ClosedPalier<R>[]> {
  const done: ClosedPalier<R>[] = [];
  let waiting: Awaited<ReturnType<typeof pendingCloses>>;
  try {
    waiting = await pendingCloses();
  } catch {
    return done;
  }

  for (const row of waiting) {
    try {
      const result = await submit({ palierAttemptId: row.palierAttemptId });
      await clearPendingClose(row.palierAttemptId);
      done.push({ palierAttemptId: row.palierAttemptId, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/Tentative introuvable/i.test(message)) {
        await clearPendingClose(row.palierAttemptId).catch(() => {});
      }
      // Tout le reste garde le marqueur — voir l'en-tête.
    }
  }
  return done;
}

/**
 * LE RATTRAPAGE COMPLET — tout ce qui traîne, tous paliers confondus.
 *
 * POURQUOI IL NE SUFFIT PAS DE SYNCHRONISER DEPUIS LA SÉANCE. La séance ne
 * connaît que SON palier. L'enfant qui finit un palier dans le car, ferme
 * l'application, et ne rouvre que l'accueil le lendemain n'y repasserait
 * jamais : ses réponses resteraient sur la tablette alors qu'il y a du réseau
 * depuis douze heures. L'accueil est le seul écran que tout le monde revoit.
 *
 * EN SÉRIE, ET SANS RIEN LEVER. Chaque `flushJournal` avale déjà ses propres
 * pannes ; une tablette d'école qui repasse en ligne trois secondes doit
 * pouvoir en profiter sans qu'un palier en échec bloque les autres.
 */
export async function catchUpAll<R>(
  sync: SyncFn,
  submit: SubmitFn<R>,
): Promise<ClosedPalier<R>[]> {
  let bundles: Awaited<ReturnType<typeof listBundles>>;
  try {
    bundles = await listBundles();
  } catch {
    return [];
  }
  for (const bundle of bundles) {
    if (bundle.hasPending) await flushJournal(bundle.palierAttemptId, sync);
  }
  return closePendingPaliers(submit);
}
