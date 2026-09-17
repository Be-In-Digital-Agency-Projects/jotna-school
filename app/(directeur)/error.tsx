"use client";

import { AlertTriangle } from "lucide-react";

export default function TeacherError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
      <h2 className="text-xl font-semibold mb-2">Une erreur est survenue</h2>
      <p className="text-gray-600 mb-4">Impossible de charger cette page.</p>
      <button
        onClick={reset}
        className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700"
      >
        Réessayer
      </button>
    </div>
  );
}
