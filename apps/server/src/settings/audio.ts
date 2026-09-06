// ────────────────────────────────────────────────────────────────
// Audio preferences — speech-to-text and text-to-speech, from Settings.
//
// Modelled on `computerUse.ts` / `workspaceRetention.ts`: a JSON file next to
// the database, read on demand so a change applies without a restart.
//
// WHY THESE LIVE SERVER-SIDE
// --------------------------
// Every one of them decides how the SERVER builds a voice session — which
// engine loads, whether the dictation cleanup pass runs, which voice speaks.
// A browser-local preference would be wrong twice over: the desktop app and
// the mobile client would each get their own, and none of them would apply to
// a dictation session opened from a different device.
//
// The environment stays the operator override. Anything set through
// `GENERATORAI_STT_ENGINE` and friends wins, because an operator pinning an
// engine in a deployment must not be silently overridden from a UI.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_FILE = 'audio.json';

/** Engine ids the UI may choose. Mirrors `SttEngineId` minus `disabled`. */
export const STT_ENGINE_CHOICES = ['auto', 'nemotron', 'moonshine', 'parakeet', 'whisper'] as const;
export type SttEngineChoice = (typeof STT_ENGINE_CHOICES)[number];

/** How dictated text is cleaned up before it reaches the composer. */
export const TEXT_FORMATTER_CHOICES = ['rule-based', 'none'] as const;
export type TextFormatterChoice = (typeof TEXT_FORMATTER_CHOICES)[number];

export interface AudioPreferences {
  /** Which STT engine to use. `auto` prefers Nemotron when its weights exist. */
  sttEngine: SttEngineChoice;
  /**
   * Spoken-punctuation and filler cleanup. `none` hands through exactly what
   * the model emitted — useful for judging the model, useless for dictation,
   * because "comma" then stays the word "comma".
   */
  textFormatter: TextFormatterChoice;
  /** Silence (ms) that ends an utterance on the streaming path. */
  endpointSilenceMs: number;
  /** Live partial transcripts while speaking. */
  interimResults: boolean;
  /** Voice output. */
  ttsEnabled: boolean;
  ttsVoice: string;
  /** 0.5–2.0. */
  ttsSpeed: number;
}

export const AUDIO_DEFAULTS: AudioPreferences = {
  sttEngine: 'auto',
  textFormatter: 'rule-based',
  endpointSilenceMs: 800,
  interimResults: true,
  ttsEnabled: true,
  ttsVoice: 'af_heart',
  ttsSpeed: 1.0,
};

export const MIN_ENDPOINT_MS = 200;
export const MAX_ENDPOINT_MS = 3000;

function stateFilePath(dataDir: string): string {
  return path.join(dataDir, STATE_FILE);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < min || value > max) return fallback;
  return value;
}

function normalize(raw: Partial<AudioPreferences> | null): AudioPreferences {
  const engine = STT_ENGINE_CHOICES.includes(raw?.sttEngine as SttEngineChoice)
    ? (raw?.sttEngine as SttEngineChoice)
    : AUDIO_DEFAULTS.sttEngine;
  const formatter = TEXT_FORMATTER_CHOICES.includes(raw?.textFormatter as TextFormatterChoice)
    ? (raw?.textFormatter as TextFormatterChoice)
    : AUDIO_DEFAULTS.textFormatter;
  return {
    sttEngine: engine,
    textFormatter: formatter,
    endpointSilenceMs: clampNumber(
      raw?.endpointSilenceMs,
      MIN_ENDPOINT_MS,
      MAX_ENDPOINT_MS,
      AUDIO_DEFAULTS.endpointSilenceMs,
    ),
    interimResults: raw?.interimResults !== false,
    ttsEnabled: raw?.ttsEnabled !== false,
    ttsVoice: typeof raw?.ttsVoice === 'string' && raw.ttsVoice ? raw.ttsVoice : AUDIO_DEFAULTS.ttsVoice,
    ttsSpeed: clampNumber(raw?.ttsSpeed, 0.5, 2.0, AUDIO_DEFAULTS.ttsSpeed),
  };
}

/** Read the persisted preferences; anything unreadable resolves to defaults. */
export function readAudioPreferences(dataDir: string): AudioPreferences {
  try {
    const raw = fs.readFileSync(stateFilePath(dataDir), 'utf8');
    return normalize(JSON.parse(raw) as Partial<AudioPreferences> | null);
  } catch {
    return { ...AUDIO_DEFAULTS };
  }
}

/** Persist the preferences, normalized. Returns what was actually written. */
export function writeAudioPreferences(
  dataDir: string,
  prefs: Partial<AudioPreferences>,
): AudioPreferences {
  const merged = normalize({ ...readAudioPreferences(dataDir), ...prefs });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    stateFilePath(dataDir),
    `${JSON.stringify({ ...merged, updatedAt: Date.now() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return merged;
}
