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
 * DÉCLARATION D'ACCESSIBILITÉ — tâche 5.4, publiée en 6.2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ELLE DIT CE QUI A ÉTÉ AUDITÉ **ET CE QUI NE L'A PAS ÉTÉ**.
 *
 * C'est la seule manière d'écrire une déclaration d'accessibilité qui serve à
 * quelque chose. Une page qui affirme « notre site est accessible » sans dire
 * comment elle le sait est un communiqué, pas une déclaration — et la première
 * personne qui bute sur un obstacle cesse de croire le reste.
 *
 * L'ÉTAT RÉEL, au moment où cette page est écrite :
 *
 *   • L'application MOBILE a reçu une passe d'accessibilité complète
 *     (tâche 5.4) : cibles tactiles auditées une à une, mouvement réduit
 *     respecté, mise à l'échelle des polices sans plafond sauf sur les
 *     glyphes enfermés dans une boîte fixe.
 *   • Cette passe a été faite EN LISANT LE CODE. **Aucun écran n'a jamais été
 *     rendu sur un appareil**, et aucun lecteur d'écran n'a été essayé. Le
 *     protocole existe (`2026-09-26-protocole-terrain-mobile.md`, §4) et
 *     attend un appareil.
 *   • Le SITE WEB n'a PAS reçu d'audit équivalent.
 *
 * Tout cela est écrit ci-dessous, en clair. Une déclaration honnête vaut mieux
 * qu'une déclaration flatteuse, y compris pour l'éditeur : elle dit à la
 * prochaine personne où travailler.
 */
export const metadata: Metadata = {
  title: "Accessibilité — Jotna School",
  description:
    "Ce qui a été fait pour l'accessibilité de Jotna School, comment nous le savons, et ce qui n'a pas encore été vérifié.",
};

const UPDATED = "26 septembre 2026";

export default function AccessibilityPage() {
  return (
    <LegalPage title="Déclaration d'accessibilité" updated={UPDATED}>
      <Section title="Notre engagement">
        <p>
          Jotna School s&apos;adresse à des enfants de six à onze ans, souvent
          sur une tablette d&apos;école posée à plat sur une table, parfois à
          côté d&apos;un adulte qui les aide. L&apos;accessibilité n&apos;est
          donc pas une case à cocher : c&apos;est la condition pour que
          l&apos;application soit utilisable dans ses conditions réelles.
        </p>
      </Section>

      <Section title="Ce qui a été fait — application mobile">
        <List
          items={[
            <>
              <Strong>Cibles tactiles d&apos;au moins 48 points</Strong>,
              auditées une par une. Un doigt de huit ans n&apos;est pas plus
              précis que celui d&apos;un adulte.
            </>,
            <>
              <Term>Mouvement réduit respecté.</Term>Si le système l&apos;a
              demandé, les animations de récompense ne se jouent pas du tout —
              ce n&apos;est pas une préférence esthétique, c&apos;est une gêne
              réelle pour certaines personnes.
            </>,
            <>
              <Term>Agrandissement du texte sans plafond.</Term>Tout ce qui se
              lit suit le réglage de taille de police du système. Seuls quelques
              glyphes décoratifs enfermés dans une forme de taille fixe —
              l&apos;emoji d&apos;une matière dans sa pastille, les initiales
              dans l&apos;avatar — sont plafonnés, sans quoi ils débordent.
            </>,
            <>
              <Strong>Texte jamais en dessous de 16 points</Strong>, et les
              titres bien au-delà.
            </>,
            <>
              <Term>Libellés pour les lecteurs d&apos;écran</Term>sur les
              éléments interactifs et sur les repères visuels — les pastilles de
              paliers, les jours de la série, les badges.
            </>,
            <>
              <Term>Retours non exclusivement sonores.</Term>Une bonne réponse
              se voit autant qu&apos;elle s&apos;entend, et les sons peuvent
              être coupés.
            </>,
          ]}
        />
      </Section>

      <Section title="Comment nous le savons — et ce que cela ne prouve pas">
        <p>
          Ces points ont été établis <Strong>en lisant le code</Strong>, élément
          par élément. C&apos;est une méthode fiable pour une taille de cible ou
          un réglage respecté, et elle ne prouve rien sur le rendu.
        </p>
        <p>
          <Strong>
            Aucun écran de l&apos;application mobile n&apos;a encore été affiché
            sur un appareil réel.
          </Strong>{" "}
          Aucun lecteur d&apos;écran — TalkBack, VoiceOver — n&apos;a été
          essayé, et le comportement à 200 % de taille de police n&apos;a pas
          été observé. Le protocole de vérification est écrit et attend un
          appareil.
        </p>
      </Section>

      <Section title="Ce qui n'a pas été audité — le site web">
        <p>
          Le site web — les espaces parent, professeur et administration —{" "}
          <Strong>n&apos;a pas reçu d&apos;audit d&apos;accessibilité</Strong>.
          Nous ne pouvons donc affirmer ni sa conformité aux WCAG, ni son
          niveau. Ce serait faux de prétendre le contraire, et cela reste à
          faire.
        </p>
      </Section>

      <Section title="Rencontrer un obstacle, le signaler">
        <p>
          Si vous — ou votre enfant — butez sur quelque chose,{" "}
          <Strong>dites-le-nous</Strong> :{" "}
          <a
            className="font-medium text-amber-700 hover:underline"
            href={`mailto:${CONTACT}`}
          >
            {CONTACT}
          </a>
          . Décrivez l&apos;écran, l&apos;appareil et ce que vous attendiez. Un
          signalement précis vaut mieux qu&apos;un audit générique, et nous
          n&apos;avons pas encore les seconds.
        </p>
      </Section>

      <Caveat>
        Cette déclaration décrit un état de fait au {UPDATED}, non une
        certification. Elle sera mise à jour lorsque les vérifications sur
        appareil réel et l&apos;audit du site web auront été menés.
      </Caveat>
    </LegalPage>
  );
}
