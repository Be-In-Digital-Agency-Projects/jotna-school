"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Loader2, BookOpen, Flame } from "lucide-react";
import { motion } from "framer-motion";
import { Pio } from "@/components/student/pio";

const iconMap: Record<string, React.ReactNode> = {
  Calculator: <span className="text-3xl">🧮</span>,
  Book: <span className="text-3xl">📖</span>,
  Flask: <span className="text-3xl">🔬</span>,
  Globe: <span className="text-3xl">🌍</span>,
  Music: <span className="text-3xl">🎵</span>,
  Palette: <span className="text-3xl">🎨</span>,
  Code: <span className="text-3xl">💻</span>,
  Hash: <span className="text-3xl">#</span>,
};

export default function StudentHomePage() {
  const subjects = useQuery(api.subjects.list);
  const stats = useQuery(api.students.getMyStats);
  // Les modules optionnels de l'école (aujourd'hui : « Arabe & Coran »).
  // Éteint par défaut : une école qui n'a rien demandé ne voit rien, et
  // l'accueil ne montre donc aucune section vide — voir `convex/modules.ts`.
  const modules = useQuery(api.modules.getMine);

  if (subjects === undefined || stats === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <span className="ml-3 text-gray-500">Chargement...</span>
      </div>
    );
  }

  // D8 — true cold-start: brand new account, zero progress everywhere.
  // We hide stats surfaces and show a single warm welcome + first-step CTA
  // so the screen doesn't read as "you have nothing yet".
  const isColdStart =
    stats !== null &&
    (stats.totalExercises ?? 0) === 0 &&
    (stats.totalStars ?? 0) === 0 &&
    (!stats.streaksEnabled || (stats.currentStreak ?? 0) === 0);

  const firstName = (stats?.student.name ?? "").split(" ")[0] || "";
  const showStreakRibbon =
    stats?.streaksEnabled === true && (stats.currentStreak ?? 0) > 0;

  return (
    <div className="space-y-8">
      {/* Welcome zone — Pio greets the student by name */}
      <WelcomeBanner
        firstName={firstName}
        isColdStart={isColdStart}
        currentStreak={stats?.currentStreak ?? 0}
        streakActive={showStreakRibbon}
      />

      {/* D7 — 7-day streak ribbon (only when parent toggle is on AND there's a streak) */}
      {showStreakRibbon && stats && (
        <StreakRibbon
          currentStreak={stats.currentStreak}
          longestStreak={stats.longestStreak}
        />
      )}

      {/* Modules optionnels de l'école — avant les matières : c'est un
          enseignement à part entière, pas une rubrique de fin de page. */}
      <ModuleCards modules={modules ?? []} />

      {/* Subjects grid — "mes mondes" */}
      <div>
        <h2 className="font-display mb-4 flex items-center gap-2 text-2xl font-extrabold text-gray-900">
          <BookOpen className="h-7 w-7 text-amber-600" aria-hidden />
          Mes matières
        </h2>

        {subjects.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-300 p-12 text-center">
            <p className="text-lg font-medium text-gray-500">
              Aucune matière disponible pour le moment.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((subject) => (
              <Link
                key={subject._id}
                href={`/student/subjects/${subject._id}`}
                className="group rounded-3xl border-2 border-transparent bg-white p-6 shadow-md transition-all duration-200 hover:scale-[1.02] hover:shadow-xl focus-visible:scale-[1.02] focus-visible:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2"
                style={{ boxShadow: `0 4px 20px ${subject.color}20` }}
              >
                <div
                  className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg"
                  style={{ backgroundColor: subject.color }}
                >
                  {iconMap[subject.icon] || (
                    <span className="text-2xl font-bold">
                      {subject.icon.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>

                <h3 className="font-display text-xl font-extrabold text-gray-900 group-hover:text-gray-700">
                  {subject.name}
                </h3>
                <p className="mt-1 text-sm font-medium text-gray-500">
                  Commence ton aventure
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Les modules que l'école a allumés.
 *
 * Ne rend RIEN quand il n'y en a aucun : ni titre, ni cadre vide. Un enfant
 * dont l'école n'a pas pris l'arabe ne doit pas voir la place où il aurait
 * été — c'est la règle du catalogue (`convex/moduleCatalog.ts`), tenue
 * jusqu'à l'écran.
 */
function ModuleCards({
  modules,
}: {
  modules: {
    key: string;
    title: string;
    summary: string;
    emoji: string;
    color: string;
    href: string;
    enabled: boolean;
  }[];
}) {
  const enabled = modules.filter((module_) => module_.enabled);
  if (enabled.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {enabled.map((module_) => (
        <Link
          key={module_.key}
          href={module_.href}
          className="group flex items-center gap-4 rounded-3xl p-5 text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ backgroundColor: module_.color }}
        >
          <span className="text-4xl" aria-hidden>
            {module_.emoji}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-display block text-xl font-extrabold">
              {module_.title}
            </span>
            <span className="mt-0.5 block text-sm opacity-95">
              {module_.summary}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function WelcomeBanner({
  firstName,
  isColdStart,
  currentStreak,
  streakActive,
}: {
  firstName: string;
  isColdStart: boolean;
  currentStreak: number;
  streakActive: boolean;
}) {
  const greeting = isColdStart
    ? `Bienvenue${firstName ? `, ${firstName}` : ""} ! 👋`
    : `Bon retour${firstName ? `, ${firstName}` : ""} !`;

  const subline = isColdStart
    ? "Choisis ta première matière pour commencer ton aventure."
    : streakActive
      ? `Bravo, tu as ${currentStreak} jour${currentStreak > 1 ? "s" : ""} de série.`
      : "Prêt(e) à apprendre aujourd'hui ?";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 p-6 text-white shadow-xl sm:p-8"
    >
      <div className="flex items-center gap-4 sm:gap-6">
        <Pio
          state={isColdStart ? "hello" : streakActive ? "cheer" : "idle"}
          size={88}
          className="shrink-0 drop-shadow-lg"
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-extrabold sm:text-3xl">
            {greeting}
          </h1>
          <p className="mt-1.5 text-base opacity-95 sm:text-lg">{subline}</p>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * D7 — 7-day visual streak ribbon. Shows the current calendar week (Mon → Sun)
 * with each day in one of three states:
 *   - active : within the running streak
 *   - today  : today, highlighted regardless of activity (kid sees "where I am")
 *   - empty  : outside the streak window
 *
 * D7c — zero-shame copy. Never says "perdu" — even broken streaks just fade.
 */
function StreakRibbon({
  currentStreak,
  longestStreak,
}: {
  currentStreak: number;
  longestStreak: number;
}) {
  // Compute the current week (Monday-anchored) as 7 Date objects.
  const today = new Date();
  const todayDow = (today.getDay() + 6) % 7; // 0 = Mon, 6 = Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - todayDow);
  monday.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  // Determine which days are within the active streak (going back from today).
  const streakStart = new Date(today);
  streakStart.setDate(today.getDate() - (currentStreak - 1));
  streakStart.setHours(0, 0, 0, 0);

  const dayLabels = ["L", "M", "M", "J", "V", "S", "D"];

  return (
    <div className="rounded-2xl border-2 border-orange-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame
            className="h-5 w-5 fill-orange-500 text-orange-500"
            aria-hidden
          />
          <span className="font-display text-lg font-bold text-gray-900">
            {currentStreak} jour{currentStreak > 1 ? "s" : ""} de série
          </span>
        </div>
        {longestStreak > currentStreak && (
          <span className="text-xs font-medium text-gray-500">
            record : {longestStreak}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-1.5 sm:gap-2">
        {days.map((d, i) => {
          const dDay = new Date(d);
          dDay.setHours(0, 0, 0, 0);
          const todayDay = new Date(today);
          todayDay.setHours(0, 0, 0, 0);
          const isToday = dDay.getTime() === todayDay.getTime();
          const isActive =
            dDay.getTime() >= streakStart.getTime() &&
            dDay.getTime() <= todayDay.getTime();

          return (
            <div
              key={i}
              className="flex flex-1 flex-col items-center gap-1.5"
              aria-label={
                isActive
                  ? `${dayLabels[i]} actif`
                  : isToday
                    ? `${dayLabels[i]} aujourd'hui`
                    : `${dayLabels[i]} en pause`
              }
            >
              <span
                className={`text-xs font-semibold ${
                  isToday ? "text-orange-700" : "text-gray-500"
                }`}
              >
                {dayLabels[i]}
              </span>
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors sm:h-10 sm:w-10 ${
                  isActive
                    ? "border-orange-300 bg-orange-100 text-orange-600"
                    : isToday
                      ? "border-orange-400 bg-white text-orange-400"
                      : "border-gray-200 bg-gray-50 text-gray-300"
                }`}
              >
                {isActive ? (
                  <Flame
                    className="h-4 w-4 fill-orange-500 text-orange-500"
                    aria-hidden
                  />
                ) : isToday ? (
                  <span className="text-base font-bold">·</span>
                ) : (
                  <span className="text-xs">·</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
