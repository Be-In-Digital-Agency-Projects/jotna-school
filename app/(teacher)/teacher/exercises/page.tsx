"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { useState } from "react";
import { refusalMessage } from "@/lib/refusalMessage";
import {
  Pencil,
  FileText,
  Plus,
  ChevronDown,
  ChevronRight,
  UserCircle,
  Trash2,
  Loader2,
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

type TeacherExercise = {
  _id: string;
  type: string;
  prompt: string;
  status: "draft" | "published";
  version: number;
  topicId: string;
  topicName: string;
  subjectId?: string;
  subjectName: string;
};

export default function TeacherExercisesPage() {
  const profile = useQuery(api.profiles.getCurrentProfile);
  const exercises = useQuery(api.exercises.listByTeacher);
  const removeTopic = useMutation(api.topics.removeWithExercises);

  const [openSubjects, setOpenSubjects] = useState<Record<string, boolean>>({});
  const [openTopics, setOpenTopics] = useState<Record<string, boolean>>({});
  const [deletingTopic, setDeletingTopic] = useState<string | null>(null);

  const handleDeleteTopic = async (topicId: string, topicName: string, count: number) => {
    if (
      !window.confirm(
        `Supprimer la thématique "${topicName}" et ses ${count} exercice(s) ? Cette action est irréversible.`,
      )
    )
      return;
    setDeletingTopic(topicId);
    try {
      await removeTopic({ id: topicId as Id<"topics"> });
    } catch (err) {
      window.alert(
        refusalMessage(err, "Impossible de supprimer cette thématique."),
      );
    } finally {
      setDeletingTopic(null);
    }
  };

  if (profile === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
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

  // Group by subject then topic
  const grouped: Record<
    string,
    {
      subjectName: string;
      topics: Record<string, { topicName: string; items: TeacherExercise[] }>;
    }
  > = {};

  for (const ex of (exercises ?? []) as TeacherExercise[]) {
    const sKey = ex.subjectId ?? "none";
    if (!grouped[sKey]) {
      grouped[sKey] = { subjectName: ex.subjectName, topics: {} };
    }
    if (!grouped[sKey].topics[ex.topicId]) {
      grouped[sKey].topics[ex.topicId] = {
        topicName: ex.topicName,
        items: [],
      };
    }
    grouped[sKey].topics[ex.topicId].items.push(ex);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mes exercices</h1>
          <p className="mt-1 text-sm text-gray-500">
            Les exercices que vous avez créés, classés par matière et thématique.
          </p>
        </div>
        <Link
          href="/teacher/pdf-uploads"
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Ajouter un exercice
        </Link>
      </div>

      {exercises === undefined ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        </div>
      ) : exercises.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 py-16">
          <FileText className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">
            Aucun exercice pour le moment.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Importez un PDF pour en générer automatiquement.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([subjectId, subject]) => {
            const isSubjectOpen = openSubjects[subjectId] ?? true;
            return (
              <div
                key={subjectId}
                className="rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenSubjects((s) => ({
                      ...s,
                      [subjectId]: !isSubjectOpen,
                    }))
                  }
                  className="flex w-full items-center gap-2 border-b border-gray-100 px-5 py-3 text-left hover:bg-gray-50"
                >
                  {isSubjectOpen ? (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  )}
                  <span className="font-semibold text-gray-900">
                    {subject.subjectName}
                  </span>
                </button>

                {isSubjectOpen && (
                  <div className="divide-y divide-gray-100">
                    {Object.entries(subject.topics).map(([topicId, topic]) => {
                      const isTopicOpen = openTopics[topicId] ?? true;
                      return (
                        <div key={topicId}>
                          <div className="flex w-full items-center gap-2 px-8 py-2.5 text-sm hover:bg-gray-50">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenTopics((s) => ({
                                  ...s,
                                  [topicId]: !isTopicOpen,
                                }))
                              }
                              className="flex flex-1 items-center gap-2 text-left"
                            >
                              {isTopicOpen ? (
                                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                              )}
                              <span className="font-medium text-gray-700">
                                {topic.topicName}
                              </span>
                              <span className="ml-2 text-xs text-gray-400">
                                {topic.items.length} exercice
                                {topic.items.length !== 1 ? "s" : ""}
                              </span>
                            </button>
                            {/*
                              Réservé à l'administrateur, comme le serveur :
                              `topics.removeWithExercises` exige `callerIsAdmin`
                              depuis qu'elle a cessé d'être la seule écriture du
                              curriculum à se contenter de `callerIsStaff`. Le
                              bouton suit la règle plutôt que de la faire
                              découvrir par un refus.
                            */}
                            {profile.role === "admin" && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleDeleteTopic(
                                    topicId,
                                    topic.topicName,
                                    topic.items.length,
                                  )
                                }
                                disabled={deletingTopic === topicId}
                                title="Supprimer ce thème et ses exercices"
                                className="rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              >
                                {deletingTopic === topicId ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            )}
                          </div>

                          {isTopicOpen && (
                            <div className="divide-y divide-gray-100 bg-gray-50/50">
                              {topic.items.map((ex) => (
                                <div
                                  key={ex._id}
                                  className="flex items-center gap-3 px-12 py-3"
                                >
                                  <span
                                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                      TYPE_COLORS[ex.type] ??
                                      "bg-gray-100 text-gray-700"
                                    }`}
                                  >
                                    {TYPE_LABELS[ex.type] ?? ex.type}
                                  </span>
                                  <span className="flex-1 truncate text-sm text-gray-700">
                                    {ex.prompt.length > 80
                                      ? `${ex.prompt.slice(0, 80)}...`
                                      : ex.prompt}
                                  </span>
                                  <span
                                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                                      ex.status === "draft"
                                        ? "bg-yellow-100 text-yellow-800"
                                        : "bg-green-100 text-green-800"
                                    }`}
                                  >
                                    {ex.status === "draft"
                                      ? "Brouillon"
                                      : "Publié"}
                                  </span>
                                  <Link
                                    href={`/teacher/exercises/${ex._id}/edit`}
                                    className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600"
                                    title="Modifier"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Link>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
