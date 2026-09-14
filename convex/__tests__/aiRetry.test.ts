import { describe, it, expect } from "vitest";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "openai";
import { isRetryableFailure } from "../aiGateway/registry";

/** Construit une erreur d'API portant un vrai code HTTP. */
function apiError(status: number): APIError {
  return new APIError(status, undefined, `HTTP ${status}`, undefined);
}

describe("isRetryableFailure — on ne paie jamais deux fois une réponse reçue", () => {
  // LE test de non-régression. Le prédicat précédent cherchait `5\d{2}` dans le
  // texte du message ; la position d'octet d'un `JSON.parse` raté y tombait, si
  // bien qu'une génération à 6 000 jetons était payée deux fois ou non selon
  // l'endroit où la réponse s'était fait couper. Vérifié à l'époque en
  // exécution : 506 réessayait, 106 et 706 non.
  it("ne réessaie JAMAIS un JSON invalide, quelle que soit la position", () => {
    for (const position of [106, 500, 506, 599, 706, 5000]) {
      const err = new Error(
        `Model emitted invalid JSON: Unexpected token } in JSON at position ${position}`,
      );
      expect(isRetryableFailure(err)).toBe(false);
    }
  });

  it("ne se laisse pas prendre par un nombre dans un message quelconque", () => {
    for (const message of [
      "Unexpected end of JSON input",
      "Le devis porte sur 500 sièges",
      "timeout",
      "ECONNRESET",
      "fetch failed",
    ]) {
      // Aucune de ces erreurs ORDINAIRES n'est réessayable : seule la classe
      // de l'erreur décide désormais, jamais son texte — y compris pour les
      // mots que l'ancien motif reconnaissait.
      expect(isRetryableFailure(new Error(message))).toBe(false);
    }
  });
});

describe("isRetryableFailure — ce qui n'a rien produit se réessaie", () => {
  it("réessaie une coupure réseau", () => {
    expect(isRetryableFailure(new APIConnectionError({}))).toBe(true);
  });

  it("réessaie un délai dépassé", () => {
    expect(isRetryableFailure(new APIConnectionTimeoutError({}))).toBe(true);
  });

  it("réessaie les 5xx, et eux seuls dans la plage serveur", () => {
    for (const status of [500, 502, 503, 529, 599]) {
      expect(isRetryableFailure(apiError(status))).toBe(true);
    }
    expect(isRetryableFailure(apiError(600))).toBe(false);
  });

  it("réessaie un 429", () => {
    expect(isRetryableFailure(apiError(429))).toBe(true);
  });
});

describe("isRetryableFailure — ce qui ne servirait à rien ne se réessaie pas", () => {
  it("ne réessaie aucune erreur de requête", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableFailure(apiError(status))).toBe(false);
    }
  });

  it("ne réessaie pas un abandon volontaire", () => {
    // Sous-classe d'`APIError` sans code : doit être reconnue AVANT le cas
    // générique, sans quoi l'ordre des branches la rendrait réessayable.
    expect(isRetryableFailure(new APIUserAbortError({}))).toBe(false);
  });

  it("ne réessaie rien qui ne soit pas une erreur", () => {
    for (const value of [null, undefined, "500", 500, {}, { status: 500 }]) {
      expect(isRetryableFailure(value)).toBe(false);
    }
  });
});
