"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Home, Award, UserCircle, Star, Flame, BookOpenText } from "lucide-react";
import { UserMenu } from "@/components/ui/user-menu";
import { Brand } from "@/components/landing/brand";
import { AccessGate } from "@/components/AccessGate";
import { MotionConfig } from "framer-motion";

const navLinks = [
  { href: "/student/home", label: "Accueil", icon: Home },
  { href: "/student/badges", label: "Coffre", icon: Award },
  { href: "/student/profil", label: "Profil", icon: UserCircle },
];

/**
 * Le lien du module « Arabe & Coran », inséré après l'accueil quand l'école
 * l'a allumé.
 *
 * IL N'APPARAÎT PAS PAR DÉFAUT. La barre du bas est le seul chemin de
 * navigation sur téléphone : y laisser en permanence un lien vers un
 * enseignement que l'école n'a pas pris donnerait une porte fermée à chaque
 * écran. `modules.getMine` répond « éteint » tant qu'aucune école n'a
 * décidé le contraire.
 */
const arabicLink = {
  href: "/student/arabe",
  label: "Arabe",
  icon: BookOpenText,
};

// Routes where the student should be fully focused on the exercise —
// the top nav + bottom tab are hidden to avoid distraction (Decision 90 +
// driving-test app pattern). Decision D5 extends focus to the bottom tab.
function isFocusRoute(pathname: string): boolean {
  return (
    /^\/student\/topics\/[^/]+\/session/.test(pathname) ||
    /^\/student\/topics\/[^/]+\/complete/.test(pathname) ||
    // Une leçon d'arabe demande la même concentration qu'un palier : elle
    // fait écouter, répéter au micro et écrire au doigt, et la barre du bas
    // passerait sous le carré d'écriture sur un téléphone.
    /^\/student\/arabe\/lecon\//.test(pathname)
  );
}

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const focusMode = isFocusRoute(pathname);
  const modules = useQuery(api.modules.getMine);
  const arabicEnabled =
    modules?.some((module_) => module_.key === "arabe_coran" && module_.enabled) ===
    true;
  const links = arabicEnabled
    ? [navLinks[0], arabicLink, ...navLinks.slice(1)]
    : navLinks;

  return (
    // D12 — honors prefers-reduced-motion globally for all motion inside
    // /student/* routes (badges, session, complete, Pio, etc.).
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col bg-gradient-to-b from-amber-50 via-yellow-50 to-lime-50">
        {!focusMode && (
          <header className="sticky top-0 z-10 border-b border-amber-100 bg-white/80 backdrop-blur-sm">
            <div className="mx-auto flex h-20 max-w-5xl items-center justify-between gap-3 px-4 sm:h-24">
              <Brand href="/student/home" size="sm" />

              {/* D5 — top nav links: tablet/desktop only. Mobile uses bottom tab. */}
              <nav className="hidden items-center gap-2 sm:flex">
                {links.map((link) => {
                  const isActive =
                    pathname === link.href ||
                    pathname.startsWith(`${link.href}/`);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-2 rounded-full px-4 py-2.5 text-base font-semibold transition-all ${
                        isActive
                          ? "bg-orange-500 text-white shadow-md shadow-orange-200"
                          : "text-gray-700 hover:bg-amber-100 hover:text-amber-800"
                      }`}
                    >
                      <link.icon className="h-5 w-5" />
                      <span>{link.label}</span>
                    </Link>
                  );
                })}
              </nav>

              <div className="flex items-center gap-2 sm:gap-3">
                <StudentStatusBar />
                <UserMenu
                  profileHref="/student/profil"
                  variant="compact"
                  fallbackLabel="Élève"
                />
              </div>
            </div>
          </header>
        )}

        <main
          className={`mx-auto w-full max-w-5xl flex-1 px-4 py-6 ${
            !focusMode ? "pb-24 sm:pb-6" : ""
          }`}
        >
          <AccessGate>{children}</AccessGate>
        </main>

        {/* D5 — bottom tab nav: mobile only. Hidden during focus mode. */}
        {!focusMode && <BottomTabNav pathname={pathname} links={links} />}
      </div>
    </MotionConfig>
  );
}

/**
 * D17 — top status bar reduced to 2 metrics:
 *   🔥 série (only if streaksEnabled per D7 + currentStreak > 0)
 *   ⭐ étoiles totales (only if any earned)
 *
 * D8 — Cold-start: renders nothing when neither has been earned, so a brand
 * new student never sees a row of zeros that frames the experience as
 * "you have nothing yet".
 */
function StudentStatusBar() {
  const stats = useQuery(api.students.getMyStats);
  if (!stats) return null;

  const showStreak = stats.streaksEnabled && stats.currentStreak > 0;
  const showStars = stats.totalStars > 0;

  if (!showStreak && !showStars) return null;

  return (
    <div className="flex items-center gap-1.5">
      {showStreak && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-sm font-bold text-orange-700"
          aria-label={`Série de ${stats.currentStreak} jour${stats.currentStreak > 1 ? "s" : ""}`}
        >
          <Flame
            className="h-4 w-4 fill-orange-500 text-orange-500"
            aria-hidden
          />
          <span>{stats.currentStreak}</span>
        </span>
      )}
      {showStars && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-1 text-sm font-bold text-yellow-800"
          aria-label={`${stats.totalStars} étoiles gagnées`}
        >
          <Star
            className="h-4 w-4 fill-yellow-500 text-yellow-500"
            aria-hidden
          />
          <span>{stats.totalStars}</span>
        </span>
      )}
    </div>
  );
}

function BottomTabNav({
  pathname,
  links,
}: {
  pathname: string;
  links: typeof navLinks;
}) {
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed bottom-0 left-0 right-0 z-10 border-t border-amber-100 bg-white/95 backdrop-blur-md sm:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1.5">
        {links.map((link) => {
          const isActive =
            pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              // D15 — 56px tap target (>44px WCAG 2.5.5 AA).
              className={`flex min-h-14 min-w-16 flex-col items-center justify-center gap-0.5 rounded-2xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                isActive
                  ? "text-orange-600"
                  : "text-gray-500 active:text-orange-600"
              }`}
            >
              <link.icon
                className={`h-6 w-6 ${isActive ? "fill-orange-100" : ""}`}
                aria-hidden
              />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
