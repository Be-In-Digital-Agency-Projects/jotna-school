"use client";

import { useRef, useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Users, ChevronDown, UserCircle } from "lucide-react";

/**
 * KidSwitcher — Decision 85
 *
 * Compact indicator in the parent header showing linked children.
 * - 0 children: renders nothing
 * - 1 child: static label
 * - 2+ children: dropdown (purely informational for MVP)
 */
export function KidSwitcher() {
  const profile = useQuery(api.profiles.getCurrentProfile);
  // Le tuteur est dérivé de la session côté serveur : plus d'argument, donc
  // plus de "skip" en attente du profil. Le garde de chargement ci-dessous
  // attend toujours les deux requêtes.
  const children = useQuery(api.profiles.getChildren);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Loading or no profile yet
  if (profile === undefined || children === undefined) return null;
  if (profile === null) return null;

  // Filter out nulls (getChildren can return null entries)
  const kids = (children ?? []).filter(
    (c): c is NonNullable<typeof c> => c !== null,
  );

  // 0 children: render nothing
  if (kids.length === 0) return null;

  // 1 child: static label
  if (kids.length === 1) {
    const kid = kids[0];
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
        <UserCircle className="h-3.5 w-3.5" />
        <span className="max-w-[120px] truncate">{kid.name}</span>
      </div>
    );
  }

  // 2+ children: dropdown indicator
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-md bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100 transition-colors"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Users className="h-3.5 w-3.5" />
        <span>{kids.length} enfants</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {kids.map((kid) => (
            <li
              key={kid._id}
              role="option"
              aria-selected={false}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              {kid.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={kid.avatar}
                  alt={kid.name}
                  className="h-5 w-5 rounded-full object-cover"
                />
              ) : (
                <UserCircle className="h-5 w-5 text-gray-300" />
              )}
              <span className="truncate">{kid.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
