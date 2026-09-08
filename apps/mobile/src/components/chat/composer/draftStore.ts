// ────────────────────────────────────────────────────────────────
// Draft + history persistence — MMKV through the prefs façade.
//
// `composer.draft.<chatId>`  the unsent text, restored on mount, cleared on
//                            send success, put back on failure
// `composer.history`         the local ring of 50 sent prompts
// `composer.voice.pushToTalk` the hold-to-talk preference (see pushToTalk.ts)
//
// Keys live here rather than in `PREF_KEYS` because that file is owned by
// the settings surface; the composer's keys are the composer's business.
// ────────────────────────────────────────────────────────────────

import { prefs } from '../../../storage/prefs';
import {
  HISTORY_KEY,
  pushHistoryRing,
  readHistoryRing,
  writeHistoryRing,
  type HistoryStorage,
} from './promptHistory';
import type { PromptHistoryEntry } from './types';

export const DRAFT_KEY_PREFIX = 'composer.draft.';

export function draftKey(chatId: string): string {
  return `${DRAFT_KEY_PREFIX}${chatId}`;
}

const storage: HistoryStorage = {
  getString: (key) => prefs.getString(key),
  setString: (key, value) => prefs.setString(key, value),
};

export function readDraft(chatId: string): string {
  return prefs.getString(draftKey(chatId)) ?? '';
}

export function writeDraft(chatId: string, text: string): void {
  if (text.length === 0) prefs.delete(draftKey(chatId));
  else prefs.setString(draftKey(chatId), text);
}

export function clearDraft(chatId: string): void {
  prefs.delete(draftKey(chatId));
}

export function readLocalHistory(): PromptHistoryEntry[] {
  return readHistoryRing(storage, HISTORY_KEY);
}

export function recordSentPrompt(entry: PromptHistoryEntry): PromptHistoryEntry[] {
  const next = pushHistoryRing(readLocalHistory(), entry);
  writeHistoryRing(storage, next, HISTORY_KEY);
  return next;
}
