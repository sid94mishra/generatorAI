// ────────────────────────────────────────────────────────────────
// appPreferences — small, genuinely-wired app-level preferences that
// live in localStorage (no server round-trip). Read at the point of
// use so a change in Settings takes effect on the next relevant action.
// ────────────────────────────────────────────────────────────────

const DEFAULT_CHAT_MODEL_KEY = 'generatorai:defaultChatModel';

/** Preferred model id for NEW chats (empty = provider default). Read by CreateChatDialog. */
export function getDefaultChatModel(): string {
  try {
    return window.localStorage.getItem(DEFAULT_CHAT_MODEL_KEY) ?? '';
  } catch {
    return '';
  }
}
export function setDefaultChatModel(modelId: string): void {
  try {
    if (modelId) window.localStorage.setItem(DEFAULT_CHAT_MODEL_KEY, modelId);
    else window.localStorage.removeItem(DEFAULT_CHAT_MODEL_KEY);
  } catch {
    /* ignore private-mode / quota errors */
  }
}

export const APP_PREF_KEYS = {
  defaultChatModel: DEFAULT_CHAT_MODEL_KEY,
} as const;
