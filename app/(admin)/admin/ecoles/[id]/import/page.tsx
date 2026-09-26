"use client";

import { use, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  Loader2,
  Printer,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { refusalMessage } from "@/lib/refusalMessage";
import { parseImportPaste, PARSE_ERROR_MESSAGES } from "@/convex/importCodes";

/**
 * Import en masse d'élèves, et impression des billets.
 *
 * LA PRÉVISUALISATION TOURNE DANS LE NAVIGATEUR, avec `parseImportPaste` — LA
 * MÊME fonction que le serveur exécute ensuite. Ce n'est pas une validation
 * dupliquée : c'est la même règle, appelée deux fois. Le directeur voit ses
 * fautes de frappe pendant qu'il colle, et le serveur reste seul juge, puisqu'il
 * rejouera exactement ce calcul-là sur ce qu'il recevra.
 *
 * Ce que l'écran ne peut PAS prévoir, et n'essaie pas : l'existence des classes
 * et l'état des sièges. Ces deux-là demandent la base, et leur refus arrive du
 * serveur avec sa phrase.
 */
export default function SchoolImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const schoolId = id as Id<"schools">;

  const school = useQuery(api.schools.getSchool, { schoolId });
  const job = useQuery(api.studentImport.latestJob, { schoolId });
  const openImport = useMutation(api.studentImport.openImport);

  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => parseImportPaste(paste), [paste]);

  const jobId = job?._id ?? null;
  const tickets = useQuery(
    api.studentImport.jobTickets,
    jobId ? { jobId } : "skip",
  );

  const running = job?.status === "pending" || job?.status === "running";

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await openImport({ schoolId, paste });
      setPaste("");
    } catch (err) {
      setError(refusalMessage(err, "L'import n'a pas pu être lancé."));
    } finally {
      setBusy(false);
    }
  }

  if (school === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (school === null) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          École introuvable
        </h2>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/admin/ecoles/${id}`}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {school.name}
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Upload className="h-6 w-6 text-gray-400" />
          Importer des élèves
        </h1>
        <p className="mt-1 text-gray-500">
          Une ligne par élève : <code>Nom complet, CM1</code>, ou, si
          l&apos;école a plusieurs classes à ce niveau,{" "}
          <code>Nom complet, CM1 A</code>. Chaque élève reçoit un code de
          connexion et un code à remettre à sa famille.
        </p>
      </div>

      <form onSubmit={handleImport} className="space-y-4">
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={10}
          placeholder={"Awa Diop, CM1 A\nMoussa Fall, CM1 B\nFatou Sow, CE2"}
          className="w-full rounded-xl border border-gray-300 p-4 font-mono text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
        />

        {paste.trim() !== "" && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
            <p className="font-medium text-gray-900">
              {preview.rows.length} élève{preview.rows.length !== 1 ? "s" : ""}{" "}
              reconnu{preview.rows.length !== 1 ? "s" : ""}
              {preview.errors.length > 0 && (
                <span className="text-red-700">
                  {" "}
                  — {preview.errors.length} ligne
                  {preview.errors.length !== 1 ? "s" : ""} illisible
                  {preview.errors.length !== 1 ? "s" : ""}
                </span>
              )}
            </p>
            {preview.errors.length > 0 && (
              <ul className="mt-2 space-y-1 text-red-700">
                {preview.errors.slice(0, 10).map((e) => (
                  <li key={e.line}>
                    ligne {e.line} : {PARSE_ERROR_MESSAGES[e.reason]}
                  </li>
                ))}
                {preview.errors.length > 10 && (
                  <li className="text-gray-500">
                    et {preview.errors.length - 10} autre(s)…
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={
            busy ||
            running ||
            preview.rows.length === 0 ||
            preview.errors.length > 0
          }
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {running
            ? "Un import est déjà en cours"
            : `Importer ${preview.rows.length} élève${preview.rows.length !== 1 ? "s" : ""}`}
        </button>
      </form>

      {job && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            {running ? (
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            ) : job.status === "partial" ? (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            ) : (
              <CheckCircle className="h-5 w-5 text-green-600" />
            )}
            <h2 className="text-lg font-semibold text-gray-900">
              Dernier import — {job.processedRows} / {job.totalRows}
            </h2>
          </div>

          {job.errorMessage && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {job.errorMessage}
            </div>
          )}

          {tickets && tickets.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Un billet par élève. Le code de connexion sert aussi de mot de
                  passe : ne les distribuez qu&apos;en main propre.
                </p>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Printer className="h-4 w-4" />
                  Imprimer
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tickets.map((t) => (
                  <div
                    key={t._id}
                    className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <p className="font-semibold text-gray-900">{t.name}</p>
                    <p className="text-xs text-gray-500">{t.className}</p>

                    {t.status === "created" ? (
                      <dl className="mt-3 space-y-2 text-sm">
                        <div>
                          <dt className="text-xs text-gray-400">
                            Code de l&apos;élève
                          </dt>
                          <dd className="font-mono text-base tracking-wider text-gray-900">
                            {t.loginCode}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-gray-400">
                            Code pour la famille
                          </dt>
                          <dd className="font-mono text-base tracking-wider text-gray-900">
                            {t.parentCode}
                          </dd>
                        </div>
                      </dl>
                    ) : t.status === "failed" ? (
                      <p className="mt-3 text-sm text-red-700">
                        {t.failureReason ?? "Création impossible"}
                      </p>
                    ) : (
                      <p className="mt-3 text-sm text-gray-400">En attente…</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
