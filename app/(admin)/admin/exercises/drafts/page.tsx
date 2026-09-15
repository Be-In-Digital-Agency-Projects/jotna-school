"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
import Link from "next/link";
import { refusalMessage } from "@/lib/refusalMessage";
import {
  Pencil,
  Trash2,
  Send,
  Loader2,
  FileText,
  Filter,
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  qcm: "QCM",
  "drag-drop": "Glisser-deposer",
  match: "Associer",
  order: "Ordonner",
  "short-answer": "Reponse courte",
};

const TYPE_COLORS: Record<string, string> = {
  qcm: "bg-blue-100 text-blue-700",
  "drag-drop": "bg-purple-100 text-purple-700",
  match: "bg-amber-100 text-amber-700",
  order: "bg-green-100 text-green-700",
  "short-answer": "bg-rose-100 text-rose-700",
};

export default function DraftsPage() {
  const exercises = useQuery(api.exercises.listAllDrafts);
  const allTopicsMap = useTopicsMap();
  const publishExercise = useMutation(api.exercises.publish);
  const removeExercise = useMutation(api.exercises.remove);

  const [filterTopicId, setFilterTopicId] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<Id<"exercises"> | null>(null);
  const [publishingId, setPublishingId] = useState<Id<"exercises"> | null>(
    null,
  );

  if (exercises === undefined) {
    return <LoadingSkeleton />;
  }

  const filtered =
    filterTopicId === "all"
      ? exercises
      : exercises.filter((e) => e.topicId === filterTopicId);

  // Collect unique topic IDs from drafts for filter dropdown
  const topicIds = [...new Set(exercises.map((e) => e.topicId))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Brouillons
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {exercises.length} exercice{exercises.length !== 1 ? "s" : ""} en
            brouillon
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="sticky top-2 z-20 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm"
        >
          {error}
        </div>
      )}

      {/* Filter bar */}
      {topicIds.length > 1 && (
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={filterTopicId}
            onChange={(e) => setFilterTopicId(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="all">Toutes les thematiques</option>
            {topicIds.map((id) => (
              <option key={id} value={id}>
                {allTopicsMap[id] ?? id}
              </option>
            ))}
          </select>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                  Thematique
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                  Enonce
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                  Version
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium tracking-wider text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map((exercise) => (
                <tr key={exercise._id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                    {allTopicsMap[exercise.topicId] ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[exercise.type] ?? "bg-gray-100 text-gray-700"}`}
                    >
                      {TYPE_LABELS[exercise.type] ?? exercise.type}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-6 py-4 text-sm text-gray-700">
                    {exercise.prompt.length > 80
                      ? exercise.prompt.slice(0, 80) + "..."
                      : exercise.prompt}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    v{exercise.version}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/exercises/${exercise._id}/edit`}
                        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                        title="Modifier"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={async () => {
                          setPublishingId(exercise._id);
                          setError(null);
                          try {
                            await publishExercise({ id: exercise._id });
                          } catch (err) {
                            setError(refusalMessage(err, "Erreur lors de la publication"));
                          } finally {
                            setPublishingId(null);
                          }
                        }}
                        disabled={publishingId === exercise._id}
                        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600 disabled:opacity-50"
                        title="Publier"
                      >
                        {publishingId === exercise._id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            !window.confirm(
                              "Supprimer cet exercice ? Cette action est irreversible.",
                            )
                          )
                            return;
                          setDeletingId(exercise._id);
                          setError(null);
                          try {
                            await removeExercise({ id: exercise._id });
                          } catch (err) {
                            setError(refusalMessage(err, "Erreur lors de la suppression"));
                          } finally {
                            setDeletingId(null);
                          }
                        }}
                        disabled={deletingId === exercise._id}
                        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        title="Supprimer"
                      >
                        {deletingId === exercise._id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useTopicsMap(): Record<string, string> {
  const topics = useQuery(api.topics.listAll);
  if (!topics) return {};
  const map: Record<string, string> = {};
  for (const t of topics) {
    map[t._id] = t.name;
  }
  return map;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-xl bg-gray-100"
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 py-16">
      <FileText className="mb-3 h-10 w-10 text-gray-300" />
      <p className="text-sm font-medium text-gray-500">
        Aucun exercice en brouillon
      </p>
    </div>
  );
}
