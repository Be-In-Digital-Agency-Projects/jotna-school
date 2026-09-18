"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const { signIn } = useAuthActions();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // `email` est le nom du paramètre attendu par le fournisseur Password,
      // pas une promesse sur la forme de la valeur : `convex/auth.ts` ne fait
      // que la normaliser en minuscules. Un identifiant imprimé passe par le
      // même chemin.
      await signIn("password", { email: identifier, password, flow: "signIn" });
      window.location.href = "/post-auth";
    } catch {
      setError("Identifiant ou mot de passe incorrect");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-center mb-2">Se connecter</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/*
        `type="text"` ET NON `type="email"`, ET C'EST UN CORRECTIF. Tous les
        comptes n'ont pas d'adresse : un élève se connecte avec `CM1A-4821`, un
        parent sans e-mail avec `FAM-7C4K2M`. Avec `type="email"`, le navigateur
        refusait lui-même la saisie — « Veuillez inclure "@" dans l'adresse
        e-mail » — et le formulaire ne partait jamais. Ces comptes étaient donc
        créés, imprimés, distribués, et inutilisables.

        `autoCapitalize` et `autoCorrect` sont coupés : un téléphone qui met une
        majuscule ou corrige un code le rend faux, et la personne ne voit pas
        pourquoi.
      */}
      <div>
        <label className="block text-sm font-medium mb-1">
          Identifiant ou e-mail
        </label>
        <input
          type="text"
          required
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="adresse e-mail, ou code reçu de votre école"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1">
          <label className="block text-sm font-medium">Mot de passe</label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-amber-700 hover:underline"
          >
            Mot de passe oublié ?
          </Link>
        </div>
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
            tabIndex={-1}
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gray-900 text-white py-2.5 rounded-lg font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors"
      >
        {loading ? "Connexion..." : "Se connecter"}
      </button>

      <p className="text-center text-sm text-gray-600">
        Pas de compte ?{" "}
        <Link href="/activation" className="font-medium text-amber-700 hover:underline">
          Activer mon compte
        </Link>
      </p>
    </form>
  );
}
