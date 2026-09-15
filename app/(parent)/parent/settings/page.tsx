"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Settings, Save, User, UserCircle } from "lucide-react";
import { refusalMessage } from "@/lib/refusalMessage";

export default function ParentSettingsPage() {
  const profile = useQuery(api.profiles.getCurrentProfile);

  const updateProfile = useMutation(api.profiles.updateProfile);

  const [name, setName] = useState("");
  const [receiveReports, setReceiveReports] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      const prefs = profile.preferences as
        | { receiveReports?: boolean }
        | undefined;
      setReceiveReports(prefs?.receiveReports ?? true);
    }
  }, [profile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;

    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      // Plus de cible en argument : le serveur écrit le profil de la session.
      await updateProfile({ name, receiveReports });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de l'enregistrement"));
    } finally {
      setSaving(false);
    }
  }

  if (profile === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <UserCircle className="mx-auto h-12 w-12 text-gray-400" />
        <h2 className="mt-3 text-lg font-semibold text-gray-900">
          Vous n&apos;êtes pas connecté
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Connectez-vous pour accéder à vos paramètres.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
        >
          Se connecter
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Settings className="h-6 w-6 text-gray-400" />
          Paramètres
        </h1>
        <p className="mt-1 text-gray-500">
          Gérez vos informations personnelles et vos préférences.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        {/* Profile section */}
        <div className="space-y-4">
          <h2 className="flex items-center gap-2 font-semibold text-gray-900">
            <User className="h-5 w-5 text-gray-400" />
            Profil
          </h2>

          <div>
            <label
              htmlFor="settings-name"
              className="block text-sm font-medium text-gray-700"
            >
              Nom
            </label>
            <input
              id="settings-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
        </div>

        {/* Email preferences */}
        <div className="space-y-4 border-t border-gray-100 pt-6">
          <h2 className="font-semibold text-gray-900">
            Préférences e-mail
          </h2>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={receiveReports}
              onChange={(e) => setReceiveReports(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-900">
                Recevoir les rapports par e-mail
              </span>
              <p className="text-xs text-gray-500">
                Recevez un e-mail à chaque fois qu&apos;un de vos enfants
                termine une thématique.
              </p>
            </div>
          </label>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 border-t border-gray-100 pt-6">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>

          {saved && (
            <span className="text-sm text-green-600">
              Modifications enregistrées !
            </span>
          )}

          {error && (
            <span className="text-sm text-red-700">{error}</span>
          )}
        </div>
      </form>
    </div>
  );
}
