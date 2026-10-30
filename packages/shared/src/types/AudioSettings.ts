// ────────────────────────────────────────────────────────────────
// Settings › Audio wire shapes (`GET/PUT /api/system/audio`,
// `GET/POST/DELETE /api/system/audio/model`) — typed for client-core
// (mobile MG-22) with the dictation language of MG-17.
//
// The server owns these preferences (`apps/server/src/settings/audio.ts`):
// they decide how the SERVER builds a voice session, so every client reads
// the same values.
// ────────────────────────────────────────────────────────────────

export interface AudioSettingsView {
  sttEngine: string;
  textFormatter: string;
  endpointSilenceMs: number;
  interimResults: boolean;
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsSpeed: number;
  /**
   * MG-17 — dictation language: `'auto'` (the engine detects it) or a
   * BCP-47 tag. Used when a dictation session does not name its own.
   * Absent from servers older than MG-17 (read as `'auto'`).
   */
  sttLanguage?: string;
  engines: readonly string[];
  formatters: readonly string[];
  minEndpointMs: number;
  maxEndpointMs: number;
  /** Set when `GENERATORAI_STT_ENGINE` pins the engine (the UI control is then read-only). */
  engineLockedByEnv: string | null;
}

export type AudioSettingsUpdate = Partial<
  Pick<
    AudioSettingsView,
    'sttEngine' | 'textFormatter' | 'endpointSilenceMs' | 'interimResults' | 'ttsEnabled' | 'ttsVoice' | 'ttsSpeed' | 'sttLanguage'
  >
>;

export interface AudioModelStatus {
  present: boolean;
  dir?: string;
  repo?: string;
  bytesOnDisk?: number;
  approxTotalBytes?: number;
  downloading?: boolean;
  /** 0–1. */
  progress?: number;
  error?: string;
  /**
   * MG-17 — BCP-47 tags the installed model can be told to transcribe.
   * Empty when it only auto-detects (the multilingual Nemotron ONNX build
   * takes no locale: auto covers its 40 locales). Absent before MG-17.
   */
  languages?: string[];
}
