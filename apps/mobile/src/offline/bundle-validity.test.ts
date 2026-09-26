import { describe, expect, it } from "vitest";

import {
  bundleUnplayableReason,
  isBundlePlayable,
  type BundleValidityInput,
} from "./bundle-validity";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const SCHEME = 1;

function bundle(over: Partial<BundleValidityInput> = {}): BundleValidityInput {
  return { accessValidUntil: NOW + 7 * DAY, atomScheme: SCHEME, ...over };
}

describe("bundleUnplayableReason — le bail", () => {
  it("joue tant que le bail court", () => {
    expect(bundleUnplayableReason(bundle(), NOW, SCHEME)).toBeNull();
    expect(isBundlePlayable(bundle(), NOW, SCHEME)).toBe(true);
  });

  it("se ferme à la seconde exacte, pas après", () => {
    expect(
      bundleUnplayableReason(bundle({ accessValidUntil: NOW + 1 }), NOW, SCHEME),
    ).toBeNull();
    expect(
      bundleUnplayableReason(bundle({ accessValidUntil: NOW }), NOW, SCHEME),
    ).toBe("expired");
    expect(
      bundleUnplayableReason(bundle({ accessValidUntil: NOW - 1 }), NOW, SCHEME),
    ).toBe("expired");
  });
});

describe("bundleUnplayableReason — le schéma d'atomes", () => {
  it("refuse un lot dont le schéma ne correspond plus", () => {
    // C'est le cas qui compte : une mise à jour à chaud a changé
    // l'atomisation sous l'appareil, les empreintes livrées ne veulent plus
    // rien dire, et l'enfant se verrait compter faux des réponses justes.
    expect(bundleUnplayableReason(bundle({ atomScheme: 1 }), NOW, 2)).toBe(
      "scheme_changed",
    );
    expect(isBundlePlayable(bundle({ atomScheme: 1 }), NOW, 2)).toBe(false);
  });

  it("refuse AUSSI un schéma plus RÉCENT que celui de l'appareil", () => {
    // Un appareil qui n'a pas encore pris la mise à jour peut recevoir un lot
    // d'un serveur déjà migré. La divergence est la même dans ce sens-là, et
    // une comparaison « >= » l'aurait laissée passer.
    expect(bundleUnplayableReason(bundle({ atomScheme: 2 }), NOW, 1)).toBe(
      "scheme_changed",
    );
  });

  it("refuse un lot SANS numéro — la prudence, pas l'optimisme", () => {
    // Un lot d'avant la tâche 6.7 a été construit par un serveur qui ne savait
    // pas encore qu'il fallait en donner un : on ne peut rien affirmer de son
    // atomisation. Le refuser coûte un téléchargement ; l'accepter coûte un
    // après-midi à un enfant qui se croit nul.
    expect(bundleUnplayableReason(bundle({ atomScheme: null }), NOW, SCHEME)).toBe(
      "scheme_changed",
    );
  });

  it("le zéro est un numéro comme un autre, pas une absence", () => {
    expect(bundleUnplayableReason(bundle({ atomScheme: 0 }), NOW, 0)).toBeNull();
    expect(bundleUnplayableReason(bundle({ atomScheme: 0 }), NOW, 1)).toBe(
      "scheme_changed",
    );
  });
});

describe("bundleUnplayableReason — les deux à la fois", () => {
  it("rend l'expiration en premier, mais refuse dans tous les cas", () => {
    const doomed = bundle({ accessValidUntil: NOW - DAY, atomScheme: null });
    expect(bundleUnplayableReason(doomed, NOW, SCHEME)).toBe("expired");
    expect(isBundlePlayable(doomed, NOW, SCHEME)).toBe(false);
  });

  it("aucune combinaison ne rend un lot jouable par accident", () => {
    const cases: BundleValidityInput[] = [
      { accessValidUntil: NOW - 1, atomScheme: SCHEME },
      { accessValidUntil: NOW + DAY, atomScheme: null },
      { accessValidUntil: NOW + DAY, atomScheme: 99 },
      { accessValidUntil: NOW - 1, atomScheme: 99 },
    ];
    for (const c of cases) {
      expect(isBundlePlayable(c, NOW, SCHEME)).toBe(false);
    }
    expect(
      isBundlePlayable(
        { accessValidUntil: NOW + DAY, atomScheme: SCHEME },
        NOW,
        SCHEME,
      ),
    ).toBe(true);
  });
});
