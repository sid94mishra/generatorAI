// ────────────────────────────────────────────────────────────────
// widgetBridge — Runtime that ferries postMessage traffic between
// sandboxed widget iframes and the GeneratorAI host.
//
// Message envelope (widget → host):
//
//   { type: 'widget:hello' }                           — widget mounted, waiting for init
//   { type: 'widget:ready' }                           — widget rendered
//   { type: 'widget:resize', height: number }          — auto-size the frame
//   { type: 'widget:state', state: unknown }           — widget's new full state
//   { type: 'widget:action', action: string, payload?: unknown }
//   { type: 'widget:followup-prompt', text: string }   — post a chat prompt (wakes agent)
//   { type: 'widget:context', content: string }         — buffer model-visible context note
//   { type: 'widget:teardown-ack', teardownId: string } — reply to a teardown request
//   { type: 'widget:open-canvas' }
//   { type: 'widget:close' }
//   { jsonrpc: '2.0', id, method: 'chat.send', params: { text } }
//   (Note: only chat.send / widget.close / widget.state are implemented as
//    JSON-RPC methods today. Other methods return an "unknown method" error.)
//
// Message envelope (host → widget):
//
//   { type: 'widget:init', props, state }
//   { type: 'widget:state', state }
//   { type: 'widget:teardown', teardownId }             — commit final state then ack
//   { type: 'jsonrpc:response', id, result?, error? }
//
// Every widget-originated write is PATCHed / POSTed to the server so
// state persists and the agent sees updates via SSE. State pushed by
// the SSE stream (state event) is forwarded to the iframe via
// `pushState()`.
// ────────────────────────────────────────────────────────────────

import { apiFetch } from '@/platform/apiFetch.js';

interface Registration {
  sessionId: string;
  iframe: HTMLIFrameElement;
  /** Origin the widget iframe is served from (e.g. http://127.0.0.1:3101).
   *  Used to PIN postMessage targetOrigin and validate inbound ev.origin so
   *  no other frame/page can spoof widget messages into the bridge. */
  origin: string;
  props: unknown;
  state: unknown;
  onReady?: () => void;
  onHeight?: (h: number) => void;
}

interface WidgetBridgeInternal {
  registrations: Map<string, Registration>;
  register(instanceId: string, r: Registration): () => void;
  pushState(instanceId: string, state: unknown): void;
  invoke(instanceId: string, invokeId: string, action: string, args: unknown): void;
  teardown(instanceId: string, teardownId: string): void;
  onWindowMessage(ev: MessageEvent): void;
}

const bridgeImpl: WidgetBridgeInternal = {
  registrations: new Map(),

  register(instanceId, r) {
    this.registrations.set(instanceId, r);
    // On unregister, remove the entry so we don't leak.
    return () => {
      const cur = this.registrations.get(instanceId);
      if (cur === r) this.registrations.delete(instanceId);
    };
  },

  pushState(instanceId, state) {
    const r = this.registrations.get(instanceId);
    if (!r || !r.iframe.contentWindow) return;
    r.state = state;
    try {
      r.iframe.contentWindow.postMessage({ type: 'widget:state', state }, r.origin);
    } catch (err) {
      console.warn('[widgetBridge] pushState failed', err);
    }
  },

  invoke(instanceId, invokeId, action, args) {
    const r = this.registrations.get(instanceId);
    if (!r || !r.iframe.contentWindow) {
      // This invoke is broadcast to every SSE-subscribed client for the
      // session/chat, not just the one hosting this widget's iframe — so
      // "I don't have it registered" is NOT evidence the widget is unmounted
      // everywhere, only that it isn't mounted in THIS tab. Stay silent and
      // let the server-side timeout (packages/core/.../WidgetService.ts
      // invokeAction) be the sole source of a genuine "not mounted" verdict.
      // Replying here would race a first-response-wins resolution against
      // whichever tab actually hosts the iframe, which is always slower
      // (postMessage round trip into the sandboxed frame) and would lose —
      // producing a false NOT_MOUNTED even while the real tab is live.
      return;
    }
    try {
      r.iframe.contentWindow.postMessage({ type: 'widget:invoke', invokeId, action, args }, r.origin);
    } catch (err) {
      void apiFetch(`/api/widgets/${encodeURIComponent(instanceId)}/invoke-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invokeId, error: `postMessage failed: ${String(err)}` }),
      }).catch(() => undefined);
    }
  },

  teardown(instanceId, teardownId) {
    const r = this.registrations.get(instanceId);
    if (!r || !r.iframe.contentWindow) {
      // Same broadcast hazard as invoke() above: this tab not having the
      // registration doesn't mean no tab does. Stay silent instead of
      // acking on another tab's behalf — the genuinely-hosting tab (or the
      // server's own timeout) will complete the teardown.
      return;
    }
    try {
      r.iframe.contentWindow.postMessage({ type: 'widget:teardown', teardownId }, r.origin);
    } catch {
      void apiFetch(`/api/widgets/${encodeURIComponent(instanceId)}/teardown-ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teardownId }),
      }).catch(() => undefined);
    }
  },

  onWindowMessage(ev) {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    // Find the registration whose iframe.contentWindow matches ev.source.
    let instanceId: string | undefined;
    let reg: Registration | undefined;
    for (const [id, r] of this.registrations) {
      if (r.iframe.contentWindow === ev.source) {
        instanceId = id;
        reg = r;
        break;
      }
    }
    if (!reg || !instanceId) return;
    // Origin pinning — reject messages that didn't come from the widget's
    // own origin (defends against a spoofed frame reusing the source ref).
    if (ev.origin && reg.origin && ev.origin !== reg.origin) {
      console.warn(
        `[widgetBridge] dropped message from unexpected origin ${ev.origin} (expected ${reg.origin})`,
      );
      return;
    }
    handleWidgetMessage(instanceId, reg, m as Record<string, unknown>);
  },
};

async function handleWidgetMessage(
  instanceId: string,
  reg: Registration,
  m: Record<string, unknown>,
): Promise<void> {
  // JSON-RPC style (chat.send, tool.invoke, etc.)
  if (m['jsonrpc'] === '2.0' && typeof m['method'] === 'string') {
    const id = m['id'];
    const method = String(m['method']);
    const params = (m['params'] as Record<string, unknown> | undefined) ?? {};
    try {
      const result = await dispatchRpc(instanceId, reg, method, params);
      reg.iframe.contentWindow?.postMessage(
        { type: 'jsonrpc:response', id, result },
        reg.origin,
      );
    } catch (err) {
      reg.iframe.contentWindow?.postMessage(
        {
          type: 'jsonrpc:response',
          id,
          error: { message: err instanceof Error ? err.message : String(err) },
        },
        reg.origin,
      );
    }
    return;
  }

  switch (m['type']) {
    case 'widget:hello': {
      // Widget just mounted — send the initial props snapshot.
      reg.iframe.contentWindow?.postMessage(
        { type: 'widget:init', props: reg.props, state: reg.state },
        reg.origin,
      );
      // `hello` is proof the document booted and its script ran, which is all
      // the host needs. Waiting for `ready` alone left widgets that announce it
      // from requestAnimationFrame stuck behind the "didn't start" overlay
      // whenever the browser throttled rAF (background tab, hidden panel).
      reg.onReady?.();
      break;
    }
    case 'widget:ready': {
      reg.onReady?.();
      break;
    }
    case 'widget:resize': {
      const h = Number(m['height']);
      if (Number.isFinite(h) && h > 0) reg.onHeight?.(h);
      break;
    }
    case 'widget:state': {
      const state = m['state'];
      try {
        await apiFetch(`/api/widgets/${encodeURIComponent(instanceId)}/state`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state }),
        });
      } catch (err) {
        console.warn('[widgetBridge] state PATCH failed', err);
      }
      break;
    }
    case 'widget:action': {
      const action = typeof m['action'] === 'string' ? m['action'] : 'unknown';
      const payload = m['payload'];
      try {
        await apiFetch(`/api/widgets/${encodeURIComponent(instanceId)}/actions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, payload, from: 'user' }),
        });
      } catch (err) {
        console.warn('[widgetBridge] action POST failed', err);
      }
      break;
    }
    case 'widget:followup-prompt': {
      // Widget → agent: post a prompt to the owning chat (wakes the agent).
      // The MCP-Apps `ui/message` equivalent. Resolves the chat id from the
      // instance so it works regardless of the current page.
      const text = typeof m['text'] === 'string' ? m['text'] : '';
      if (!text.trim()) break;
      try {
        const inst = await apiFetch<{ instance?: { chatId?: string } }>(
          `/api/widgets/${encodeURIComponent(instanceId)}`,
        );
        const chatId = inst?.instance?.chatId;
        if (!chatId) {
          console.warn('[widgetBridge] followup-prompt: widget has no owning chat');
          break;
        }
        const fd = new FormData();
        fd.append('prompt', text);
        await fetch(`/api/chats/${encodeURIComponent(chatId)}/prompt`, { method: 'POST', body: fd });
      } catch (err) {
        console.warn('[widgetBridge] followup-prompt failed', err);
      }
      break;
    }
    case 'widget:context': {
      // Widget → agent: buffer a model-visible context note for the NEXT
      // turn (does NOT wake the agent). MCP-Apps `ui/update-model-context`.
      const content = typeof m['content'] === 'string' ? m['content'] : '';
      if (!content.trim()) break;
      try {
        await apiFetch(`/api/widgets/${encodeURIComponent(instanceId)}/context`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content }),
        });
      } catch (err) {
        console.warn('[widgetBridge] context POST failed', err);
      }
      break;
    }
    case 'widget:teardown-ack': {
      // Widget committed its final state in response to widget:teardown.
      const teardownId = typeof m['teardownId'] === 'string' ? m['teardownId'] : '';
      if (!teardownId) break;
      try {
        await apiFetch(`/api/widgets/${encodeURIComponent(instanceId)}/teardown-ack`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ teardownId }),
        });
      } catch (err) {
        console.warn('[widgetBridge] teardown-ack POST failed', err);
      }
      break;
    }
    case 'widget:close': {
      try {
        await apiFetch(`/api/widgets/${encodeURIComponent(instanceId)}`, { method: 'DELETE' });
      } catch (err) {
        console.warn('[widgetBridge] close DELETE failed', err);
      }
      break;
    }
    case 'widget:invoke-result': {
      // Widget finished servicing an agent-dispatched `widget:invoke`.
      // POST the result back so the server-side pending promise resolves.
      const invokeId = typeof m['invokeId'] === 'string' ? m['invokeId'] : '';
      if (!invokeId) break;
      const result = m['result'];
      const error = typeof m['error'] === 'string' ? m['error'] : undefined;
      try {
        await apiFetch(`/api/widgets/${encodeURIComponent(instanceId)}/invoke-result`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ invokeId, result, error }),
        });
      } catch (err) {
        console.warn('[widgetBridge] invoke-result POST failed', err);
      }
      break;
    }
    default:
      // Unknown envelope — ignore quietly (widgets may extend the protocol).
      break;
  }
}

async function dispatchRpc(
  instanceId: string,
  reg: Registration,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case 'chat.send': {
      // Post a new user message to the chat this widget lives in.
      // We only support the case where sessionId is bound to a chat —
      // the widget uses whichever chat currently owns the session.
      const text = typeof params['text'] === 'string' ? params['text'] : '';
      if (!text) throw new Error('chat.send: text is required');
      // Resolve chat id from the current URL if we're on a chat page,
      // otherwise fall back to null (server will accept the session id
      // via the /api/sessions/:id/prompt path — but that route doesn't
      // exist here; we look up the chat id from the widget instance).
      const inst = await apiFetch<{ instance?: { chatId?: string } }>(`/api/widgets/${encodeURIComponent(instanceId)}`);
      const chatId = inst?.instance?.chatId;
      if (!chatId) throw new Error('chat.send: this widget has no owning chat');
      const fd = new FormData();
      fd.append('prompt', text);
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/prompt`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) throw new Error(`chat.send failed: ${res.status}`);
      return { ok: true };
    }
    case 'widget.close': {
      await apiFetch(`/api/widgets/${encodeURIComponent(instanceId)}`, { method: 'DELETE' });
      return { ok: true };
    }
    case 'widget.state':
      return { state: reg.state };
    default:
      throw new Error(`unknown method: ${method}`);
  }
}

// Attach the global window listener once. Idempotent — importing this
// module multiple times still only installs a single listener.
declare global {
  interface Window { __gaWidgetBridgeAttached?: boolean }
}
if (typeof window !== 'undefined' && !window.__gaWidgetBridgeAttached) {
  window.addEventListener('message', (ev) => bridgeImpl.onWindowMessage(ev));
  window.__gaWidgetBridgeAttached = true;
}

export const widgetBridge = bridgeImpl;
