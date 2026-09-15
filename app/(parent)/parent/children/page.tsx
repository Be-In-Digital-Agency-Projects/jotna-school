"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import {
  Ticket,
  Users,
  BookOpen,
  Trophy,
  ArrowRight,
  UserCircle,
  Plus,
  LinkIcon,
  Clock,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

export default function ParentChildrenPage() {
  const profile = useQuery(api.profiles.getCurrentProfile);

  // Le tuteur est dérivé de la session côté serveur : plus d'argument, donc
  // plus de "skip" en attente du profil. La requête part immédiatement et rend
  // [] tant que l'appelant n'est pas authentifié.
  const children = useQuery(api.profiles.getChildren);

  const pendingRequests = useQuery(api.linkRequests.getPendingForParent);

  if (profile === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <UserCircle className="mx-auto h-12 w-12 text-gray-400" />
        <p className="mt-3 text-sm text-gray-500">Non connecté</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mes enfants</h1>
          <p className="mt-1 text-sm text-gray-500">
            Consultez les profils et la progression de chaque enfant.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/parent/children/code"
            className="inline-flex items-center gap-2 rounded-lg border border-teal-600 px-4 py-2 text-sm font-medium text-teal-600 hover:bg-teal-50"
          >
            <Ticket className="h-4 w-4" />
            J&apos;ai un code de l&apos;école
          </Link>
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

      {pendingRequests && pendingRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">
            Demandes en attente
          </h2>
          {pendingRequests.map((req) => (
            <div
              key={req._id}
              className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
            >
              <Clock className="h-5 w-5 shrink-0 text-amber-500" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {req.studentName}
                </p>
                <p className="text-xs text-amber-600">
                  En attente de confirmation par email
                </p>
              </div>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                En attente
              </span>
            </div>
          ))}
        </div>
      )}

      {children === undefined ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
        </div>
      ) : children.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center">
          <Users className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-2 text-sm text-gray-500">
            Aucun enfant ajouté pour le moment.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              href="/parent/children/code"
              className="inline-flex items-center gap-2 rounded-lg border border-teal-600 px-4 py-2 text-sm font-medium text-teal-600 hover:bg-teal-50"
            >
              <Ticket className="h-4 w-4" />
              J&apos;ai un code de l&apos;école
            </Link>
            <Link
              href="/parent/children/link"
              className="inline-flex items-center gap-2 rounded-lg border border-teal-600 px-4 py-2 text-sm font-medium text-teal-600 hover:bg-teal-50"
            >
              <LinkIcon className="h-4 w-4" />
              Lier un enfant existant
            </Link>
            <Link
              href="/parent/children/add"
              className="inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              Ajouter un enfant
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {children
            .filter((c): c is NonNullable<typeof c> => c !== null)
            .map((child) => (
              <ChildCard
                key={child._id}
                childId={child._id as Id<"profiles">}
                name={child.name}
                avatar={child.avatar}
              />
            ))}
        </div>
      )}
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
  const reports = useQuery(api.reports.listByStudent, {
    studentId: childId,
  });

  const topicsCompleted = reports?.length ?? 0;
  const averageScore =
    reports && reports.length > 0
      ? Math.round(
          (reports.reduce((sum, r) => sum + r.score, 0) / reports.length) * 100,
        )
      : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-3">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
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
            {topicsCompleted} thématique
            {topicsCompleted !== 1 ? "s" : ""} terminée
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
            {averageScore !== null ? `${averageScore}%` : "—"}
          </p>
          <p className="text-xs text-amber-600">Moyenne</p>
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
