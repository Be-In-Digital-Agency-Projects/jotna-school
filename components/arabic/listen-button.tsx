"use client";

/**
 * LE BOUTON « ÉCOUTER » — la brique la plus utilisée du module.
 *
 * Il demande au serveur l'audio d'un texte du parcours (`arabic.voice.speak`),
 * puis le joue. Le serveur met le fichier en cache ; ce composant met en cache
 * l'URL, pour qu'un enfant qui réécoute dix fois la même lettre ne déclenche
 * qu'UN aller-retour — le reste est du `<audio>` local.
 *
 * LE CACHE EST AU NIVEAU DU MODULE, pas du composant : la même lettre est
 * affichée par la carte, par le QCM et par l'exercice de prononciation, et
 * c'est le même son. Une `Map` de quelques dizaines d'URL, vidée au
 * rechargement de la page — rien à invalider, l'URL de stockage Convex ne
 * change pas tant que le clip existe.
 *
 * IL IGNORE LE RÉGLAGE « SONS » DE L'ESPACE ÉLÈVE, et c'est voulu : ce réglage
 * (`lib/sounds`) coupe les bruitages de récompense, qui sont un ornement. Ici,
 * le son EST la leçon — couper la voix reviendrait à retirer le tableau de la
 * classe.
 *
 * IL NE LÈVE JAMAIS. Sans clé de synthèse, sans réseau, ou si le fournisseur
 * refuse, il affiche une ligne sobre et la leçon continue : on peut apprendre
 * à écrire une lettre sans l'entendre, et un module qui s'arrête parce qu'une
 * API est muette ne sert personne.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { arabicCopy } from "@/lib/arabic/copy";

export type SpeechRef =
  | { kind: "letterName"; letterKey: string }
  | {
      kind: "letterSyllable";
      letterKey: string;
      haraka: "fatha" | "kasra" | "damma";
    }
  | { kind: "lessonItem"; lessonKey: string; itemKey: string };

/** URL par référence, pour la durée de la page. */
const urlCache = new Map<string, string>();

function cacheKeyOf(ref: SpeechRef): string {
  return JSON.stringify(ref);
}

type State = "idle" | "loading" | "playing" | "unavailable" | "not_configured";

export function ListenButton({
  speechRef,
  label,
  variant = "primary",
  className = "",
  onUnavailable,
}: {
  speechRef: SpeechRef;
  label?: string;
  variant?: "primary" | "ghost" | "chip";
  className?: string;
  onUnavailable?: (reason: string) => void;
}) {
  const speak = useAction(api.arabic.voice.speak);
  const [state, setState] = useState<State>("idle");
  const [played, setPlayed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Un composant démonté ne doit ni jouer ni réveiller un état disparu.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const play = useCallback(
    async (url: string) => {
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      setState("playing");
      audio.onended = () => setState("idle");
      audio.onerror = () => setState("unavailable");
      try {
        await audio.play();
        setPlayed(true);
      } catch {
        // Lecture refusée par le navigateur (geste utilisateur manquant) :
        // le bouton redevient simplement cliquable.
        setState("idle");
      }
    },
    [],
  );

  const handleClick = useCallback(async () => {
    const key = cacheKeyOf(speechRef);
    const cached = urlCache.get(key);
    if (cached) {
      await play(cached);
      return;
    }

    setState("loading");
    try {
      const result = await speak({ ref: speechRef });
      if (result.status === "ready") {
        urlCache.set(key, result.url);
        await play(result.url);
        return;
      }
      const unavailableState =
        result.reason === "not_configured" ? "not_configured" : "unavailable";
      setState(unavailableState);
      onUnavailable?.(result.reason);
    } catch {
      setState("unavailable");
      onUnavailable?.("network");
    }
  }, [onUnavailable, play, speak, speechRef]);

  if (state === "not_configured" || state === "unavailable") {
    return (
      <span
        className={`inline-flex items-center gap-2 rounded-2xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-500 ${className}`}
      >
        <VolumeX className="h-4 w-4" aria-hidden />
        {state === "not_configured"
          ? arabicCopy.listen.notConfigured
          : arabicCopy.listen.unavailable}
      </span>
    );
  }

  const busy = state === "loading";
  const text =
    label ??
    (busy
      ? arabicCopy.listen.loading
      : played
        ? arabicCopy.listen.replay
        : arabicCopy.listen.idle);

  const styles =
    variant === "primary"
      ? "bg-teal-600 text-white shadow-md shadow-teal-200 hover:bg-teal-700"
      : variant === "chip"
        ? "bg-white text-teal-700 border-2 border-teal-200 hover:border-teal-400"
        : "text-teal-700 hover:bg-teal-50";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-label={`${arabicCopy.listen.idle} — ${describe(speechRef)}`}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-base font-bold transition-all disabled:opacity-70 ${styles} ${className}`}
    >
      {busy ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      ) : (
        <Volume2
          className={`h-5 w-5 ${state === "playing" ? "animate-pulse" : ""}`}
          aria-hidden
        />
      )}
      <span>{text}</span>
    </button>
  );
}

/** Libellé d'accessibilité — un lecteur d'écran ne voit pas l'arabe affiché. */
function describe(ref: SpeechRef): string {
  if (ref.kind === "letterName") return `nom de la lettre ${ref.letterKey}`;
  if (ref.kind === "letterSyllable") {
    return `lettre ${ref.letterKey} avec la ${ref.haraka}`;
  }
  return "le texte de la leçon";
}
