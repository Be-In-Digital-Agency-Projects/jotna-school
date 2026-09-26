import type { Metadata } from "next";

import {
  CONTACT,
  Caveat,
  LegalPage,
  List,
  Section,
  Strong,
  Term,
} from "../_components/legal-page";

/**
 * COOKIES ET STOCKAGE LOCAL — tâche 6.2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CETTE PAGE EST COURTE PARCE QUE LA RÉALITÉ EST COURTE.
 *
 * Le dépôt a été inspecté plutôt que décrit de mémoire. Résultat :
 *
 *   • UN SEUL cookie est écrit par le site — `sidebar_state`, posé par le
 *     composant de barre latérale (`components/ui/sidebar.tsx`), durée sept
 *     jours. Il retient si le panneau d'administration est ouvert ou replié.
 *   • Le jeton de connexion N'EST PAS un cookie : `@convex-dev/auth/react` le
 *     range dans le `localStorage` du navigateur (et `lib/auth.ts` le retire
 *     de là à la déconnexion).
 *   • Le reste du stockage local sert à la préférence de son et aux
 *     statistiques d'une séance en cours.
 *   • AUCUN cookie de mesure d'audience ni de publicité — cohérent avec le
 *     constat de l'audit : zéro outil d'analytics dans tout le dépôt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA CONSÉQUENCE JURIDIQUE EST DITE, PAS SUGGÉRÉE. Un stockage strictement
 * nécessaire au service ne demande pas de consentement préalable, et c'est
 * pour cela qu'il n'y a pas de bandeau. Écrire la conclusion sans montrer
 * l'inventaire qui la fonde serait exactement ce que font les pages cookies
 * qu'on ne lit pas.
 */
export const metadata: Metadata = {
  title: "Cookies — Jotna School",
  description:
    "Un seul cookie, aucun traceur : l'inventaire complet de ce que Jotna School range dans votre navigateur.",
};

const UPDATED = "26 septembre 2026";

export default function CookiesPage() {
  return (
    <LegalPage title="Cookies et stockage local" updated={UPDATED}>
      <Section title="En une phrase">
        <p>
          Jotna School écrit <Strong>un seul cookie</Strong>, purement
          technique, et{" "}
          <Strong>
            aucun cookie de mesure d&apos;audience ou de publicité
          </Strong>
          . C&apos;est pourquoi vous ne voyez pas de bandeau de consentement :
          il n&apos;y a rien à vous faire accepter.
        </p>
      </Section>

      <Section title="Le cookie">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-900">
                <th className="py-2 pr-4 font-semibold">Nom</th>
                <th className="py-2 pr-4 font-semibold">À quoi il sert</th>
                <th className="py-2 font-semibold">Durée</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-mono text-xs">sidebar_state</td>
                <td className="py-2 pr-4">
                  Retenir si le menu latéral est déplié ou replié, dans les
                  espaces d&apos;administration et d&apos;enseignement.
                </td>
                <td className="py-2">7 jours</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Il ne contient ni identifiant, ni donnée personnelle : une seule
          valeur, ouvert ou replié.
        </p>
      </Section>

      <Section title="Ce qui est rangé dans le navigateur, sans être un cookie">
        <p>
          Trois choses vivent dans le stockage local de votre navigateur. Elles
          ne voyagent jamais vers nos serveurs à chaque requête, contrairement à
          un cookie, et ne servent qu&apos;à vous :
        </p>
        <List
          items={[
            <>
              <Strong>Votre jeton de connexion</Strong>, qui vous évite de
              ressaisir vos identifiants à chaque page. Il disparaît à la
              déconnexion.
            </>,
            <>
              <Term>La préférence de son</Term>de l&apos;espace élève, et le
              fait qu&apos;on vous ait déjà posé la question.
            </>,
            <>
              <Strong>Les statistiques de la séance en cours</Strong>, le temps
              d&apos;afficher l&apos;écran de fin d&apos;une thématique.
            </>,
          ]}
        />
      </Section>

      <Section title="Et dans l'application mobile ?">
        <p>
          Il n&apos;y a pas de cookie : une application n&apos;en utilise pas.
          Ce qu&apos;elle range sur l&apos;appareil — le jeton de connexion dans
          le coffre du système, les exercices préparés pour jouer sans réseau,
          les réponses pas encore envoyées — est décrit dans la{" "}
          <a
            className="font-medium text-amber-700 hover:underline"
            href="/legal/confidentialite"
          >
            politique de confidentialité
          </a>
          .
        </p>
      </Section>

      <Section title="Refuser ou effacer">
        <p>
          Vous pouvez effacer ou bloquer les cookies depuis les réglages de
          votre navigateur. Bloquer{" "}
          <span className="font-mono text-xs">sidebar_state</span>{" "}
          n&apos;empêche rien : le menu s&apos;ouvrira simplement dans son état
          par défaut à chaque visite.
        </p>
        <p>
          Effacer le stockage local vous déconnectera, et c&apos;est tout ce que
          cela fera. Aucune progression n&apos;y est conservée : tout ce qui
          compte vit sur nos serveurs.
        </p>
        <p>
          Une question ?{" "}
          <a
            className="font-medium text-amber-700 hover:underline"
            href={`mailto:${CONTACT}`}
          >
            {CONTACT}
          </a>
        </p>
      </Section>

      <Caveat>
        Cet inventaire est celui du {UPDATED}. Tout ajout d&apos;un outil de
        mesure d&apos;audience rendrait cette page fausse et imposerait un
        recueil de consentement : c&apos;est l&apos;une des raisons pour
        lesquelles il n&apos;y en a aucun.
      </Caveat>
    </LegalPage>
  );
}
