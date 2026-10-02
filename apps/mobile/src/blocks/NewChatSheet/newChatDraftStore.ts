// The New chat draft (04 §1.2, MD-62): one store the sheet's pages write into — the agent, model and project pickers
// return their value here, never through route params. The unsent draft survives closing the sheet, per server
// (MMKV `srv.<serverId>.newChat.draft`), and is cleared once the chat is created.
import { create } from 'zustand';

import { prefs } from '../../services/storage/prefs';
import { EMPTY_NEW_CHAT_DRAFT, type NewChatDraft } from './model/newChatSheetModel';

const key = (serverId: string): string => `srv.${serverId}.newChat.draft`;

function read(serverId: string | null): NewChatDraft {
  if (!serverId) return EMPTY_NEW_CHAT_DRAFT;
  try {
    const raw = prefs.getString(key(serverId));
    return raw ? { ...EMPTY_NEW_CHAT_DRAFT, ...(JSON.parse(raw) as Partial<NewChatDraft>) } : EMPTY_NEW_CHAT_DRAFT;
  } catch {
    return EMPTY_NEW_CHAT_DRAFT;
  }
}

interface NewChatDraftStore {
  serverId: string | null;
  draft: NewChatDraft;
  /** Loads the server's unsent draft, applying entry params (`?project=&agent=`). */
  open: (serverId: string | null, seed?: Partial<NewChatDraft>) => void;
  update: (patch: Partial<NewChatDraft>) => void;
  clear: () => void;
}

export const useNewChatDraft = create<NewChatDraftStore>((set, get) => ({
  serverId: null,
  draft: EMPTY_NEW_CHAT_DRAFT,
  open: (serverId, seed) => set({ serverId, draft: { ...read(serverId), ...(seed ?? {}) } }),
  update: (patch) => {
    const draft = { ...get().draft, ...patch };
    set({ draft });
    const serverId = get().serverId;
    if (serverId) prefs.setString(key(serverId), JSON.stringify(draft));
  },
  clear: () => {
    const serverId = get().serverId;
    if (serverId) prefs.delete(key(serverId));
    set({ draft: EMPTY_NEW_CHAT_DRAFT });
  },
}));
