import { describe, it, expect } from "vitest";
import { uniformInt, secureRandomInt } from "../secureRandom";

/** Une source scriptée, pour éprouver le rejet sans dépendre du hasard. */
function scripted(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error("source épuisée");
    return values[i++];
  };
}

describe("uniformInt", () => {
  it("ramène la valeur dans la plage", () => {
    expect(uniformInt(10, scripted([7]))).toBe(7);
    expect(uniformInt(10, scripted([17]))).toBe(7);
  });

  it("rend 0 sans consommer d'entropie pour une plage de 1", () => {
    // Pas de tirage du tout : une plage à une valeur n'a rien à choisir.
    expect(uniformInt(1, scripted([]))).toBe(0);
  });

  it("REJETTE la queue au lieu de la replier — pas de biais de modulo", () => {
    // Plage 10 : le plus grand multiple de 10 sous 2³² est 4294967290. Une
    // valeur au-dessus doit être JETÉE, pas ramenée par `%`. Si elle était
    // repliée, 4294967291 donnerait 1 ; ici elle est rejetée et c'est le
    // tirage suivant qui compte.
    const next = scripted([4294967291, 42]);
    expect(uniformInt(10, next)).toBe(2);
  });

  it("rejette autant de fois qu'il le faut", () => {
    const next = scripted([4294967295, 4294967294, 4294967293, 5]);
    expect(uniformInt(10, next)).toBe(5);
  });

  it("refuse une plage qui n'est pas un entier positif", () => {
    for (const bad of [0, -1, 2.5, NaN]) {
      expect(() => uniformInt(bad, scripted([1]))).toThrow("plage invalide");
    }
  });

  it("abandonne plutôt que de boucler sur une source dégénérée", () => {
    // Une source qui rendrait toujours une valeur hors limite ferait tourner
    // l'appel sans fin. Mieux vaut lever : l'appelant sait alors que son
    // générateur est cassé, au lieu de voir sa fonction se figer.
    const stuck = () => 4294967295;
    expect(() => uniformInt(10, stuck)).toThrow("inexploitable");
  });
});

describe("secureRandomInt", () => {
  it("respecte ses bornes, incluses", () => {
    for (let i = 0; i < 200; i++) {
      const n = secureRandomInt(1000, 9999);
      expect(n).toBeGreaterThanOrEqual(1000);
      expect(n).toBeLessThanOrEqual(9999);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("atteint les deux extrémités d'une plage minuscule", () => {
    // Un générateur qui ne sortirait jamais la borne haute décalerait tout
    // l'espace de codes sans que rien ne le signale.
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(secureRandomInt(0, 1));
    expect(seen).toEqual(new Set([0, 1]));
  });

  it("ne rend pas deux fois la même chose sur un grand espace", () => {
    // Test de non-régression grossier : une source figée — un `Math.random()`
    // mal branché, une constante — se verrait ici immédiatement.
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(secureRandomInt(0, 2 ** 30));
    expect(seen.size).toBeGreaterThan(90);
  });
});
