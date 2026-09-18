"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { GraduationCap, School, Users } from "lucide-react";

import { api } from "@/convex/_generated/api";

/**
 * L'accueil du directeur : ses écoles, et ce qu'il peut y faire.
 *
 * PLUSIEURS ÉCOLES EST UN CAS RÉEL — un groupe scolaire en porte deux — donc
 * l'écran liste plutôt que de supposer. Avec une seule école, la liste tient en
 * une carte et ne coûte rien.
 */
export default function DirecteurDashboardPage() {
  const schools = useQuery(api.schoolAccounts.mySchools);

  if (schools === undefined) {
    return <p className="text-sm text-gray-500">Chargement…</p>;
  }

  if (schools.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <School className="mx-auto h-10 w-10 text-gray-300" />
        <h1 className="mt-3 text-lg font-semibold">Aucune école rattachée</h1>
        <p className="mt-2 text-sm text-gray-600">
          Votre compte n&apos;est rattaché à aucune école en tant que directeur.
          C&apos;est l&apos;administration de Jotna School qui pose ce
          rattachement.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Mon école</h1>
        <p className="text-sm text-gray-600">
          Créez les comptes de vos professeurs, de vos parents et de vos élèves.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {schools.map((school) => (
          <div
            key={school.schoolId}
            className="rounded-xl border bg-white p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-indigo-50 p-2">
                <School className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="font-semibold">{school.name}</h2>
                <p className="text-xs text-gray-500">
                  {school.city ?? "Ville non renseignée"} · {school.status}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <Link
                href={`/directeur/comptes?school=${school.schoolId}`}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <Users className="h-4 w-4" />
                Gérer les comptes
              </Link>
              <Link
                href={`/directeur/eleves?school=${school.schoolId}`}
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                <GraduationCap className="h-4 w-4" />
                Importer des élèves
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
