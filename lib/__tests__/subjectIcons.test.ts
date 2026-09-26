import { describe, expect, it } from "vitest";

import { DEFAULT_SUBJECTS } from "@/convex/subjects";
import {
  SUBJECT_EMOJI,
  SUBJECT_EMOJI_FALLBACK,
  subjectEmoji,
} from "@/lib/subject-icons";

/**
 * LA TABLE DES EMOJIS EST LIÉE AUX DONNÉES QU'ELLE TRADUIT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI S'EST PASSÉ, ET QU'UN RENDU A MONTRÉ.
 *
 * `subjects.icon` porte un nom d'icône Lucide, pas un emoji. Web et mobile le
 * traduisaient chacun avec sa propre copie d'une table — et les DEUX
 * oubliaient `Users`, que `seedDefaults` écrit pour l'EMC. Sur le web, la
 * matière tombait sur une icône générique ; sur mobile, elle affichait
 * **« US »**, deux lettres majuscules dans une pastille colorée, sur l'accueil
 * d'un enfant de huit ans.
 *
 * C'est la deuxième fois que cette traduction fait défaut : la première, le
 * mobile affichait le mot « Calculator » en corps 32. Elle avait été corrigée
 * en RECOPIANT la table du web, ce qui a reporté le problème sans le fermer —
 * les deux copies partageaient déjà le même trou.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE TEST GARDE.
 *
 * Une seule table (`lib/subject-icons.ts`), et ce test la confronte à la liste
 * RÉELLEMENT semée (`DEFAULT_SUBJECTS`). Ajouter une matière avec une icône
 * inconnue fait rougir la CI, au lieu d'attendre qu'un enfant la voie.
 */
describe("l'emoji d'une matière", () => {
  it.each(DEFAULT_SUBJECTS)(
    "« $name » a une icône traduite ($icon)",
    ({ name, icon }) => {
      expect(
        SUBJECT_EMOJI[icon],
        `La matière « ${name} » est semée avec l'icône « ${icon} », que la ` +
          `table ne connaît pas. L'enfant verrait « ${icon.slice(0, 2).toUpperCase()} ` +
          `» dans une pastille. Ajoutez-la à SUBJECT_EMOJI.`,
      ).toBeDefined();
    },
  );

  it("chaque matière semée rend bien un emoji, et pas un sigle", () => {
    for (const { icon } of DEFAULT_SUBJECTS) {
      const rendered = subjectEmoji(icon);
      expect(rendered).not.toMatch(/^[A-Z]{2}$/);
      expect(rendered).not.toBe(icon);
    }
  });

  it("une icône inconnue donne un sigle — le signal est VOULU", () => {
    // Deux lettres majuscules, c'est laid, et c'est le but : une matière sans
    // emoji doit se remarquer, pas se fondre derrière une icône passe-partout.
    expect(subjectEmoji("Rocket")).toBe("RO");
  });

  it("un vrai emoji saisi à la main passe tel quel", () => {
    // `Array.from` compte les points de code : « 🧪 » en occupe deux en
    // UTF-16, et un test sur `.length` le prendrait pour un sigle.
    expect(subjectEmoji("🧪")).toBe("🧪");
    expect(subjectEmoji("🇸🇳")).toBe("🇸🇳");
  });

  it("rien du tout donne le repli", () => {
    expect(subjectEmoji(null)).toBe(SUBJECT_EMOJI_FALLBACK);
    expect(subjectEmoji(undefined)).toBe(SUBJECT_EMOJI_FALLBACK);
    expect(subjectEmoji("   ")).toBe(SUBJECT_EMOJI_FALLBACK);
  });
});
