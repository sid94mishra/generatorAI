// ────────────────────────────────────────────────────────────────
// WidgetFrame — the sandboxed iframe host for an extension widget (F-dock-08;
// restyled on the kit, D-32). Mounted inline in the transcript and full
// height in the dock's Widget tab.
//
// The widget loads from a DEDICATED origin (separate loopback port, e.g.
// http://127.0.0.1:3101) via `<iframe src>`. Because that origin is isolated
// from the host SPA/API, `allow-same-origin` only scopes the frame to the
// widget origin — it unlocks fetch / localStorage / multi-file bundles while
// the widget still cannot touch host cookies or DOM (the MCP-Apps
// sandbox-proxy origin split).
//
// `widgetBridge` mediates between the iframe and the host:
//   Server → Client: harness.widget.state → prop update → postMessage.
//   Client → Server: postMessage → PATCH /api/widgets/:id/state →
//                    harness.widget.state → seen by the agent.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WidgetBlock } from '@/stores/streamStore.js';
import { widgetBridge } from '@/lib/widgetBridge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { cn } from '@/ui/lib/cn.js';

export interface WidgetFrameProps {
  block: WidgetBlock;
  /** Session owning the widget — bridge writes go to its routing keys server-side. */
  sessionId: string;
  className?: string;
  /** Full-height canvas (the dock tab): no border, no title row. */
  fullscreen?: boolean;
  /** Minimum initial height (px); content sizes up via the bridge. */
  minHeight?: number;
}

const DEFAULT_MIN_HEIGHT = 160;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Chrome's local-network protections block an iframe when the embedding page
 *  and the frame spell loopback differently (`localhost` page → `127.0.0.1`
 *  frame aborts with no error). The server advertises `127.0.0.1`, so realign
 *  the spelling with the page. Isolation comes from the PORT, which is kept. */
function alignLoopbackHost(assetsBase: string): string {
  if (typeof window === 'undefined') return assetsBase;
  try {
    const url = new URL(assetsBase);
    const pageHost = window.location.hostname;
    if (!LOOPBACK_HOSTS.has(url.hostname) || !LOOPBACK_HOSTS.has(pageHost)) return assetsBase;
    if (url.hostname === pageHost) return assetsBase;
    url.hostname = pageHost;
    return url.origin;
  } catch {
    return assetsBase;
  }
}

/** Absolute URL of the widget's entry HTML on the widget-asset origin. */
function buildWidgetUrl(assetsBase: string, extensionId: string, entry: string): string {
  const base = assetsBase && assetsBase.length > 0 ? alignLoopbackHost(assetsBase) : '';
  const cleaned = entry.replace(/^\/+/, '');
  return `${base}/api/widget-assets/${encodeURIComponent(extensionId)}/${cleaned
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

/**
 * P1-53 — `allow-scripts` + `allow-same-origin` is only safe because the
 * widget loads from a different origin. On the SAME origin the pair is the
 * canonical sandbox escape, and widgets are model-authorable, so the separate
 * origin is a load-bearing precondition: no origin, no render. Fails closed.
 * Returns null when safe, or the reason to display.
 */
function sandboxViolation(assetsBase: string): string | null {
  if (typeof window === 'undefined') return 'the host origin could not be determined';
  if (!assetsBase || assetsBase.length === 0) return 'no isolated asset origin was configured';
  let resolved: URL;
  try {
    resolved = new URL(alignLoopbackHost(assetsBase), window.location.href);
  } catch {
    return 'the configured asset origin is not a valid URL';
  }
  if (resolved.origin === window.location.origin) {
    return 'the asset origin resolves to this application’s own origin';
  }
  return null;
}

export function WidgetFrame({ block, sessionId, className, fullscreen, minHeight }: WidgetFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(minHeight ?? DEFAULT_MIN_HEIGHT);
  const [ready, setReady] = useState(false);
  // An aborted `src` navigation (a re-render or asset-origin restart during
  // the load) leaves the iframe blank with no auto-retry: bump a nonce to
  // force a fresh navigation when `load` doesn't fire soon.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // A missing entry file still fires `load` (the 404 page is a document), so
  // "loaded but never shook hands" is the only sign the widget is broken.
  const [stalled, setStalled] = useState(false);

  const widgetUrl = useMemo(
    () => buildWidgetUrl(block.assetsBase, block.extensionId, block.entry),
    [block.assetsBase, block.extensionId, block.entry],
  );
  const unsafeOrigin = useMemo(() => sandboxViolation(block.assetsBase), [block.assetsBase]);
  const src = useMemo(
    () => (reloadNonce > 0 ? `${widgetUrl}${widgetUrl.includes('?') ? '&' : '?'}_r=${reloadNonce}` : widgetUrl),
    [widgetUrl, reloadNonce],
  );

  // Retry if the iframe hasn't loaded shortly after (re)mount. Caps at 3 tries.
  useEffect(() => {
    if (loaded || reloadNonce >= 3) return undefined;
    const t = setTimeout(() => setReloadNonce((n) => n + 1), 1600);
    return () => clearTimeout(t);
  }, [loaded, reloadNonce, widgetUrl]);

  useEffect(() => {
    setLoaded(false);
    setReloadNonce(0);
    setStalled(false);
  }, [widgetUrl]);

  useEffect(() => {
    if (!loaded || ready) {
      setStalled(false);
      return undefined;
    }
    const t = setTimeout(() => setStalled(true), 6000);
    return () => clearTimeout(t);
  }, [loaded, ready]);

  useEffect(() => {
    if (unsafeOrigin) {
      // W31/P1-53 — log the refusal so operators can diagnose a missing
      // widget-asset origin (the browser-side WARN).
      // eslint-disable-next-line no-console
      console.warn(
        '[WidgetFrame] Refused to render widget %s: %s. Configure a dedicated asset origin (separate loopback port) to enable widgets.',
        block.extensionId,
        unsafeOrigin,
      );
    }
  }, [unsafeOrigin, block.extensionId]);

  // Register the bridge for this instance.
  useEffect(() => {
    if (!iframeRef.current) return undefined;
    return widgetBridge.register(block.instanceId, {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.instanceId, sessionId, widgetUrl, reloadNonce]);

  // Push state into the iframe whenever it changes.
  useEffect(() => {
    if (!ready) return;
    widgetBridge.pushState(block.instanceId, block.state);
  }, [block.instanceId, block.state, ready]);

  if (block.status === 'closed') {
    return (
      <p className={cn('px-3 py-2 text-ui text-fg-3 italic', className)}>
        Widget closed{block.title ? `: ${block.title}` : ''}.
      </p>
    );
  }
  if (unsafeOrigin) {
    return (
      <Callout tone="err" title="Widget not rendered" className={className} data-widget-refused="sandbox-origin">
        Widgets run untrusted, model-authored code and must load from a separate origin. Rendering was refused because{' '}
        {unsafeOrigin}.
      </Callout>
    );
  }
  if (block.status === 'error') {
    return (
      <Callout tone="err" title="Widget error" className={className}>
        <span className="font-mono">{block.error ?? 'unknown'}</span>
      </Callout>
    );
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-surface',
        fullscreen ? 'h-full' : 'rounded-card border border-line',
        className,
      )}
      data-widget-id={block.instanceId}
      data-widget-descriptor={block.descriptorId}
      data-widget-surface={block.surface}
    >
      {!fullscreen && (block.title || block.descriptorId) ? (
        <div className="flex min-w-0 items-center gap-2 border-b border-line-soft px-2.5 py-1.5 text-small text-fg-3">
          <span className="truncate font-semibold text-fg">{block.title ?? block.component}</span>
          <span aria-hidden>·</span>
          <span className="truncate font-mono">{block.descriptorId}</span>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={block.title ?? block.descriptorId}
        src={src}
        onLoad={() => setLoaded(true)}
        // Isolated origin: allow-same-origin is scoped to it (see header).
        // allow-downloads lets a widget save a generated file (Blob URL); it
        // does not relax same-origin or script isolation.
        sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"
        referrerPolicy="no-referrer"
        className={cn('block w-full border-0 bg-transparent', fullscreen && 'h-full')}
        // Computed geometry: the widget reports its content height.
        style={fullscreen ? undefined : { height }}
      />
      {stalled ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-surface p-4 text-center text-small text-fg-3">
          <span className="text-ui font-semibold text-fg">This widget didn’t start</span>
          <span>
            <InlineCode>{block.extensionId}</InlineCode> may be missing <InlineCode>{block.entry}</InlineCode>, or the page
            failed to boot.
          </span>
          <Button
            size="sm"
            icon="retry"
            className="mt-1"
            onClick={() => {
              setLoaded(false);
              setStalled(false);
              setReloadNonce((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
