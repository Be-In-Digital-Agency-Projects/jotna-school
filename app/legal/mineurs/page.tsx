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
 * PROTECTION DES MINEURS — tâche 6.3.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * C'EST LA PAGE QU'UN PARENT CHERCHE APRÈS AVOIR LU LA POLITIQUE.
 *
 * Elle était liée depuis le pied de page du site — `/legal/mineurs` — et
 * n'existait pas. Sur un produit dont TOUS les utilisateurs finaux ont entre
 * six et onze ans, c'était le lien mort le plus gênant des six.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ELLE NE PROMET RIEN QUE LE CODE NE TIENNE.
 *
 * Chaque affirmation ci-dessous a été vérifiée pendant l'audit *Kids Category*
 * (`docs/legal/kids-category.md`), et trois d'entre elles sont des constats de
 * `grep`, pas des intentions :
 *
 *   • aucun SDK publicitaire ni analytics — zéro occurrence dans tout le dépôt ;
 *   • aucun lien sortant dans l'application mobile — donc aucune barrière
 *     parentale à construire, parce qu'il n'y a rien à barrer ;
 *   • aucun achat, aucun prix, aucun lien vers un paiement (décision D7).
 *
 * Ce qui n'est PAS tenu est écrit aussi, en bas. Une page de protection des
 * mineurs qui ne dit que du bien d'elle-même n'est pas crédible, et le premier
 * parent qui trouve l'angle mort cesse de croire le reste.
 */
export const metadata: Metadata = {
  title: "Protection des mineurs — Jotna School",
  description:
    "Ce que nous faisons pour que Jotna School soit sûr pour un enfant de six à onze ans, et ce que nous ne faisons pas encore.",
};

const UPDATED = "26 septembre 2026";

export default function MinorsPage() {
  return (
    <LegalPage title="Protection des mineurs" updated={UPDATED}>
      <Section title="À qui s'adresse Jotna School">
        <p>
          Tous les utilisateurs finaux de l&apos;application élève sont des
          enfants scolarisés du CI au CM2, soit environ{" "}
          <Strong>six à onze ans</Strong>. Ce n&apos;est pas une application
          grand public à laquelle des enfants accèdent : c&apos;est une
          application d&apos;enfants, et tout y a été décidé dans cet ordre-là.
        </p>
      </Section>

      <Section title="Ce que l'application ne contient pas">
        <List
          items={[
            <>
              <Strong>Aucune publicité</Strong>, d&apos;aucune sorte. Il
              n&apos;y a aucun outil publicitaire installé dans
              l&apos;application.
            </>,
            <>
              <Term>Aucun outil de mesure d&apos;audience</Term>et aucun
              pisteur. L&apos;application ne collecte aucun identifiant
              publicitaire et ne demande jamais l&apos;autorisation de suivi.
            </>,
            <>
              <Term>Aucun lien vers l&apos;extérieur.</Term>Il n&apos;y a pas un
              seul lien sortant dans l&apos;application élève : un enfant ne
              peut pas en sortir vers un navigateur, une boutique ou un réseau
              social.
            </>,
            <>
              <Term>Aucun achat.</Term>Ni prix affiché, ni abonnement, ni bouton
              menant à un paiement. Les établissements paient hors de
              l&apos;application.
            </>,
            <>
              <Term>Aucune communication entre utilisateurs.</Term>Pas de
              messagerie, pas de commentaire, pas de profil public, pas de photo
              de profil, pas de pseudonyme visible par d&apos;autres.
            </>,
            <>
              <Term>Aucun accès aux capteurs.</Term>Ni appareil photo, ni
              microphone, ni position.
            </>,
          ]}
        />
      </Section>

      <Section title="Comment un enfant entre">
        <p>
          L&apos;enfant ne crée pas de compte et ne saisit aucune donnée
          personnelle : il entre avec un <Term>code imprimé</Term>que son école
          lui remet. Ce code sert d&apos;identifiant — il n&apos;y a ni adresse
          électronique, ni mot de passe à inventer, ni question de sécurité.
        </p>
        <p>
          Sur une tablette partagée, « changer d&apos;élève » referme la session
          de l&apos;enfant précédent avant d&apos;en ouvrir une autre. Le
          travail du premier est transmis ou conservé pour plus tard ; il
          n&apos;est jamais attribué au suivant.
        </p>
      </Section>

      <Section title="L'intelligence artificielle">
        <p>
          Deux fonctions font appel à une IA : expliquer une erreur, et proposer
          des exercices adaptés après plusieurs échecs. Elles envoient le
          travail de l&apos;enfant à un prestataire situé hors du Sénégal —
          jamais son nom, ni son école, ni son code.
        </p>
        <p>
          <Strong>Rien n&apos;est envoyé sans consentement.</Strong>{" "}
          L&apos;établissement déclare détenir l&apos;autorisation des
          représentants légaux, et un parent rattaché à l&apos;élève peut
          refuser pour son enfant depuis ses réglages. Son refus s&apos;applique
          immédiatement et l&apos;emporte sur la déclaration de l&apos;école.
          Sans consentement, ces deux fonctions sont simplement indisponibles ;
          tout le reste continue de marcher.
        </p>
      </Section>

      <Section title="Le contenu">
        <p>
          Les exercices suivent le programme de l&apos;enseignement primaire
          sénégalais. Une partie est produite avec l&apos;aide d&apos;une IA à
          partir de ce programme, puis relue avant d&apos;être publiée : aucun
          contenu n&apos;arrive devant un enfant sans être passé par cette
          relecture.
        </p>
        <p>
          Les messages adressés à l&apos;enfant sont écrits pour ne jamais le
          dévaloriser. Un palier échoué dit « on va réessayer ensemble », un
          jour sans travail n&apos;est jamais « perdu » ni « raté ».
        </p>
      </Section>

      <Section title="Signaler un problème">
        <p>
          Si vous constatez un contenu inapproprié, un comportement inattendu de
          l&apos;application, ou quoi que ce soit qui vous inquiète pour votre
          enfant, écrivez à{" "}
          <a
            className="font-medium text-amber-700 hover:underline"
            href={`mailto:${CONTACT}`}
          >
            {CONTACT}
          </a>
          . Si l&apos;enfant est scolarisé, prévenez également son établissement
          : c&apos;est lui qui a ouvert l&apos;accès.
        </p>
      </Section>

      <Section title="Ce que nous ne faisons pas encore">
        <p>Deux points méritent d&apos;être connus plutôt que découverts :</p>
        <List
          items={[
            <>
              <Strong>
                La suppression des données ne s&apos;exerce que par écrit.
              </Strong>{" "}
              Il n&apos;existe pas de bouton dans l&apos;application. Écrivez à
              l&apos;adresse ci-dessus, ou passez par l&apos;établissement.
            </>,
            <>
              <Strong>
                Le contrôle du temps d&apos;écran n&apos;est pas dans
                l&apos;application.
              </Strong>{" "}
              Nous n&apos;imposons aucune limite de durée. Utilisez les réglages
              de temps d&apos;écran de l&apos;appareil, qui sont plus fiables
              que ce que nous pourrions construire.
            </>,
          ]}
        />
      </Section>

      <Caveat>
        Cette page décrit fidèlement le fonctionnement du logiciel au {UPDATED}.
        Elle ne constitue pas un avis juridique.
      </Caveat>
    </LegalPage>
  );
}
