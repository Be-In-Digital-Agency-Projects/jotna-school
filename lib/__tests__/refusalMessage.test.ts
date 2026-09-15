import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { refusalMessage } from "../refusalMessage";

const FALLBACK = "Erreur lors de l'enregistrement du contrat";

describe("refusalMessage", () => {
  it("rend le texte du serveur quand une ConvexError porte une chaîne", () => {
    // La forme que lève `convex/schools.ts` : une phrase déjà rédigée pour un
    // administrateur. C'est le cas que toute cette migration existe pour servir.
    const err = new ConvexError("Le nombre de sièges doit être un entier positif");

    expect(refusalMessage(err, FALLBACK)).toBe(
      "Le nombre de sièges doit être un entier positif",
    );
  });

  it("ne lit pas `message`, que Convex occulte", () => {
    // `message` vaut `[CONVEX M(…)] <texte>\n  Called by client` chez le vrai
    // client, et rien du tout hors développement. Une fonction qui le lirait
    // passerait ce test-ci par accident si elle lisait `data` en premier, donc
    // on vérifie que le texte rendu n'est PAS celui de `message`.
    const err = new ConvexError("refus du serveur");
    err.message = "[CONVEX M(schools:recordSubscription)] Server Error";

    expect(refusalMessage(err, FALLBACK)).toBe("refus du serveur");
  });

  it("retombe sur le repli pour la forme OBJET du paywall", () => {
    // Les cinq sites du paywall lèvent `{ code, reason }` : un motif, pas une
    // phrase. Sans ce garde-fou l'écran afficherait « [object Object] ».
    const err = new ConvexError({ code: "ACCESS_DENIED", reason: "expired" });

    expect(refusalMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it("retombe sur le repli pour une Error ordinaire", () => {
    // Validateur d'arguments, fonction introuvable, panne du runtime : pas de
    // `data`, et un `message` qui ne vaut pas mieux que le repli de l'écran.
    expect(refusalMessage(new Error("Server Error"), FALLBACK)).toBe(FALLBACK);
  });

  it("ne jette sur aucune valeur, y compris null et les primitives", () => {
    // `catch (err)` attrape ce qu'on lui jette, pas seulement des Error. Une
    // exception ici remplacerait le refus par un écran blanc.
    for (const value of [null, undefined, "texte nu", 0, false, [], {}]) {
      expect(refusalMessage(value, FALLBACK)).toBe(FALLBACK);
    }
  });

  it("accepte tout porteur de `data` textuel, sans dépendre de la classe", () => {
    // Le test de FORME est délibéré : l'identité de `ConvexError` n'est pas
    // garantie à travers les bundles du navigateur. Ce cas verrouille ce choix.
    expect(refusalMessage({ data: "refus rédigé" }, FALLBACK)).toBe("refus rédigé");
  });
});
