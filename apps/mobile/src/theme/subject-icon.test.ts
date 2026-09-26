import { describe, expect, it } from "vitest";

import { subjectIcon } from "./subject-icon";

describe("subjectIcon — le défaut qu'il corrige", () => {
  it("traduit les noms que le serveur écrit VRAIMENT", () => {
    // `convex/testSeeds.ts` écrit « Calculator ». Sans cette table, l'accueil
    // affichait ce mot-là, en corps 32, sur la carte d'un enfant.
    expect(subjectIcon("Calculator")).toBe("🧮");
    expect(subjectIcon("Book")).toBe("📖");
    expect(subjectIcon("Globe")).toBe("🌍");
  });

  it("ne rend jamais le nom Lucide tel quel", () => {
    for (const name of ["Calculator", "Book", "Flask", "Globe", "Music", "Palette", "Code", "Hash"]) {
      expect(subjectIcon(name)).not.toBe(name);
    }
  });
});

describe("subjectIcon — les cas qui ne sont pas dans la table", () => {
  it("un nom inconnu devient un sigle de deux lettres, comme sur le web", () => {
    expect(subjectIcon("Biology")).toBe("BI");
    expect(subjectIcon("wolof")).toBe("WO");
  });

  it("un vrai emoji passe tel quel — le web, lui, le hacherait", () => {
    expect(subjectIcon("🧪")).toBe("🧪");
    expect(subjectIcon("🇸🇳")).toBe("🇸🇳");
  });

  it("compte les POINTS DE CODE, pas les unités UTF-16", () => {
    // « 🧪 » occupe deux unités UTF-16 : `icon.length <= 2` le prendrait pour
    // un sigle de deux lettres et le passerait à `toUpperCase`, ce qui ne
    // change rien ici mais casserait un emoji à trois unités.
    expect(subjectIcon("🧪")).toHaveLength(2);
    expect(Array.from(subjectIcon("🧪"))).toHaveLength(1);
  });

  it("un sigle déjà court reste lisible", () => {
    expect(subjectIcon("SVT")).toBe("SV");
    expect(subjectIcon("EM")).toBe("EM");
  });

  it("rien du tout devient le livre", () => {
    expect(subjectIcon(undefined)).toBe("📘");
    expect(subjectIcon(null)).toBe("📘");
    expect(subjectIcon("")).toBe("📘");
    expect(subjectIcon("   ")).toBe("📘");
  });
});
