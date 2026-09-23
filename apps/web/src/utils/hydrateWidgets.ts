// ────────────────────────────────────────────────────────────────
// hydrateWidgets — Reconstitute a chat's widgets from the DB on mount.
//
// Widget instances are DB-backed (WidgetInstance rows). Historically the
// web client only learned about them by replaying the SSE event log, so a
// widget rendered before the replay window (SSE_MAX_REPLAY) vanished on
// refresh. This helper fetches the authoritative list over REST and seeds
// the stream store — independent of the event log — which is how Claude /
// ChatGPT reconstitute their widgets (fetch on load, not replay).
//
// Called after initial SSE replay: current metadata must win over persisted
// render events, especially the desktop's ephemeral widget asset port.
// ────────────────────────────────────────────────────────────────

import { apiFetch } from '@/platform/apiFetch.js';
import { useStreamStore } from '@/stores/streamStore.js';

interface RenderPayload {
  instanceId: string;
  descriptorId: string;
  extensionId: string;
  component: string;
  surface: string;
  title?: string;
  props: unknown;
  state: unknown;
  assetsBase: string;
  entry: string;
  status: 'active' | 'closed' | 'error';
}

/**
 * Fetch the chat's widgets and seed the stream store keyed by `sessionId`.
 * Closed widgets are skipped. Safe to call repeatedly (idempotent merge).
 */
export async function hydrateWidgetsForChat(chatId: string, sessionId: string): Promise<void> {
  if (!chatId || !sessionId) return;
  let payloads: RenderPayload[] = [];
  try {
    const res = await apiFetch<{ render?: RenderPayload[] }>(
      `/api/widgets?chatId=${encodeURIComponent(chatId)}`,
    );
    payloads = Array.isArray(res?.render) ? res.render : [];
  } catch {
    return; // non-fatal — SSE replay is the fallback
  }
  const store = useStreamStore.getState();
  for (const p of payloads) {
    if (p.status === 'closed') continue;
    store.addWidget(sessionId, {
      instanceId: p.instanceId,
      descriptorId: p.descriptorId,
      extensionId: p.extensionId,
      component: p.component,
      title: p.title,
      surface: p.surface === 'inline' || p.surface === 'chat' ? 'inline' : 'widget',
      assetsBase: p.assetsBase ?? '',
      entry: p.entry,
      props: p.props,
      state: p.state,
      status: p.status === 'error' ? 'error' : 'active',
    });
  }
}
