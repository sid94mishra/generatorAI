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

import { prefs } from '../../../services/storage/prefs';
import {
  HISTORY_KEY,
  pushHistoryRing,
  readHistoryRing,
  writeHistoryRing,
  type HistoryStorage,
} from './promptHistory';
import type { PromptHistoryEntry } from './types';

/** Captures the issuing server so delayed draft writes cannot follow a switch. */
export function createDraftStore(serverId: string | null) {
  const prefix = serverId ? `srv.${serverId}.` : null;
  const draftKey = (chatId: string) => `${prefix}composer.draft.${chatId}`;
  const storage: HistoryStorage = {
    getString: (key) => prefix ? prefs.getString(`${prefix}${key}`) : undefined,
    setString: (key, value) => { if (prefix) prefs.setString(`${prefix}${key}`, value); },
  };
  const readLocalHistory = (): PromptHistoryEntry[] => readHistoryRing(storage, HISTORY_KEY);
  return {
    readDraft: (chatId: string) => prefix ? prefs.getString(draftKey(chatId)) ?? '' : '',
    writeDraft(chatId: string, text: string) {
      if (!prefix) return;
      if (text.length === 0) prefs.delete(draftKey(chatId));
      else prefs.setString(draftKey(chatId), text);
    },
    clearDraft(chatId: string) { if (prefix) prefs.delete(draftKey(chatId)); },
    readLocalHistory,
    recordSentPrompt(entry: PromptHistoryEntry): PromptHistoryEntry[] {
      const next = pushHistoryRing(readLocalHistory(), entry);
      writeHistoryRing(storage, next, HISTORY_KEY);
      return next;
    },
  };
}
