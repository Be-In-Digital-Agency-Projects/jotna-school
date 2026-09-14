import type { AccessReason } from "@/convex/accessRules";

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
