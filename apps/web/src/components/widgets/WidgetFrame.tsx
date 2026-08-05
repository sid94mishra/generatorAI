// ────────────────────────────────────────────────────────────────
// WidgetFrame — Sandboxed iframe host for an extension widget.
//
// Loads the widget from a DEDICATED origin (separate loopback port,
// e.g. http://127.0.0.1:3101) via `<iframe src>`. Because that origin
// is isolated from the host SPA/API, `allow-same-origin` is safe here:
// it scopes the iframe to the widget origin only (not the host), which
// unlocks fetch / localStorage / multi-file bundles for the widget
// while keeping it unable to touch host cookies or DOM. This mirrors
// the MCP-Apps sandbox-proxy origin split.
//
// A `WidgetBridge` mediates between the iframe and the host: it maps
// postMessage envelopes to server REST calls and vice versa. State
// updates flow both ways:
//   Server → Client:  harness.widget.state event → prop update forwarded
//                     to iframe via postMessage.
//   Client → Server:  iframe postMessage → PATCH /api/widgets/:id/state
//                     → emits harness.widget.state → seen by agent.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WidgetBlock } from '@/stores/streamStore.js';
import { widgetBridge } from '@/lib/widgetBridge.js';

interface WidgetFrameProps {
  block: WidgetBlock;
  /** Session id owning this widget — needed so bridge writes go to the
   *  right routing keys server-side (state emissions target this session). */
  sessionId: string;
  /** Optional class for the wrapper. */
  className?: string;
  /** Fullscreen mode — canvas surface. Kills borders + gives 100% height. */
  fullscreen?: boolean;
  /** Minimum initial height (px) — content sizes up via ResizeObserver. */
  minHeight?: number;
}

const DEFAULT_MIN_HEIGHT = 160;

/** Build the absolute URL to the widget's entry HTML on the dedicated
 *  widget-asset origin. Relative asset paths (`./bundle.js`) resolve
 *  against this URL naturally since the iframe now has a real origin. */
function buildWidgetUrl(assetsBase: string, extensionId: string, entry: string): string {
  const base = assetsBase && assetsBase.length > 0 ? assetsBase : '';
  const cleaned = entry.replace(/^\/+/, '');
  return `${base}/api/widget-assets/${encodeURIComponent(extensionId)}/${cleaned
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

export function WidgetFrame({ block, sessionId, className, fullscreen, minHeight }: WidgetFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(minHeight ?? DEFAULT_MIN_HEIGHT);
  const [ready, setReady] = useState<boolean>(false);
  // Load-stall retry: unlike srcDoc, an aborted `src` navigation (common when
  // a React re-render or asset-origin restart interrupts the in-flight load)
  // leaves the iframe blank with no auto-retry. We bump a nonce to force a
  // fresh navigation if `load` doesn't fire within a short window.
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [loaded, setLoaded] = useState<boolean>(false);
  // A missing entry file still fires `load` (the asset origin's 404 page is a
  // document), so "loaded but never shook hands" is the only signal we get
  // that the widget is broken rather than slow.
  const [stalled, setStalled] = useState<boolean>(false);

  const widgetUrl = useMemo(
    () => buildWidgetUrl(block.assetsBase, block.extensionId, block.entry),
    [block.assetsBase, block.extensionId, block.entry],
  );

  const src = useMemo(
    () => (reloadNonce > 0 ? `${widgetUrl}${widgetUrl.includes('?') ? '&' : '?'}_r=${reloadNonce}` : widgetUrl),
    [widgetUrl, reloadNonce],
  );

  // Retry if the iframe hasn't loaded shortly after (re)mount. Caps at 3 tries.
  useEffect(() => {
    if (loaded) return;
    if (reloadNonce >= 3) return;
    const t = setTimeout(() => setReloadNonce((n) => n + 1), 1600);
    return () => clearTimeout(t);
  }, [loaded, reloadNonce, widgetUrl]);

  // Reset load tracking when the underlying URL changes.
  useEffect(() => {
    setLoaded(false);
    setReloadNonce(0);
    setStalled(false);
  }, [widgetUrl]);

  useEffect(() => {
    if (!loaded || ready) { setStalled(false); return; }
    const t = setTimeout(() => setStalled(true), 6000);
    return () => clearTimeout(t);
  }, [loaded, ready]);

  // Register bridge for this instance.
  useEffect(() => {
    if (!iframeRef.current) return;
    const unregister = widgetBridge.register(block.instanceId, {
      sessionId,
      iframe: iframeRef.current,
      origin: (() => {
        try {
          return new URL(widgetUrl, window.location.href).origin;
        } catch {
          return window.location.origin;
        }
      })(),
      props: block.props,
      state: block.state,
      onReady: () => setReady(true),
      onHeight: (h) => setHeight(Math.max(minHeight ?? DEFAULT_MIN_HEIGHT, h)),
    });
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.instanceId, sessionId, widgetUrl, reloadNonce]);

  // Push updated state into the iframe whenever it changes.
  useEffect(() => {
    if (!ready) return;
    widgetBridge.pushState(block.instanceId, block.state);
  }, [block.instanceId, block.state, ready]);

  if (block.status === 'closed') {
    return (
      <div className={className} style={{ padding: 12, opacity: 0.6, fontStyle: 'italic', fontSize: 13 }}>
        Widget closed{block.title ? `: ${block.title}` : ''}.
      </div>
    );
  }
  if (block.status === 'error') {
    return (
      <div
        className={className}
        style={{
          padding: 12,
          border: '1px solid var(--color-danger, #cf222e)',
          borderRadius: 8,
          background: 'rgba(207, 34, 46, 0.06)',
          fontSize: 13,
        }}
      >
        Widget error: {block.error ?? 'unknown'}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        border: fullscreen ? 'none' : '1px solid var(--color-border, #d0d7de)',
        borderRadius: fullscreen ? 0 : 10,
        overflow: 'hidden',
        background: 'var(--color-surface, #ffffff)',
        height: fullscreen ? '100%' : undefined,
      }}
      data-widget-id={block.instanceId}
      data-widget-descriptor={block.descriptorId}
      data-widget-surface={block.surface}
    >
      {!fullscreen && (block.title || block.descriptorId) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 10px',
            borderBottom: '1px solid var(--color-border, #d0d7de)',
            fontSize: 12,
            color: 'var(--color-muted-foreground, #57606a)',
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--color-foreground, #1f2328)' }}>
            {block.title ?? block.component}
          </span>
          <span>·</span>
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{block.descriptorId}</span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={block.title ?? block.descriptorId}
        src={src}
        onLoad={() => setLoaded(true)}
        // Widget loads from an isolated origin, so allow-same-origin is
        // scoped to that origin only (not the host) — safe, and unlocks
        // fetch / storage / multi-file bundles for the widget.
        // allow-downloads: Chrome blocks file downloads (e.g. a generated
        // .docx/.xlsx via a Blob URL) triggered from a sandboxed frame
        // unless this flag is present. It only unblocks the download
        // action itself — it doesn't relax same-origin/script isolation.
        sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"
        referrerPolicy="no-referrer"
        style={{
          width: '100%',
          height: fullscreen ? '100%' : height,
          border: 'none',
          display: 'block',
          background: 'transparent',
        }}
      />
      {stalled && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: 16,
            textAlign: 'center',
            background: 'var(--color-surface, #ffffff)',
            fontSize: 12,
            color: 'var(--color-muted-foreground, #57606a)',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground, #1f2328)' }}>
            This widget didn&apos;t start
          </span>
          <span>
            <code style={{ fontFamily: 'ui-monospace, monospace' }}>{block.extensionId}</code> may be
            missing <code style={{ fontFamily: 'ui-monospace, monospace' }}>{block.entry}</code>, or
            the page failed to boot.
          </span>
          <button
            type="button"
            onClick={() => { setLoaded(false); setStalled(false); setReloadNonce((n) => n + 1); }}
            style={{
              marginTop: 4,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-border, #d0d7de)',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--color-foreground, #1f2328)',
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}


