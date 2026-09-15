"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { refusalMessage } from "@/lib/refusalMessage";
import {
  Upload,
  FileText,
  Trash2,
  Eye,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Send,
  UserCircle,
} from "lucide-react";

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  uploaded: {
    label: "En cours",
    color: "bg-yellow-100 text-yellow-800",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  extracted: {
    label: "Extrait",
    color: "bg-blue-100 text-blue-800",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  reviewed: {
    label: "Relu",
    color: "bg-indigo-100 text-indigo-800",
    icon: <Eye className="h-3.5 w-3.5" />,
  },
  published: {
    label: "Publié",
    color: "bg-green-100 text-green-800",
    icon: <Send className="h-3.5 w-3.5" />,
  },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TeacherPdfUploadsPage() {
  const router = useRouter();
  const profile = useQuery(api.profiles.getCurrentProfile);
  const uploads = useQuery(api.pdfUploads.listByTeacher);
  const subjects = useQuery(api.subjects.list);
  const generateUploadUrl = useMutation(api.pdfUploads.generateUploadUrl);
  const createUpload = useMutation(api.pdfUploads.create);
  const removeUpload = useMutation(api.pdfUploads.remove);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    if (!profile) {
      setError("Vous devez être connecté pour envoyer un fichier.");
      return;
    }
    if (!selectedSubjectId) {
      setError("Veuillez sélectionner une matière avant d'envoyer un fichier.");
      return;
    }
    if (file.type !== "application/pdf") {
      setError("Seuls les fichiers PDF sont acceptés.");
      return;
    }

    setError(null);
    setIsUploading(true);
    setUploadProgress("Génération de l'URL d'envoi...");

    try {
      const uploadUrl = await generateUploadUrl();
      setUploadProgress("Envoi du fichier...");

      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!result.ok) {
        throw new Error("Erreur lors de l'envoi du fichier.");
      }

      const { storageId } = await result.json();
      setUploadProgress("Création de l'enregistrement...");

      const uploadId = await createUpload({
        storageId,
        originalFilename: file.name,
        mimeType: file.type,
        size: file.size,
        subjectId: selectedSubjectId as Id<"subjects">,
      });

      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Redirect to the detail page so the teacher can watch the extraction
      // progress and review/publish the generated exercises.
      router.push(`/teacher/pdf-uploads/${uploadId}`);
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de l'envoi."));
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDelete = async (id: Id<"pdfUploads">) => {
    if (!window.confirm("Supprimer ce PDF et tous les exercices associés ?")) {
      return;
    }
    setError(null);
    try {
      await removeUpload({ id });
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de la suppression."));
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mes imports PDF</h1>
          <p className="mt-1 text-sm text-gray-500">
            Importez des PDFs pour générer automatiquement des exercices via
            l&apos;IA.
          </p>
        </div>
      </div>

      {/* Upload zone */}
      <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="w-full sm:w-64">
            <label
              htmlFor="subject-select"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Matière
            </label>
            <select
              id="subject-select"
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">Sélectionner...</option>
              {subjects?.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-1 items-end gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              disabled={isUploading || !selectedSubjectId}
              className="sr-only"
              id="pdf-file-input"
            />
            <label
              htmlFor="pdf-file-input"
              aria-disabled={isUploading || !selectedSubjectId}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors ${
                isUploading || !selectedSubjectId
                  ? "cursor-not-allowed bg-emerald-600 opacity-50"
                  : "cursor-pointer bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {isUploading ? "Envoi en cours..." : "Importer un PDF"}
            </label>
            {!selectedSubjectId && (
              <span className="text-xs text-gray-500">
                Sélectionnez d&apos;abord une matière
              </span>
            )}
          </div>
        </div>

        {uploadProgress && (
          <div className="mt-3 flex items-center gap-2 text-sm text-emerald-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            {uploadProgress}
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-auto text-red-500 hover:text-red-700"
            >
              Fermer
            </button>
          </div>
        )}
      </div>

      {/* Uploads list */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Fichiers importés
          </h2>
        </div>

        {uploads === undefined && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        )}

        {uploads && uploads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-gray-300" />
            <p className="mt-4 text-sm font-medium text-gray-900">
              Aucun PDF importé
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Importez votre premier fichier PDF pour commencer.
            </p>
          </div>
        )}

        {uploads && uploads.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-6 py-3">Fichier</th>
                  <th className="px-6 py-3">Matière</th>
                  <th className="px-6 py-3">Taille</th>
                  <th className="px-6 py-3">Statut</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {uploads.map((upload) => {
                  const statusConfig = STATUS_CONFIG[upload.status] ?? {
                    label: upload.status,
                    color: "bg-gray-100 text-gray-800",
                    icon: null,
                  };
                  const hasError =
                    upload.extractedRaw &&
                    typeof upload.extractedRaw === "object" &&
                    "error" in
                      (upload.extractedRaw as Record<string, unknown>);

                  return (
                    <tr
                      key={upload._id}
                      className="transition-colors hover:bg-gray-50"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 flex-shrink-0 text-red-500" />
                          <span className="max-w-[200px] truncate font-medium text-gray-900">
                            {upload.originalFilename}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {upload.subjectName}
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {formatFileSize(upload.size)}
                      </td>
                      <td className="px-6 py-4">
                        {hasError ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Erreur
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusConfig.color}`}
                          >
                            {statusConfig.icon}
                            {statusConfig.label}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {formatDate(upload._creationTime)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/teacher/pdf-uploads/${upload._id}`}
                            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-emerald-600"
                            title="Voir le détail"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(upload._id)}
                            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
