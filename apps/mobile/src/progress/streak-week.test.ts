import { describe, expect, it } from "vitest";

import { streakWeek } from "./streak-week";

/** Mercredi 24 septembre 2026, 10h UTC. */
const WED = Date.UTC(2026, 8, 23, 10, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function states(now: number, streak: number) {
  return streakWeek(now, streak).map((d) => d.state);
}

describe("streakWeek — la semaine", () => {
  it("commence toujours un lundi et fait sept jours", () => {
    const week = streakWeek(WED, 0);
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.label)).toEqual(["L", "M", "M", "J", "V", "S", "D"]);
    // 23 septembre 2026 est un mercredi ; le lundi est le 21.
    expect(week[0].dayOfMonth).toBe(21);
    expect(week[6].dayOfMonth).toBe(27);
  });

  it("un dimanche reste dans SA semaine, il n'ouvre pas la suivante", () => {
    const sunday = Date.UTC(2026, 8, 27, 23, 30, 0);
    const week = streakWeek(sunday, 0);
    expect(week[0].dayOfMonth).toBe(21);
    expect(week[6].dayOfMonth).toBe(27);
    expect(week[6].state).toBe("today");
  });

  it("marque aujourd'hui même sans série — l'enfant voit où il en est", () => {
    expect(states(WED, 0)).toEqual([
      "empty",
      "empty",
      "today",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
  });
});

describe("streakWeek — la fenêtre active", () => {
  it("une série de 1 n'allume qu'aujourd'hui", () => {
    expect(states(WED, 1)).toEqual([
      "empty",
      "empty",
      "active",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
  });

  it("une série de 3 remonte jusqu'à lundi", () => {
    expect(states(WED, 3)).toEqual([
      "active",
      "active",
      "active",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
  });

  it("une série plus longue que la semaine allume tout jusqu'à aujourd'hui, et rien après", () => {
    expect(states(WED, 40)).toEqual([
      "active",
      "active",
      "active",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
  });
});

describe("streakWeek — l'heure et le fuseau", () => {
  it("ne bouge pas selon l'heure de la journée", () => {
    const morning = Date.UTC(2026, 8, 23, 0, 0, 1);
    const night = Date.UTC(2026, 8, 23, 23, 59, 59);
    expect(states(morning, 3)).toEqual(states(night, 3));
  });

  it("bascule à MINUIT UTC, qui est la définition du serveur", () => {
    // 23 septembre 23h59 UTC et 24 septembre 00h01 UTC ne sont pas le même
    // jour pour `convex/streak.ts` ; le ruban doit voir la même frontière.
    const before = Date.UTC(2026, 8, 23, 23, 59, 0);
    const after = before + 2 * 60 * 1000;
    expect(streakWeek(before, 1)[2].state).toBe("active");
    expect(streakWeek(after, 1)[2].state).toBe("empty");
    expect(streakWeek(after, 1)[3].state).toBe("active");
  });

  it("franchit un changement de mois sans se décaler", () => {
    // Jeudi 1er octobre 2026 ; le lundi de sa semaine est le 28 septembre.
    const oct1 = Date.UTC(2026, 9, 1, 12, 0, 0);
    const week = streakWeek(oct1, 5);
    expect(week[0].dayOfMonth).toBe(28);
    expect(week[3].dayOfMonth).toBe(1);
    // « actif » l'emporte sur « aujourd'hui » quand la série court — c'est la
    // précédence du web, et elle a du sens : la flamme vaut mieux que le point.
    expect(week[3].state).toBe("active");
    expect(states(oct1, 5)).toEqual([
      "active",
      "active",
      "active",
      "active",
      "empty",
      "empty",
      "empty",
    ]);
  });

  it("franchit un changement d'année", () => {
    // Vendredi 1er janvier 2027 ; son lundi est le 28 décembre 2026.
    const jan1 = Date.UTC(2027, 0, 1, 8, 0, 0);
    const week = streakWeek(jan1, 2);
    expect(week[0].dayOfMonth).toBe(28);
    expect(week[4].dayOfMonth).toBe(1);
    expect(week[4].state).toBe("active");
    expect(week[3].state).toBe("active");
  });
});

describe("streakWeek — les valeurs qu'on ne veut pas voir planter", () => {
  it("une série négative ne renverse pas la fenêtre", () => {
    // Elle ne devrait pas exister, mais elle vient du serveur : un ruban qui
    // allumerait toute la semaine sur une valeur absurde serait pire.
    expect(states(WED, -3)).toEqual([
      "empty",
      "empty",
      "today",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
  });

  it("le lundi d'une série de 7 est allumé, le dimanche d'avant ne l'est pas", () => {
    const monday = Date.UTC(2026, 8, 21, 9, 0, 0);
    const week = streakWeek(monday, 7);
    expect(week[0].state).toBe("active");
    expect(week.slice(1).map((d) => d.state)).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    // La veille appartient à la semaine précédente, qu'on n'affiche pas.
    expect(week[0].dayOfMonth).toBe(21);
    expect(monday - DAY).toBeLessThan(Date.UTC(2026, 8, 21));
  });
});
