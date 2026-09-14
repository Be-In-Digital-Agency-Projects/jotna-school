"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { School, Plus, Loader2, ChevronRight, MapPin } from "lucide-react";

/** Libellés des trois statuts de `schools.status` (convex/schema.ts). */
const STATUS_LABEL: Record<string, string> = {
  prospect: "Prospect",
  active: "Active",
  suspended: "Suspendue",
};

const STATUS_CLASS: Record<string, string> = {
  prospect: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-700",
  suspended: "bg-red-100 text-red-700",
};

export default function SchoolsPage() {
  const schools = useQuery(api.schools.listSchools);
  const createSchool = useMutation(api.schools.createSchool);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [ninea, setNinea] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      // Les champs facultatifs partent en `undefined` quand ils sont vides :
      // une chaîne vide stockée se relit comme une valeur renseignée.
      await createSchool({
        name,
        city: city.trim() || undefined,
        contactName,
        contactEmail,
        contactPhone: contactPhone.trim() || undefined,
        ninea: ninea.trim() || undefined,
      });
      setName("");
      setCity("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setNinea("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la création");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (schools === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <span className="ml-3 text-gray-500">Chargement des écoles...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Écoles</h1>
          <p className="mt-1 text-sm text-gray-500">
            Personnel, classes et inscriptions des écoles partenaires
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Ajouter une école
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Nouvelle école
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="ex: École Cheikh Anta Diop"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ville
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="ex: Dakar"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact
                </label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  required
                  placeholder="ex: Mme Diop, directrice"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email du contact
                </label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  required
                  placeholder="ex: direction@ecole.sn"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Téléphone
                </label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="ex: +221 77 000 00 00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  NINEA
                </label>
                <input
                  type="text"
                  value={ninea}
                  onChange={(e) => setNinea(e.target.value)}
                  placeholder="identifiant fiscal, pour la facture"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Une école est créée au statut « prospect ». Son abonnement se
              gère ailleurs : tant qu&apos;il n&apos;existe pas, les élèves
              inscrits n&apos;ont pas accès à l&apos;application.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Créer
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {schools.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-12 text-center">
          <School className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            Aucune école
          </h3>
          <p className="mt-2 text-sm text-gray-500">
            Commencez par créer une école, puis rattachez-lui son personnel.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {schools.map((school) => (
            <Link
              key={school._id}
              href={`/admin/ecoles/${school._id}`}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-indigo-200"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <School className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{school.name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                    {school.city && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {school.city}
                      </span>
                    )}
                    <span>{school.contactName}</span>
                    <span>{school.contactEmail}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    STATUS_CLASS[school.status] ?? "bg-gray-100 text-gray-700"
                  }`}
                >
                  {STATUS_LABEL[school.status] ?? school.status}
                </span>
                <ChevronRight className="h-5 w-5 text-gray-400" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
