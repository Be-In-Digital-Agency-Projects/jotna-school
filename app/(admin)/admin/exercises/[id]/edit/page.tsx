"use client";

import { use, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useRouter } from "next/navigation";
import { Save, Send, ArrowLeft, Loader2, Plus, X, GripVertical } from "lucide-react";
import ExercisePreview from "@/components/exercises/ExercisePreview";
import { refusalMessage } from "@/lib/refusalMessage";

type ExerciseType = "qcm" | "drag-drop" | "match" | "order" | "short-answer";

const TYPE_OPTIONS: { value: ExerciseType; label: string }[] = [
  { value: "qcm", label: "QCM" },
  { value: "drag-drop", label: "Glisser-deposer" },
  { value: "match", label: "Associer" },
  { value: "order", label: "Ordonner" },
  { value: "short-answer", label: "Reponse courte" },
];

export default function ExerciseEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const exerciseId = id as Id<"exercises">;
  const exercise = useQuery(api.exercises.getById, { id: exerciseId });
  const updateExercise = useMutation(api.exercises.update);
  const publishExercise = useMutation(api.exercises.publish);
  const router = useRouter();

  const [type, setType] = useState<ExerciseType>("qcm");
  const [prompt, setPrompt] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [payload, setPayload] = useState<any>({});
  const [answerKey, setAnswerKey] = useState("");
  const [hints, setHints] = useState<string[]>([]);
  const [order, setOrder] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Initialize form with exercise data
  useEffect(() => {
    if (exercise && !initialized) {
      setType(exercise.type);
      setPrompt(exercise.prompt);
      setPayload(exercise.payload);
      setAnswerKey(exercise.answerKey);
      setHints(exercise.hints);
      setOrder(exercise.order);
      setInitialized(true);
    }
  }, [exercise, initialized]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await updateExercise({
        id: exerciseId,
        type,
        prompt,
        payload,
        answerKey,
        hints,
        order,
      });
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de l'enregistrement"));
    } finally {
      setSaving(false);
    }
  }, [exerciseId, type, prompt, payload, answerKey, hints, order, updateExercise]);

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    setError(null);
    try {
      // Save first, then publish
      await updateExercise({
        id: exerciseId,
        type,
        prompt,
        payload,
        answerKey,
        hints,
        order,
      });
      await publishExercise({ id: exerciseId });
      // La redirection est DANS le `try`, après la publication : un refus la
      // saute, et l'administrateur reste sur l'écran pour lire pourquoi.
      router.push("/admin/exercises/published");
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de la publication"));
    } finally {
      setPublishing(false);
    }
  }, [exerciseId, type, prompt, payload, answerKey, hints, order, updateExercise, publishExercise, router]);

  if (exercise === undefined) {
    return <LoadingSkeleton />;
  }

  if (exercise === null) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg font-medium text-gray-500">
          Exercice introuvable
        </p>
        <button
          onClick={() => router.back()}
          className="mt-4 text-sm text-indigo-600 hover:text-indigo-800"
        >
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Header */}
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
              v{exercise.version} &middot;{" "}
              {exercise.status === "published" ? "Publie" : "Brouillon"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Enregistrer
          </button>
          {exercise.status === "draft" && (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {publishing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Publier
            </button>
          )}
        </div>
      </div>

      {/* Split view */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* LEFT: Edit form */}
        <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Formulaire</h2>

          {/* Type selector */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Type d&apos;exercice
            </label>
            <select
              value={type}
              onChange={(e) => {
                const newType = e.target.value as ExerciseType;
                setType(newType);
                setPayload(getDefaultPayload(newType));
              }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Prompt */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Enonce
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder="Ecrivez l'enonce de l'exercice..."
            />
          </div>

          {/* Dynamic payload editor */}
          <PayloadEditor type={type} payload={payload} onChange={setPayload} />

          {/* Answer key */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Cle de reponse
            </label>
            <input
              type="text"
              value={answerKey}
              onChange={(e) => setAnswerKey(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder="Reponse correcte..."
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
                  <GripVertical className="h-4 w-4 shrink-0 text-gray-300" />
                  <input
                    type="text"
                    value={hint}
                    onChange={(e) => {
                      const next = [...hints];
                      next[index] = e.target.value;
                      setHints(next);
                    }}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    placeholder={`Indice ${index + 1}`}
                  />
                  <button
                    onClick={() => setHints(hints.filter((_, i) => i !== index))}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {hints.length < 3 && (
                <button
                  onClick={() => setHints([...hints, ""])}
                  className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
                >
                  <Plus className="h-4 w-4" />
                  Ajouter un indice
                </button>
              )}
            </div>
          </div>

          {/* Order */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Ordre
            </label>
            <input
              type="number"
              value={order}
              onChange={(e) => setOrder(Number(e.target.value))}
              min={0}
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {/* RIGHT: Live preview */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Apercu (vue eleve)
          </h2>
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6">
            <ExercisePreview type={type} prompt={prompt} payload={payload} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payload Editor (dynamic based on type)
// ---------------------------------------------------------------------------

function PayloadEditor({
  type,
  payload,
  onChange,
}: {
  type: ExerciseType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (p: any) => void;
}) {
  switch (type) {
    case "qcm":
      return <QcmEditor payload={payload} onChange={onChange} />;
    case "match":
      return <MatchEditor payload={payload} onChange={onChange} />;
    case "order":
      return <OrderEditor payload={payload} onChange={onChange} />;
    case "drag-drop":
      return <DragDropEditor payload={payload} onChange={onChange} />;
    case "short-answer":
      return <ShortAnswerEditor payload={payload} onChange={onChange} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// QCM Editor
// ---------------------------------------------------------------------------

function QcmEditor({
  payload,
  onChange,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (p: any) => void;
}) {
  const options: string[] = payload?.options ?? [""];
  const correctIndex: number = payload?.correctIndex ?? 0;
  const explanation: string = payload?.explanation ?? "";

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-gray-700">Options</label>
      <div className="space-y-2">
        {options.map((opt: string, index: number) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="radio"
              name="correctIndex"
              checked={index === correctIndex}
              onChange={() =>
                onChange({ ...payload, options, correctIndex: index, explanation })
              }
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500"
              title="Marquer comme correct"
            />
            <input
              type="text"
              value={opt}
              onChange={(e) => {
                const next = [...options];
                next[index] = e.target.value;
                onChange({ ...payload, options: next, correctIndex, explanation });
              }}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder={`Option ${String.fromCharCode(65 + index)}`}
            />
            {options.length > 1 && (
              <button
                onClick={() => {
                  const next = options.filter((_: string, i: number) => i !== index);
                  const newCorrect =
                    correctIndex >= next.length
                      ? next.length - 1
                      : correctIndex > index
                        ? correctIndex - 1
                        : correctIndex;
                  onChange({
                    ...payload,
                    options: next,
                    correctIndex: newCorrect,
                    explanation,
                  });
                }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() =>
            onChange({
              ...payload,
              options: [...options, ""],
              correctIndex,
              explanation,
            })
          }
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
        >
          <Plus className="h-4 w-4" />
          Ajouter une option
        </button>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Explication (optionnel)
        </label>
        <textarea
          value={explanation}
          onChange={(e) =>
            onChange({ ...payload, options, correctIndex, explanation: e.target.value })
          }
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          placeholder="Expliquez la bonne reponse..."
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match Editor
// ---------------------------------------------------------------------------

function MatchEditor({
  payload,
  onChange,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (p: any) => void;
}) {
  const pairs: { left: string; right: string }[] = payload?.pairs ?? [
    { left: "", right: "" },
  ];

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-gray-700">Paires</label>
      <div className="space-y-2">
        {pairs.map((pair, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              value={pair.left}
              onChange={(e) => {
                const next = [...pairs];
                next[index] = { ...pair, left: e.target.value };
                onChange({ ...payload, pairs: next });
              }}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder="Gauche"
            />
            <span className="text-gray-400">→</span>
            <input
              type="text"
              value={pair.right}
              onChange={(e) => {
                const next = [...pairs];
                next[index] = { ...pair, right: e.target.value };
                onChange({ ...payload, pairs: next });
              }}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder="Droite"
            />
            {pairs.length > 1 && (
              <button
                onClick={() =>
                  onChange({
                    ...payload,
                    pairs: pairs.filter((_, i) => i !== index),
                  })
                }
                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() =>
            onChange({
              ...payload,
              pairs: [...pairs, { left: "", right: "" }],
            })
          }
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
        >
          <Plus className="h-4 w-4" />
          Ajouter une paire
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order Editor
// ---------------------------------------------------------------------------

function OrderEditor({
  payload,
  onChange,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (p: any) => void;
}) {
  const correctSequence: string[] = payload?.correctSequence ?? [""];

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-gray-700">
        Elements (dans l&apos;ordre correct)
      </label>
      <div className="space-y-2">
        {correctSequence.map((item: string, index: number) => (
          <div key={index} className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-500">
              {index + 1}
            </span>
            <input
              type="text"
              value={item}
              onChange={(e) => {
                const next = [...correctSequence];
                next[index] = e.target.value;
                onChange({ ...payload, correctSequence: next });
              }}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder={`Element ${index + 1}`}
            />
            <div className="flex gap-1">
              {index > 0 && (
                <button
                  onClick={() => {
                    const next = [...correctSequence];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    onChange({ ...payload, correctSequence: next });
                  }}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  title="Monter"
                >
                  ↑
                </button>
              )}
              {index < correctSequence.length - 1 && (
                <button
                  onClick={() => {
                    const next = [...correctSequence];
                    [next[index], next[index + 1]] = [next[index + 1], next[index]];
                    onChange({ ...payload, correctSequence: next });
                  }}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  title="Descendre"
                >
                  ↓
                </button>
              )}
            </div>
            {correctSequence.length > 1 && (
              <button
                onClick={() =>
                  onChange({
                    ...payload,
                    correctSequence: correctSequence.filter(
                      (_: string, i: number) => i !== index,
                    ),
                  })
                }
                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() =>
            onChange({
              ...payload,
              correctSequence: [...correctSequence, ""],
            })
          }
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
        >
          <Plus className="h-4 w-4" />
          Ajouter un element
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag & Drop Editor
// ---------------------------------------------------------------------------

function DragDropEditor({
  payload,
  onChange,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (p: any) => void;
}) {
  const zones: string[] = payload?.zones ?? [""];
  const items: { text: string; correctZone: string }[] = payload?.items ?? [
    { text: "", correctZone: "" },
  ];

  return (
    <div className="space-y-6">
      {/* Zones */}
      <div className="space-y-4">
        <label className="block text-sm font-medium text-gray-700">Zones</label>
        <div className="space-y-2">
          {zones.map((zone: string, index: number) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={zone}
                onChange={(e) => {
                  const next = [...zones];
                  next[index] = e.target.value;
                  onChange({ ...payload, zones: next, items });
                }}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                placeholder={`Zone ${index + 1}`}
              />
              {zones.length > 1 && (
                <button
                  onClick={() =>
                    onChange({
                      ...payload,
                      zones: zones.filter((_: string, i: number) => i !== index),
                      items,
                    })
                  }
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() =>
              onChange({ ...payload, zones: [...zones, ""], items })
            }
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
          >
            <Plus className="h-4 w-4" />
            Ajouter une zone
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-4">
        <label className="block text-sm font-medium text-gray-700">
          Elements
        </label>
        <div className="space-y-2">
          {items.map(
            (item: { text: string; correctZone: string }, index: number) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.text}
                  onChange={(e) => {
                    const next = [...items];
                    next[index] = { ...item, text: e.target.value };
                    onChange({ ...payload, zones, items: next });
                  }}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  placeholder="Texte de l'element"
                />
                <select
                  value={item.correctZone}
                  onChange={(e) => {
                    const next = [...items];
                    next[index] = { ...item, correctZone: e.target.value };
                    onChange({ ...payload, zones, items: next });
                  }}
                  className="w-40 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="">Zone...</option>
                  {zones
                    .filter((z: string) => z.trim() !== "")
                    .map((z: string) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                </select>
                {items.length > 1 && (
                  <button
                    onClick={() =>
                      onChange({
                        ...payload,
                        zones,
                        items: items.filter(
                          (
                            _: { text: string; correctZone: string },
                            i: number,
                          ) => i !== index,
                        ),
                      })
                    }
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ),
          )}
          <button
            onClick={() =>
              onChange({
                ...payload,
                zones,
                items: [...items, { text: "", correctZone: "" }],
              })
            }
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
          >
            <Plus className="h-4 w-4" />
            Ajouter un element
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Short Answer Editor
// ---------------------------------------------------------------------------

function ShortAnswerEditor({
  payload,
  onChange,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (p: any) => void;
}) {
  const acceptedAnswers: string[] = payload?.acceptedAnswers ?? [""];
  const tolerance: string = payload?.tolerance ?? "";

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Reponses acceptees
        </label>
        <div className="space-y-2">
          {acceptedAnswers.map((answer: string, index: number) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={answer}
                onChange={(e) => {
                  const next = [...acceptedAnswers];
                  next[index] = e.target.value;
                  onChange({ ...payload, acceptedAnswers: next, tolerance });
                }}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                placeholder={`Reponse ${index + 1}`}
              />
              {acceptedAnswers.length > 1 && (
                <button
                  onClick={() =>
                    onChange({
                      ...payload,
                      acceptedAnswers: acceptedAnswers.filter(
                        (_: string, i: number) => i !== index,
                      ),
                      tolerance,
                    })
                  }
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() =>
              onChange({
                ...payload,
                acceptedAnswers: [...acceptedAnswers, ""],
                tolerance,
              })
            }
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
          >
            <Plus className="h-4 w-4" />
            Ajouter une reponse
          </button>
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Tolerance (optionnel)
        </label>
        <input
          type="text"
          value={tolerance}
          onChange={(e) =>
            onChange({ ...payload, acceptedAnswers, tolerance: e.target.value })
          }
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          placeholder="Ex: casse insensible, +/- 1..."
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaultPayload(type: ExerciseType) {
  switch (type) {
    case "qcm":
      return { options: ["", ""], correctIndex: 0, explanation: "" };
    case "match":
      return { pairs: [{ left: "", right: "" }] };
    case "order":
      return { correctSequence: [""] };
    case "drag-drop":
      return {
        zones: [""],
        items: [{ text: "", correctZone: "" }],
      };
    case "short-answer":
      return { acceptedAnswers: [""], tolerance: "" };
    default:
      return {};
  }
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-96 animate-pulse rounded-xl bg-gray-100" />
        <div className="h-96 animate-pulse rounded-xl bg-gray-100" />
      </div>
    </div>
  );
}
