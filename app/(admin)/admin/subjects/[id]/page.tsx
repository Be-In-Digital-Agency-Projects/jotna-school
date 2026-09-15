"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { use } from "react";
import Link from "next/link";
import { refusalMessage } from "@/lib/refusalMessage";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Plus,
  Loader2,
  Save,
  X,
} from "lucide-react";

export default function SubjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const subject = useQuery(api.subjects.getById, { id: id as any });
  const topics = useQuery(api.topics.listBySubject, {
    subjectId: id as any,
  });
  const updateSubject = useMutation(api.subjects.update);
  const createTopic = useMutation(api.topics.create);
  const removeTopic = useMutation(api.topics.remove);

  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectName, setSubjectName] = useState("");
  const [subjectIcon, setSubjectIcon] = useState("");
  const [subjectColor, setSubjectColor] = useState("");
  const [subjectOrder, setSubjectOrder] = useState(0);

  const [showTopicForm, setShowTopicForm] = useState(false);
  const [topicName, setTopicName] = useState("");
  const [topicDescription, setTopicDescription] = useState("");
  const [topicOrder, setTopicOrder] = useState(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startEditSubject = () => {
    if (!subject) return;
    setSubjectName(subject.name);
    setSubjectIcon(subject.icon);
    setSubjectColor(subject.color);
    setSubjectOrder(subject.order);
    setEditingSubject(true);
  };

  const handleUpdateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await updateSubject({
        id: id as any,
        name: subjectName,
        icon: subjectIcon,
        color: subjectColor,
        order: subjectOrder,
      });
      setEditingSubject(false);
    } catch (err) {
      setError(
        refusalMessage(err, "Erreur lors de la mise à jour"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await createTopic({
        subjectId: id as any,
        name: topicName,
        description: topicDescription,
        order: topicOrder,
      });
      setTopicName("");
      setTopicDescription("");
      setTopicOrder(0);
      setShowTopicForm(false);
    } catch (err) {
      setError(
        refusalMessage(err, "Erreur lors de la création"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTopic = async (topicId: string) => {
    setError(null);
    try {
      await removeTopic({ id: topicId as any });
      setDeleteConfirm(null);
    } catch (err) {
      setError(
        refusalMessage(err, "Erreur lors de la suppression"),
      );
      setDeleteConfirm(null);
    }
  };

  if (subject === undefined || topics === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <span className="ml-3 text-gray-500">Chargement...</span>
      </div>
    );
  }

  if (subject === null) {
    return (
      <div className="py-20 text-center">
        <h2 className="text-xl font-semibold text-gray-900">
          Matière introuvable
        </h2>
        <Link
          href="/admin/subjects"
          className="mt-4 inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux matières
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Back link */}
      <Link
        href="/admin/subjects"
        className="mb-6 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour aux matières
      </Link>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Subject info card */}
      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {editingSubject ? (
          <form onSubmit={handleUpdateSubject} className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Modifier la matière
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom
                </label>
                <input
                  type="text"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Icône
                </label>
                <input
                  type="text"
                  value={subjectIcon}
                  onChange={(e) => setSubjectIcon(e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Couleur
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={subjectColor}
                    onChange={(e) => setSubjectColor(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-gray-300"
                  />
                  <input
                    type="text"
                    value={subjectColor}
                    onChange={(e) => setSubjectColor(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ordre
                </label>
                <input
                  type="number"
                  value={subjectOrder}
                  onChange={(e) => setSubjectOrder(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Enregistrer
              </button>
              <button
                type="button"
                onClick={() => setEditingSubject(false)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <X className="h-4 w-4" />
                Annuler
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-xl text-white text-lg font-bold"
                style={{ backgroundColor: subject.color }}
              >
                {subject.icon.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {subject.name}
                </h1>
                <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
                  <span>Icône: {subject.icon}</span>
                  <span className="text-gray-300">|</span>
                  <span className="flex items-center gap-1.5">
                    Couleur:
                    <span
                      className="inline-block h-3.5 w-3.5 rounded-full border border-gray-200"
                      style={{ backgroundColor: subject.color }}
                    />
                    {subject.color}
                  </span>
                  <span className="text-gray-300">|</span>
                  <span>Ordre: {subject.order}</span>
                </div>
              </div>
            </div>
            <button
              onClick={startEditSubject}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Pencil className="h-4 w-4" />
              Modifier
            </button>
          </div>
        )}
      </div>

      {/* Topics section */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Thématiques</h2>
        <button
          onClick={() => setShowTopicForm(!showTopicForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Ajouter une thématique
        </button>
      </div>

      {showTopicForm && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">
            Nouvelle thématique
          </h3>
          <form onSubmit={handleCreateTopic} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nom
              </label>
              <input
                type="text"
                value={topicName}
                onChange={(e) => setTopicName(e.target.value)}
                required
                placeholder="ex: Les fractions"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={topicDescription}
                onChange={(e) => setTopicDescription(e.target.value)}
                required
                rows={3}
                placeholder="Description de la thématique..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none resize-none"
              />
            </div>
            <div className="w-32">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ordre
              </label>
              <input
                type="number"
                value={topicOrder}
                onChange={(e) => setTopicOrder(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Créer
              </button>
              <button
                type="button"
                onClick={() => setShowTopicForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {topics.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900">
            Aucune thématique
          </h3>
          <p className="mt-2 text-sm text-gray-500">
            Ajoutez des thématiques à cette matière.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {topics.map((topic) => (
            <div
              key={topic._id}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{topic.name}</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {topic.description}
                  </p>
                  <span className="mt-2 inline-block text-xs text-gray-400">
                    Ordre: {topic.order}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/subjects/${id}/topics/${topic._id}/edit`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Modifier
                  </Link>
                  {deleteConfirm === topic._id ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDeleteTopic(topic._id)}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                      >
                        Confirmer
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(topic._id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
