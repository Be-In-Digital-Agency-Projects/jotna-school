import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/landing/brand";

/**
 * LA POLITIQUE DE CONFIDENTIALITÉ — tâche 6.2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ELLE EST UNE PAGE PUBLIQUE, ET CE N'EST PAS UN DÉTAIL DE MISE EN PAGE.
 *
 * Apple et Google exigent une URL ATTEIGNABLE SANS COMPTE, vérifiée par un
 * humain pendant la revue. Un document rangé dans `docs/` ne peut pas être
 * soumis. Cette route vit donc hors des groupes `(admin)`, `(parent)`,
 * `(student)` et `(teacher)`, qui portent chacun leur garde d'accès.
 *
 * SON CHEMIN N'EST PAS CHOISI, IL EST IMPOSÉ PAR L'EXISTANT.
 * `components/landing/footer.tsx` pointe vers `/legal/confidentialite` depuis
 * le premier jour — vers une route qui n'existait pas. Le pied de page du
 * site public annonçait donc une politique de confidentialité et rendait un
 * 404, ce que le premier relecteur de boutique aurait vu. Cinq autres liens
 * du même bloc sont encore morts (`mentions`, `cgu`, `cookies`, `mineurs`,
 * `accessibilite`) : ils demandent des informations d'entreprise et une
 * relecture juridique, et ne s'inventent pas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CHAQUE PHRASE A ÉTÉ VÉRIFIÉE DANS LE CODE, PAS RECOPIÉE D'UN MODÈLE.
 *
 * Une politique générique est le pire des deux mondes : elle promet des
 * choses que le produit ne fait pas, et tait celles qu'il fait. Les faits
 * ci-dessous viennent de `convex/schema.ts`, des trois chemins IA de
 * `convex/aiConsentRules.ts`, et du stockage local décrit au §3 du plan
 * mobile. Deux d'entre eux sont inhabituels et méritent d'être dits en toutes
 * lettres :
 *
 *   • L'élève inscrit par son école n'a NI adresse électronique, NI téléphone,
 *     NI photo. Son identifiant de connexion est le code imprimé sur son
 *     billet (`cm1a-4821`), pas une adresse.
 *   • Des données d'exercice RÉSIDENT SUR L'APPAREIL — c'est le hors-ligne du
 *     §3 —, y compris les réponses de l'enfant tant qu'elles n'ont pas été
 *     envoyées. Le formulaire *Data safety* de Google pose la question ; la
 *     taire serait une déclaration fausse.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE PAGE N'EST PAS : un avis juridique. Elle décrit fidèlement ce
 * que le logiciel fait. Sa conformité à la Loi 2008-12 et aux exigences des
 * boutiques doit être relue par quelqu'un dont c'est le métier avant la
 * soumission — c'est écrit à la fin, pour le lecteur comme pour l'éditeur.
 */
export const metadata: Metadata = {
  title: "Politique de confidentialité — Jotna School",
  description:
    "Ce que Jotna School collecte, ce qui reste sur l'appareil, ce qui ne sort jamais, et comment exercer vos droits.",
};

const UPDATED = "26 septembre 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-lime-50">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        <header className="mb-10 text-center">
          {/* `Brand` porte DÉJÀ son propre `Link` vers l'accueil (voir
              `components/landing/brand.tsx`) : l'envelopper dans un second
              produisait un lien imbriqué, que le HTML interdit. */}
          <Brand size="lg" priority className="mx-auto origin-center" />
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">
            Politique de confidentialité
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Dernière mise à jour : {UPDATED}
          </p>
        </header>

        <article className="space-y-8 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-10">
          <Section title="En une page">
            <p>
              Jotna School est une application scolaire destinée à des enfants
              de 6 à 11 ans. Nous en avons écrit le fonctionnement de la
              manière la plus économe possible : un élève inscrit par son école
              n&apos;a <Strong>ni adresse électronique, ni numéro de téléphone,
              ni photo</Strong> chez nous. Il n&apos;y a{" "}
              <Strong>aucune publicité</Strong>, <Strong>aucun outil de mesure
              d&apos;audience</Strong> et <Strong>aucun pisteur</Strong>, ni
              dans l&apos;application mobile, ni sur le site.
            </p>
          </Section>

          <Section title="Qui est responsable du traitement">
            <p>
              Jotna School, éditeur de la plateforme. Pour toute question ou
              pour exercer vos droits :{" "}
              <a
                className="font-medium text-amber-700 hover:underline"
                href="mailto:contact@jotna.school"
              >
                contact@jotna.school
              </a>
              .
            </p>
            <p>
              Lorsque l&apos;élève est inscrit par un établissement, celui-ci
              détermine l&apos;usage scolaire qui est fait de la plateforme et
              reste votre premier interlocuteur.
            </p>
          </Section>

          <Section title="Ce que nous collectons">
            <p>Pour un élève inscrit par son école :</p>
            <List
              items={[
                "son prénom et son nom, tels que l'école les a saisis ;",
                "sa classe et son établissement ;",
                "son code de connexion — c'est lui qui sert d'identifiant, et non une adresse électronique ;",
                "ses réponses aux exercices, le nombre d'essais, les indices utilisés et le temps passé ;",
                "sa progression : paliers validés, étoiles, badges, série de jours.",
              ]}
            />
            <p>
              Pour un parent ou un membre du personnel, qui crée lui-même son
              compte : son nom, son adresse électronique, et ses préférences
              d&apos;envoi de courriels.
            </p>
            <p className="rounded-lg bg-gray-50 p-4 text-sm">
              Nous ne collectons <Strong>pas</Strong> de données de
              localisation, pas de contacts, pas de photographies, pas
              d&apos;identifiant publicitaire, et l&apos;application mobile ne
              demande l&apos;accès à <Strong>aucun capteur</Strong> — ni
              appareil photo, ni microphone, ni position.
            </p>
          </Section>

          <Section title="Ce qui reste sur l'appareil">
            <p>
              L&apos;application mobile permet de jouer{" "}
              <Strong>sans connexion</Strong>. Pour cela, elle enregistre sur
              l&apos;appareil :
            </p>
            <List
              items={[
                "les exercices préparés à l'avance, avec leurs indices — jamais le corrigé, qui ne quitte pas nos serveurs ;",
                "les réponses données hors connexion, tant qu'elles n'ont pas pu être envoyées ;",
                "le jeton de connexion de l'élève, dans le coffre sécurisé du système (Trousseau iOS, Keystore Android) ;",
                "le préfixe de classe, pour éviter de le retaper.",
              ]}
            />
            <p>
              Les exercices préparés <Strong>s&apos;effacent au bout de
              quatorze jours</Strong>, ou plus tôt si l&apos;abonnement de
              l&apos;école s&apos;arrête. Les réponses non envoyées, elles, ne
              s&apos;effacent jamais tant qu&apos;elles n&apos;ont pas été
              transmises : c&apos;est du travail d&apos;enfant, et nous avons
              choisi de ne pas le jeter. « Changer d&apos;élève » efface ce qui
              a déjà été transmis et laisse le reste partir plus tard.
            </p>
            <p>
              Désinstaller l&apos;application efface tout ce qui se trouve sur
              l&apos;appareil, y compris les réponses qui n&apos;auraient pas
              encore été envoyées.
            </p>
          </Section>

          <Section title="L'aide par intelligence artificielle">
            <p>
              Pour expliquer une erreur ou proposer des exercices adaptés, le
              travail de l&apos;élève — sa réponse, ou ses réponses fausses sur
              un exercice — est envoyé à notre prestataire d&apos;IA{" "}
              <Strong>OpenAI</Strong>, dont les serveurs se situent hors du
              Sénégal. Rien n&apos;est envoyé sous le nom de l&apos;enfant :
              nous ne transmettons ni son nom, ni son école, ni son code.
            </p>
            <p>
              <Strong>
                Cet envoi n&apos;a lieu que si le consentement a été recueilli.
              </Strong>{" "}
              L&apos;établissement déclare détenir l&apos;autorisation des
              représentants légaux ; un parent rattaché à l&apos;élève peut
              refuser pour son enfant depuis ses réglages, et son refus
              s&apos;applique immédiatement et l&apos;emporte sur la
              déclaration de l&apos;école. Sans consentement, l&apos;aide par
              IA est simplement indisponible : tout le reste de
              l&apos;application continue de fonctionner.
            </p>
          </Section>

          <Section title="Qui d'autre voit ces données">
            <p>Nous ne vendons aucune donnée et n&apos;en louons aucune.</p>
            <List
              items={[
                "L'école de l'élève : ses professeurs et sa direction voient sa progression, ce qui est l'objet même du service.",
                "Le parent rattaché : la progression de son enfant.",
                "OpenAI : uniquement le travail décrit ci-dessus, uniquement avec le consentement recueilli.",
                "Convex : l'hébergeur de notre base de données et de nos fonctions serveur.",
                "Resend : l'envoi des courriels aux adultes — jamais aux enfants, qui n'ont pas d'adresse.",
                "PayDunya et Bictorys : le paiement des abonnements par les écoles. Aucune donnée d'élève ne leur est transmise.",
              ]}
            />
          </Section>

          <Section title="Combien de temps nous les gardons">
            <p>
              Les données de progression d&apos;un élève sont conservées tant
              que son école l&apos;a inscrit, puis pendant la durée nécessaire
              à l&apos;établissement du bilan de l&apos;année scolaire. Un
              compte de parent ou de personnel est conservé tant qu&apos;il est
              actif.
            </p>
          </Section>

          <Section title="Vos droits">
            <p>
              Conformément à la loi sénégalaise n° 2008-12 du 25 janvier 2008
              sur la protection des données à caractère personnel, vous pouvez
              demander l&apos;accès aux données concernant votre enfant, leur
              rectification, leur effacement, ou vous opposer à un traitement.
              Écrivez à{" "}
              <a
                className="font-medium text-amber-700 hover:underline"
                href="mailto:contact@jotna.school"
              >
                contact@jotna.school
              </a>
              . Si l&apos;élève est inscrit par un établissement, adressez-vous
              d&apos;abord à celui-ci : c&apos;est lui qui a saisi son
              inscription.
            </p>
            <p>
              Vous pouvez également saisir la Commission de protection des
              données personnelles (CDP) du Sénégal.
            </p>
          </Section>

          <Section title="Les enfants">
            <p>
              L&apos;application destinée aux élèves ne permet{" "}
              <Strong>pas de créer un compte</Strong> : les codes de connexion
              sont produits par l&apos;établissement. Elle ne contient{" "}
              <Strong>aucun lien vers l&apos;extérieur</Strong>, aucun achat,
              aucun message entre utilisateurs, et aucune publicité.
            </p>
          </Section>

          <Section title="Modifications">
            <p>
              Toute modification de cette politique sera publiée sur cette page,
              avec sa date. Un changement qui élargirait l&apos;usage des
              données des enfants sera porté à la connaissance des écoles et
              des parents rattachés avant d&apos;entrer en vigueur.
            </p>
          </Section>

          <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-gray-700">
            Ce document décrit fidèlement le fonctionnement du logiciel. Il ne
            constitue pas un avis juridique et doit être relu par un conseil
            avant toute soumission aux boutiques d&apos;applications.
          </p>
        </article>

        <div className="mt-8 text-center">
          <Link
            href="/"
            className="text-sm font-medium text-amber-700 hover:underline"
          >
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({
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

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-gray-900">{children}</strong>;
}
