"use client";

import { use, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useRouter } from "next/navigation";
import { Save, ArrowLeft, Loader2, Plus, X } from "lucide-react";
import { refusalMessage } from "@/lib/refusalMessage";

// Minimal teacher-facing editor: name/prompt/hints/type only.
// For richer payload editing, teachers can use the admin editor if granted access.

type ExerciseType = "qcm" | "drag-drop" | "match" | "order" | "short-answer";

const TYPE_OPTIONS: { value: ExerciseType; label: string }[] = [
  { value: "qcm", label: "QCM" },
  { value: "drag-drop", label: "Glisser-déposer" },
  { value: "match", label: "Associer" },
  { value: "order", label: "Ordonner" },
  { value: "short-answer", label: "Réponse courte" },
];

export default function TeacherExerciseEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const exerciseId = id as Id<"exercises">;
  const exercise = useQuery(api.exercises.getById, { id: exerciseId });
  const updateExercise = useMutation(api.exercises.update);
  const router = useRouter();

  const [type, setType] = useState<ExerciseType>("qcm");
  const [prompt, setPrompt] = useState("");
  const [hints, setHints] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (exercise && !initialized) {
      setType(exercise.type);
      setPrompt(exercise.prompt);
      setHints(exercise.hints);
      setInitialized(true);
    }
  }, [exercise, initialized]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateExercise({
        id: exerciseId,
        type,
        prompt,
        hints,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de l'enregistrement"));
    } finally {
      setSaving(false);
    }
  }

  if (exercise === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  if (exercise === null) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg font-medium text-gray-500">
          Exercice introuvable
        </p>
        <button
          onClick={() => router.back()}
          className="mt-4 text-sm text-emerald-600 hover:text-emerald-800"
        >
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Modifier l&apos;exercice
            </h1>
            <p className="text-sm text-gray-500">
              v{exercise.version} ·{" "}
              {exercise.status === "published" ? "Publié" : "Brouillon"}
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Enregistrer
        </button>
      </div>

      {saved && (
        <div className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
          Modifications enregistrées !
        </div>
      )}

      <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {/* Type */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Type d&apos;exercice
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ExerciseType)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Prompt */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Énoncé
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            placeholder="Écrivez l'énoncé de l'exercice..."
          />
        </div>

        {/* Hints */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Indices (max 3)
          </label>
          <div className="space-y-2">
            {hints.map((hint, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={hint}
                  onChange={(e) => {
                    const next = [...hints];
                    next[index] = e.target.value;
                    setHints(next);
                  }}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  placeholder={`Indice ${index + 1}`}
                />
                <button
                  onClick={() =>
                    setHints(hints.filter((_, i) => i !== index))
                  }
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {hints.length < 3 && (
              <button
                onClick={() => setHints([...hints, ""])}
                className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-800"
              >
                <Plus className="h-4 w-4" />
                Ajouter un indice
              </button>
            )}
          </div>
        </div>

        <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
          Pour modifier le contenu détaillé (options, paires, zones...),
          demandez à un administrateur l&apos;accès à l&apos;éditeur complet.
        </p>
      </div>
    </div>
  );
}
