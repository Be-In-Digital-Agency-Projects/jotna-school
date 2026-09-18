import { Loader2 } from "lucide-react";

export default function TeacherLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-20">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
        <p className="text-sm font-medium text-gray-500">Chargement...</p>
      </div>
    </div>
  );
}
