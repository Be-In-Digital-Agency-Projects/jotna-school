"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { FileText, Clock, CheckCircle2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatFcfa, formatInvoiceDate } from "@/convex/invoiceRules";

/**
 * Les factures de l'école.
 *
 * LES MONTANTS ET LES DATES PASSENT PAR `invoiceRules`, les MÊMES fonctions que
 * le courriel envoyé à l'école. Ce n'est pas une duplication de règle : c'est la
 * même règle appelée deux fois. Un écran qui formaterait les montants à sa façon
 * finirait par afficher « 50000 FCFA » là où la facture dit
 * « 50 000 FCFA », et une école qui rapproche les deux douterait de la
 * bonne.
 *
 * LE MOTIF D'ÉCHEC N'EST AFFICHÉ QUE S'IL ARRIVE, et il n'arrive qu'à
 * l'administration de la plateforme — `invoices.listForSchool` le rend `null` à
 * un directeur. Quand une facture ne part pas, la cause est chez nous : une
 * école ne peut rien y faire, et lire le nom de nos variables d'environnement ne
 * l'aiderait pas.
 */
function FacturesContent() {
  const params = useSearchParams();
  const schoolParam = params.get("school");
  const schools = useQuery(api.schoolAccounts.mySchools);

  const schoolId = (schoolParam ?? schools?.[0]?.schoolId) as
    | Id<"schools">
    | undefined;

  const invoices = useQuery(
    api.invoices.listForSchool,
    schoolId ? { schoolId } : "skip",
  );

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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Factures</h1>
        <p className="text-sm text-gray-600">
          Une facture par tranche réglée. Elle part par e-mail à l&apos;adresse
          de contact de l&apos;école dès que le paiement est constaté.
        </p>
      </div>

      {invoices === undefined && (
        <p className="text-sm text-gray-500">Chargement…</p>
      )}

      {invoices && invoices.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <FileText className="mx-auto h-10 w-10 text-gray-300" />
          <h2 className="mt-3 font-semibold">Aucune facture</h2>
          <p className="mt-2 text-sm text-gray-600">
            La première facture sera émise au règlement de la première tranche
            de votre contrat.
          </p>
        </div>
      )}

      {invoices && invoices.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Numéro</th>
                <th className="px-4 py-3 font-medium">Émise le</th>
                <th className="px-4 py-3 font-medium">Objet</th>
                <th className="px-4 py-3 text-right font-medium">Montant</th>
                <th className="px-4 py-3 font-medium">Envoi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((invoice) => (
                <tr key={invoice.invoiceId}>
                  <td className="px-4 py-3 font-mono font-semibold whitespace-nowrap">
                    {invoice.number}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatInvoiceDate(invoice.issuedAt)}
                  </td>
                  <td className="px-4 py-3">
                    Tranche {invoice.installmentIndex}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                    {formatFcfa(invoice.amountFcfa)}
                  </td>
                  <td className="px-4 py-3">
                    {invoice.delivery === "sent" ? (
                      <span className="inline-flex items-center gap-1.5 text-green-700">
                        <CheckCircle2 className="h-4 w-4" />
                        Envoyée
                        {invoice.sentAt !== null && (
                          <span className="text-gray-500">
                            le {formatInvoiceDate(invoice.sentAt)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-amber-700">
                        <Clock className="h-4 w-4" />
                        En attente
                      </span>
                    )}
                    {invoice.failureReason && (
                      <p className="mt-1 max-w-md text-xs text-red-700">
                        {invoice.failureReason}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invoices && invoices.length > 0 && (
        <p className="text-xs text-gray-500">
          Les factures partent à l&apos;adresse de contact de
          l&apos;école&nbsp;: {invoices[0].recipientEmail}. Pour la changer,
          contactez l&apos;administration de Jotna School.
        </p>
      )}
    </div>
  );
}

export default function DirecteurFacturesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Chargement…</p>}>
      <FacturesContent />
    </Suspense>
  );
}
