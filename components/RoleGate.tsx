"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { ShieldAlert, Loader2 } from "lucide-react";

/**
 * Barre un espace dont l'appelant n'a pas le rôle.
 *
 * DU CONFORT, PAS UNE SÉCURITÉ, exactement comme `AccessGate` : les fonctions
 * Convex sont une API HTTP publique et chacune porte sa propre garde. Ce
 * composant n'empêche rien ; il évite qu'un parent qui suit un lien tombe sur
 * une console d'administration vide, sans comprendre si l'application est
 * cassée ou si elle ne lui est pas destinée.
 *
 * CE QU'IL NE FAIT PAS : rediriger. Une redirection automatique masquerait au
 * personnel ce qui s'est passé, et rendrait l'écran impossible à déboguer — on
 * dit ce qui manque, on propose la sortie, et on laisse la personne cliquer.
 */
export function RoleGate({
  allow,
  children,
}: {
  allow: readonly string[];
  children: React.ReactNode;
}) {
  const profile = useQuery(api.profiles.getCurrentProfile);

  if (profile === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (profile !== null && allow.includes(profile.role)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-12 w-12 text-gray-400" />
        <h2 className="mt-4 text-lg font-semibold text-gray-900">
          {profile === null
            ? "Vous n'êtes pas connecté"
            : "Cet espace ne vous est pas destiné"}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {profile === null
            ? "Connectez-vous pour accéder à cet espace."
            : "Votre compte n'a pas le rôle requis. Si c'est une erreur, " +
              "demandez à un administrateur de vérifier votre rôle."}
        </p>
        <Link
          href={profile === null ? "/login" : "/"}
          className="mt-5 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          {profile === null ? "Se connecter" : "Retour à l'accueil"}
        </Link>
      </div>
    </div>
  );
}
