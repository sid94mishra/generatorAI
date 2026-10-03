// Foreground duplicates (06 §7.2): a push about the chat or run the user is looking at is not shown — the in-app
// gate card already is. The shell reports the visible route; the notification handler asks. Pure apart from the
// module-level current screen.

let visible: { serverId: string | null; pathname: string } = { serverId: null, pathname: '/' };

export function setVisibleScreen(serverId: string | null, pathname: string): void {
  visible = { serverId, pathname };
}

/** The screen a push is about: `/chats/<id>` or `/workflows/<wid>/runs/<runId>`, or null for anything else. */
export function itemScreen(data: Record<string, unknown>): string | null {
  const href = typeof data.href === 'string' ? data.href : typeof data.route === 'string' ? data.route : null;
  if (!href) return null;
  const path = href.split('?')[0]!;
  const chat = /^\/chats\/[^/]+/.exec(path);
  if (chat) return chat[0];
  const run = /^\/workflows\/[^/]+\/runs\/[^/]+/.exec(path);
  return run ? run[0] : null;
}

/** True when the push is about the item on screen, on the server it came from. */
export function isOnScreen(data: Record<string, unknown> | null, current = visible): boolean {
  if (!data) return false;
  if (typeof data.serverId === 'string' && data.serverId !== current.serverId) return false;
  const screen = itemScreen(data);
  return screen !== null && (current.pathname === screen || current.pathname.startsWith(`${screen}/`));
}
