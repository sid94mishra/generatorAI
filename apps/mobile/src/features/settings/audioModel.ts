// ────────────────────────────────────────────────────────────────
// Audio settings — the shape of `/api/system/audio` and the copy the screen
// shows for it. The labels are the desktop Settings ▸ Audio labels, so an
// engine is called the same thing on both clients. Pure: tested without a
// renderer.
//
// The microphone picker on desktop is not here on purpose: it chooses an input
// device of THAT machine. A phone records from its own microphone, which the
// OS routes (built-in, wired or Bluetooth headset) without an app setting.
// ────────────────────────────────────────────────────────────────

export interface AudioSettings {
  sttEngine: string;
  textFormatter: string;
  endpointSilenceMs: number;
  interimResults?: boolean;
  ttsEnabled: boolean;
  ttsVoice?: string;
  ttsSpeed: number;
  engines: string[];
  formatters: string[];
  minEndpointMs: number;
  maxEndpointMs: number;
  /** Set when the operator pinned the engine in the server's environment. */
  engineLockedByEnv: string | null;
}

export const ENGINE_LABEL: Record<string, string> = {
  auto: 'Automatic (recommended)',
  nemotron: 'Nemotron 3.5 ASR',
  moonshine: 'Moonshine Base',
  parakeet: 'Parakeet CTC',
  whisper: 'Whisper base.en',
};

export const ENGINE_DETAIL: Record<string, string> = {
  auto: 'The best engine installed on your server.',
  nemotron: 'Streaming, multilingual, punctuation and capitals.',
  moonshine: 'Fastest. English only.',
  parakeet: 'No punctuation.',
  whisper: 'Slowest, most forgiving.',
};

export const FORMATTER_LABEL: Record<string, string> = {
  'rule-based': 'On',
  none: 'Off',
};

export const FORMATTER_DETAIL: Record<string, string> = {
  'rule-based': 'Spoken punctuation (“comma”, “new line”) and filler cleanup.',
  none: 'Exactly what the model transcribed.',
};

export function engineLabel(id: string): string {
  return ENGINE_LABEL[id] ?? id;
}

export function formatterLabel(id: string): string {
  return FORMATTER_LABEL[id] ?? id;
}

/** Candidate pause lengths, in ms. Desktop has a number field; a phone gets stops. */
const PAUSE_STOPS = [400, 600, 800, 1000, 1200, 1500, 2000, 3000] as const;

/**
 * The pause-before-committing stops on offer: the standard stops inside the
 * server's bounds, plus the current value when it is not one of them (it was
 * set from desktop), so the screen never shows a selection it cannot display.
 */
export function pauseStops(min: number, max: number, current: number): number[] {
  const stops = PAUSE_STOPS.filter((ms) => ms >= min && ms <= max) as number[];
  if (Number.isFinite(current) && current >= min && current <= max && !stops.includes(current)) stops.push(current);
  return stops.sort((a, b) => a - b);
}

export function pauseLabel(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${(ms / 1000).toFixed(1)}s`;
}

export const SPEED_STOPS = [0.75, 1, 1.25, 1.5, 2] as const;

export function speedLabel(speed: number): string {
  return `${Number.isInteger(speed) ? speed.toFixed(0) : String(speed)}×`;
}

/** Read the payload defensively: an older server may omit the newer fields. */
export function parseAudioSettings(raw: unknown): AudioSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v ? v : fallback);
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const list = (v: unknown, fallback: string[]): string[] =>
    Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length > 0 ? (v as string[]) : fallback;
  return {
    sttEngine: str(r['sttEngine'], 'auto'),
    textFormatter: str(r['textFormatter'], 'rule-based'),
    endpointSilenceMs: num(r['endpointSilenceMs'], 800),
    ...(typeof r['interimResults'] === 'boolean' ? { interimResults: r['interimResults'] } : {}),
    ttsEnabled: r['ttsEnabled'] !== false,
    ...(typeof r['ttsVoice'] === 'string' ? { ttsVoice: r['ttsVoice'] } : {}),
    ttsSpeed: num(r['ttsSpeed'], 1),
    engines: list(r['engines'], ['auto']),
    formatters: list(r['formatters'], ['rule-based', 'none']),
    minEndpointMs: num(r['minEndpointMs'], 300),
    maxEndpointMs: num(r['maxEndpointMs'], 5000),
    engineLockedByEnv: typeof r['engineLockedByEnv'] === 'string' && r['engineLockedByEnv'] ? r['engineLockedByEnv'] : null,
  };
}
