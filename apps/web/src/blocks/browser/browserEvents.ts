// ────────────────────────────────────────────────────────────────
// Browser session events (`session` scope `browser:<workspaceId>`, prefix
// `browser.`) → what the panel does with them. Pure.
//
// Wire shape: `platform/muxStream.ts` hands every handler
// `{ kind, payload }`, where `payload` is the AgentEvent's `data` (the server
// publishes `streamBroker.publish(scope, id, event.kind, event.data)` and the
// mux frame carries it as `p`). The legacy per-scope SSE shape was
// `{ kind, data }`; both are read, `payload` first.
// ────────────────────────────────────────────────────────────────

/** Events after which the descriptor is refetched at once. */
const DESCRIPTOR_EVENTS = new Set([
  'browser.session_created',
  'browser.session_stopped',
  'browser.session_updated',
  'browser.navigation',
  'browser.error',
]);

/** An inspector pick (`browser.selection`), persisted server-side as an artifact. */
export interface BrowserSelection {
  url: string;
  cssSelector: string;
  xpath: string;
  artifactId: string;
}

export interface BrowserStreamMessage {
  /** The descriptor may have changed: refetch it. */
  refreshDescriptor: boolean;
  /** Set for a `browser.selection` that names its artifact. */
  selection: BrowserSelection | null;
}

interface SelectionData { artifactId?: string; url?: string; cssSelector?: string; xpath?: string }

/** Parse one stream message; null when it is not JSON. */
export function parseBrowserStreamMessage(raw: string): BrowserStreamMessage | null {
  let frame: { kind?: string; payload?: SelectionData | null; data?: SelectionData | null };
  try {
    frame = JSON.parse(raw) as typeof frame;
  } catch {
    return null;
  }
  const kind = frame?.kind;
  const body = frame?.payload ?? frame?.data;
  const selection = kind === 'browser.selection' && body?.artifactId
    ? { url: body.url ?? '', cssSelector: body.cssSelector ?? '', xpath: body.xpath ?? '', artifactId: body.artifactId }
    : null;
  return { refreshDescriptor: typeof kind === 'string' && DESCRIPTOR_EVENTS.has(kind), selection };
}

/** The chat attachment for an inspector pick: `element-<ts>.json`. */
export function selectionAttachment(sel: BrowserSelection, now: number = Date.now()): File {
  const summary = {
    url: sel.url,
    cssSelector: sel.cssSelector,
    xpath: sel.xpath,
    artifactId: sel.artifactId,
  };
  const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
  return new File([blob], `element-${now}.json`, { type: 'application/json' });
}
