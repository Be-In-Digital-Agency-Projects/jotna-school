import { useAuthActions } from "@convex-dev/auth/react";
import { useCallback, useState } from "react";

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
 * CE CROCHET EST LE SEUL ENDROIT OÙ L'ON QUITTE UNE SESSION, et c'est le but :
 * la phase 3 y ajoutera la purge du journal hors-ligne non synchronisé, une
 * fois celui-ci écrit. Un `signOut()` appelé directement depuis un écran
 * passerait à côté de cette purge le jour où elle existera, et laisserait les
 * réponses d'un enfant sur la tablette d'un autre.
 */
export function useChangeStudent(): { changeStudent: () => void; busy: boolean } {
  const { signOut } = useAuthActions();
  const [busy, setBusy] = useState(false);

  const changeStudent = useCallback(() => {
    setBusy(true);
    void (async () => {
      try {
        // PHASE 3 — purger ici le journal hors-ligne non synchronisé, APRÈS
        // l'avoir envoyé si le réseau est là : le travail déjà fait par
        // l'enfant précédent ne se jette pas (même principe que D18).
        await signOut();
      } finally {
        setBusy(false);
      }
    })();
  }, [signOut]);

  return { changeStudent, busy };
}
