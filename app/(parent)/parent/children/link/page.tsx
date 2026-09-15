"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { ArrowLeft, Search, UserCircle, Send, CheckCircle, Clock, LinkIcon } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { refusalMessage } from "@/lib/refusalMessage";

export default function LinkChildPage() {
  const profile = useQuery(api.profiles.getCurrentProfile);
  const createRequest = useMutation(api.linkRequests.createRequest);

  const [email, setEmail] = useState("");
  const [searchEmail, setSearchEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchResult = useQuery(
    api.linkRequests.searchStudentByEmail,
    searchEmail ? { email: searchEmail } : "skip",
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(false);
    setSearchEmail(email.trim().toLowerCase());
  }

  async function handleSendRequest(studentId: Id<"profiles">) {
    setSending(true);
    setError(null);
    try {
      await createRequest({ studentId });
      setSent(true);
    } catch (err) {
      setError(
        refusalMessage(err, "Erreur lors de l'envoi de la demande."),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link
          href="/parent/children"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-gray-900">
          Lier un enfant existant
        </h1>
        <p className="mt-1 text-gray-500">
          Si votre enfant a deja un compte, recherchez-le par son adresse email
          pour lui envoyer une demande de liaison.
        </p>
      </div>

      <form
        onSubmit={handleSearch}
        className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <div>
          <label
            htmlFor="child-email"
            className="block text-sm font-medium text-gray-700"
          >
            Adresse email de l&apos;enfant
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="child-email"
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSent(false);
                setError(null);
                if (!e.target.value.trim()) setSearchEmail("");
              }}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              placeholder="enfant@exemple.com"
            />
            <button
              type="submit"
              disabled={!profile || !email.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <Search className="h-4 w-4" />
              Chercher
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {searchEmail && searchResult === undefined && (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-3 border-teal-600 border-t-transparent" />
        </div>
      )}

      {searchEmail && searchResult === null && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <UserCircle className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            Aucun compte eleve trouve avec cette adresse email.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Verifiez l&apos;adresse ou{" "}
            <Link href="/parent/children/add" className="text-teal-600 hover:underline">
              creez un nouveau compte
            </Link>{" "}
            pour votre enfant.
          </p>
        </div>
      )}

      {searchResult && "alreadyLinked" in searchResult && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-6 text-center shadow-sm">
          <CheckCircle className="mx-auto h-10 w-10 text-teal-600" />
          <p className="mt-3 text-sm font-medium text-teal-800">
            Cet enfant est deja lie a votre compte.
          </p>
        </div>
      )}

      {searchResult && "pendingRequest" in searchResult && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm">
          <Clock className="mx-auto h-10 w-10 text-amber-600" />
          <p className="mt-3 text-sm font-medium text-amber-800">
            Une demande est deja en attente pour cet eleve.
          </p>
          <p className="mt-1 text-xs text-amber-600">
            Un email a ete envoye. En attente de confirmation.
          </p>
        </div>
      )}

      {searchResult && "studentId" in searchResult && !sent && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            {searchResult.avatar ? (
              <img
                src={searchResult.avatar}
                alt={searchResult.name}
                className="h-14 w-14 rounded-full object-cover"
              />
            ) : (
              <UserCircle className="h-14 w-14 text-gray-300" />
            )}
            <div className="flex-1">
              <p className="font-semibold text-gray-900">{searchResult.name}</p>
              <p className="text-sm text-gray-500">Compte eleve</p>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            <p>
              Un email sera envoye a votre enfant pour confirmer la liaison. Il
              devra accepter pour que vous puissiez suivre sa progression.
            </p>
          </div>

          <button
            onClick={() => searchResult.studentId && handleSendRequest(searchResult.studentId)}
            disabled={sending}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {sending ? "Envoi en cours..." : "Envoyer la demande"}
          </button>
        </div>
      )}

      {sent && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-6 text-center shadow-sm">
          <CheckCircle className="mx-auto h-10 w-10 text-teal-600" />
          <p className="mt-3 text-sm font-medium text-teal-800">
            Demande envoyee avec succes !
          </p>
          <p className="mt-1 text-xs text-teal-600">
            Un email a ete envoye a votre enfant. La liaison sera effective des
            qu&apos;il aura accepte.
          </p>
          <Link
            href="/parent/children"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            <LinkIcon className="h-4 w-4" />
            Voir mes enfants
          </Link>
        </div>
      )}
    </div>
  );
}
