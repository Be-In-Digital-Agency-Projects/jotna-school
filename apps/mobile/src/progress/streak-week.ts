/**
 * LE RUBAN DE SÉRIE — sept jours, lundi à dimanche (tâche 4.1).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IL SE CALCULE EN UTC, ET CE N'EST PAS UN DÉTAIL.
 *
 * Le serveur définit le jour en **Africa/Dakar**, et `convex/streak.ts` le dit
 * sans détour : « Africa/Dakar is UTC+0 with no DST, so the UTC date IS the
 * local date ». Sa série se compte donc en jours UTC.
 *
 * Le ruban du web, lui, calcule sa semaine avec `new Date().getDay()` — le
 * fuseau de la MACHINE. À Dakar les deux coïncident, et personne ne voit rien.
 * Sur un téléphone c'est une autre affaire : un appareil réglé sur un autre
 * fuseau — une famille en déplacement, un enfant de la diaspora, ou tout
 * simplement une tablette mal réglée — dessinerait une semaine décalée d'un
 * jour par rapport à la série que le serveur a comptée. On prend donc la
 * définition du serveur, pas celle de l'appareil.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE RUBAN NE PEUT PAS SAVOIR, ET QU'IL NE PRÉTEND PAS SAVOIR.
 *
 * `getMyStats` rend `currentStreak`, pas les jours où l'enfant a joué. On
 * déduit donc la fenêtre active en remontant depuis aujourd'hui — ce qui
 * suppose que la série court jusqu'à aujourd'hui. Avec un gel (D7 : un jour
 * sans activité est rattrapé automatiquement une fois par semaine), ce n'est
 * pas exact : le ruban allumera un jour que l'enfant a sauté.
 *
 * C'EST UN CHOIX, PAS UN OUBLI, et il est déjà celui du web. La copie de la
 * série est « sans honte » (D7c) : un ruban qui montrerait le trou dirait à
 * l'enfant qu'il a manqué un jour, ce que le gel existe précisément pour ne
 * pas lui dire. L'exactitude demanderait que le serveur renvoie
 * `lastActivityYmd` — il l'a en base, il ne l'expose pas.
 */

export type DayState = "active" | "today" | "empty";

export interface StreakDay {
  /** L, M, M, J, V, S, D — l'initiale, comme sur le web. */
  label: string;
  /** Le jour du mois, pour les lecteurs d'écran. */
  dayOfMonth: number;
  state: DayState;
}

const LABELS = ["L", "M", "M", "J", "V", "S", "D"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Minuit UTC du jour qui contient `ts`. */
function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function streakWeek(now: number, currentStreak: number): StreakDay[] {
  const today = startOfUtcDay(now);

  // `getUTCDay()` rend 0 pour dimanche ; on veut lundi en tête.
  const mondayOffset = (new Date(today).getUTCDay() + 6) % 7;
  const monday = today - mondayOffset * DAY_MS;

  // Une série de 1 couvre aujourd'hui seul ; une série de 0 ne couvre rien,
  // et la borne se retrouve DEVANT aujourd'hui, ce qui n'allume aucun jour.
  const firstActive = today - (currentStreak - 1) * DAY_MS;

  return LABELS.map((label, i) => {
    const day = monday + i * DAY_MS;
    const active =
      currentStreak > 0 && day >= firstActive && day <= today;
    return {
      label,
      dayOfMonth: new Date(day).getUTCDate(),
      state: active ? "active" : day === today ? "today" : "empty",
    };
  });
}
