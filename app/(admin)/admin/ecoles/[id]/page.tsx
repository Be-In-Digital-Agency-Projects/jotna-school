"use client";

import { use, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Plus,
  School,
  Users,
  UserMinus,
  UserPlus,
  GraduationCap,
  AlertTriangle,
} from "lucide-react";

/** Les types viennent des fonctions Convex : aucune forme n'est recopiée. */
type StaffRow = FunctionReturnType<typeof api.schools.listStaff>[number];
type CandidateRow = FunctionReturnType<
  typeof api.schools.listStaffCandidates
>[number];
type ClassRow = FunctionReturnType<typeof api.schools.listClasses>[number];
type EnrollableRow = FunctionReturnType<
  typeof api.schools.listEnrollableStudents
>[number];
type ClassStudentRow = FunctionReturnType<
  typeof api.schools.listClassStudents
>[number];

type ClassLevel = Doc<"schoolClasses">["class"];
type StaffRole = Doc<"schoolStaff">["staffRole"];

/** Niveaux et rôles en dur, mais TYPÉS par le schéma : une valeur inventée ne compile pas. */
const CLASS_LEVELS: ClassLevel[] = ["CI", "CP", "CE1", "CE2", "CM1", "CM2"];
const STAFF_ROLES: StaffRole[] = ["professeur", "directeur"];

const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  professeur: "Professeur",
  directeur: "Directeur",
};

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default function SchoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  // `getSchool` prend une chaîne et la valide côté serveur (`normalizeId`) :
  // le segment d'URL n'est pas un identifiant tant qu'il n'a pas été vérifié.
  const school = useQuery(api.schools.getSchool, { schoolId: id });

  if (school === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <span className="ml-3 text-gray-500">Chargement de l&apos;école...</span>
      </div>
    );
  }

  if (school === null) {
    return (
      <div className="py-20 text-center">
        <h2 className="text-xl font-semibold text-gray-900">École introuvable</h2>
        <Link
          href="/admin/ecoles"
          className="mt-4 inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux écoles
        </Link>
      </div>
    );
  }

  return <SchoolDetail school={school} />;
}

function SchoolDetail({ school }: { school: Doc<"schools"> }) {
  const staff = useQuery(api.schools.listStaff, { schoolId: school._id });
  const candidates = useQuery(api.schools.listStaffCandidates, {
    schoolId: school._id,
  });
  const classes = useQuery(api.schools.listClasses, { schoolId: school._id });
  const enrollable = useQuery(api.schools.listEnrollableStudents);

  return (
    <div>
      <Link
        href="/admin/ecoles"
        className="mb-6 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour aux écoles
      </Link>

      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <School className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{school.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {[school.city, school.contactName, school.contactEmail, school.contactPhone]
              .filter((part) => part)
              .join(" · ")}
          </p>
        </div>
      </div>

      <StaffSection
        schoolId={school._id}
        staff={staff}
        candidates={candidates}
      />

      <ClassesSection
        schoolId={school._id}
        classes={classes}
        teachers={(staff ?? []).filter((row) => row.staffRole === "professeur")}
        enrollable={enrollable}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personnel — étape 2 du parcours : sans une ligne ici, personne ne peut être
// affecté à une classe de cette école.
// ---------------------------------------------------------------------------

function StaffSection({
  schoolId,
  staff,
  candidates,
}: {
  schoolId: Doc<"schools">["_id"];
  staff: StaffRow[] | undefined;
  candidates: CandidateRow[] | undefined;
}) {
  const addStaff = useMutation(api.schools.addStaff);
  const removeStaff = useMutation(api.schools.removeStaff);

  const [profileId, setProfileId] = useState("");
  const [staffRole, setStaffRole] = useState<StaffRole>("professeur");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickable = (candidates ?? []).filter(
    (candidate) => candidate.role === staffRole,
  );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    // L'identifiant typé vient de la liste, jamais de la valeur du menu.
    const picked = pickable.find((candidate) => candidate._id === profileId);
    if (!picked) {
      setError("Choisissez un profil dans la liste");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await addStaff({ schoolId, profileId: picked._id, staffRole });
      setProfileId("");
    } catch (err) {
      setError(messageOf(err, "Erreur lors du rattachement"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (row: StaffRow) => {
    setError(null);
    try {
      await removeStaff({ staffId: row._id });
      setRemoveConfirm(null);
    } catch (err) {
      setError(messageOf(err, "Erreur lors du retrait"));
      setRemoveConfirm(null);
    }
  };

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900">Personnel</h2>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={handleAdd}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Rôle
          </label>
          <select
            value={staffRole}
            onChange={(e) => {
              const next = STAFF_ROLES.find((role) => role === e.target.value);
              if (next) {
                setStaffRole(next);
                setProfileId("");
              }
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            {STAFF_ROLES.map((role) => (
              <option key={role} value={role}>
                {STAFF_ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-56 flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Profil
          </label>
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="">
              {candidates === undefined
                ? "Chargement..."
                : pickable.length === 0
                  ? "Aucun profil disponible"
                  : "Choisir un profil"}
            </option>
            {pickable.map((candidate) => (
              <option key={candidate._id} value={candidate._id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={isSubmitting || profileId === ""}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          Rattacher
        </button>
      </form>

      {staff === undefined ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement du personnel...
        </div>
      ) : staff.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Aucun membre du personnel. Rattachez un professeur pour pouvoir lui
          confier une classe.
        </div>
      ) : (
        <div className="space-y-2">
          {staff.map((row) => (
            <div
              key={row._id}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium text-gray-900">{row.name}</h3>
                  <p className="text-sm text-gray-500">
                    {STAFF_ROLE_LABEL[row.staffRole]}
                  </p>
                </div>
                {removeConfirm === row._id ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRemove(row)}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                    >
                      Confirmer
                    </button>
                    <button
                      onClick={() => setRemoveConfirm(null)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRemoveConfirm(row._id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    Retirer
                  </button>
                )}
              </div>
              {removeConfirm === row._id && (
                <p className="mt-3 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Retirer {row.name} le détache aussi des classes de cette
                    école qu&apos;il occupe. Il ne verra plus les élèves de ces
                    classes dans son espace. Les élèves, eux, restent inscrits
                    et gardent leur accès.
                  </span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Classes, affectation et inscriptions — étapes 3 à 5.
// ---------------------------------------------------------------------------

function ClassesSection({
  schoolId,
  classes,
  teachers,
  enrollable,
}: {
  schoolId: Doc<"schools">["_id"];
  classes: ClassRow[] | undefined;
  teachers: StaffRow[];
  enrollable: EnrollableRow[] | undefined;
}) {
  const createClass = useMutation(api.schools.createClass);

  const [level, setLevel] = useState<ClassLevel>("CM1");
  const [label, setLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await createClass({ schoolId, class: level, label });
      setLabel("");
    } catch (err) {
      setError(messageOf(err, "Erreur lors de la création de la classe"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900">Classes</h2>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Niveau
          </label>
          <select
            value={level}
            onChange={(e) => {
              const next = CLASS_LEVELS.find((item) => item === e.target.value);
              if (next) setLevel(next);
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            {CLASS_LEVELS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-40 flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Section
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            placeholder="ex: A"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Créer la classe
        </button>
      </form>

      {classes === undefined ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des classes...
        </div>
      ) : classes.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Aucune classe dans cette école.
        </div>
      ) : (
        <div className="space-y-4">
          {classes.map((schoolClass) => (
            <ClassCard
              key={schoolClass._id}
              schoolClass={schoolClass}
              teachers={teachers}
              enrollable={enrollable}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ClassCard({
  schoolClass,
  teachers,
  enrollable,
}: {
  schoolClass: ClassRow;
  teachers: StaffRow[];
  enrollable: EnrollableRow[] | undefined;
}) {
  const students = useQuery(api.schools.listClassStudents, {
    schoolClassId: schoolClass._id,
  });
  const assignTeacher = useMutation(api.schools.assignTeacher);
  const enrollStudent = useMutation(api.schools.enrollStudent);
  const releaseStudent = useMutation(api.schools.releaseStudent);

  const [studentId, setStudentId] = useState("");
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [releaseConfirm, setReleaseConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Le menu du professeur est piloté par la donnée serveur, sans état local :
  // pas de copie à resynchroniser après l'écriture.
  const handleAssign = async (value: string) => {
    setError(null);
    try {
      const picked = teachers.find((row) => row.profileId === value);
      await assignTeacher({
        schoolClassId: schoolClass._id,
        teacherId: picked?.profileId,
      });
    } catch (err) {
      setError(messageOf(err, "Erreur lors de l'affectation"));
    }
  };

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    const picked = (enrollable ?? []).find((row) => row._id === studentId);
    if (!picked) {
      setError("Choisissez un élève dans la liste");
      return;
    }
    setIsEnrolling(true);
    setError(null);
    try {
      await enrollStudent({
        studentId: picked._id,
        schoolClassId: schoolClass._id,
      });
      setStudentId("");
    } catch (err) {
      setError(messageOf(err, "Erreur lors de l'inscription"));
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleRelease = async (row: ClassStudentRow) => {
    setError(null);
    try {
      await releaseStudent({ membershipId: row.membershipId });
      setReleaseConfirm(null);
    } catch (err) {
      setError(messageOf(err, "Erreur lors de la libération"));
      setReleaseConfirm(null);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900">
            {schoolClass.class} {schoolClass.label}
          </h3>
          <p className="text-sm text-gray-500">
            {schoolClass.studentCount} élève
            {schoolClass.studentCount !== 1 ? "s" : ""} inscrit
            {schoolClass.studentCount !== 1 ? "s" : ""} ·{" "}
            {schoolClass.teacherName ?? "aucun professeur affecté"}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Professeur
          </label>
          <select
            value={schoolClass.teacherId ?? ""}
            onChange={(e) => handleAssign(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="">Aucun professeur</option>
            {teachers.map((row) => (
              <option key={row.profileId} value={row.profileId}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-5 border-t border-gray-100 pt-4">
        <form onSubmit={handleEnroll} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Inscrire un élève
            </label>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="">
                {enrollable === undefined
                  ? "Chargement..."
                  : enrollable.length === 0
                    ? "Aucun élève sans inscription"
                    : "Choisir un élève"}
              </option>
              {(enrollable ?? []).map((row) => (
                <option key={row._id} value={row._id}>
                  {row.name}
                  {row.class ? ` (${row.class})` : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={isEnrolling || studentId === ""}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isEnrolling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Inscrire
          </button>
        </form>
        <p className="mt-2 text-xs text-gray-500">
          Inscrire un élève le place sous l&apos;abonnement de cette école et
          lui ouvre l&apos;accès à l&apos;application. Son niveau passe à{" "}
          {schoolClass.class}. Un élève ne peut être inscrit que dans une seule
          classe à la fois.
        </p>
      </div>

      <div className="mt-5 border-t border-gray-100 pt-4">
        {students === undefined ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des élèves...
          </div>
        ) : students.length === 0 ? (
          <p className="text-sm text-gray-500">
            Aucun élève inscrit dans cette classe.
          </p>
        ) : (
          <div className="space-y-2">
            {students.map((row) => (
              <div key={row.membershipId} className="rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-gray-900">
                    {row.name}
                  </span>
                  {releaseConfirm === row.membershipId ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRelease(row)}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                      >
                        Confirmer la libération
                      </button>
                      <button
                        onClick={() => setReleaseConfirm(null)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setReleaseConfirm(row.membershipId)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                      Libérer le siège
                    </button>
                  )}
                </div>
                {releaseConfirm === row.membershipId && (
                  <p className="mt-3 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {row.name} perdra l&apos;accès à l&apos;application dès
                      maintenant : plus de matières, plus d&apos;exercices, plus
                      de progression. Son travail déjà fait est conservé, et
                      l&apos;accès revient si vous l&apos;inscrivez de nouveau
                      dans une classe.
                    </span>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
