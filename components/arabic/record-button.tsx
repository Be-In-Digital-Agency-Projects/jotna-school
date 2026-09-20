"use client";

/**
 * « À TOI ! » — l'enfant appuie, répète, et le module lui répond.
 *
 * LE PARCOURS D'UNE RÉPÉTITION, en cinq temps :
 *   1. on demande le micro (`getUserMedia`) — la première fois seulement, le
 *      navigateur retient ensuite l'autorisation pour cette origine ;
 *   2. `MediaRecorder` enregistre, au plus `MAX_MS` ;
 *   3. les octets partent dans l'action `verifyPronunciation` ;
 *   4. le serveur transcrit, compare, note, et écrit la tentative ;
 *   5. l'enfant lit un verdict et ce qui a été entendu.
 *
 * LE MICRO SE COUPE TOUJOURS. `stream.getTracks().forEach(stop)` est appelé à
 * l'arrêt, à l'erreur ET au démontage : un onglet qui garde la pastille rouge
 * d'enregistrement après une leçon est un manquement, pas un détail —
 * a fortiori sur le téléphone d'un enfant.
 *
 * LA DURÉE EST BORNÉE À HUIT SECONDES. Personne ne met huit secondes à dire
 * « bâ » ; la borne existe pour le doigt resté appuyé et pour l'enfant qui
 * oublie le bouton. Elle protège aussi la facture (chaque envoi est un appel
 * facturé) et la vie privée : une conversation de classe n'a pas à partir en
 * transcription.
 *
 * RIEN N'EST CONSERVÉ. Le `Blob` vit le temps de l'envoi ; aucune trace n'est
 * écrite ni côté navigateur ni côté serveur (voir `convex/arabic/voice.ts`).
 *
 * L'APPELANT DOIT LUI DONNER UNE `key` QUI CHANGE AVEC L'ITEM. Le verdict de
 * la lettre précédente ne doit pas rester affiché sous la suivante, et c'est
 * React qui remet l'état à neuf en remontant le composant — pas un effet qui
 * remettrait les états à zéro après coup, et ferait clignoter l'ancien verdict
 * sous la nouvelle lettre le temps d'un rendu.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { Loader2, Mic, Square } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { arabicCopy, verdictMessage } from "@/lib/arabic/copy";
import type { PronunciationVerdict } from "@/convex/arabic/matching";

/** Huit secondes : très au-delà d'une syllabe, très en deçà d'une discussion. */
const MAX_MS = 8000;

/** Par ordre de préférence — le premier que le navigateur sait produire gagne. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

export interface RecordOutcome {
  verdict: PronunciationVerdict;
  score: number;
  heard: string;
  missing: string[];
}

type Phase = "idle" | "recording" | "sending" | "done" | "blocked";

export function RecordButton({
  lessonKey,
  itemKey,
  drill,
  onOutcome,
  attemptIndex,
}: {
  lessonKey: string;
  itemKey: string;
  drill: "pronounce" | "read";
  onOutcome: (outcome: RecordOutcome) => void;
  /** Sert à choisir la phrase de verdict sans hasard. */
  attemptIndex: number;
}) {
  const verify = useAction(api.arabic.voice.verifyPronunciation);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const releaseMic = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseMic();
    };
  }, [releaseMic]);

  const send = useCallback(
    async (blob: Blob, mimeType: string) => {
      setPhase("sending");
      try {
        const audio = await blob.arrayBuffer();
        const result = await verify({
          lessonKey,
          itemKey,
          drill,
          audio,
          mimeType,
        });
        if (!mountedRef.current) return;

        if (result.status === "judged") {
          setPhase("done");
          setMessage(verdictMessage(result.verdict, attemptIndex));
          setHeard(result.heard || null);
          onOutcome({
            verdict: result.verdict,
            score: result.score,
            heard: result.heard,
            missing: result.missing,
          });
          return;
        }

        setPhase("blocked");
        setMessage(
          result.status === "quota_reached"
            ? arabicCopy.record.quota
            : arabicCopy.record.unavailable,
        );
      } catch {
        if (!mountedRef.current) return;
        setPhase("blocked");
        setMessage(arabicCopy.record.unavailable);
      }
    },
    [attemptIndex, drill, itemKey, lessonKey, onOutcome, verify],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    setMessage(null);
    setHeard(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setPhase("blocked");
      setMessage(arabicCopy.record.unsupported);
      return;
    }

    const mimeType = MIME_CANDIDATES.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    );
    if (!mimeType) {
      setPhase("blocked");
      setMessage(arabicCopy.record.unsupported);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase("blocked");
      setMessage(arabicCopy.record.denied);
      return;
    }

    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    streamRef.current = stream;
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMic();
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size === 0) {
        setPhase("idle");
        return;
      }
      void send(blob, mimeType);
    };

    recorder.start();
    setPhase("recording");
    timerRef.current = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, MAX_MS);
  }, [releaseMic, send]);

  const busy = phase === "sending";

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={phase === "recording" ? stop : start}
        disabled={busy}
        className={`flex min-h-14 w-full items-center justify-center gap-3 rounded-3xl px-6 py-4 text-lg font-extrabold text-white shadow-lg transition-all disabled:opacity-70 ${
          phase === "recording"
            ? "animate-pulse bg-red-500 shadow-red-200"
            : "bg-orange-500 shadow-orange-200 hover:bg-orange-600"
        }`}
      >
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        ) : phase === "recording" ? (
          <Square className="h-6 w-6 fill-white" aria-hidden />
        ) : (
          <Mic className="h-6 w-6" aria-hidden />
        )}
        <span>
          {busy
            ? arabicCopy.record.sending
            : phase === "recording"
              ? arabicCopy.record.recording
              : phase === "done"
                ? arabicCopy.record.again
                : arabicCopy.record.idle}
        </span>
      </button>

      {message && (
        <p
          role="status"
          className="rounded-2xl bg-white px-4 py-3 text-center text-base font-semibold text-gray-800 shadow-sm"
        >
          {message}
          {heard && (
            <span className="mt-1 block text-sm font-medium text-gray-500">
              {arabicCopy.heardPrefix}{" "}
              <span dir="rtl" lang="ar" className="font-arabic text-lg">
                {heard}
              </span>
            </span>
          )}
        </p>
      )}
    </div>
  );
}
