// ────────────────────────────────────────────────────────────────
// widgetTabId — deterministic right-pane tab id for one widget instance.
//
// Encoding the instance in the tab id is what makes "open this widget"
// idempotent: re-rendering the same widget focuses the tab already showing
// it instead of stacking duplicates, and the mapping survives a reload for
// free because RightPane persists tab ids. Mirrors `diff/fileTabId`.
// ────────────────────────────────────────────────────────────────

const PREFIX = 'widget:';

export function widgetTabId(instanceId: string): string {
  return `${PREFIX}${instanceId}`;
}

/** The instance a tab is bound to, or null for an unbound "Widgets" tab. */
export function parseWidgetTabId(tabId: string): string | null {
  if (!tabId.startsWith(PREFIX)) return null;
  return tabId.slice(PREFIX.length) || null;
}
