"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  Calendar,
  HardDrive,
  BookOpen,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  Send,
  RefreshCw,
  PenTool,
} from "lucide-react";

const STATUS_STEPS = [
  { key: "uploaded", label: "Importe", icon: Clock },
  { key: "extracted", label: "Extrait", icon: CheckCircle2 },
  { key: "reviewed", label: "Relu", icon: Eye },
  { key: "published", label: "Publie", icon: Send },
] as const;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EXERCISE_TYPE_LABELS: Record<string, string> = {
  qcm: "QCM",
  "drag-drop": "Glisser-deposer",
  match: "Association",
  order: "Remise en ordre",
  "short-answer": "Reponse courte",
};

export default function PdfUploadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const upload = useQuery(api.pdfUploads.getById, {
    id: id as Id<"pdfUploads">,
  });
  const createUpload = useMutation(api.pdfUploads.create);

  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Loading state
  if (upload === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  // Not found
  if (upload === null) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="h-12 w-12 text-gray-300" />
        <h2 className="mt-4 text-lg font-semibold text-gray-900">
          PDF introuvable
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Ce fichier n&apos;existe pas ou a ete supprime.
        </p>
        <Link
          href="/admin/pdf-uploads"
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour a la liste
        </Link>
      </div>
    );
  }

  const hasError =
    upload.extractedRaw &&
    typeof upload.extractedRaw === "object" &&
    "error" in (upload.extractedRaw as Record<string, unknown>);
  const errorMessage = hasError
    ? String(
        (upload.extractedRaw as Record<string, unknown>).error,
      )
    : null;

  const currentStepIndex = STATUS_STEPS.findIndex(
    (s) => s.key === upload.status,
  );

  const handleRetry = async () => {
    setIsRetrying(true);
    setRetryError(null);
    try {
      // Re-create with the same metadata to trigger extraction again
      await createUpload({
        storageId: upload.storageId,
        originalFilename: upload.originalFilename,
        mimeType: upload.mimeType,
        size: upload.size,
        subjectId: upload.subjectId,
      });
    } catch (err) {
      setRetryError(
        err instanceof Error ? err.message : "Erreur lors de la relance.",
      );
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/admin/pdf-uploads"
        className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour aux imports
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100">
            <FileText className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {upload.originalFilename}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Import PDF #{id.slice(-6)}
            </p>
          </div>
        </div>
      </div>

      {/* File info cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <HardDrive className="h-4 w-4" />
            Taille
          </div>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {formatFileSize(upload.size)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <BookOpen className="h-4 w-4" />
            Matiere
          </div>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {upload.subjectName}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="h-4 w-4" />
            Date d&apos;import
          </div>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {formatDate(upload._creationTime)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <PenTool className="h-4 w-4" />
            Exercices
          </div>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {upload.exercisesCount}
          </p>
        </div>
      </div>

      {/* Status progress */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Progression
        </h2>
        <div className="flex items-center gap-2">
          {STATUS_STEPS.map((step, index) => {
            const isCompleted = index <= currentStepIndex && !hasError;
            const isCurrent = index === currentStepIndex;
            const StepIcon = step.icon;

            return (
              <div key={step.key} className="flex flex-1 items-center">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                      hasError && isCurrent
                        ? "bg-red-100 text-red-600"
                        : isCompleted
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {hasError && isCurrent ? (
                      <AlertCircle className="h-5 w-5" />
                    ) : (
                      <StepIcon className="h-5 w-5" />
                    )}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      hasError && isCurrent
                        ? "text-red-600"
                        : isCompleted
                          ? "text-indigo-600"
                          : "text-gray-400"
                    }`}
                  >
                    {hasError && isCurrent ? "Erreur" : step.label}
                  </span>
                </div>
                {index < STATUS_STEPS.length - 1 && (
                  <div
                    className={`mx-2 h-0.5 flex-1 rounded ${
                      index < currentStepIndex && !hasError
                        ? "bg-indigo-600"
                        : "bg-gray-200"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Error state */}
      {hasError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
            <div className="flex-1">
              <h3 className="font-semibold text-red-900">
                Erreur lors de l&apos;extraction
              </h3>
              <p className="mt-1 text-sm text-red-700">{errorMessage}</p>
              {retryError && (
                <p className="mt-2 text-sm text-red-600">{retryError}</p>
              )}
              <button
                type="button"
                onClick={handleRetry}
                disabled={isRetrying}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {isRetrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Relancer l&apos;extraction
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extraction info */}
      {upload.extractedAt && !hasError && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div>
              <h3 className="font-semibold text-green-900">
                Extraction terminee
              </h3>
              <p className="mt-0.5 text-sm text-green-700">
                {upload.exercisesCount} exercice(s) genere(s) le{" "}
                {formatDate(upload.extractedAt)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Uploaded / processing state */}
      {upload.status === "uploaded" && !hasError && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-yellow-600" />
            <div>
              <h3 className="font-semibold text-yellow-900">
                Extraction en cours
              </h3>
              <p className="mt-0.5 text-sm text-yellow-700">
                L&apos;IA analyse le document et extrait les exercices. Cela
                peut prendre quelques minutes.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Exercises list */}
      {upload.exercises && upload.exercises.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Exercices generes ({upload.exercisesCount})
            </h2>
          </div>
          <div className="divide-y divide-gray-100">
            {upload.exercises.map((exercise, index) => (
              <div
                key={exercise._id}
                className="flex items-start gap-4 px-6 py-4"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-sm font-semibold text-indigo-700">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {EXERCISE_TYPE_LABELS[exercise.type] ?? exercise.type}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        exercise.status === "draft"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-green-100 text-green-800"
                      }`}
                    >
                      {exercise.status === "draft" ? "Brouillon" : "Publie"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-900">
                    {exercise.prompt}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Reponse : {exercise.answerKey}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
