"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus } from "lucide-react";

import { StudentImportPanel } from "@/components/school/student-import-panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { refusalMessage } from "@/lib/refusalMessage";

const LEVELS = ["CI", "CP", "CE1", "CE2", "CM1", "CM2"] as const;

/**
 * Les classes de l'école — LE PRÉREQUIS DE L'IMPORT, donc sur le même écran.
 *
 * SANS CLASSE, L'IMPORT REFUSE : `studentImport.openImport` rend « l'école n'a
 * aucune classe de CM1 » et rien n'est créé. Reléguer la création de classes
 * ailleurs — ou nulle part, comme c'était le cas pour un directeur — donnait un
 * écran d'import dont chaque ligne échouait, sans que rien n'indique où aller.
 *
 * LE LIBELLÉ EST LIBRE et vaut « unique » par défaut : beaucoup d'écoles n'ont
 * qu'une classe par niveau, et leur imposer « A » ferait écrire « CM1 A » sur
 * des billets où « CM1 » suffit.
 */
function ClassesSection({ schoolId }: { schoolId: Id<"schools"> }) {
  const classes = useQuery(api.schools.listClasses, { schoolId });
  const staff = useQuery(api.schools.listStaff, { schoolId });
  const createClass = useMutation(api.schools.createClass);
  const assignTeacher = useMutation(api.schools.assignTeacher);

  const [level, setLevel] = useState<(typeof LEVELS)[number]>("CM1");
  const [label, setLabel] = useState("unique");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teachers = (staff ?? []).filter(
    (row) => row.staffRole === "professeur",
  );

  async function handleAssign(
    schoolClassId: Id<"schoolClasses">,
    value: string,
  ) {
    setError(null);
    try {
      await assignTeacher({
        schoolClassId,
        ...(value === ""
          ? {}
          : { teacherId: value as Id<"profiles"> }),
      });
    } catch (err) {
      setError(refusalMessage(err, "L'affectation a échoué."));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createClass({ schoolId, class: level, label });
    } catch (err) {
      setError(refusalMessage(err, "La classe n'a pas pu être créée."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Classes de l&apos;école</h2>
      <p className="mt-1 text-sm text-gray-600">
        Créez les classes avant d&apos;importer : chaque élève rejoint une
        classe existante.
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Niveau</label>
          <select
            value={level}
            onChange={(e) =>
              setLevel(e.target.value as (typeof LEVELS)[number])
            }
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {LEVELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Libellé</label>
          <input
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="A, B, unique…"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Créer la classe
        </button>
      </form>

      <div className="mt-4">
        {classes === undefined && (
          <p className="text-sm text-gray-500">Chargement…</p>
        )}
        {classes && classes.length === 0 && (
          <p className="text-sm text-gray-600">Aucune classe pour l&apos;instant.</p>
        )}
        {classes && classes.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {classes.map((row) => (
              <li
                key={row._id}
                className="flex flex-wrap items-center gap-3 px-3 py-2"
              >
                <span className="text-sm font-semibold">
                  {row.class} {row.label}
                </span>
                {/*
                  SANS PROFESSEUR AFFECTÉ, L'ESPACE DU PROFESSEUR EST VIDE.
                  `access.studentIdsTaughtBy` part de `schoolClasses.teacherId`
                  et non d'un lien de tutelle : une classe sans enseignant ne
                  donne à personne la vue sur ses élèves.
                */}
                <select
                  value={row.teacherId ?? ""}
                  onChange={(e) => handleAssign(row._id, e.target.value)}
                  className="ml-auto rounded-lg border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="">Aucun professeur</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.profileId} value={teacher.profileId}>
                      {teacher.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * L'import d'élèves vu depuis la direction — le MÊME panneau que `/admin`.
 *
 * L'ÉCOLE EST DÉDUITE, PAS SAISIE. Un directeur n'a qu'une école le plus
 * souvent ; `mySchools` la rend, et le paramètre d'URL ne sert qu'au cas des
 * groupes scolaires. Lui demander de choisir son école dans un menu à une seule
 * entrée serait une question dont il connaît déjà la réponse.
 */
function ElevesContent() {
  const params = useSearchParams();
  const schoolParam = params.get("school");
  const schools = useQuery(api.schoolAccounts.mySchools);

  if (schools === undefined) {
    return <p className="text-sm text-gray-500">Chargement…</p>;
  }

  const schoolId = (schoolParam ?? schools[0]?.schoolId) as
    | Id<"schools">
    | undefined;

  if (!schoolId) {
    return (
      <p className="text-sm text-gray-600">
        Aucune école rattachée à votre compte.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <ClassesSection schoolId={schoolId} />
      <StudentImportPanel schoolId={schoolId} backHref="/directeur/dashboard" />
    </div>
  );
}

export default function DirecteurElevesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Chargement…</p>}>
      <ElevesContent />
    </Suspense>
  );
}
