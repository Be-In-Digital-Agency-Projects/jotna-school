"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { Copy, Mail, Printer, UserPlus } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Created = {
  name: string;
  loginId: string;
  activationCode: string;
  channel: "email" | "printed";
  expiresAt: number;
};

const ROLE_LABEL: Record<string, string> = {
  directeur: "Directeur",
  professeur: "Professeur",
  parent: "Parent",
  student: "Élève",
};

const STATE_LABEL: Record<string, string> = {
  active: "Actif",
  pending: "En attente d'activation",
  expired: "Code expiré",
};

/**
 * La création de comptes, côté école.
 *
 * LE CODE S'AFFICHE UNE FOIS, ICI, ET NULLE PART AILLEURS. `listAccounts` ne le
 * rend jamais : le relire dans une liste en ferait un secret partagé par tout le
 * personnel, durablement lisible par qui passe derrière un écran resté ouvert.
 * Le directeur le note, l'imprime ou le dicte ; s'il le perd, il réémet.
 *
 * L'E-MAIL EST OPTIONNEL, ET C'EST LE POINT. Avec une adresse, le code part par
 * e-mail et l'identifiant EST l'adresse. Sans adresse, le compte reçoit un
 * identifiant imprimable — un parent d'élève de CI n'a pas toujours d'e-mail, et
 * l'exiger reviendrait à lui refuser le suivi de son enfant.
 */
function ComptesContent() {
  const params = useSearchParams();
  const schoolParam = params.get("school");
  const schools = useQuery(api.schoolAccounts.mySchools);

  const schoolId = (schoolParam ??
    (schools && schools[0]?.schoolId)) as Id<"schools"> | undefined;

  const accounts = useQuery(
    api.schoolAccounts.listAccounts,
    schoolId ? { schoolId } : "skip",
  );

  const [role, setRole] = useState<"professeur" | "directeur" | "parent">(
    "professeur",
  );
  // L'ENFANT DU PARENT, choisi à la création. Sans lui, le compte parent
  // s'ouvre sur un espace vide : `profiles.getChildren` part de
  // `studentGuardians`, et rien d'autre ne crée cette ligne depuis que
  // l'auto-inscription suivie d'un code `PIO-` a disparu.
  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");

  const createStaff = useAction(api.schoolAccounts.createStaffAccount);
  const createParent = useAction(api.schoolAccounts.createParentAccount);

  const classes = useQuery(
    api.schools.listClasses,
    schoolId && role === "parent" ? { schoolId } : "skip",
  );
  const classStudents = useQuery(
    api.schools.listClassStudents,
    classId ? { schoolClassId: classId as Id<"schoolClasses"> } : "skip",
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId) return;
    setError(null);
    setBusy(true);
    setCreated(null);
    try {
      const payload = {
        schoolId,
        name,
        ...(email.trim() === "" ? {} : { email: email.trim() }),
      };
      const result =
        role === "parent"
          ? await createParent({
              ...payload,
              ...(studentId === ""
                ? {}
                : { studentId: studentId as Id<"profiles"> }),
            })
          : await createStaff({ ...payload, staffRole: role });
      setCreated(result);
      setName("");
      setEmail("");
      setStudentId("");
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.message
          ? err.message.replace(/^\[.*?\]\s*/, "")
          : "Création impossible.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (schools === undefined) {
    return <p className="text-sm text-gray-500">Chargement…</p>;
  }
  if (!schoolId) {
    return (
      <p className="text-sm text-gray-600">
        Aucune école rattachée à votre compte.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Comptes de l&apos;école</h1>
        <p className="text-sm text-gray-600">
          Vous créez le compte ; la personne choisit son mot de passe en
          l&apos;activant.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border bg-white p-5 shadow-sm"
      >
        <h2 className="mb-4 font-semibold">Créer un compte</h2>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Rôle</label>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "professeur" | "directeur" | "parent")
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="professeur">Professeur</option>
              <option value="parent">Parent</option>
              <option value="directeur">Directeur</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Nom</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex : Awa Diop"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              E-mail <span className="text-gray-400">(optionnel)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="laisser vide pour un code imprimé"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        {role === "parent" && (
          <div className="mt-4 grid gap-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="text-sm font-medium">Rattacher à un enfant</p>
              <p className="text-xs text-gray-600">
                Sans enfant rattaché, le parent se connecte sur un espace vide.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Classe</label>
              <select
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setStudentId("");
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                <option value="">Choisir une classe</option>
                {(classes ?? []).map((row) => (
                  <option key={row._id} value={row._id}>
                    {row.class} {row.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Élève</label>
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                disabled={classId === ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"
              >
                <option value="">
                  {classId === "" ? "Choisir d'abord la classe" : "Choisir un élève"}
                </option>
                {(classStudents ?? []).map((row) => (
                  <option key={row.studentId} value={row.studentId}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          <UserPlus className="h-4 w-4" />
          {busy ? "Création…" : "Créer le compte"}
        </button>

        <p className="mt-3 text-xs text-gray-500">
          Avec un e-mail, le code part par message et l&apos;identifiant est
          l&apos;adresse. Sans e-mail, un identifiant est tiré et s&apos;imprime
          avec le code.
        </p>
      </form>

      {created && (
        <div className="rounded-xl border-2 border-green-300 bg-green-50 p-5">
          <h2 className="font-semibold text-green-900">
            Compte créé pour {created.name}
          </h2>
          <p className="mt-1 text-sm text-green-800">
            {created.channel === "email"
              ? "Le code part par e-mail. Notez-le quand même : un message qui n'arrive pas ne doit pas bloquer la personne."
              : "Aucun e-mail : remettez ces deux lignes à la personne."}
          </p>

          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-white p-3">
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Identifiant
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold">
                {created.loginId}
              </dd>
            </div>
            <div className="rounded-lg bg-white p-3">
              <dt className="text-xs uppercase tracking-wide text-gray-500">
                Code d&apos;activation
              </dt>
              <dd className="mt-1 font-mono text-lg font-bold tracking-widest">
                {created.activationCode}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(
                  `Identifiant : ${created.loginId}\nCode d'activation : ${created.activationCode}`,
                )
              }
              className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              <Copy className="h-4 w-4" /> Copier
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              <Printer className="h-4 w-4" /> Imprimer
            </button>
          </div>

          <p className="mt-3 text-xs text-green-900">
            Code valable jusqu&apos;au{" "}
            {new Date(created.expiresAt).toLocaleDateString("fr-FR")}. Il ne sert
            qu&apos;une fois, et il ne sera plus jamais affiché.
          </p>
        </div>
      )}

      <div className="rounded-xl border bg-white shadow-sm">
        <h2 className="border-b px-5 py-4 font-semibold">
          Comptes créés{accounts ? ` (${accounts.length})` : ""}
        </h2>

        {accounts === undefined && (
          <p className="px-5 py-4 text-sm text-gray-500">Chargement…</p>
        )}

        {accounts && accounts.length === 0 && (
          <p className="px-5 py-6 text-sm text-gray-600">
            Aucun compte créé pour l&apos;instant.
          </p>
        )}

        {accounts && accounts.length > 0 && (
          <ul className="divide-y">
            {accounts.map((account) => (
              <li
                key={`${account.profileId}-${account.createdAt}`}
                className="flex flex-wrap items-center gap-3 px-5 py-3"
              >
                <span className="font-medium">{account.name}</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                  {ROLE_LABEL[account.role] ?? account.role}
                </span>
                <span className="font-mono text-xs text-gray-500">
                  {account.loginId}
                </span>
                {account.channel === "email" ? (
                  <Mail className="h-4 w-4 text-gray-400" />
                ) : (
                  <Printer className="h-4 w-4 text-gray-400" />
                )}
                <span
                  className={`ml-auto rounded px-2 py-0.5 text-xs font-medium ${
                    account.state === "active"
                      ? "bg-green-100 text-green-800"
                      : account.state === "pending"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-red-100 text-red-800"
                  }`}
                >
                  {STATE_LABEL[account.state]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function ComptesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Chargement…</p>}>
      <ComptesContent />
    </Suspense>
  );
}
