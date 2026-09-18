// ────────────────────────────────────────────────────────────────
// Chat display names.
//
// The orchestrator names the worker chats it spawns `⚙ <task name>`
// (OrchestratorService). That marker is server data and other clients rely
// on it, so it is not changed at the source — but printed raw it reads as a
// stray emoji in every title. Clients strip it for display and show a
// "Sub-agent" badge instead.
//
// Pure (no React Native) so it is unit-tested on Node.
// ────────────────────────────────────────────────────────────────

/** The marker the server prefixes worker chat names with. */
export const SUB_AGENT_MARKER = '⚙';

// The gear, an optional emoji variation selector (U+FE0F), then any spacing.
const MARKER_PREFIX = /^\s*⚙️?\s*/u;

export interface ChatDisplayName {
  /** The name with the marker removed; never empty. */
  title: string;
  /** True when the chat is an orchestrator-spawned worker. */
  subAgent: boolean;
}

export function parseChatName(name: string | null | undefined, fallback = 'Untitled chat'): ChatDisplayName {
  const raw = typeof name === 'string' ? name : '';
  const subAgent = MARKER_PREFIX.test(raw);
  const title = (subAgent ? raw.replace(MARKER_PREFIX, '') : raw).trim();
  return { title: title.length > 0 ? title : fallback, subAgent };
}

/** Just the display string. */
export function displayChatName(name: string | null | undefined, fallback?: string): string {
  return parseChatName(name, fallback).title;
}
