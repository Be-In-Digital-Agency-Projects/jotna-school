/**
 * Le texte d'un refus de mutation, tel que le SERVEUR l'a écrit.
 *
 * LE CHAMP QUI VOYAGE EST `data`, ET LUI SEUL — vérifié sur le client Convex
 * installé (1.35.1), pas supposé. Une mutation qui échoue ne rend jamais
 * l'erreur du serveur : le client en fabrique une neuve. Quand le serveur a
 * levé une `ConvexError`, `BaseConvexClient.mutation`
 * (`convex/dist/esm/browser/sync/client.js`) relance
 * `forwardData(result, new ConvexError(createHybridErrorStacktrace(…)))`, et
 * `forwardData` (`convex/dist/esm/browser/logging.js`) fait exactement une
 * chose : `error.data = result.errorData`, la valeur du serveur décodée par
 * `jsonToConvex` (`browser/sync/request_manager.js`). Rien de ce chemin ne
 * regarde l'environnement — `data` arrive intact en développement comme en
 * production. `useMutation` n'ouvre pas un autre chemin : il passe par
 * `ConvexReactClient.mutation`, qui délègue à celui-là.
 *
 * `message`, LUI, NE VAUT PAS LA PEINE D'ÊTRE LU. Il vaut
 * `[CONVEX M(schools:recordSubscription)] <message du serveur>\n  Called by
 * client` (`createHybridErrorStacktrace`), donc jamais le texte écrit, même
 * quand le déploiement le laisse passer — et hors développement Convex
 * l'occulte, ce que `lib/accessCopy.ts` documente déjà pour le paywall.
 *
 * PAS D'`instanceof ConvexError` : c'est le choix qu'`isAccessDenied`
 * (`lib/accessCopy.ts`) avait déjà fait, pour ne pas dépendre de l'identité
 * d'une classe à travers les bundles du navigateur. Un test de FORME sur
 * `data` ne peut pas mentir, et il ne coûte pas un import de plus.
 *
 * DEUX FORMES DE `ConvexError` COEXISTENT, UNE SEULE S'AFFICHE ICI.
 * `convex/schools.ts` lève une CHAÎNE : le texte est déjà rédigé pour un
 * administrateur, on le montre tel quel. Les cinq sites du paywall lèvent un
 * OBJET `{ code, reason }` : c'est un motif, pas une phrase, et les mots se
 * choisissent ailleurs selon le lecteur (`accessMessageForAdult`,
 * `kidMessages`) — un objet n'est donc pas un refus d'administration et
 * retombe sur le repli.
 *
 * TOUT CE QUI N'A PAS DE `data` RETOMBE AUSSI SUR LE REPLI : panne réseau,
 * arguments refusés par le validateur, fonction introuvable, erreur du
 * runtime. Ce ne sont pas des refus rédigés, et leur `message` — occulté en
 * production, enveloppé en développement — vaut moins pour un administrateur
 * que la phrase de repli de l'écran. Il n'est pas perdu pour autant : le
 * client Convex l'écrit déjà dans la console du navigateur
 * (`logForFunction`, même fichier que `forwardData`).
 */
export function refusalMessage(err: unknown, fallback: string): string {
  if (
    typeof err === "object" &&
    err !== null &&
    "data" in err &&
    typeof err.data === "string"
  ) {
    return err.data;
  }
  return fallback;
}
