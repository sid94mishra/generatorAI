// ────────────────────────────────────────────────────────────────
// sideTabId — deterministic dock tab id for one side chat (D-180), so opening
// a side chat again focuses its tab, and the parent's dock state restores the
// side chats open beside it after a reload. Mirrors `widgetTabId`.
// ────────────────────────────────────────────────────────────────

const PREFIX = 'side:';

export function sideTabId(chatId: string): string {
  return `${PREFIX}${chatId}`;
}

/** The side chat a tab shows, or null. */
export function parseSideTabId(tabId: string): string | null {
  if (!tabId.startsWith(PREFIX)) return null;
  return tabId.slice(PREFIX.length) || null;
}
