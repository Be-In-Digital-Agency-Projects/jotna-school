// Import RELATIF, pas l'alias `@/` : ce module est lu par trois consommateurs
// aux résolutions différentes — le web (alias `@/` = racine), les fonctions
// Convex, et depuis 2026-09 l'application mobile (où `@/` désigne `src/`).
// Un chemin relatif est le seul qui vaille pour les trois. `explainMistake.ts`
// importe déjà `../lib/kidCopy` de cette façon.
import type { AccessReason } from "../convex/accessRules";

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

/**
 * Repli de détection quand seul le message brut de l'erreur est disponible
 * (pas de donnée structurée — voir isAccessDenied ci-dessous). Posé par les
 * cinq sites qui lèvent dans convex/ (requireAccess, attemptsVerify,
 * attemptsExplain, paliers/index ×2).
 */
export const ACCESS_DENIED_PREFIX = "ACCESS_DENIED:";

/**
 * Vrai si `err` est un rejet du paywall (spec §5.8).
 *
 * Convex occulte par défaut le message et la pile d'une Error ordinaire
 * côté client hors développement (elles ne remontent qu'en
 * `npx convex dev`) — un simple test de sous-chaîne sur `err.message` ne
 * suffirait donc pas en production. Les cinq sites qui lèvent dans convex/
 * utilisent ConvexError, dont le champ `data` est, lui, toujours transmis au
 * client, dans les deux cas. On le teste en premier
 * (`err.data.code === "ACCESS_DENIED"`), et on ne retombe sur
 * ACCESS_DENIED_PREFIX qu'à défaut — utile en développement et si un site
 * encore sur une Error ordinaire échappait à ce relevé.
 */
export function isAccessDenied(err: unknown): boolean {
  if (
    typeof err === "object" &&
    err !== null &&
    "data" in err &&
    typeof err.data === "object" &&
    err.data !== null &&
    "code" in err.data &&
    err.data.code === "ACCESS_DENIED"
  ) {
    return true;
  }
  const msg = err instanceof Error ? err.message : "";
  return msg.includes(ACCESS_DENIED_PREFIX);
}
