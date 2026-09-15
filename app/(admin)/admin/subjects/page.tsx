"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { BookOpen, Pencil, Trash2, Plus, Loader2 } from "lucide-react";
import { refusalMessage } from "@/lib/refusalMessage";

export default function SubjectsPage() {
  const subjects = useQuery(api.subjects.list);
  const createSubject = useMutation(api.subjects.create);
  const removeSubject = useMutation(api.subjects.remove);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("BookOpen");
  const [color, setColor] = useState("#6366f1");
  const [order, setOrder] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await createSubject({ name, icon, color, order });
      setName("");
      setIcon("BookOpen");
      setColor("#6366f1");
      setOrder(0);
      setShowForm(false);
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de la création"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await removeSubject({ id: id as any });
      setDeleteConfirm(null);
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de la suppression"));
      setDeleteConfirm(null);
    }
  };

  if (subjects === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <span className="ml-3 text-gray-500">Chargement des matières...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Matières</h1>
          <p className="mt-1 text-sm text-gray-500">
            Gérez les matières du programme scolaire
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Ajouter une matière
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Nouvelle matière
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="ex: Mathématiques"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Icône
                </label>
                <input
                  type="text"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  required
                  placeholder="ex: BookOpen"
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
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-gray-300"
                  />
                  <input
                    type="text"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
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
                  value={order}
                  onChange={(e) => setOrder(Number(e.target.value))}
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
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Créer
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {subjects.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-12 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            Aucune matière
          </h3>
          <p className="mt-2 text-sm text-gray-500">
            Commencez par ajouter une matière au programme.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <SubjectCard
              key={subject._id}
              subject={subject}
              deleteConfirm={deleteConfirm}
              setDeleteConfirm={setDeleteConfirm}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubjectCard({
  subject,
  deleteConfirm,
  setDeleteConfirm,
  onDelete,
}: {
  subject: {
    _id: string;
    name: string;
    icon: string;
    color: string;
    order: number;
  };
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const topics = useQuery(api.topics.listBySubject, {
    subjectId: subject._id as any,
  });
  const topicCount = topics?.length ?? 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-white text-sm font-bold"
            style={{ backgroundColor: subject.color }}
          >
            {subject.icon.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{subject.name}</h3>
            <p className="text-sm text-gray-500">
              {topicCount} thématique{topicCount !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div
          className="h-4 w-4 rounded-full border border-gray-200"
          style={{ backgroundColor: subject.color }}
          title={subject.color}
        />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Link
          href={`/admin/subjects/${subject._id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
          Modifier
        </Link>
        {deleteConfirm === subject._id ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDelete(subject._id)}
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
            onClick={() => setDeleteConfirm(subject._id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Supprimer
          </button>
        )}
      </div>
    </div>
  );
}
