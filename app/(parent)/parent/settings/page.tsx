"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Settings, Save, Sparkles, User, UserCircle } from "lucide-react";
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

      <AiConsentSection />
    </div>
  );
}

/**
 * LE LEVIER DU PARENT SUR LE TRAITEMENT IA — tâche 6.4.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IL EST HORS DU FORMULAIRE, et ce n'est pas une question de mise en page.
 * Le formulaire ci-dessus s'enregistre sur « Enregistrer » ; un refus de
 * consentement, lui, doit prendre effet à la seconde où le parent le clique.
 * Un « non » qui attend qu'on pense à valider un formulaire n'en est pas un.
 *
 * ON AFFICHE LA DÉCISION COMPLÈTE, pas seulement l'avis du parent : c'est
 * `decideAiConsent` côté serveur qui la rend, la même fonction que les trois
 * chemins IA consultent. Le parent lit donc exactement ce qui se passe, et
 * non une reconstitution qui pourrait en diverger.
 *
 * LE DÉLAI DE GRÂCE EST DIT, AVEC SA DATE. Sans cela, l'IA s'éteindrait un
 * matin pour les enfants d'une école qui n'a pas déclaré, sans que personne
 * ait vu venir l'échéance.
 */
function AiConsentSection() {
  const children = useQuery(api.profiles.getChildrenAiConsent);
  const setConsent = useMutation(api.profiles.setChildAiConsent);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (children === undefined || children.length === 0) return null;

  return (
    <section className="mt-6 space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="flex items-center gap-2 font-semibold text-gray-900">
          <Sparkles className="h-5 w-5 text-gray-400" />
          Aide par intelligence artificielle
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Pour expliquer une erreur ou proposer des exercices adaptés, nous
          envoyons le travail de votre enfant à un prestataire d&apos;IA. Vous
          pouvez l&apos;autoriser ou le refuser, enfant par enfant. Votre refus
          s&apos;applique immédiatement.
        </p>
      </div>

      <ul className="space-y-4">
        {children.map((child) => (
          <li
            key={child.childId}
            className="rounded-lg border border-gray-100 bg-gray-50 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-gray-900">{child.name}</span>
              <span
                className={
                  child.allowed
                    ? "rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800"
                    : "rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-700"
                }
              >
                {child.allowed ? "Aide IA active" : "Aide IA désactivée"}
              </span>
            </div>

            <p className="mt-1 text-xs text-gray-500">
              {child.parentDecision === false
                ? "Vous avez refusé."
                : child.parentDecision === true
                  ? "Vous avez autorisé."
                  : child.schoolDeclaredAt !== null
                    ? `Autorisé par ${child.schoolName ?? "l'école"}.`
                    : child.onGrace
                      ? `Aucune déclaration : l'aide IA s'arrêtera le ${new Date(child.graceEndsAt).toLocaleDateString("fr-FR")} si rien ne change.`
                      : "Aucune déclaration : l'aide IA est arrêtée."}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ["granted", "Autoriser"],
                  ["unset", "M'en remettre à l'école"],
                  ["refused", "Refuser"],
                ] as const
              ).map(([decision, label]) => {
                const current =
                  child.parentDecision === true
                    ? "granted"
                    : child.parentDecision === false
                      ? "refused"
                      : "unset";
                const active = current === decision;
                return (
                  <button
                    key={decision}
                    type="button"
                    disabled={busyId === child.childId || active}
                    onClick={() => {
                      setBusyId(child.childId);
                      void setConsent({ childId: child.childId, decision })
                        .catch(() => {})
                        .finally(() => setBusyId(null));
                    }}
                    className={
                      active
                        ? "rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white"
                        : "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
