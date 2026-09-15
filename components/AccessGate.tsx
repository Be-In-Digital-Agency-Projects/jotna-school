"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { kidMessages } from "@/lib/kidCopy";
import { Sprout } from "lucide-react";

/**
 * Barre l'espace élève quand l'accès n'est pas ouvert.
 *
 * Ce composant est du confort, PAS une sécurité : le vrai contrôle est dans
 * chaque fonction Convex (spec §5.1). Les fonctions Convex sont une API HTTP
 * publique et se contournent sans passer par cette interface.
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const access = useQuery(api.access.getAccessState);

  // En cours de chargement : ne rien barrer, l'app affiche déjà ses loaders.
  if (access === undefined) return <>{children}</>;
  if (access.ok) return <>{children}</>;

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
