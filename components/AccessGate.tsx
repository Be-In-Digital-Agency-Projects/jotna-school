"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { kidMessages } from "@/lib/kidCopy";
import { accessMessageForAdult } from "@/lib/accessCopy";
import { Sprout, ShieldAlert } from "lucide-react";

/**
 * Barre l'espace élève quand l'accès n'est pas ouvert.
 *
 * Ce composant est du confort, PAS une sécurité : le vrai contrôle est dans
 * chaque fonction Convex (spec §5.1). Les fonctions Convex sont une API HTTP
 * publique et se contournent sans passer par cette interface.
 *
 * IL MONTRAIT LE MESSAGE ENFANT À TOUT LE MONDE, et §5.8 promettait l'inverse :
 * l'enfant ne doit jamais lire un motif d'argent, l'adulte doit connaître la
 * vraie raison. `lib/accessCopy.ts` couvrait déjà les neuf motifs — et AUCUN
 * écran ne l'appelait. Un parent qui ouvrait une route élève lisait donc un
 * message de pousse et de patience, sans jamais apprendre que l'abonnement de
 * l'école attend un règlement.
 *
 * QUI LIT SE DÉDUIT DU MOTIF, sans requête supplémentaire. `decideAccess`
 * (`convex/accessRules.ts`) teste `not_authenticated` puis `not_student` AVANT
 * tout le reste : ces deux motifs désignent donc exactement un visiteur
 * déconnecté et un adulte, et tous les autres impliquent un élève authentifié.
 * La déduction est exacte par construction de la fonction, pas par estimation.
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const access = useQuery(api.access.getAccessState);

  // En cours de chargement : ne rien barrer, l'app affiche déjà ses loaders.
  if (access === undefined) return <>{children}</>;
  if (access.ok) return <>{children}</>;

  const forAdult =
    access.reason === "not_authenticated" || access.reason === "not_student";

  if (forAdult) {
    const { title, body } = accessMessageForAdult(access.reason);
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-12 w-12 text-gray-400" />
          <h2 className="mt-4 text-lg font-semibold text-gray-900">{title}</h2>
          <p className="mt-2 text-sm text-gray-500">{body}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
        <Sprout className="mx-auto h-12 w-12 text-emerald-500" />
        <p className="mt-4 text-lg font-medium text-gray-900">
          {kidMessages.accessNotOpen}
        </p>
      </div>
    </div>
  );
}
