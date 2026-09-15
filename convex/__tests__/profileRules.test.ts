import { describe, it, expect } from "vitest";
import { decideProfileUpdate } from "../profileRules";

describe("decideProfileUpdate", () => {
  it("n'écrit que les champs fournis", () => {
    const d = decideProfileUpdate({ name: "Awa" }, undefined);
    expect(d).toEqual({ ok: true, patch: { name: "Awa" } });
  });

  it("ne renvoie AUCUN patch quand rien n'est fourni", () => {
    // Le handler s'en sert pour ne pas écrire du tout : un patch vide crée
    // quand même une révision et réveille tous les abonnements qui lisent le
    // profil. Un « rien à faire » n'est pas un refus pour autant.
    const d = decideProfileUpdate({}, { receiveReports: true });
    expect(d).toEqual({ ok: true, patch: {} });
  });

  it("refuse un nom vide ou blanc, que le formulaire l'exige ou non", () => {
    for (const name of ["", "   ", "\t\n"]) {
      expect(decideProfileUpdate({ name }, undefined)).toEqual({
        ok: false,
        reason: "empty_name",
      });
    }
  });

  it("taille le nom sans toucher aux noms composés", () => {
    expect(decideProfileUpdate({ name: "  Awa Diop  " }, undefined)).toEqual({
      ok: true,
      patch: { name: "Awa Diop" },
    });
  });

  it("FUSIONNE les préférences au lieu de les remplacer", () => {
    // C'est la raison d'être de ce module. `preferences` est un fourre-tout :
    // streak.ts, badges.ts et students.ts y rangent série, badges et son.
    // L'ancienne mutation écrivait l'objet entier reçu du client, donc l'écran
    // de paramètres parent — qui n'envoie que `receiveReports` — effaçait tout
    // le reste.
    const d = decideProfileUpdate(
      { receiveReports: false },
      { streak: { current: 12 }, badges: ["b1", "b2"], soundEnabled: true },
    );
    expect(d).toEqual({
      ok: true,
      patch: {
        preferences: {
          streak: { current: 12 },
          badges: ["b1", "b2"],
          soundEnabled: true,
          receiveReports: false,
        },
      },
    });
  });

  it("écrase la clé visée, et elle seule", () => {
    const d = decideProfileUpdate(
      { receiveReports: true },
      { receiveReports: false, soundEnabled: false },
    );
    expect(d.ok && d.patch.preferences).toEqual({
      receiveReports: true,
      soundEnabled: false,
    });
  });

  it("ne répand pas des préférences qui ne sont pas un objet", () => {
    // `preferences` est `v.any()` au schéma : rien n'impose un objet. Répandre
    // une chaîne donnerait `{0:"a",1:"b",…}` — des préférences inventées, pires
    // que des préférences perdues.
    for (const junk of ["abc", 42, true, ["a", "b"], null, undefined]) {
      const d = decideProfileUpdate({ receiveReports: true }, junk);
      expect(d.ok && d.patch.preferences).toEqual({ receiveReports: true });
    }
  });

  it("ne touche pas aux préférences quand l'écran n'en envoie pas", () => {
    // Un écran qui ne règle que le nom ne doit pas réécrire le fourre-tout —
    // sans quoi deux écrans se marcheraient dessus à chaque enregistrement.
    const d = decideProfileUpdate({ name: "Awa" }, { streak: { current: 12 } });
    expect(d.ok && d.patch).not.toHaveProperty("preferences");
  });

  it("n'écrit jamais autre chose que nom, avatar et préférences", () => {
    // L'argument `preferences: v.any()` a disparu de la mutation : un élève
    // s'y décernait badges et série en un appel. La règle tient par la forme
    // du patch, pas par une liste de clés interdites qui se périmerait.
    const d = decideProfileUpdate(
      { name: "Awa", avatar: "a.png", receiveReports: true },
      {},
    );
    expect(Object.keys(d.ok ? d.patch : {}).sort()).toEqual([
      "avatar",
      "name",
      "preferences",
    ]);
  });
});
