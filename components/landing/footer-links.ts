/**
 * LES LIENS DU PIED DE PAGE — séparés du composant pour être TESTABLES.
 *
 * Ils vivaient dans `footer.tsx`, à côté du balisage, et six d'entre eux
 * pointaient vers des pages qui n'existaient pas : les six liens légaux
 * rendaient un 404. C'est la première chose qu'un relecteur de boutique
 * ouvre — le site annonçait une politique de confidentialité et n'en servait
 * aucune.
 *
 * Quatre ont été écrites depuis. Ce qui manquait n'était pas le texte, c'était
 * le GARDE : rien n'avait signalé les six, et rien n'aurait signalé le
 * septième. Sortir la donnée du composant la rend lisible par un test sans
 * rendre un seul élément React — voir `lib/__tests__/publicationSurface.test.ts`.
 */
export type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

export type FooterColumn = {
  title: string;
  links: FooterLink[];
};

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Produit",
    links: [
      { label: "Comment ça marche", href: "/#comment" },
      { label: "Exercices", href: "/#exercices" },
      { label: "Gamification", href: "/#gamification" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Compte",
    links: [
      { label: "Se connecter", href: "/login" },
      { label: "Créer un compte", href: "/register" },
      { label: "Espace parent", href: "/parent/dashboard" },
      { label: "Espace professeur", href: "/teacher/dashboard" },
    ],
  },
  {
    title: "Légal",
    links: [
      { label: "Mentions légales", href: "/legal/mentions" },
      { label: "Conditions générales", href: "/legal/cgu" },
      { label: "Politique de confidentialité", href: "/legal/confidentialite" },
      { label: "Cookies", href: "/legal/cookies" },
      { label: "Protection des mineurs", href: "/legal/mineurs" },
      { label: "Accessibilité", href: "/legal/accessibilite" },
    ],
  },
];
