import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { useCallback, useState } from "react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { purgeSyncedWork } from "@/offline/store";
import { catchUpAll } from "@/offline/sync";

/**
 * « Changer d'élève » — décision D10.
 *
 * Le cas courant à l'école n'est pas un appareil par enfant : trente élèves se
 * succèdent sur quelques tablettes. Ce geste doit donc être de premier plan et
 * SANS ÉTAT RÉSIDUEL — l'enfant suivant ne doit en aucun cas jouer sous le nom
 * du précédent, sinon tentatives, étoiles et badges vont au mauvais profil.
 *
 * `signOut()` efface le jeton que `ConvexAuthProvider` avait écrit dans le
 * trousseau ; le préfixe de classe, lui, SURVIT volontairement (le suivant est
 * presque toujours de la même classe, et l'écran d'entrée offre séparément de
 * le corriger).
 *
 * CE CROCHET EST LE SEUL ENDROIT OÙ L'ON QUITTE UNE SESSION, et c'est ce qui
 * rend le ménage hors-ligne possible : un `signOut()` appelé depuis un écran
 * passerait à côté.
 *
 * L'ORDRE CI-DESSOUS EST LE SEUL QUI MARCHE, et chaque étape a sa raison.
 *
 *   1. RENDRE COMPTE D'ABORD, tant que le jeton de l'enfant est encore là.
 *      Après `signOut()`, `syncOfflineJournal` et `submitPalier` n'ont plus
 *      d'identité : les réponses resteraient sur la tablette jusqu'au jour —
 *      peut-être jamais — où cet enfant-là se reconnecte dessus.
 *   2. RANGER ENSUITE, et seulement ce qui ne sert plus (`purgeSyncedWork`
 *      dit précisément quoi, et pourquoi pas plus).
 *   3. QUITTER.
 *
 * RIEN DE TOUT CELA NE BLOQUE LE DÉPART. Si le réseau manque, l'étape 1
 * échoue en silence et l'étape 2 garde le travail non envoyé : le suivant peut
 * s'asseoir, et le serveur refusera de toute façon d'attribuer ces réponses à
 * quelqu'un d'autre (`attempt.userId`). Faire attendre trente élèves parce
 * qu'une tablette n'a pas de réseau serait le pire des deux mondes.
 */
export function useChangeStudent(): { changeStudent: () => void; busy: boolean } {
  const { signOut } = useAuthActions();
  const syncJournal = useMutation(api.palierAttempts.syncOfflineJournal);
  const submit = useMutation(api.palierAttempts.submitPalier);
  const [busy, setBusy] = useState(false);

  const changeStudent = useCallback(() => {
    setBusy(true);
    void (async () => {
      try {
        await catchUpAll(
          (a) => syncJournal(a as never) as never,
          (a) =>
            submit({ palierAttemptId: a.palierAttemptId as Id<"palierAttempts"> }),
        );
      } catch {
        // Pas de réseau, ou le serveur refuse : on part quand même.
      }
      try {
        await purgeSyncedWork();
      } catch {
        // Une base illisible ne doit pas retenir l'enfant suivant.
      }
      try {
        await signOut();
      } finally {
        setBusy(false);
      }
    })();
  }, [signOut, syncJournal, submit]);

  return { changeStudent, busy };
}
