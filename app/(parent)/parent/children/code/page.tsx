"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ticket, UserCircle, CheckCircle } from "lucide-react";
import { refusalMessage } from "@/lib/refusalMessage";

/**
 * Le parent saisit le code imprimé sur le billet remis par l'école.
 *
 * DEUX TEMPS, ET LE PREMIER N'ÉCRIT RIEN. On montre d'abord le prénom de
 * l'enfant que le code désigne, et on attend une confirmation. C'est ce qui
 * rattrape la faute de frappe qui tomberait par malchance sur un code valide
 * d'un autre élève — et rien dans le dépôt ne défait un `studentGuardians`,
 * donc le rattachement est difficilement réversible.
 */
export default function ChildCodePage() {
  const router = useRouter();
  const redeem = useMutation(api.parentLink.redeemCode);

  const [code, setCode] = useState("");
  const [checked, setChecked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery(
    api.parentLink.previewCode,
    checked ? { code: checked } : "skip",
  );

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await redeem({ code: checked });
      router.push("/parent/dashboard");
    } catch (err) {
      setError(refusalMessage(err, "Ce code n'a pas pu être utilisé."));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/parent/children"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Mes enfants
      </Link>

      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Ticket className="h-6 w-6 text-teal-600" />
          Rattacher avec le code de l&apos;école
        </h1>
        <p className="mt-1 text-gray-500">
          L&apos;école vous a remis un billet portant un code. Saisissez-le ici
          pour retrouver votre enfant dans votre espace.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setChecked(code.trim());
        }}
        className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <div>
          <label
            htmlFor="parent-code"
            className="block text-sm font-medium text-gray-700"
          >
            Code du billet
          </label>
          <input
            id="parent-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="PIO-7C4K2M"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-lg tracking-wider uppercase focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            Le code ne contient ni O, ni I, ni zéro — seulement des caractères
            qui ne se confondent pas.
          </p>
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
        >
          Vérifier le code
        </button>
      </form>

      {checked && preview === undefined && (
        <p className="text-sm text-gray-400">Vérification…</p>
      )}

      {checked && preview === null && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Ce code n&apos;existe pas. Vérifiez chaque caractère du billet, ou
          demandez-en un nouveau à l&apos;école.
        </div>
      )}

      {preview?.status === "expired" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Ce code a expiré. L&apos;école peut en imprimer un nouveau.
        </div>
      )}

      {preview?.status === "redeemed" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Ce code a déjà été utilisé. Si c&apos;est un autre adulte de la
          famille, demandez un second billet à l&apos;école.
        </div>
      )}

      {preview?.status === "ready" && (
        <div className="space-y-4 rounded-xl border border-teal-200 bg-teal-50 p-6">
          <div className="flex items-center gap-3">
            <UserCircle className="h-10 w-10 text-teal-600" />
            <div>
              <p className="text-xs text-teal-700">Ce code désigne</p>
              <p className="text-lg font-semibold text-gray-900">
                {preview.name}
              </p>
            </div>
          </div>
          <p className="text-sm text-teal-800">
            Confirmez seulement s&apos;il s&apos;agit bien de votre enfant : ce
            rattachement vous donnera accès à sa progression.
          </p>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            <CheckCircle className="h-4 w-4" />
            {busy ? "Rattachement…" : `Oui, c'est mon enfant`}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
