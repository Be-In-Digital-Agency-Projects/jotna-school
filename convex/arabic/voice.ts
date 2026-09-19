"use node";

/**
 * LA VOIX DU MODULE — faire entendre l'arabe, et écouter l'enfant le redire.
 *
 * DEUX ACTIONS, DEUX SENS :
 *   - `speak` fabrique l'audio d'un texte du parcours (nom de lettre,
 *     syllabe, mot, verset) et rend une URL. Le résultat est MIS EN CACHE :
 *     le texte du module est fini, donc chaque son n'est payé qu'une fois pour
 *     toutes les écoles et tous les enfants ;
 *   - `verifyPronunciation` reçoit quelques secondes d'enregistrement, les
 *     fait transcrire, compare à ce qui était attendu (`matching.ts`) et rend
 *     un verdict.
 *
 * LE FOURNISSEUR EST ELEVENLABS. C'est ce que demandait la commande (« une
 * belle voix en arabe, douce et compréhensible ») : leur modèle multilingue
 * lit l'arabe vocalisé, et leur transcription (Scribe) le rend. Tout passe par
 * `voiceConfig()` — clé, voix, modèles — de sorte qu'aucun identifiant n'est
 * écrit en dur et qu'un changement de fournisseur se fasse dans ce seul
 * fichier.
 *
 * RIEN NE MARCHE SANS CLÉ, ET RIEN NE CASSE NON PLUS. Sans
 * `ELEVENLABS_API_KEY`, les deux actions rendent un état « indisponible » que
 * l'écran sait afficher : la leçon continue sans le son, l'enfant lit la
 * translittération et s'auto-évalue. Un module d'apprentissage qui tombe en
 * panne parce qu'une variable d'environnement manque n'est pas acceptable dans
 * une salle de classe.
 *
 * ON NE SYNTHÉTISE QUE CE QUE LE PARCOURS CONTIENT. Les actions prennent une
 * RÉFÉRENCE (une lettre, un item de leçon), jamais un texte libre, et
 * résolvent le texte ici, depuis `alphabet.ts` et `curriculum.ts`. Exposer
 * « dis ce que je te donne » ferait de ce dépôt un générateur de voix gratuit
 * pour qui possède un compte élève.
 *
 * LA VOIX DE L'ENFANT NE SE POSE NULLE PART. Les octets arrivent en argument,
 * partent en transcription, et disparaissent avec la fin de l'action : ni
 * stockage, ni table, ni journal. Même la transcription n'est pas écrite — on
 * la rend à l'écran pour que l'enfant voie ce qui a été entendu, et elle
 * s'efface avec la page. Ce qui reste en base est ce qu'un cahier garderait :
 * la date, l'exercice, et si c'était juste.
 *
 * `"use node"` : ce fichier n'exporte QUE des actions (guidelines du dépôt) —
 * ses lectures et écritures vivent dans `./db.ts`. Le runtime Node garantit
 * `fetch`, `FormData` et `Blob`, dont dépend l'envoi multipart de l'audio.
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { getLetter } from "./alphabet";
import { getLesson } from "./curriculum";
import {
  acceptedFormsForLetter,
  judgePronunciation,
  judgeReading,
  type PronunciationVerdict,
} from "./matching";

const API_BASE = "https://api.elevenlabs.io/v1";

/**
 * Le modèle de synthèse par défaut.
 *
 * `eleven_multilingual_v2` lit l'arabe vocalisé et respecte les voyelles
 * brèves — c'est ce qui compte ici : un modèle qui les ignore prononcerait
 * « بَ » et « بِ » de la même façon, et le niveau 2 du parcours n'aurait plus
 * d'objet. Surchargeable par `ELEVENLABS_MODEL_ID`.
 */
const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";
const DEFAULT_STT_MODEL = "scribe_v1";

/** ISO-639-3. Leur API accepte aussi « ar » ; on fixe le plus explicite. */
const DEFAULT_STT_LANGUAGE = "ara";

/**
 * Deux mégaoctets d'audio, soit très largement les huit secondes que l'écran
 * s'autorise à enregistrer. Au-delà, on refuse sans appeler : ce n'est plus un
 * enfant qui répète une lettre.
 */
const MAX_AUDIO_BYTES = 2_000_000;

/** Les formats qu'un navigateur produit avec `MediaRecorder`. */
const ALLOWED_MIME: Readonly<Record<string, string>> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

interface VoiceConfig {
  apiKey: string;
  voiceId: string;
  ttsModel: string;
  sttModel: string;
  sttLanguage: string;
  /** 0,7 à 1,2 chez ElevenLabs. Absent = vitesse naturelle du modèle. */
  speed: number | null;
}

/**
 * La configuration, ou `null` si le fournisseur n'est pas branché.
 *
 * `ELEVENLABS_VOICE_ID` n'a PAS de valeur par défaut, et c'est délibéré :
 * choisir une voix est une décision pédagogique (on veut une diction douce et
 * lente, pas une voix de présentateur), elle dépend du compte qui la possède,
 * et un identifiant inventé ici produirait soit une erreur, soit — pire — une
 * voix que personne n'a écoutée avant de la donner à des enfants. Le mode
 * d'emploi est dans `docs/module-arabe-coran.md`.
 */
function voiceConfig(): VoiceConfig | null {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) return null;

  const rawSpeed = Number(process.env.ELEVENLABS_SPEED);
  return {
    apiKey,
    voiceId,
    ttsModel: process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_TTS_MODEL,
    sttModel: process.env.ELEVENLABS_STT_MODEL_ID ?? DEFAULT_STT_MODEL,
    sttLanguage: process.env.ELEVENLABS_STT_LANGUAGE ?? DEFAULT_STT_LANGUAGE,
    speed:
      Number.isFinite(rawSpeed) && rawSpeed >= 0.7 && rawSpeed <= 1.2
        ? rawSpeed
        : null,
  };
}

// ---------------------------------------------------------------------------
// Références de texte — ce qu'on accepte de faire dire.
// ---------------------------------------------------------------------------

const refValidator = v.union(
  v.object({
    kind: v.literal("letterName"),
    letterKey: v.string(),
  }),
  v.object({
    kind: v.literal("letterSyllable"),
    letterKey: v.string(),
    haraka: v.union(
      v.literal("fatha"),
      v.literal("kasra"),
      v.literal("damma"),
    ),
  }),
  v.object({
    kind: v.literal("lessonItem"),
    lessonKey: v.string(),
    itemKey: v.string(),
  }),
);

type SpeechRef =
  | { kind: "letterName"; letterKey: string }
  | { kind: "letterSyllable"; letterKey: string; haraka: "fatha" | "kasra" | "damma" }
  | { kind: "lessonItem"; lessonKey: string; itemKey: string };

/** Le texte arabe désigné par une référence, ou `null` si elle ne désigne rien. */
function resolveText(ref: SpeechRef): string | null {
  if (ref.kind === "letterName") {
    return getLetter(ref.letterKey)?.nameAr ?? null;
  }
  if (ref.kind === "letterSyllable") {
    const letter = getLetter(ref.letterKey);
    return letter ? letter.syllables[ref.haraka] : null;
  }
  const lesson = getLesson(ref.lessonKey);
  if (!lesson) return null;

  const item = lesson.items.find((candidate) => candidate.key === ref.itemKey);
  if (item) return item.ar;

  // Une leçon d'alphabet n'a pas d'items : ses « items » sont ses lettres, et
  // l'écran demande le NOM quand il désigne une lettre.
  if ((lesson.letters as readonly string[]).includes(ref.itemKey)) {
    return getLetter(ref.itemKey)?.nameAr ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Action 1 — faire entendre
// ---------------------------------------------------------------------------

type SpeakResult =
  | { status: "ready"; url: string; cached: boolean }
  | {
      status: "unavailable";
      reason: "not_configured" | "not_allowed" | "unknown_text" | "provider_error";
    };

export const speak = action({
  args: { ref: refValidator },
  handler: async (ctx, args): Promise<SpeakResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { status: "unavailable", reason: "not_allowed" };

    const caller = await ctx.runQuery(internal.arabic.db.callerContext, {
      userId: userId as string,
    });
    if (!caller.enabled || !caller.profileId) {
      return { status: "unavailable", reason: "not_allowed" };
    }

    const text = resolveText(args.ref as SpeechRef);
    if (!text) return { status: "unavailable", reason: "unknown_text" };

    const config = voiceConfig();
    if (!config) return { status: "unavailable", reason: "not_configured" };

    // La clé porte la voix ET le modèle : changer de voix ne resservira pas
    // l'ancienne. Le texte est court (un verset au plus), donc lisible tel
    // quel dans le tableau de bord — pas d'empreinte à déchiffrer.
    const cacheKey = `${config.voiceId}|${config.ttsModel}|${text}`;

    const cached = await ctx.runQuery(internal.arabic.db.findClip, { cacheKey });
    if (cached) {
      const url = await ctx.storage.getUrl(cached.storageId);
      if (url) return { status: "ready", url, cached: true };
      // Le fichier a disparu du stockage sans que la ligne suive : on
      // resynthétise plutôt que de rendre une URL morte.
    }

    let audio: Blob;
    try {
      audio = await synthesize(text, config);
    } catch (error) {
      console.error("[arabe] synthèse vocale en échec", error);
      return { status: "unavailable", reason: "provider_error" };
    }

    const storageId = await ctx.storage.store(audio);
    const saved: { storageId: Id<"_storage"> } = await ctx.runMutation(
      internal.arabic.db.saveClip,
      {
        cacheKey,
        text,
        voiceId: config.voiceId,
        modelId: config.ttsModel,
        storageId,
        bytes: audio.size,
      },
    );

    if (caller.isStudent) {
      await ctx.runMutation(internal.arabic.db.addTtsChars, {
        studentId: caller.profileId,
        chars: text.length,
      });
    }

    const url = await ctx.storage.getUrl(saved.storageId);
    if (!url) return { status: "unavailable", reason: "provider_error" };
    return { status: "ready", url, cached: false };
  },
});

/** Appelle la synthèse et rend le mp3. Lève si le fournisseur refuse. */
async function synthesize(text: string, config: VoiceConfig): Promise<Blob> {
  const response = await fetch(
    `${API_BASE}/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: config.ttsModel,
        voice_settings: {
          // Une diction POSÉE : on privilégie la stabilité sur l'expressivité,
          // parce qu'un enfant copie ce qu'il entend et qu'une lecture
          // théâtrale déforme les voyelles brèves.
          stability: 0.6,
          similarity_boost: 0.8,
          style: 0,
          use_speaker_boost: true,
          ...(config.speed !== null ? { speed: config.speed } : {}),
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `elevenlabs tts ${response.status}: ${detail.slice(0, 200)}`,
    );
  }
  return await response.blob();
}

// ---------------------------------------------------------------------------
// Action 2 — écouter l'enfant
// ---------------------------------------------------------------------------

type VerifyResult =
  | {
      status: "judged";
      verdict: PronunciationVerdict;
      score: number;
      /** Ce que la transcription a entendu — affiché, jamais écrit en base. */
      heard: string;
      /** Les mots du verset qui manquaient. Vide hors lecture suivie. */
      missing: string[];
      remaining: number;
    }
  | { status: "quota_reached" }
  | {
      status: "unavailable";
      reason:
        | "not_configured"
        | "not_allowed"
        | "unknown_text"
        | "audio_too_large"
        | "unsupported_format"
        | "provider_error";
    };

export const verifyPronunciation = action({
  args: {
    lessonKey: v.string(),
    itemKey: v.string(),
    drill: v.union(v.literal("pronounce"), v.literal("read")),
    audio: v.bytes(),
    mimeType: v.string(),
  },
  handler: async (ctx, args): Promise<VerifyResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { status: "unavailable", reason: "not_allowed" };

    const caller = await ctx.runQuery(internal.arabic.db.callerContext, {
      userId: userId as string,
    });
    // Seul un ÉLÈVE s'enregistre : un professeur qui parcourt le module écoute
    // et lit, il n'a pas de progression où écrire une tentative.
    if (!caller.enabled || !caller.profileId || !caller.isStudent) {
      return { status: "unavailable", reason: "not_allowed" };
    }

    const extension = ALLOWED_MIME[baseMime(args.mimeType)];
    if (!extension) return { status: "unavailable", reason: "unsupported_format" };
    if (args.audio.byteLength > MAX_AUDIO_BYTES) {
      return { status: "unavailable", reason: "audio_too_large" };
    }

    const expected = resolveExpected(args.lessonKey, args.itemKey);
    if (!expected) return { status: "unavailable", reason: "unknown_text" };

    const config = voiceConfig();
    if (!config) return { status: "unavailable", reason: "not_configured" };

    // Le jeton se prend AVANT l'appel — voir `db.consumeSttQuota`.
    const quota = await ctx.runMutation(internal.arabic.db.consumeSttQuota, {
      studentId: caller.profileId,
    });
    if (!quota.allowed) return { status: "quota_reached" };

    let transcript: string;
    try {
      transcript = await transcribe(
        args.audio,
        baseMime(args.mimeType),
        extension,
        config,
      );
    } catch (error) {
      console.error("[arabe] transcription en échec", error);
      return { status: "unavailable", reason: "provider_error" };
    }

    const judgement =
      expected.kind === "letter"
        ? judgePronunciation({
            accepted: expected.accepted,
            transcript,
            requireGlyph: expected.glyph,
          })
        : expected.kind === "word"
          ? judgePronunciation({
              accepted: [expected.text],
              transcript,
            })
          : judgeReading({ expected: expected.text, transcript });

    const missing = "missing" in judgement ? judgement.missing : [];

    await ctx.runMutation(internal.arabic.db.recordServerAttempt, {
      studentId: caller.profileId,
      lessonKey: args.lessonKey,
      drill: args.drill,
      itemKey: args.itemKey,
      // « Presque » compte comme réussi pour la PROGRESSION — l'enfant a
      // produit un son reconnaissable — mais la NOTE garde la nuance, et
      // c'est elle qui décide des étoiles.
      correct: judgement.verdict !== "retry",
      score: judgement.score,
      verdict: judgement.verdict,
    });

    return {
      status: "judged",
      verdict: judgement.verdict,
      score: judgement.score,
      heard: judgement.heard,
      missing,
      remaining: quota.remaining,
    };
  },
});

/** « audio/webm;codecs=opus » → « audio/webm ». */
function baseMime(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

type Expected =
  | { kind: "letter"; accepted: string[]; glyph: string }
  | { kind: "word"; text: string }
  | { kind: "ayah"; text: string };

/**
 * Ce qui était attendu, et COMMENT le juger.
 *
 * Trois régimes, parce qu'on ne juge pas de la même façon une lettre, un mot
 * et un verset : une lettre a plusieurs réponses justes (son nom, sa syllabe)
 * et une garde sur le glyphe ; un mot n'en a qu'une ; un verset se compte mot
 * à mot (`judgeReading`).
 */
function resolveExpected(lessonKey: string, itemKey: string): Expected | null {
  const lesson = getLesson(lessonKey);
  if (!lesson) return null;

  if ((lesson.letters as readonly string[]).includes(itemKey)) {
    const letter = getLetter(itemKey);
    if (!letter) return null;
    return {
      kind: "letter",
      accepted: acceptedFormsForLetter(letter),
      glyph: letter.isolated,
    };
  }

  const item = lesson.items.find((candidate) => candidate.key === itemKey);
  if (!item) return null;

  return item.ar.includes(" ")
    ? { kind: "ayah", text: item.ar }
    : { kind: "word", text: item.ar };
}

/** Envoie l'audio à la transcription et rend le texte reconnu. */
async function transcribe(
  audio: ArrayBuffer,
  mimeType: string,
  extension: string,
  config: VoiceConfig,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mimeType }), `voix.${extension}`);
  form.append("model_id", config.sttModel);
  form.append("language_code", config.sttLanguage);
  // On ne veut ni les « [rires] » ni la séparation des locuteurs : un seul
  // enfant parle, et ces annotations pollueraient la comparaison.
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");

  const response = await fetch(`${API_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": config.apiKey },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `elevenlabs stt ${response.status}: ${detail.slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as { text?: unknown };
  return typeof payload.text === "string" ? payload.text : "";
}
