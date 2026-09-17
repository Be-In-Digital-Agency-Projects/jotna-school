"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useQuery } from "convex/react";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { refusalMessage } from "@/lib/refusalMessage";

/**
 * L'activation d'un compte créé par une école.
 *
 * ELLE REMPLACE L'INSCRIPTION LIBRE. Personne ne crée son compte : l'école le
 * crée, remet un identifiant et un code, et cette page ne fait qu'y poser un
 * mot de passe. Le serveur refuse désormais toute inscription — voir
 * `convex/roleRules.decideProfileRole` — donc cette page est le seul chemin
 * d'entrée d'un nouvel arrivant.
 *
 * LE CODE EST CONFIRMÉ AVANT LE MOT DE PASSE, par `previewActivation` : la
 * personne lit son propre nom avant de choisir un secret. Sans cela, une faute
 * de recopie ne se verrait qu'après avoir tout saisi, et rien ne dirait si le
 * code appartenait à quelqu'un d'autre.
 */
function ActivationForm() {
  // LE CODE ARRIVE PAR L'URL QUAND LA PERSONNE CLIQUE DANS SON E-MAIL.
  // `schoolAccountsEmail` envoie `/activation?code=XXXXXXXX` : ne pas le lire
  // ici obligeait à recopier à la main un code que le lien portait déjà, et
  // transformait un clic en dictée de huit caractères.
  const params = useSearchParams();
  const fromUrl = params.get("code");

  const [code, setCode] = useState(fromUrl ?? "");
  // Le code de l'URL est soumis d'emblée : un lien cliqué est une intention,
  // pas un brouillon. La personne voit son nom sans avoir rien tapé.
  const [submittedCode, setSubmittedCode] = useState<string | null>(
    fromUrl ? fromUrl.trim() : null,
  );
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { signIn } = useAuthActions();
  const activate = useAction(api.schoolAccounts.activateAccount);
  const preview = useQuery(
    api.schoolAccounts.previewActivation,
    submittedCode ? { code: submittedCode } : "skip",
  );

  function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmittedCode(code.trim());
  }

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    if (!submittedCode) return;
    setError(null);
    setLoading(true);
    try {
      const { loginId } = await activate({
        code: submittedCode,
        password,
        confirmation,
      });
      // On enchaîne la connexion pour la personne : elle vient de choisir son
      // mot de passe, lui redemander son identifiant serait lui faire relire un
      // billet qu'elle a déjà rangé.
      await signIn("password", {
        email: loginId,
        password,
        flow: "signIn",
      });
      window.location.href = "/post-auth";
    } catch (err: unknown) {
      // Même raison que dans l'espace direction : le message du client Convex
      // porte la trace de pile, le texte écrit par le serveur voyage dans
      // `data`. Le lecteur est ici un parent qui tient un papier.
      setError(refusalMessage(err, "Activation impossible. Réessayez."));
    } finally {
      setLoading(false);
    }
  }

  const previewError =
    preview && "error" in preview ? preview.error : null;
  const identity = preview && "name" in preview ? preview : null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-center mb-2">Activer mon compte</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      {!identity && (
        <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            Votre école vous a remis un code d&apos;activation, par e-mail ou sur
            un papier. Saisissez-le pour choisir votre mot de passe.
          </p>

          <div>
            <label className="block text-sm font-medium mb-1">
              Code d&apos;activation
            </label>
            <input
              type="text"
              required
              autoCapitalize="characters"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ex : 4C7K2MQR"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {previewError && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-lg text-sm">
              {previewError}
            </div>
          )}

          <button
            type="submit"
            disabled={preview === undefined && submittedCode !== null}
            className="w-full bg-amber-600 text-white py-2 rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-60"
          >
            {preview === undefined && submittedCode !== null ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Vérification…
              </span>
            ) : (
              "Continuer"
            )}
          </button>
        </form>
      )}

      {identity && (
        <form onSubmit={handleActivate} className="flex flex-col gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm">
            <p className="font-semibold text-green-900">
              Bonjour {identity.name}
            </p>
            <p className="text-green-800">
              Votre compte {identity.role} est prêt. Votre identifiant de
              connexion est{" "}
              <span className="font-mono font-semibold">
                {identity.loginId}
              </span>
              .
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Choisissez votre mot de passe
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
                aria-label={
                  showPassword
                    ? "Masquer le mot de passe"
                    : "Afficher le mot de passe"
                }
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Six caractères au minimum.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Confirmez le mot de passe
            </label>
            <input
              type={showPassword ? "text" : "password"}
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber-600 text-white py-2 rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-60"
          >
            {loading ? "Activation…" : "Activer et me connecter"}
          </button>
        </form>
      )}

      <p className="text-center text-sm text-gray-600">
        Votre compte est déjà actif ?{" "}
        <Link href="/login" className="text-amber-700 font-semibold">
          Se connecter
        </Link>
      </p>
    </div>
  );
}

/**
 * `useSearchParams` impose une frontière de suspension en App Router : sans
 * elle, la page entière serait rendue côté client à chaque visite.
 */
export default function ActivationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      }
    >
      <ActivationForm />
    </Suspense>
  );
}
