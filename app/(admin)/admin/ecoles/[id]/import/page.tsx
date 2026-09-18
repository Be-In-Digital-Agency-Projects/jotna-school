"use client";

import { use } from "react";

import { StudentImportPanel } from "@/components/school/student-import-panel";
import type { Id } from "@/convex/_generated/dataModel";

/** L'import d'élèves vu depuis l'administration de la plateforme. */
export default function SchoolImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <StudentImportPanel
      schoolId={id as Id<"schools">}
      backHref={`/admin/ecoles/${id}`}
    />
  );
}
