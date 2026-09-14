"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Users, BookOpen, Trophy, ArrowRight, UserCircle, LinkIcon, Plus } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

export default function ParentDashboardPage() {
  const profile = useQuery(api.profiles.getCurrentProfile);

  // Le tuteur est dérivé de la session côté serveur : plus d'argument, donc
  // plus de "skip" en attente du profil.
  const children = useQuery(api.profiles.getChildren);

  // Still loading the profile query
  if (profile === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
      </div>
    );
  }

  // Authenticated query resolved but no profile / not signed in
  if (profile === null) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <UserCircle className="mx-auto h-12 w-12 text-gray-400" />
        <h2 className="mt-3 text-lg font-semibold text-gray-900">
          Vous n&apos;êtes pas connecté
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Connectez-vous pour accéder à votre tableau de bord.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
        >
          Se connecter
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Bonjour, {profile.name} !
        </h1>
        <p className="mt-1 text-gray-500">
          Suivez la progression de vos enfants depuis votre tableau de bord.
        </p>
      </div>

      {/* Children cards */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Mes enfants</h2>
          <div className="flex gap-3">
            <Link
              href="/parent/children/link"
              className="text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              Lier un enfant existant
            </Link>
            <Link
              href="/parent/children/add"
              className="text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              + Ajouter un enfant
            </Link>
          </div>
        </div>

        {!children || children.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm text-gray-500">
              Aucun enfant ajouté pour le moment.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href="/parent/children/link"
                className="inline-flex items-center gap-2 rounded-lg border border-teal-600 px-4 py-2 text-sm font-medium text-teal-600 hover:bg-teal-50"
              >
                <LinkIcon className="h-4 w-4" />
                Lier un enfant existant
              </Link>
              <Link
                href="/parent/children/add"
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
              >
                <Plus className="h-4 w-4" />
                Ajouter un enfant
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {children.filter((c): c is NonNullable<typeof c> => c !== null).map((child) => (
              <ChildCard
                key={child._id}
                childId={child._id as Id<"profiles">}
                name={child.name}
                avatar={child.avatar}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ChildCard({
  childId,
  name,
  avatar,
}: {
  childId: Id<"profiles">;
  name: string;
  avatar?: string;
}) {
  // Fetch progress data for this child
  const progress = useQuery(api.reports.listByStudent, {
    studentId: childId,
  });

  const topicsCompleted = progress?.length ?? 0;

  // Fetch earned badges for this child
  const latestBadge = null; // Badges could be fetched here if needed

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-3">
        {avatar ? (
          <img
            src={avatar}
            alt={name}
            className="h-12 w-12 rounded-full object-cover"
          />
        ) : (
          <UserCircle className="h-12 w-12 text-gray-300" />
        )}
        <div>
          <h3 className="font-semibold text-gray-900">{name}</h3>
          <p className="text-sm text-gray-500">
            {topicsCompleted} rapport{topicsCompleted !== 1 ? "s" : ""} disponible
            {topicsCompleted !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-teal-50 p-3 text-center">
          <BookOpen className="mx-auto h-5 w-5 text-teal-600" />
          <p className="mt-1 text-lg font-bold text-teal-700">
            {topicsCompleted}
          </p>
          <p className="text-xs text-teal-600">Rapports</p>
        </div>
        <div className="rounded-lg bg-amber-50 p-3 text-center">
          <Trophy className="mx-auto h-5 w-5 text-amber-600" />
          <p className="mt-1 text-lg font-bold text-amber-700">
            {latestBadge ? "1" : "—"}
          </p>
          <p className="text-xs text-amber-600">Badges</p>
        </div>
      </div>

      <Link
        href={`/parent/children/${childId}/progress`}
        className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
      >
        Voir la progression
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
