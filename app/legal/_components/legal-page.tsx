import Link from "next/link";

import { Brand } from "@/components/landing/brand";
import { CONTACT_EMAIL } from "@/lib/brand";

/**
 * LA CHARPENTE COMMUNE DES PAGES LÉGALES — tâches 6.2 et 6.3.
 *
 * Le dossier `_components` commence par un tiret bas : Next.js le tient donc
 * hors du routage, et ce fichier n'est pas une page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI L'EXTRAIRE PLUTÔT QUE DE LA RECOPIER.
 *
 * La politique de confidentialité portait cette mise en page pour elle seule.
 * Trois pages de plus la voulaient à l'identique — protection des mineurs,
 * cookies, accessibilité. Quatre copies d'un en-tête, c'est quatre endroits où
 * corriger le jour où la marque change, et trois occasions d'oublier.
 *
 * Ce qui est partagé est la CHARPENTE, pas le texte : chaque page écrit le
 * sien, parce qu'une page légale qui ressemble à un gabarit rempli se lit
 * comme un gabarit rempli.
 *
 * `Brand` porte DÉJÀ son propre lien vers l'accueil : l'envelopper dans un
 * second produirait un lien imbriqué, que le HTML interdit.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-lime-50">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        <header className="mb-10 text-center">
          <Brand size="lg" priority className="mx-auto origin-center" />
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">
            {title}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Dernière mise à jour : {updated}
          </p>
        </header>

        <article className="space-y-8 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-10">
          {children}
        </article>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
          <Link
            href="/legal/confidentialite"
            className="font-medium text-amber-700 hover:underline"
          >
            Confidentialité
          </Link>
          <Link
            href="/legal/mineurs"
            className="font-medium text-amber-700 hover:underline"
          >
            Protection des mineurs
          </Link>
          <Link
            href="/legal/cookies"
            className="font-medium text-amber-700 hover:underline"
          >
            Cookies
          </Link>
          <Link
            href="/legal/accessibilite"
            className="font-medium text-amber-700 hover:underline"
          >
            Accessibilité
          </Link>
          <Link href="/" className="font-medium text-gray-500 hover:underline">
            Accueil
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-gray-700">
        {children}
      </div>
    </section>
  );
}

export function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-gray-900">{children}</strong>;
}

/** L'encadré d'aveu : ce que la page NE garantit pas. */
export function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-gray-700">
      {children}
    </p>
  );
}

/**
 * L'adresse que les quatre pages affichent.
 *
 * ELLE ÉTAIT ÉCRITE EN DUR ICI, ET ELLE ÉTAIT FAUSSE : `jotna.school`,
 * un domaine dont rien n'atteste la possession, pendant que le pied de
 * page du site donnait `jotnaschool.com`. Une politique qui promet un
 * droit de suppression et donne une adresse morte ne vaut rien.
 */
export const CONTACT = CONTACT_EMAIL;
