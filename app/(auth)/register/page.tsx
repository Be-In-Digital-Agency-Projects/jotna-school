import { redirect } from "next/navigation";

/**
 * L'inscription libre n'existe plus — cette route mène à l'activation.
 *
 * UNE REDIRECTION PLUTÔT QU'UNE SUPPRESSION. `/register` est dans des e-mails
 * déjà envoyés, dans des signets et peut-être sur des papiers distribués : une
 * 404 dirait « cassé » là où la vérité est « ce n'est plus par ici ». La page
 * d'activation, elle, explique le nouveau chemin.
 *
 * LA VRAIE FERMETURE EST CÔTÉ SERVEUR, dans `convex/roleRules.decideProfileRole`
 * qui refuse toute création de compte non marquée comme venant d'une école. Ce
 * fichier n'est qu'une courtoisie : le supprimer ne rouvrirait rien.
 */
export default function RegisterPage() {
  redirect("/activation");
}
