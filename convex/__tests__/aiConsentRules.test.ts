import { describe, expect, it } from "vitest";

import {
  AI_CONSENT_GRACE_ENDS_AT,
  decideAiConsent,
  type AiConsentInput,
} from "../aiConsentRules";

const GRACE_ENDS = Date.UTC(2026, 9, 26);
const DURING = Date.UTC(2026, 9, 1);
const AFTER = Date.UTC(2026, 10, 1);
const DECLARED = Date.UTC(2026, 8, 20);

function input(over: Partial<AiConsentInput> = {}): AiConsentInput {
  return {
    parentDecision: undefined,
    schoolDeclaredAt: null,
    graceEndsAt: GRACE_ENDS,
    now: DURING,
    ...over,
  };
}

describe("decideAiConsent — le refus parental l'emporte sur tout", () => {
  it("refuse même quand l'école a déclaré", () => {
    const d = decideAiConsent(
      input({ parentDecision: false, schoolDeclaredAt: DECLARED }),
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("parent_refused");
  });

  it("refuse PENDANT le délai de grâce — un « non » qui attend n'en est pas un", () => {
    const d = decideAiConsent({
      parentDecision: false,
      schoolDeclaredAt: null,
      graceEndsAt: GRACE_ENDS,
      now: DURING,
    });
    expect(d.allowed).toBe(false);
    expect(d.onGrace).toBe(false);
  });

  it("refuse quel que soit l'instant", () => {
    for (const now of [0, DURING, GRACE_ENDS, AFTER, Number.MAX_SAFE_INTEGER]) {
      expect(decideAiConsent(input({ parentDecision: false, now })).allowed).toBe(
        false,
      );
    }
  });
});

describe("decideAiConsent — l'accord parental explicite", () => {
  it("autorise même sans déclaration de l'école, et hors délai", () => {
    const d = decideAiConsent(
      input({ parentDecision: true, schoolDeclaredAt: null, now: AFTER }),
    );
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("parent_granted");
    // Ce n'est pas de la grâce : le représentant légal a dit oui.
    expect(d.onGrace).toBe(false);
  });
});

describe("decideAiConsent — la déclaration de l'école", () => {
  it("autorise quand l'école a déclaré et qu'aucun parent ne s'est prononcé", () => {
    const d = decideAiConsent(
      input({ schoolDeclaredAt: DECLARED, now: AFTER }),
    );
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("school_declared");
    expect(d.onGrace).toBe(false);
  });

  it("une déclaration postérieure au délai vaut quand même", () => {
    // Une école qui déclare en retard retrouve l'IA : la déclaration n'est pas
    // une course contre la montre, c'est une condition.
    const d = decideAiConsent(
      input({ schoolDeclaredAt: Date.UTC(2026, 11, 1), now: Date.UTC(2026, 11, 2) }),
    );
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("school_declared");
  });
});

describe("decideAiConsent — le délai de grâce", () => {
  it("laisse passer tant qu'il court, en le SIGNALANT", () => {
    const d = decideAiConsent(input({ now: DURING }));
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("grace_period");
    // Sans ce drapeau, la coupure au trentième jour arriverait sans prévenir.
    expect(d.onGrace).toBe(true);
  });

  it("se ferme à la milliseconde exacte, pas après", () => {
    expect(decideAiConsent(input({ now: GRACE_ENDS - 1 })).allowed).toBe(true);
    expect(decideAiConsent(input({ now: GRACE_ENDS })).allowed).toBe(false);
    expect(decideAiConsent(input({ now: GRACE_ENDS + 1 })).allowed).toBe(false);
  });

  it("une fois passé, refuse et dit pourquoi", () => {
    const d = decideAiConsent(input({ now: AFTER }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("no_declaration");
    expect(d.onGrace).toBe(false);
  });
});

describe("decideAiConsent — l'ordre des règles", () => {
  it("le refus parental est lu AVANT la déclaration de l'école", () => {
    // C'est le test qui verrouille le fond de la décision : inverser ces deux
    // branches ferait passer un enfant dont le parent a dit non, parce que son
    // école, elle, avait déclaré. Aucun autre test ne l'attraperait.
    const refusedButDeclared = decideAiConsent({
      parentDecision: false,
      schoolDeclaredAt: DECLARED,
      graceEndsAt: GRACE_ENDS,
      now: DURING,
    });
    expect(refusedButDeclared.reason).toBe("parent_refused");
  });

  it("l'accord parental est lu AVANT la grâce, donc il n'expire pas avec elle", () => {
    const granted = decideAiConsent(input({ parentDecision: true, now: AFTER }));
    expect(granted.reason).toBe("parent_granted");
  });

  it("aucune entrée ne rend `allowed` sans raison correspondante", () => {
    const cases: AiConsentInput[] = [
      input(),
      input({ now: AFTER }),
      input({ parentDecision: true }),
      input({ parentDecision: false }),
      input({ schoolDeclaredAt: DECLARED }),
      input({ schoolDeclaredAt: DECLARED, now: AFTER }),
      input({ parentDecision: false, schoolDeclaredAt: DECLARED, now: AFTER }),
    ];
    for (const c of cases) {
      const d = decideAiConsent(c);
      const allowedReasons = ["parent_granted", "school_declared", "grace_period"];
      expect(allowedReasons.includes(d.reason)).toBe(d.allowed);
      // `onGrace` n'est vrai que sur la grâce, jamais ailleurs.
      expect(d.onGrace).toBe(d.reason === "grace_period");
    }
  });
});

describe("AI_CONSENT_GRACE_ENDS_AT", () => {
  it("est une date ÉCRITE, pas un calcul relatif au déploiement", () => {
    // Un délai relatif à la date de compilation repartirait à zéro à chaque
    // redéploiement et l'échéance ne tomberait jamais. Ce test échoue si
    // quelqu'un remplace la constante par un `Date.now() + 30 jours`.
    expect(AI_CONSENT_GRACE_ENDS_AT).toBe(Date.UTC(2026, 9, 26));
  });

  it("tombe trente jours après la décision du propriétaire", () => {
    const decidedOn = Date.UTC(2026, 8, 26);
    const days = (AI_CONSENT_GRACE_ENDS_AT - decidedOn) / (24 * 60 * 60 * 1000);
    expect(days).toBe(30);
  });
});
