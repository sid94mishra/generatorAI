// ────────────────────────────────────────────────────────────────
// BrowserPanel — Integrated Browser UI (v14, VSCode-style redesign).
//
// Top bar layout (matches VSCode's Simple Browser + Sharing widget):
//
//   [◀] [▶] [↻]   ┌────── URL ─────┐   [Share] [Inspect] [Capture]
//
// Behaviour:
//   • Share button toggles "attach to chat" (VSCode `sharingState`
//     Shared/NotShared). Detach is disabled while a turn is in flight
//     (the parent passes `agentBusy`). Next user prompt auto-reattaches
//     on the server (BrowserService.reattachOnPrompt).
//   • Inspect click → element selection is auto-attached to chat
//     as a JSON File via `onCapture`. No more snapshot gallery.
//   • Capture drag → rectangle → server crops PNG → attached to chat.
//   • Web-UI user-interactivity toggle (localStorage key
//     `generatorai:browser:webInteractivity`, default OFF) hides
//     back/forward/reload/URL bar/Stop/Capture. When OFF, the user
//     can still scroll the page and pick elements via Inspect, but
//     click/type/navigate are blocked in the SPA. Desktop always
//     runs at full interactivity.
//   • Overlay scrollbar (headless Chromium doesn't paint native
//     scrollbars) is drag-to-scroll.
//   • Snapshot gallery removed. Screenshots taken by the agent still
//     persist as artifacts and surface in the Files tab.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, ArrowLeft, ArrowRight, RotateCw, Play, Square,
  MousePointerClick, Loader2, AlertTriangle,
  Share2, Link2Off, Crop, MoreVertical, Wrench, Activity, Terminal,
  Smartphone, RotateCcw, MessageSquare, Trash2, Send, Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { countFallback } from '@/lib/clientMetrics.js';
import { isRestorableBrowserUrl, readBrowserTabUrl, writeBrowserTabUrl } from '@/lib/browserTabUrls.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import { buildAuthenticatedSocketUrl } from '@/platform/authTransport.js';
import { openMultiplexedStream } from '@/platform/muxStream.js';
import { NativeBrowserView } from './NativeBrowserView.js';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/primitives/dropdown-menu.js';

// ── Types ────────────────────────────────────────────────────

interface BrowserPanelProps {
  workspaceId: string | undefined;
  /**
   * Stable per-instance id for this browser tab (the RightPane tab id).
   * Each RightPane "Browser" tab is its own native WebContentsView keyed
   * by this id, so multiple browser tabs stay fully isolated (separate
   * page, history, cookies, title, favicon). Optional for non-native /
   * legacy callers — falls back to the workspace id.
   */
  tabId?: string;
  open: boolean;
  onClose: () => void;
  /** Called when the user picks an inspector selection / region to send to chat. */
  onCapture?: (file: File, kind: 'selection' | 'screenshot' | 'dom') => void;
  /**
   * When true the outer status/close header is hidden so this panel can
   * live inside a shared side pane host (e.g. `RightPane`).
   */
  embedded?: boolean;
  /**
   * True while a chat / stage turn is streaming. Used to disable the
   * "detach" toggle so the agent can't lose its browser mid-turn.
   */
  agentBusy?: boolean;
  /**
   * Fires when the live page's tab state changes so a host tab strip can
   * render a Chrome-like tab (spinner while loading → favicon + title).
   */
  onTabStateChange?: (state: { loading: boolean; title: string | null; favicon: string | null; url: string | null }) => void;
  /**
   * Namespace under which this tab's last-visited URL is remembered, e.g.
   * `chat:<chatId>` or `workflow-run:<runId>`. Leaving the page destroys the
   * native view, so without this the tab would come back blank. Omit to
   * disable URL memory entirely.
   */
  urlScopeKey?: string;
  /**
   * False while this panel is mounted but not the selected tab (P1-50).
   *
   * The RightPane mounts every tab and hides the inactive ones, which is what
   * keeps a page alive across tab switches — and what made five browser tabs
   * hold five live screencast sockets, decoding every frame into an object
   * URL nothing painted. When false the live-view socket is closed entirely;
   * it reopens on the next frame after the tab is selected. Defaults to true
   * so non-RightPane callers are unaffected.
   */
  visible?: boolean;
}

interface DescriptorState {
  status: string;
  mode: 'native' | 'screencast' | 'off';
  ready: boolean;
  currentUrl?: string;
  targetId?: string;
  viewport?: { width: number; height: number };
  attachedToChat?: boolean;
  config?: { visibility?: string; evalAllowed?: boolean; enabled?: boolean };
}

// ── Global user-interactivity setting (web only) ─────────────

const INTERACTIVITY_STORAGE_KEY = 'generatorai:browser:webInteractivity';

/**
 * Read the current interactivity setting. Web-only knob: when false
 * (default), the SPA hides navigation controls and blocks mouse/keyboard
 * input to the live view (except for element inspect + passive scroll).
 * The desktop app ignores this — the WCV is a real browser tab so
 * interactivity is always on there.
 */
export function getWebBrowserInteractivity(): boolean {
  try {
    return window.localStorage.getItem(INTERACTIVITY_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist the interactivity setting. Emits a `storage` event so other
 * open tabs pick up the change and re-render. */
export function setWebBrowserInteractivity(v: boolean): void {
  try {
    const oldValue = window.localStorage.getItem(INTERACTIVITY_STORAGE_KEY);
    const newValue = String(v);
    window.localStorage.setItem(INTERACTIVITY_STORAGE_KEY, newValue);
    // `newValue`/`storageArea` are not optional in practice: third-party
    // storage-sync listeners read a null `newValue` as "key deleted" and
    // helpfully remove the entry we just wrote.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: INTERACTIVITY_STORAGE_KEY,
        oldValue,
        newValue,
        storageArea: window.localStorage,
        url: window.location.href,
      }),
    );
  } catch {
    /* ignore */
  }
}

/** Live tab state a host tab strip can use to render a Chrome-like tab. */
export interface BrowserTabState {
  loading: boolean;
  title: string | null;
  favicon: string | null;
  url: string | null;
}

/**
 * Chrome-like tab icon for the Browser tab: a spinner while the page is
 * loading, the page favicon once loaded (falling back to a globe if the
 * favicon fails), or a globe when idle. Pass the live `BrowserTabState`
 * surfaced by `BrowserPanel`'s `onTabStateChange`.
 */
export function BrowserTabIcon({ state }: { state: BrowserTabState | null | undefined }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  const favicon = state?.favicon ?? null;
  useEffect(() => { setBroken(false); }, [favicon]);
  if (state?.loading) return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (favicon && !broken) {
    return (
      <img
        src={favicon}
        alt=""
        className="h-3.5 w-3.5 rounded-[3px] object-contain"
        onError={() => setBroken(true)}
      />
    );
  }
  return <Globe className="h-3.5 w-3.5" />;
}

/** The tab label for the Browser tab: the page title, or "Browser". */
export function browserTabLabel(state: BrowserTabState | null | undefined): string {
  const t = (state?.title ?? '').trim();
  return t || 'Browser';
}

/** React hook wrapping the interactivity setting. */
function useWebBrowserInteractivity(): boolean {
  const [v, setV] = useState<boolean>(() => getWebBrowserInteractivity());
  useEffect(() => {
    const handler = (e: StorageEvent): void => {
      if (e.key === INTERACTIVITY_STORAGE_KEY || e.key == null) {
        setV(getWebBrowserInteractivity());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  return v;
}

// ── HTTP helpers ─────────────────────────────────────────────

async function fetchDescriptor(workspaceId: string): Promise<DescriptorState> {
  const res = await fetch(`/api/workspaces/${workspaceId}/browser/descriptor`);
  if (!res.ok) throw new Error(`descriptor ${res.status}`);
  return (await res.json()) as DescriptorState;
}

async function extractApiError(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; issues?: Array<{ message?: string }> } };
    const issues = parsed.error?.issues;
    if (Array.isArray(issues) && issues.length > 0) {
      return issues.map((i) => i.message ?? '').filter(Boolean).join('; ') || fallback;
    }
    return parsed.error?.message?.trim() || fallback;
  } catch { return fallback; }
}

async function start(workspaceId: string, url?: string): Promise<DescriptorState> {
  const res = await fetch(`/api/workspaces/${workspaceId}/browser/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, config: { enabled: true } }),
  });
  if (!res.ok) throw new Error(await extractApiError(res, `start failed (${res.status})`));
  return (await res.json()) as DescriptorState;
}

async function stop(workspaceId: string): Promise<void> {
  await fetch(`/api/workspaces/${workspaceId}/browser/stop`, { method: 'POST' });
}

async function postAction(workspaceId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/workspaces/${workspaceId}/browser/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractApiError(res, `action failed (${res.status})`));
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Internal/blank URLs that must never surface in the URL bar. The native
 * browser host loads `about:blank#gai-<workspaceId>` as a discovery marker
 * so the server can find the WebContentsView — it's a handshake detail,
 * not something the user should ever see or edit.
 */
function isInternalBrowserUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return url.startsWith('about:blank') || url.includes('#gai-');
}

/** Device-emulation presets for the responsive toolbar (native desktop only). */
interface DevicePreset {
  id: string;
  label: string;
  /** 0×0 = Responsive (emulation off, view follows the panel size). */
  width: number;
  height: number;
  mobile: boolean;
}
const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: 'responsive', label: 'Responsive', width: 0, height: 0, mobile: false },
  { id: 'mobile-s', label: 'Mobile S — 360×640', width: 360, height: 640, mobile: true },
  { id: 'iphone', label: 'iPhone 12/13 — 390×844', width: 390, height: 844, mobile: true },
  { id: 'mobile-l', label: 'Mobile L — 414×896', width: 414, height: 896, mobile: true },
  { id: 'pixel', label: 'Pixel 7 — 412×915', width: 412, height: 915, mobile: true },
  { id: 'tablet', label: 'Tablet — 768×1024', width: 768, height: 1024, mobile: true },
  { id: 'ipad-pro', label: 'iPad Pro — 1024×1366', width: 1024, height: 1366, mobile: true },
  { id: 'laptop', label: 'Laptop — 1366×768', width: 1366, height: 768, mobile: false },
  { id: 'desktop', label: 'Desktop — 1920×1080', width: 1920, height: 1080, mobile: false },
];
const ZOOM_LEVELS: readonly number[] = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

/** A picked DOM element (native desktop) awaiting a user comment. */
interface PickedElement {
  url: string;
  tag: string;
  id: string | null;
  classes: string[];
  label: string;
  text: string;
  cssSelector: string;
  xpath: string;
  outerHtml: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  computedStyle?: Record<string, string>;
  screenshot?: string | null;
  comment?: string;
}

/** A lightweight annotation list entry (count badge + comments popover). */
interface AnnotationSummary {
  key: string;
  n: number;
  label: string;
  tag: string;
  comment: string;
  region: boolean;
}

// ── Component ────────────────────────────────────────────────

export function BrowserPanel({ workspaceId, tabId, open, onClose, onCapture, embedded = false, agentBusy = false, onTabStateChange, urlScopeKey, visible = true }: BrowserPanelProps): React.JSX.Element | null {
  const { resolvedTheme } = useTheme();
  // Chrome-like tab state surfaced to the host tab strip.
  const [tabLoading, setTabLoading] = useState(false);
  const [tabTitle, setTabTitle] = useState<string | null>(null);
  const [tabFavicon, setTabFavicon] = useState<string | null>(null);
  // The native browser tab id for THIS panel instance. Falls back to the
  // workspace id for legacy/non-native callers. All native `browser.*`
  // calls key off this so each RightPane Browser tab is its own WCV.
  const nativeTabId = tabId ?? workspaceId ?? null;
  // Where this tab was when its view was last torn down. Read exactly once
  // per mount — re-reading as the user browses would make the tab jump back.
  const restoreUrlRef = useRef<string | null | undefined>(undefined);
  if (restoreUrlRef.current === undefined) {
    restoreUrlRef.current = urlScopeKey && nativeTabId ? readBrowserTabUrl(urlScopeKey, nativeTabId) : null;
  }
  // True until the restored page actually lands. While it is in flight the
  // view still reports the internal `about:blank#gai-…` marker, and without
  // this the URL bar would blank out and then flash the address back.
  const restorePendingRef = useRef<boolean>(Boolean(restoreUrlRef.current));
  const [descriptor, setDescriptor] = useState<DescriptorState | null>(null);
  const [urlInput, setUrlInput] = useState(() => restoreUrlRef.current ?? '');
  const [loading, setLoading] = useState<'start' | 'stop' | 'navigate' | 'action' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspectorOn, setInspectorOn] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  const [nowKey, setNowKey] = useState(0);
  const [urlInputFocused, setUrlInputFocused] = useState(false);
  /**
   * True once at least one frame has been painted onto the live canvas.
   *
   * Was an object-URL string for an `<img>`. The live view is a `<canvas>`
   * now because WebCodecs hands back `VideoFrame`s, not images — and the
   * canvas keeps the last frame on screen by itself, which is what the
   * hand-rolled `placeholderBg` freeze-frame (a per-byte base64 re-encode of
   * every twentieth JPEG) was there to fake.
   */
  const [hasFrame, setHasFrame] = useState(false);
  /** Live-stream WS health, screencast mode only — surfaced next to the
   *  header status pill so a dropped connection is visible instead of
   *  silently retrying behind a frozen frame. */
  const [streamState, setStreamState] = useState<'connecting' | 'live' | 'reconnecting' | 'degraded' | 'stopped'>('connecting');
  const [nativeAvailable, setNativeAvailable] = useState<boolean>(false);
  const [nativeUrl, setNativeUrl] = useState<string | null>(null);
  // In-page annotation (comment pins) mode + live list (native desktop).
  const [annotateOn, setAnnotateOn] = useState(false);
  const [annotateItems, setAnnotateItems] = useState<AnnotationSummary[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // ── Device emulation (native desktop responsive toolbar) ──
  const [emulationOn, setEmulationOn] = useState(false);
  const [emuPreset, setEmuPreset] = useState<string>('responsive');
  const [emuWidth, setEmuWidth] = useState<number>(390);
  const [emuHeight, setEmuHeight] = useState<number>(844);
  const [emuDpr, setEmuDpr] = useState<number>(1);
  const [emuMobile, setEmuMobile] = useState<boolean>(false);
  const [emuZoom, setEmuZoom] = useState<number>(1);
  const [scrollState, setScrollState] = useState<{ scrollY: number; scrollHeight: number; clientHeight: number } | null>(null);
  /** Rectangle currently being drawn in capture mode (CSS px, relative to the live <canvas>). */
  const [captureRect, setCaptureRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const liveWsRef = useRef<WebSocket | null>(null);
  const liveContainerRef = useRef<HTMLDivElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureStartRef = useRef<{ x: number; y: number } | null>(null);
  /** Guards native-browser auto-start so it fires once per open workspace. */
  const autoStartRef = useRef<string | null>(null);

  const interactivityOn = useWebBrowserInteractivity();
  /**
   * Full interactivity is granted in these cases:
   *   1. Desktop shell exposes a native browser (always full — VSCode-style).
   *   2. Web UI user-preference `webInteractivity=true`.
   * When neither, the user can still SEE the page, SCROLL it, and use
   * Inspect to attach an element to chat. Everything else is agent-driven.
   */
  const fullInteractivity = nativeAvailable || interactivityOn;
  const attachedToChat = descriptor?.attachedToChat !== false;

  // ── Descriptor polling ─────────────────────────────────
  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const d = await fetchDescriptor(workspaceId);
        if (cancelled) return;
        setDescriptor(d);
        const transient = d.status === 'starting' || d.status === 'stopping' || (d.status === 'active' && !d.ready);
        timer = setTimeout(tick, transient ? 400 : 4000);
      } catch {
        timer = setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [open, workspaceId, nowKey]);

  // ── SSE — reactive descriptor + inspector selection auto-attach ──
  //
  // `onCapture` is captured via a ref so the effect can call the latest
  // version without needing to include it in the dep array. Without the
  // ref, parents that pass an inline `onCapture={(f)=>...}` cause the
  // effect to re-run on every render, closing + reopening the SSE
  // stream — and the `browser.selection` event fires in the tiny gap
  // where no listener is attached, silently losing the attachment.
  const onCaptureRef = useRef(onCapture);
  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  // Same ref pattern for the tab-state callback so parents can pass an inline
  // `onTabStateChange` without retriggering the emit effect (see below).
  const onTabStateChangeRef = useRef(onTabStateChange);
  useEffect(() => { onTabStateChangeRef.current = onTabStateChange; }, [onTabStateChange]);
  // Last emitted tab-state (serialized) — dedupes redundant host notifications.
  const lastTabStateRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    const es = openMultiplexedStream(
      'session',
      `browser:${workspaceId}`,
      {
        onMessage: (e) => {
          try {
        const payload = JSON.parse(e.data) as { kind?: string; data?: { workspaceId?: string; artifactId?: string; url?: string; cssSelector?: string; xpath?: string } };
        // Session / navigation changes → refresh descriptor now.
        if (
          payload.kind === 'browser.session_created' ||
          payload.kind === 'browser.session_stopped' ||
          payload.kind === 'browser.session_updated' ||
          payload.kind === 'browser.navigation' ||
          payload.kind === 'browser.error'
        ) {
          void fetchDescriptor(workspaceId).then(setDescriptor).catch(() => undefined);
        }
        // Inspector selection → auto-fetch the JSON artifact and hand
        // it to the chat composer via `onCapture`. This is what makes
        // "click to attach element" actually attach the element.
        const cb = onCaptureRef.current;
        if (payload.kind === 'browser.selection' && payload.data?.artifactId && cb) {
          const summary = {
            url: payload.data.url ?? '',
            cssSelector: payload.data.cssSelector ?? '',
            xpath: payload.data.xpath ?? '',
            artifactId: payload.data.artifactId,
          };
          const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
          const file = new File([blob], `element-${Date.now()}.json`, { type: 'application/json' });
          cb(file, 'selection');
          // One-shot UX: turn Inspect off after a pick — matches the
          // InspectorScript.setEnabled(false) auto-disable.
          setInspectorOn(false);
        }
          } catch { /* ignore */ }
        },
      },
      ['browser.'],
    );
    return () => { es.close(); };
  }, [open, workspaceId]);

  // ── Viewport hint (resize) ────────────────────────────
  useEffect(() => {
    if (!open || !workspaceId || !descriptor?.ready) return;
    const el = liveContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let lastW = 0, lastH = 0;
    const RESIZE_THRESHOLD = 256;
    const push = (w: number, h: number): void => {
      lastW = w; lastH = h;
      void fetch(`/api/workspaces/${workspaceId}/browser/resize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width: w, height: h }), cache: 'no-store',
      }).catch(() => undefined);
    };
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0]; if (!entry) return;
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      if (w < 100 || h < 100) return;
      if (lastW !== 0 && Math.abs(w - lastW) < RESIZE_THRESHOLD && Math.abs(h - lastH) < RESIZE_THRESHOLD) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => push(w, h), 400);
    });
    obs.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width >= 100 && rect.height >= 100) {
      pending = setTimeout(() => push(Math.round(rect.width), Math.round(rect.height)), 100);
    }
    return () => { obs.disconnect(); if (pending) clearTimeout(pending); };
  }, [open, workspaceId, descriptor?.ready]);

  // ── Scroll state polling ──────────────────────────────
  useEffect(() => {
    if (!open || !workspaceId || !descriptor?.ready) { setScrollState(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/browser/scroll`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json() as { scrollY: number; scrollHeight: number; clientHeight: number };
          if (!cancelled) setScrollState(data);
        }
      } catch { /* silent */ }
      if (!cancelled) timer = setTimeout(tick, 250);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [open, workspaceId, descriptor?.ready]);

  // ── Native browser probe (desktop) ────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ok = await window.generatoraiDesktop?.browser?.available?.();
        if (!cancelled) setNativeAvailable(!!ok);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Native browser tab wiring ─────────────────────────
  // Keep the URL bar in sync with the live native URL (driven by
  // NativeBrowserView's onUrlChange below). `nativeTabId` is this panel's
  // stable per-instance id (the RightPane tab id) — every `browser.*` call
  // and every native event filters on it, so sibling Browser tabs never
  // cross-talk.

  // ── Auto-start (desktop native browser) ────────────────
  // With the native browser the WebContentsView already exists, so there's
  // no reason to make the user click "Start". Kick off the server session
  // automatically on open so the address bar + controls are live and the
  // agent can share the tab immediately — the user just types a URL and goes.
  useEffect(() => {
    if (!open) { autoStartRef.current = null; return; }
    if (!workspaceId || !nativeAvailable) return;
    if (descriptor?.ready || descriptor?.status === 'starting') return;
    if (loading === 'start') return;
    if (autoStartRef.current === workspaceId) return;
    autoStartRef.current = workspaceId;
    // No initial URL: the address bar may already be pre-filled with this
    // tab's remembered page, and the native view restores it directly.
    // Passing it here too would load the page twice.
    void handleStart({ useUrlInput: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, nativeAvailable, descriptor?.ready, descriptor?.status]);

  // ── Actions ───────────────────────────────────────────
  const handleStart = useCallback(async (opts?: { useUrlInput?: boolean }) => {
    if (!workspaceId) return;
    setLoading('start'); setError(null);
    try {
      const raw = opts?.useUrlInput === false ? '' : urlInput.trim();
      const normalised = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : undefined;
      if (nativeAvailable && nativeTabId && window.generatoraiDesktop?.browser) {
        try { await window.generatoraiDesktop.browser.create(nativeTabId, workspaceId, true); } catch { /* ignore */ }
      }
      const d = await start(workspaceId, normalised);
      setDescriptor(d);
      setNowKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally { setLoading(null); }
  }, [workspaceId, urlInput, nativeAvailable, nativeTabId]);

  const handleStop = useCallback(async () => {
    if (!workspaceId) return;
    setLoading('stop');
    try {
      await stop(workspaceId);
      const d = await fetchDescriptor(workspaceId);
      setDescriptor(d);
    } finally { setLoading(null); }
  }, [workspaceId]);

  const handleNavigate = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!workspaceId) return;
    const url = urlInput.trim();
    if (!url) return;
    setLoading('navigate'); setError(null);
    try {
      const normalised = /^https?:\/\//.test(url) ? url : `https://${url}`;
      if (nativeAvailable && nativeTabId && window.generatoraiDesktop?.browser) {
        await window.generatoraiDesktop.browser.navigate(nativeTabId, normalised);
        setNativeUrl(normalised);
      } else {
        await postAction(workspaceId, { kind: 'navigate', url: normalised });
      }
      const d = await fetchDescriptor(workspaceId);
      setDescriptor(d);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(null); }
  }, [workspaceId, urlInput, nativeAvailable, nativeTabId]);

  const handleAction = useCallback(async (kind: 'back' | 'forward' | 'reload') => {
    if (!workspaceId) return;
    setLoading('action');
    try {
      if (nativeAvailable && nativeTabId && window.generatoraiDesktop?.browser) {
        if (kind === 'back') await window.generatoraiDesktop.browser.back(nativeTabId);
        else if (kind === 'forward') await window.generatoraiDesktop.browser.forward(nativeTabId);
        else await window.generatoraiDesktop.browser.reload(nativeTabId);
      } else {
        await postAction(workspaceId, { kind });
      }
      const d = await fetchDescriptor(workspaceId);
      setDescriptor(d);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(null); }
  }, [workspaceId, nativeAvailable, nativeTabId]);

  // Build chat attachments from a drained annotation (element summary +
  // the user's requested change as Markdown, plus a cropped screenshot).
  const attachAnnotation = useCallback((p: PickedElement & { comment?: string }) => {
    const comment = (p.comment ?? '').trim();
    const cssLines = p.computedStyle
      ? Object.entries(p.computedStyle).map(([k, v]) => `  ${k}: ${v};`).join('\n')
      : '';
    const md = [
      `# UI change request`,
      ``,
      `**Requested change:** ${comment || '_(none provided)_'}`,
      ``,
      `## Selected element`,
      `- **Element:** \`${p.label}\``,
      `- **Tag:** \`${p.tag}\`${p.id ? ` · **id:** \`${p.id}\`` : ''}${p.classes.length ? ` · **classes:** \`${p.classes.join(' ')}\`` : ''}`,
      `- **Page:** ${p.url}`,
      `- **CSS selector:** \`${p.cssSelector}\``,
      `- **XPath:** \`${p.xpath}\``,
      p.text ? `- **Text:** ${p.text}` : '',
      `- **Box:** ${Math.round(p.boundingBox.width)}×${Math.round(p.boundingBox.height)} @ (${Math.round(p.boundingBox.x)}, ${Math.round(p.boundingBox.y)})`,
      ``,
      `## HTML`,
      '```html',
      p.outerHtml,
      '```',
      cssLines ? `\n## Computed CSS\n\`\`\`css\n${p.cssSelector} {\n${cssLines}\n}\n\`\`\`` : '',
      '',
    ].filter((l) => l !== '').join('\n');
    const safe = (p.id || p.tag || 'element').replace(/[^a-z0-9]+/gi, '-').slice(0, 32);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    onCapture?.(new File([new Blob([md], { type: 'text/markdown' })], `element-${safe}-${stamp}.md`, { type: 'text/markdown' }), 'selection');
    if (p.screenshot) {
      try {
        const bstr = atob(p.screenshot.split(',')[1] ?? '');
        const u8 = new Uint8Array(bstr.length);
        for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
        onCapture?.(new File([new Blob([u8], { type: 'image/png' })], `element-${safe}-${stamp}.png`, { type: 'image/png' }), 'screenshot');
      } catch { /* ignore */ }
    }
  }, [onCapture]);

  // Toggle in-page annotation (comment pins) mode. In native desktop this
  // injects a theme-matched review overlay INTO the page (the WCV paints on
  // top of the DOM, so the comment UI must live inside the page). The user
  // drops pins, types a note in a draggable card and presses Add. Sending is
  // driven from the toolbar Comments popover.
  const handleToggleInspector = useCallback(async () => {
    if (!workspaceId) return;
    const nb = window.generatoraiDesktop?.browser;
    if (nativeAvailable && nativeTabId && nb?.annotateStart) {
      const next = !annotateOn;
      try {
        if (next) {
          setCaptureMode(false);
          await nb.annotateStart(nativeTabId, resolvedTheme);
        } else {
          await nb.annotateStop(nativeTabId);
          setAnnotateItems([]);
          setCommentsOpen(false);
        }
        setAnnotateOn(next);
      } catch (err) { setError((err as Error).message); }
      return;
    }
    // Web / screencast path — server-driven inspector overlay.
    const nextI = !inspectorOn;
    try {
      if (nextI) setCaptureMode(false);
      await postAction(workspaceId, { kind: 'inspector', on: nextI });
      setInspectorOn(nextI);
    } catch (err) { setError((err as Error).message); }
  }, [workspaceId, inspectorOn, nativeAvailable, annotateOn, resolvedTheme, nativeTabId]);

  // Poll the in-page overlay while annotate mode is on: keep the toolbar
  // count badge + Comments popover list in sync as the user adds/removes.
  useEffect(() => {
    if (!annotateOn || !workspaceId || !nativeAvailable || !nativeTabId) return;
    const nb = window.generatoraiDesktop?.browser;
    if (!nb?.annotatePoll) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const res = await nb.annotatePoll(nativeTabId);
        if (!cancelled && res) {
          setAnnotateItems(Array.isArray(res.items) ? res.items : []);
          // Single-off sends: the user pressed "Send" on a card in-page.
          for (const item of res.sent ?? []) attachAnnotation(item as PickedElement & { comment?: string });
        }
      } catch { /* ignore */ }
      if (!cancelled) timer = setTimeout(tick, 400);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [annotateOn, workspaceId, nativeAvailable, nativeTabId]);

  // Send annotations to chat: drain the given keys (or all commented ones),
  // which removes them from the page so they can't be added twice, then
  // attach each as a Markdown context file + cropped screenshot.
  const sendAnnotations = useCallback(async (keys?: string[]) => {
    const nb = window.generatoraiDesktop?.browser;
    if (!nativeAvailable || !nativeTabId || !nb?.annotateSend) return;
    try {
      const items = await nb.annotateSend(nativeTabId, keys);
      for (const item of items ?? []) attachAnnotation(item as PickedElement & { comment?: string });
      const res = await nb.annotatePoll(nativeTabId);
      setAnnotateItems(Array.isArray(res?.items) ? res.items : []);
      if (!res || res.total === 0) setCommentsOpen(false);
    } catch (err) { setError((err as Error).message); }
  }, [nativeAvailable, nativeTabId, attachAnnotation]);

  const removeAnnotation = useCallback(async (key: string) => {
    const nb = window.generatoraiDesktop?.browser;
    if (!nativeAvailable || !nativeTabId || !nb?.annotateRemove) return;
    try {
      await nb.annotateRemove(nativeTabId, key);
      const res = await nb.annotatePoll(nativeTabId);
      setAnnotateItems(Array.isArray(res?.items) ? res.items : []);
    } catch { /* ignore */ }
  }, [nativeAvailable, nativeTabId]);

  const clearAnnotations = useCallback(async () => {
    const nb = window.generatoraiDesktop?.browser;
    if (!nativeAvailable || !nativeTabId || !nb?.annotateClear) return;
    try {
      await nb.annotateClear(nativeTabId);
      setAnnotateItems([]);
      setCommentsOpen(false);
    } catch { /* ignore */ }
  }, [nativeAvailable, nativeTabId]);

  // Exit annotate mode when the panel closes or the workspace changes, so
  // the in-page overlay doesn't linger on a hidden/other view.
  useEffect(() => {
    if (open) return;
    const nb = window.generatoraiDesktop?.browser;
    if (annotateOn && nb?.annotateStop && nativeTabId) void nb.annotateStop(nativeTabId).catch(() => undefined);
    setAnnotateOn(false);
    setAnnotateItems([]);
    setCommentsOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const handleToggleCapture = useCallback(async () => {
    // Native desktop: drag-to-select a region becomes a comment annotation
    // (same as element pick) — the user drags a box, then adds a note and
    // sends it from the Comments popover. Requires annotate mode; enable it.
    const nb = window.generatoraiDesktop?.browser;
    if (nativeAvailable && nativeTabId && nb?.annotateRegion) {
      try {
        if (!annotateOn) { await nb.annotateStart(nativeTabId, resolvedTheme); setAnnotateOn(true); }
        setInspectorOn(false);
        await nb.annotateRegion(nativeTabId);
      } catch (err) { setError((err as Error).message); }
      return;
    }
    // Web / screencast path — draw the rectangle on the live <img>.
    setCaptureMode((v) => {
      const next = !v;
      if (next && inspectorOn) {
        setInspectorOn(false);
        if (workspaceId) void postAction(workspaceId, { kind: 'inspector', on: false }).catch(() => undefined);
      }
      return next;
    });
  }, [workspaceId, inspectorOn, nativeAvailable, annotateOn, resolvedTheme, nativeTabId]);

  // ── Device emulation (native desktop) ─────────────────
  const applyEmulation = useCallback((opts: {
    on: boolean; preset: string; width: number; height: number; dpr: number; mobile: boolean; zoom: number;
  }) => {
    const nb = window.generatoraiDesktop?.browser;
    if (!nativeAvailable || !nativeTabId || !nb) return;
    const responsive = !opts.on || opts.preset === 'responsive' || opts.width <= 0 || opts.height <= 0;
    void nb.setEmulation(nativeTabId, responsive ? null : {
      width: opts.width, height: opts.height, deviceScaleFactor: opts.dpr, mobile: opts.mobile,
    }).catch(() => undefined);
    void nb.setZoom(nativeTabId, opts.on ? opts.zoom : 1).catch(() => undefined);
  }, [nativeAvailable, nativeTabId]);

  const handleToggleEmulation = useCallback(() => {
    setEmulationOn((prev) => {
      const next = !prev;
      applyEmulation({ on: next, preset: emuPreset, width: emuWidth, height: emuHeight, dpr: emuDpr, mobile: emuMobile, zoom: emuZoom });
      return next;
    });
  }, [applyEmulation, emuPreset, emuWidth, emuHeight, emuDpr, emuMobile, emuZoom]);

  const handlePickPreset = useCallback((id: string) => {
    const preset = DEVICE_PRESETS.find((p) => p.id === id) ?? DEVICE_PRESETS[0]!;
    setEmuPreset(id);
    if (preset.width > 0) { setEmuWidth(preset.width); setEmuHeight(preset.height); }
    setEmuMobile(preset.mobile);
    applyEmulation({ on: true, preset: id, width: preset.width || emuWidth, height: preset.height || emuHeight, dpr: emuDpr, mobile: preset.mobile, zoom: emuZoom });
  }, [applyEmulation, emuWidth, emuHeight, emuDpr, emuZoom]);

  const handleEmuDimChange = useCallback((w: number, h: number) => {
    setEmuWidth(w); setEmuHeight(h); setEmuPreset('custom');
    applyEmulation({ on: true, preset: 'custom', width: w, height: h, dpr: emuDpr, mobile: emuMobile, zoom: emuZoom });
  }, [applyEmulation, emuDpr, emuMobile, emuZoom]);

  const handleEmuRotate = useCallback(() => {
    const w = emuHeight, h = emuWidth;
    setEmuWidth(w); setEmuHeight(h);
    applyEmulation({ on: true, preset: emuPreset, width: w, height: h, dpr: emuDpr, mobile: emuMobile, zoom: emuZoom });
  }, [applyEmulation, emuWidth, emuHeight, emuPreset, emuDpr, emuMobile, emuZoom]);

  const handleEmuZoom = useCallback((z: number) => {
    setEmuZoom(z);
    applyEmulation({ on: true, preset: emuPreset, width: emuWidth, height: emuHeight, dpr: emuDpr, mobile: emuMobile, zoom: z });
  }, [applyEmulation, emuPreset, emuWidth, emuHeight, emuDpr, emuMobile]);

  const handleEmuDpr = useCallback((dpr: number) => {
    setEmuDpr(dpr);
    applyEmulation({ on: true, preset: emuPreset, width: emuWidth, height: emuHeight, dpr, mobile: emuMobile, zoom: emuZoom });
  }, [applyEmulation, emuPreset, emuWidth, emuHeight, emuMobile, emuZoom]);

  const handleToggleShare = useCallback(async () => {
    if (!workspaceId || agentBusy) return;
    setLoading('share');
    try {
      const path = attachedToChat ? 'detach' : 'attach';
      const res = await fetch(`/api/workspaces/${workspaceId}/browser/${path}`, { method: 'POST' });
      if (!res.ok) throw new Error(`${path} failed (${res.status})`);
      const out = await res.json() as { attachedToChat?: boolean };
      setDescriptor((d) => d ? { ...d, attachedToChat: out.attachedToChat } : d);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(null); }
  }, [workspaceId, attachedToChat, agentBusy]);

  // ── Input dispatch ────────────────────────────────────
  const sendInput = useCallback(async (event: unknown) => {
    if (!workspaceId) return;
    const ws = liveWsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(event)); return; } catch { /* fall through */ }
    }
    try {
      await fetch(`/api/workspaces/${workspaceId}/browser/input`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event), cache: 'no-store',
      });
    } catch { /* silent */ }
  }, [workspaceId]);

  const eventToPageCoords = useCallback((e: { clientX: number; clientY: number; currentTarget: HTMLElement | null } | React.MouseEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) => {
    // `canvas.width/height` replaces `img.naturalWidth/naturalHeight`: on a
    // canvas the attribute size IS the intrinsic size, and `object-contain`
    // letterboxes it exactly the way it letterboxed the <img>, so the mapping
    // below is unchanged apart from where the numbers come from.
    const canvas = liveCanvasRef.current;
    if (!canvas || !canvas.width || !canvas.height) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const displayedW = canvas.width * scale;
    const displayedH = canvas.height * scale;
    const offX = (rect.width - displayedW) / 2;
    const offY = (rect.height - displayedH) / 2;
    const cssX = e.clientX - rect.left - offX;
    const cssY = e.clientY - rect.top - offY;
    if (cssX < 0 || cssY < 0 || cssX > displayedW || cssY > displayedH) return null;
    return {
      x: Math.round((cssX / displayedW) * canvas.width),
      y: Math.round((cssY / displayedH) * canvas.height),
    };
  }, []);

  // ── Live-view mouse / keyboard handlers ───────────────
  const handleLiveClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Inspect mode: allow click regardless of interactivity — this is
    // the only way to attach elements when interactivity is off.
    if (!inspectorOn && !fullInteractivity) return;
    const p = eventToPageCoords(e);
    if (!p) return;
    try { (e.currentTarget as HTMLCanvasElement).focus(); } catch { /* ignore */ }
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    void sendInput({ type: 'mouse.click', x: p.x, y: p.y, button, clickCount: e.detail || 1 });
  }, [eventToPageCoords, sendInput, inspectorOn, fullInteractivity]);

  const handleLiveWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    // Scroll is always allowed — even under restricted interactivity, the
    // user needs to see below the fold to guide the agent.
    const p = eventToPageCoords(e);
    void sendInput({ type: 'mouse.wheel', x: p?.x, y: p?.y, deltaX: e.deltaX, deltaY: e.deltaY });
  }, [eventToPageCoords, sendInput]);

  const handleLiveMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Skip mouse.move throttle if interactivity is off (no click follow-up
    // will happen anyway). We still send hover-only moves when inspect is
    // on so the highlighter overlay tracks correctly.
    if (!fullInteractivity && !inspectorOn) return;
    const now = performance.now();
    const w = window as unknown as { __gaiLastMouseMove?: number };
    if (w.__gaiLastMouseMove && now - w.__gaiLastMouseMove < 100) return;
    w.__gaiLastMouseMove = now;
    const p = eventToPageCoords(e);
    if (!p) return;
    void sendInput({ type: 'mouse.move', x: p.x, y: p.y });
  }, [eventToPageCoords, sendInput, fullInteractivity, inspectorOn]);

  const handleLiveKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!fullInteractivity) return;
    if (e.key === 'F5' || e.key === 'F12') return;
    e.preventDefault();
    const modifiers: Array<'Alt' | 'Control' | 'Meta' | 'Shift'> = [];
    if (e.altKey) modifiers.push('Alt');
    if (e.ctrlKey) modifiers.push('Control');
    if (e.metaKey) modifiers.push('Meta');
    if (e.shiftKey) modifiers.push('Shift');
    if (e.key.length === 1 && modifiers.length === 0) {
      void sendInput({ type: 'key.type', text: e.key });
      return;
    }
    void sendInput({ type: 'key.press', key: e.key, modifiers });
  }, [sendInput, fullInteractivity]);

  // ── Capture-drag on the live view ─────────────────────
  const handleCaptureMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!captureMode) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    captureStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setCaptureRect({ x: captureStartRef.current.x, y: captureStartRef.current.y, w: 0, h: 0 });
  }, [captureMode]);

  const handleCaptureMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!captureMode || !captureStartRef.current) return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const s = captureStartRef.current;
    setCaptureRect({
      x: Math.min(s.x, x),
      y: Math.min(s.y, y),
      w: Math.abs(x - s.x),
      h: Math.abs(y - s.y),
    });
  }, [captureMode]);

  const handleCaptureMouseUp = useCallback(async () => {
    if (!captureMode || !captureStartRef.current || !workspaceId) {
      captureStartRef.current = null;
      return;
    }
    const rect = captureRect;
    captureStartRef.current = null;
    setCaptureRect(null);
    setCaptureMode(false);
    if (!rect || rect.w < 8 || rect.h < 8) return; // ignore stray clicks
    const canvas = liveCanvasRef.current;
    if (!canvas || !canvas.width || !canvas.height) return;
    // Map CSS-px rect on the letterboxed <canvas> to page coords.
    const box = canvas.getBoundingClientRect();
    const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
    const displayedW = canvas.width * scale;
    const displayedH = canvas.height * scale;
    const offX = (box.width - displayedW) / 2;
    const offY = (box.height - displayedH) / 2;
    const x = ((rect.x - offX) / displayedW) * canvas.width;
    const y = ((rect.y - offY) / displayedH) * canvas.height;
    const w = (rect.w / displayedW) * canvas.width;
    const h = (rect.h / displayedH) * canvas.height;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/browser/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip: { x, y, width: w, height: h } }),
      });
      if (!res.ok) throw new Error(await extractApiError(res, `capture failed (${res.status})`));
      const blob = await res.blob();
      const file = new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' });
      onCapture?.(file, 'screenshot');
    } catch (err) { setError((err as Error).message); }
  }, [captureMode, captureRect, workspaceId, onCapture]);

  // ── Scrollbar drag ────────────────────────────────────
  const scrollBarRef = useRef<HTMLDivElement | null>(null);
  const scrollDragRef = useRef<{ startY: number; startScrollY: number } | null>(null);

  const handleScrollThumbDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    if (!scrollState) return;
    scrollDragRef.current = { startY: e.clientY, startScrollY: scrollState.scrollY };
    // Mouseup on window (not on thumb) so a fast release outside the pill
    // still commits.
    const onMove = (ev: MouseEvent): void => {
      if (!scrollDragRef.current || !scrollBarRef.current || !scrollState) return;
      const track = scrollBarRef.current.getBoundingClientRect();
      const range = scrollState.scrollHeight - scrollState.clientHeight;
      if (range <= 0) return;
      const dy = ev.clientY - scrollDragRef.current.startY;
      const ratio = dy / track.height;
      const targetY = Math.max(0, Math.min(range, scrollDragRef.current.startScrollY + ratio * scrollState.scrollHeight));
      // Send a wheel event at the delta so Chromium performs a native
      // smooth scroll. Delta = new_target - current_scrollY.
      void sendInput({ type: 'mouse.wheel', deltaX: 0, deltaY: targetY - scrollState.scrollY });
      // Optimistic update so the thumb tracks the pointer.
      setScrollState((s) => s ? { ...s, scrollY: targetY } : s);
    };
    const onUp = (): void => {
      scrollDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [scrollState, sendInput]);

  // ── Live-view streaming ───────────────────────────────
  //
  // D5 chose WebCodecs over the existing socket. The server sends encoded VP8
  // chunks behind a 16-byte header (see `apps/server/src/browser-ws.ts`) when
  // this client says it can decode them, and JPEG when it cannot. Every frame
  // states its own codec, so the two are interleavable: the seed frame and the
  // paint-silence keepalive are JPEG on a socket whose steady state is VP8, and
  // nothing here has to be told when that changes.
  //
  // ── Why the decode is not in a Worker ───────────────────────────────────
  //
  // The heavy work already happens off the main thread: `VideoDecoder` and
  // `createImageBitmap` both decode on browser-internal threads and only their
  // *callbacks* land here, where all that remains is one `drawImage` — a GPU
  // blit of an already-decoded frame. Moving the callback to a Worker would
  // require creating one from a `blob:` URL (this component cannot add a file
  // to the bundle without a second entry point), and the app's CSP is
  // `default-src 'self'` with no `worker-src blob:`, so such a Worker is
  // blocked outright. Detecting that by catching the failure is precisely the
  // pattern P1-33 exists to forbid, so we do not attempt it.
  useEffect(() => {
    // P1-50 — `visible` sits alongside `open` deliberately: an invisible tab
    // is exactly as uninteresting as a closed pane. The RightPane keeps every
    // tab mounted, so without this each open Browser tab held its own live
    // screencast socket and decoded every frame that was painted nowhere.
    if (!open || !visible || !workspaceId || !descriptor?.ready || descriptor.mode !== 'screencast') {
      setHasFrame(false);
      liveWsRef.current?.close();
      liveWsRef.current = null;
      return;
    }
    let cancelled = false;
    let ws: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const maxReconnects = 6;
    const pollController = new AbortController();

    // ── Frame sink ───────────────────────────────────────
    /** Header layout is documented once, on the server, in `browser-ws.ts`. */
    const HEADER_BYTES = 16;
    const MAGIC = 0x47;
    const CODEC_JPEG = 0;
    const CODEC_VP8 = 1;

    type Decoded = ImageBitmap | VideoFrame;
    let decoder: VideoDecoder | null = null;
    let decoderSize = { width: 0, height: 0 };
    /** VP8 delta frames before the first key frame decode to nothing. */
    let sawKeyframe = false;
    /** Wall-clock of the last `request_keyframe`, for the rate limit below. */
    let lastKeyframeRequestAt = 0;
    const KEYFRAME_REQUEST_MIN_INTERVAL_MS = 500;

    const isHidden = (): boolean =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden';

    /**
     * Ask the server for a fresh key frame.
     *
     * A VP8 delta decodes only against the frame before it, so the moment this
     * client drops or fails to decode one chunk, every chunk after it is
     * undecodable — and the encoder, running in `realtime` mode, has no reason
     * of its own to ever emit another key frame. This used to be missing
     * entirely: the panel simply froze on its last good frame, with a healthy
     * socket, no error state and nothing logged.
     *
     * Rate-limited because the triggers fire per frame and each answer is a
     * full key frame. Silent while the document is hidden: asking for an
     * expensive frame nobody is looking at would defeat the drop it is
     * recovering from — the `visibilitychange` handler asks on the way back.
     */
    function requestKeyframe(): void {
      if (cancelled || isHidden()) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - lastKeyframeRequestAt < KEYFRAME_REQUEST_MIN_INTERVAL_MS) return;
      lastKeyframeRequestAt = now;
      try { ws.send(JSON.stringify({ type: 'request_keyframe' })); } catch { /* closing */ }
    }

    // Coming back to a tab whose reference chain was dropped while it was
    // hidden. Without this the panel waits for the next delta to notice, and
    // on a settled page that is "until something on the page moves".
    const onVisibility = (): void => {
      if (cancelled || isHidden() || sawKeyframe) return;
      requestKeyframe();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    function paint(source: Decoded, width: number, height: number): void {
      const canvas = liveCanvasRef.current;
      if (!canvas || cancelled) return;
      if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      setHasFrame(true);
    }

    function closeDecoder(): void {
      const d = decoder;
      decoder = null;
      sawKeyframe = false;
      decoderSize = { width: 0, height: 0 };
      if (d && d.state !== 'closed') {
        try { d.close(); } catch { /* already gone */ }
      }
    }

    function ensureDecoder(width: number, height: number): VideoDecoder | null {
      if (typeof VideoDecoder === 'undefined') return null;
      if (decoder && decoder.state !== 'closed'
        && decoderSize.width === width && decoderSize.height === height) return decoder;
      // A resize changes the coded size, and a decoder configured for the old
      // one silently produces stretched frames rather than erroring.
      closeDecoder();
      const created = new VideoDecoder({
        output: (frame) => {
          try { paint(frame, frame.displayWidth, frame.displayHeight); } finally { frame.close(); }
        },
        error: () => {
          // The stream is not lost: the server keeps sending, and JPEG frames
          // still paint. Drop the decoder — but "wait for the next key frame"
          // was a wish, not a plan: nothing was going to produce one. Ask.
          closeDecoder();
          requestKeyframe();
        },
      });
      created.configure({ codec: 'vp8', codedWidth: width, codedHeight: height });
      decoder = created;
      decoderSize = { width, height };
      sawKeyframe = false;
      return created;
    }

    function onBinaryFrame(buffer: ArrayBuffer): void {
      if (cancelled || buffer.byteLength <= HEADER_BYTES) return;
      const view = new DataView(buffer);
      // A framing mismatch means the peer is not the endpoint we think it is
      // (an old server, a proxy rewriting frames). Dropping is right; feeding
      // it to a decoder as if it were video is not.
      if (view.getUint8(0) !== MAGIC || view.getUint8(1) !== 1) return;
      const codec = view.getUint8(2);
      const keyframe = (view.getUint8(3) & 1) === 1;
      const width = view.getUint16(4);
      const height = view.getUint16(6);
      const timestamp = view.getFloat64(8);
      const payload = new Uint8Array(buffer, HEADER_BYTES);

      // The socket stays open across a browser-tab switch (closing it would
      // drop the agent's view of the page), but decoding a frame for a
      // document nobody is looking at is pure waste.
      //
      // This check used to run BEFORE the header was read, so it dropped key
      // frames along with the deltas — and a dropped key frame is not a
      // dropped frame, it is the end of the stream: every delta after it is
      // undecodable and nothing ever asked for another. The saving this exists
      // for is the delta stream anyway; a key frame arrives at open, on resize
      // and on request, so decoding one costs almost nothing and is what makes
      // coming back to the tab possible at all.
      const hidden = isHidden();

      if (codec === CODEC_VP8) {
        if (hidden && !keyframe) {
          countFallback('browserFramesDroppedHidden');
          // Say out loud that the chain is broken, so the deltas that follow
          // are not fed to a decoder whose reference frame never arrived.
          sawKeyframe = false;
          return;
        }
        const active = ensureDecoder(width, height);
        if (!active) return;              // no VideoDecoder: nothing to do
        if (!keyframe && !sawKeyframe) {
          // Either we joined mid-stream or something upstream dropped a chunk.
          // Either way this frame is undecodable and so is every one behind it
          // until a key frame arrives — which only happens if we ask.
          requestKeyframe();
          return;
        }
        if (keyframe) sawKeyframe = true;
        try {
          active.decode(new EncodedVideoChunk({
            type: keyframe ? 'key' : 'delta',
            timestamp,
            data: payload,
          }));
        } catch {
          closeDecoder();
          requestKeyframe();
        }
        return;
      }

      if (codec === CODEC_JPEG) {
        // Self-contained: dropping one strands nothing behind it, so the
        // hidden-tab saving is free here.
        if (hidden) {
          countFallback('browserFramesDroppedHidden');
          return;
        }
        // `createImageBitmap` decodes off the main thread and yields a bitmap
        // the compositor can upload directly — no object URL, no <img> load
        // event, and nothing to revoke.
        void createImageBitmap(new Blob([payload], { type: 'image/jpeg' }))
          .then((bitmap) => {
            if (cancelled) { bitmap.close(); return; }
            try { paint(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
          })
          .catch(() => undefined);
      }
    }

    /**
     * What this client can decode, most-preferred first — asked of the browser
     * rather than assumed, and resolved once per stream. `VideoDecoder`
     * existing is not the same as VP8 being supported (Safari's WebCodecs, for
     * one, ships a different codec set), so the config is actually probed.
     */
    const acceptedCodecs: Promise<string[]> = (async () => {
      if (typeof VideoDecoder === 'undefined') return ['jpeg'];
      try {
        const support = await VideoDecoder.isConfigSupported({ codec: 'vp8' });
        return support.supported ? ['vp8', 'jpeg'] : ['jpeg'];
      } catch {
        return ['jpeg'];
      }
    })();

    function tryOpenWs(): void {
      // Ticket-minting is async, so the socket is created inside the promise.
      // `cancelled` is re-checked after the await for the unmount race.
      void (async () => {
        try {
          const isDev = window.location.port === '5173';
          const origin = isDev
            ? `${window.location.protocol}//${window.location.hostname}:3100`
            : window.location.origin;
          const url = await buildAuthenticatedSocketUrl(
            `${origin}/api/workspaces/${workspaceId}/browser/stream`,
            { scope: 'browser', id: workspaceId ?? null },
          );
          if (cancelled) return;
          ws = new WebSocket(url);
          // `arraybuffer`, not `blob`: the header has to be read synchronously
          // to know which decoder the payload belongs to, and a Blob would put
          // an extra async hop in front of every single frame.
          ws.binaryType = 'arraybuffer';
          liveWsRef.current = ws;
          attachWsHandlers(ws);
        } catch {
          // No `exec:browser` scope, or the device was revoked — fall back to
          // the polling path, which will surface the HTTP error properly.
          if (!cancelled) startPolling();
        }
      })();
    }

    function attachWsHandlers(ws: WebSocket): void {
      try {
        ws.onopen = () => {
          // Fresh connection is healthy — reset the reconnect budget so a
          // later drop gets its own full set of retry attempts.
          reconnectAttempts = 0;
          setStreamState('live');
          // The codec is DECLARED by both ends before a byte of video moves:
          // this is the client half of P1-33's negotiation.
          void acceptedCodecs.then((accept) => {
            if (cancelled || ws.readyState !== WebSocket.OPEN) return;
            try { ws.send(JSON.stringify({ type: 'hello', accept })); } catch { /* closing */ }
          });
        };
        ws.onmessage = (e) => {
          if (cancelled) return;
          if (typeof e.data === 'string') {
            try {
              const msg = JSON.parse(e.data) as { type?: string };
              // The server telling us it cannot stream is an answer, not a
              // failure: stop, and do not start a second transport behind it.
              if (msg.type === 'stream_unavailable') setStreamState('stopped');
              else if (msg.type === 'stream_error') setStreamState('reconnecting');
            } catch { /* ignore malformed control frames */ }
            return;
          }
          onBinaryFrame(e.data as ArrayBuffer);
        };
        ws.onerror = () => { /* fallthrough to reconnect on close */ };
        ws.onclose = () => {
          if (cancelled) return;
          liveWsRef.current = null;
          closeDecoder();
          // A dropped stream must NOT freeze the live view on its last
          // frame — the agent keeps driving the page after any transient
          // WS/close. Reconnect with a short backoff; only after repeated
          // failures fall back to HTTP frame polling.
          if (reconnectAttempts < maxReconnects) {
            reconnectAttempts += 1;
            setStreamState('reconnecting');
            const delay = Math.min(2000, 250 * reconnectAttempts);
            reconnectTimer = setTimeout(() => { if (!cancelled) tryOpenWs(); }, delay);
          } else {
            startPolling();
          }
        };
      } catch { startPolling(); }
    }

    async function pollTick(): Promise<void> {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        pollTimer = setTimeout(() => { if (!cancelled) void pollTick(); }, 1000);
        return;
      }
      const started = Date.now();
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/browser/screencast.jpg?quality=45&k=${started}`,
          { signal: pollController.signal, cache: 'no-store' },
        );
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        const bitmap = await createImageBitmap(blob);
        if (cancelled) { bitmap.close(); return; }
        try { paint(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
      } catch { /* silent */ }
      if (cancelled) return;
      const elapsed = Date.now() - started;
      pollTimer = setTimeout(() => { if (!cancelled) void pollTick(); }, Math.max(100, 200 - elapsed));
    }
    function startPolling(): void {
      if (pollTimer || cancelled) return;
      // N5 — the expensive fallback, and now the ONLY thing this path is for:
      // the socket could not be opened at all (no `exec:browser` grant, or six
      // failed reconnects). It is never a concurrent second capture path — the
      // codec fallback for a client that cannot decode VP8 happens on the
      // socket itself. Counted so a test (and `system doctor`) can tell "the
      // screencast is fine" from "the screencast has been on the slow path for
      // an hour".
      countFallback('browserScreencastHttpFallback');
      setStreamState('degraded');
      void pollTick();
    }

    setStreamState('connecting');
    tryOpenWs();
    return () => {
      cancelled = true;
      pollController.abort();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (pollTimer) clearTimeout(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeDecoder();
      try { ws?.close(); } catch { /* ignore */ }
      liveWsRef.current = null;
      setStreamState('stopped');
    };
  }, [open, visible, workspaceId, descriptor?.ready, descriptor?.mode, nowKey]);

  // ── URL sync ──────────────────────────────────────────
  useEffect(() => {
    if (urlInputFocused) return;
    // In native mode the URL bar must reflect ONLY this tab's own live URL
    // (`nativeUrl`). We must NOT fall back to `descriptor.currentUrl` — that
    // is the workspace-level server session which "follows the active tab",
    // so a freshly-created tab (whose own nativeUrl is still null) would
    // otherwise inherit the previously-active tab's URL. A blank new tab
    // therefore correctly shows an empty address bar.
    const fresh = nativeAvailable ? nativeUrl : descriptor?.currentUrl;
    // Never show the internal discovery marker — leave the bar empty so the
    // placeholder prompts the user to type an address.
    if (isInternalBrowserUrl(fresh)) {
      if (nativeAvailable && !restorePendingRef.current) setUrlInput('');
      return;
    }
    restorePendingRef.current = false;
    if (fresh) setUrlInput(fresh);
  }, [descriptor?.currentUrl, urlInputFocused, nativeAvailable, nativeUrl]);

  // ── Chrome-like tab state → host tab strip ────────────
  // In screencast (web) mode we only know loading from the descriptor status
  // and have no favicon; in native mode NativeBrowserView drives these.
  useEffect(() => {
    if (nativeAvailable) return;
    setTabLoading(descriptor?.status === 'starting');
  }, [nativeAvailable, descriptor?.status]);

  useEffect(() => {
    const url = nativeAvailable ? nativeUrl : (descriptor?.currentUrl ?? null);
    const internal = isInternalBrowserUrl(url);
    const next: BrowserTabState = {
      loading: tabLoading,
      title: internal ? null : tabTitle,
      favicon: internal ? null : tabFavicon,
      url,
    };
    // Dedupe: only notify the host when the tab state actually changed.
    // The callback is read from a ref so a parent passing an inline
    // `onTabStateChange` can't retrigger this effect (which would loop:
    // emit → parent setState → new callback identity → emit → …).
    const serialized = JSON.stringify(next);
    if (serialized === lastTabStateRef.current) return;
    lastTabStateRef.current = serialized;
    // Remember where this tab is so it can be restored after the view is
    // torn down (navigating away from the chat / run). Only real pages are
    // recorded — a transient blank during teardown must not erase memory.
    if (urlScopeKey && nativeTabId && isRestorableBrowserUrl(url)) {
      writeBrowserTabUrl(urlScopeKey, nativeTabId, url);
    }
    onTabStateChangeRef.current?.(next);
  }, [nativeAvailable, nativeUrl, tabLoading, tabTitle, tabFavicon, descriptor?.currentUrl, urlScopeKey, nativeTabId]);

  // Reset tab state when the panel closes so a stale spinner/title doesn't
  // linger on the tab.
  useEffect(() => {
    if (!open) { setTabLoading(false); setTabTitle(null); setTabFavicon(null); }
  }, [open]);

  const shareTitle = useMemo(() => {
    if (agentBusy && !attachedToChat) return 'Cannot re-attach while agent is streaming';
    if (agentBusy && attachedToChat) return 'Cannot detach while agent is streaming';
    return attachedToChat ? 'Sharing with Agent — click to stop sharing' : 'Share with Agent';
  }, [agentBusy, attachedToChat]);

  if (!open) return null;

  const status = descriptor?.status ?? 'off';
  const isOn = descriptor?.ready === true;
  const showNavControls = fullInteractivity;

  return (
    <div className="flex h-full w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)]">
      {!embedded && (
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className={cn(
              'inline-block h-2 w-2 rounded-full',
              status === 'active' && 'bg-[var(--color-success)]',
              status === 'starting' && 'bg-[var(--color-warning)] animate-pulse',
              status === 'error' && 'bg-[var(--color-danger)]',
              (status === 'off' || status === 'terminated') && 'bg-[var(--color-muted-foreground)]',
            )} />
            <span className="font-medium">Integrated Browser</span>
            <span className="text-[var(--color-muted-foreground)]">· {status}</span>
            {descriptor?.mode === 'screencast' && streamState !== 'live' && streamState !== 'stopped' && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium',
                  streamState === 'reconnecting' && 'bg-[var(--color-warning)]/20 text-[var(--color-warning)]',
                  streamState === 'degraded' && 'bg-[var(--color-danger)]/20 text-[var(--color-danger)]',
                  streamState === 'connecting' && 'bg-[var(--color-muted-foreground)]/20 text-[var(--color-muted-foreground)]',
                )}
                title={
                  streamState === 'reconnecting'
                    ? 'Live-view connection dropped — retrying'
                    : streamState === 'degraded'
                      ? 'Live-view falling back to slower polling after repeated reconnect failures'
                      : 'Connecting live view…'
                }
              >
                {streamState === 'reconnecting' && 'reconnecting…'}
                {streamState === 'degraded' && 'degraded (polling)'}
                {streamState === 'connecting' && 'connecting…'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]" aria-label="Close browser panel">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Top bar — VSCode-parity chrome ───────────────── */}
      <form
        onSubmit={handleNavigate}
        className="flex items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5"
      >
        {showNavControls && (
          <>
            <button type="button" onClick={() => handleAction('back')} className="rounded p-1 text-[var(--color-foreground)] hover:bg-[var(--color-subtle)] disabled:opacity-40" disabled={!isOn} aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => handleAction('forward')} className="rounded p-1 text-[var(--color-foreground)] hover:bg-[var(--color-subtle)] disabled:opacity-40" disabled={!isOn} aria-label="Forward">
              <ArrowRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => handleAction('reload')} className="rounded p-1 text-[var(--color-foreground)] hover:bg-[var(--color-subtle)] disabled:opacity-40" disabled={!isOn} aria-label="Reload">
              <RotateCw className={cn('h-4 w-4', loading === 'action' && 'animate-spin')} />
            </button>
          </>
        )}
        {showNavControls ? (
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onFocus={() => setUrlInputFocused(true)}
            onBlur={() => setUrlInputFocused(false)}
            placeholder={nativeAvailable ? 'Search or enter address' : (isOn ? 'https://example.com' : 'https://…  (press Start)')}
            className="min-w-0 flex-1 rounded-full border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-xs text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--color-primary)]"
          />
        ) : (
          // Restricted mode — the user sees the current URL as a read-only pill.
          <div
            className="min-w-0 flex-1 truncate rounded-full border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-1 text-xs text-[var(--color-muted-foreground)]"
            title={descriptor?.currentUrl}
          >
            {descriptor?.currentUrl ?? 'about:blank'}
          </div>
        )}
        {/* Right cluster: Share / Inspect / Capture / Start-Stop */}
        <div className="flex items-center gap-0.5">
          {isOn && (
            <button
              type="button"
              onClick={handleToggleShare}
              disabled={agentBusy || loading === 'share'}
              title={shareTitle}
              aria-label={shareTitle}
              aria-pressed={attachedToChat}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium',
                attachedToChat
                  ? 'bg-[var(--color-primary-emphasis)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]'
                  : 'bg-[var(--color-subtle)] text-[var(--color-foreground)] hover:bg-[var(--color-emphasis)]',
                (agentBusy || loading === 'share') && 'opacity-50 cursor-not-allowed',
              )}
            >
              {attachedToChat ? <Share2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
              <span>{attachedToChat ? 'Sharing' : 'Share'}</span>
            </button>
          )}
          {isOn && (
            <button
              type="button"
              onClick={handleToggleInspector}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-subtle)]',
                (inspectorOn || annotateOn) && 'bg-[color-mix(in_srgb,var(--color-done)_25%,transparent)] text-[var(--color-done)] hover:bg-[color-mix(in_srgb,var(--color-done)_30%,transparent)]',
              )}
              title={annotateOn ? 'Commenting — click elements to leave notes; click to exit' : 'Comment — click elements to leave notes and attach them to chat'}
              aria-pressed={inspectorOn || annotateOn}
            >
              <MousePointerClick className="h-3.5 w-3.5" />
            </button>
          )}
          {isOn && nativeAvailable && annotateOn && (
            <DropdownMenu open={commentsOpen} onOpenChange={setCommentsOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-subtle)]',
                    annotateItems.length > 0 && 'text-[var(--color-primary)]',
                  )}
                  title="Comments — view all notes and send to chat"
                  aria-label={`Comments (${annotateItems.length})`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {annotateItems.length > 0 && (
                    <span className="rounded-full bg-[var(--color-primary)] px-1.5 text-[10px] font-semibold leading-4 text-[var(--color-primary-foreground)]">
                      {annotateItems.length}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[300px] p-0">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs font-semibold text-[var(--color-foreground)]">
                    Comments {annotateItems.length > 0 ? `(${annotateItems.length})` : ''}
                  </span>
                  {annotateItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void clearAnnotations()}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]"
                    >
                      <Trash2 className="h-3 w-3" /> Clear
                    </button>
                  )}
                </div>
                <DropdownMenuSeparator className="my-0" />
                {annotateItems.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[11px] text-[var(--color-muted-foreground)]">
                    Click an element or drag a region on the page to add a comment.
                  </div>
                ) : (
                  <div className="max-h-[280px] overflow-y-auto py-1">
                    {annotateItems.map((it) => (
                      <div key={it.key} className="group flex items-start gap-2 px-3 py-1.5 hover:bg-[var(--color-subtle)]">
                        <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[9px] font-bold text-[var(--color-primary-foreground)]">
                          {it.n}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[11px] text-[var(--color-foreground)]" title={it.label}>{it.label}</div>
                          <div className={cn('truncate text-[11px]', it.comment ? 'text-[var(--color-muted-foreground)]' : 'italic text-[var(--color-muted-foreground)] opacity-60')} title={it.comment}>
                            {it.comment || 'No comment yet'}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => void sendAnnotations([it.key])}
                            disabled={!it.comment}
                            title="Send this comment to chat"
                            className="rounded p-1 text-[var(--color-primary)] hover:bg-[color-mix(in_srgb,var(--color-primary)_15%,transparent)] disabled:opacity-30"
                          >
                            <Send className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeAnnotation(it.key)}
                            title="Delete this comment"
                            className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-danger)]"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {annotateItems.some((i) => i.comment) && (
                  <>
                    <DropdownMenuSeparator className="my-0" />
                    <div className="p-2">
                      <button
                        type="button"
                        onClick={() => void sendAnnotations()}
                        className="flex w-full items-center justify-center gap-1.5 rounded bg-[var(--color-primary-emphasis)] px-2 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Send all to chat
                      </button>
                    </div>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isOn && showNavControls && (
            <button
              type="button"
              onClick={handleToggleCapture}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-subtle)]',
                captureMode && 'bg-[var(--color-success-muted)] text-[var(--color-success)] hover:bg-[color-mix(in_srgb,var(--color-success)_25%,transparent)]',
              )}
              title={nativeAvailable ? 'Comment on a region — drag to select an area, add a note, and send to chat' : 'Capture region — drag to select an area and attach it to chat'}
              aria-pressed={captureMode}
            >
              {nativeAvailable ? <Crop className="h-3.5 w-3.5" /> : <Crop className="h-3.5 w-3.5" />}
            </button>
          )}
          {nativeAvailable && isOn && workspaceId && (
            <button
              type="button"
              onClick={handleToggleEmulation}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-subtle)]',
                emulationOn && 'bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)] text-[var(--color-primary)] hover:bg-[color-mix(in_srgb,var(--color-primary)_28%,transparent)]',
              )}
              title="Toggle device toolbar — responsive dimensions, zoom & mobile emulation"
              aria-pressed={emulationOn}
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
          )}
          {nativeAvailable && isOn && workspaceId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-subtle)]"
                  title="More — open browser DevTools"
                  aria-label="Browser options"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[190px]">
                <DropdownMenuLabel>Developer Tools</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => nativeTabId && void window.generatoraiDesktop?.browser?.openDevtools?.(nativeTabId)}
                >
                  <Wrench className="mr-2 h-3.5 w-3.5" />
                  Open DevTools
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => nativeTabId && void window.generatoraiDesktop?.browser?.openDevtools?.(nativeTabId, 'network')}
                >
                  <Activity className="mr-2 h-3.5 w-3.5" />
                  Open Network tab
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => nativeTabId && void window.generatoraiDesktop?.browser?.openDevtools?.(nativeTabId, 'console')}
                >
                  <Terminal className="mr-2 h-3.5 w-3.5" />
                  Open Console tab
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => nativeTabId && void window.generatoraiDesktop?.browser?.openDevtools?.(nativeTabId, 'elements')}
                >
                  <MousePointerClick className="mr-2 h-3.5 w-3.5" />
                  Inspect Elements
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {showNavControls && (
            !isOn ? (
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={loading === 'start'}
                className="ml-1 flex items-center gap-1 rounded bg-[var(--color-primary-emphasis)] px-2 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)] disabled:opacity-50"
              >
                {loading === 'start' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Start
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStop}
                disabled={loading === 'stop'}
                className="ml-1 flex items-center gap-1 rounded bg-[var(--color-danger)] px-2 py-1 text-xs font-medium text-white hover:bg-[color-mix(in_srgb,var(--color-danger)_85%,black)]"
              >
                {loading === 'stop' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
              </button>
            )
          )}
        </div>
      </form>

      {/* Device emulation bar — native desktop responsive toolbar ─── */}
      {nativeAvailable && isOn && emulationOn && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-[11px] text-[var(--color-foreground)]">
          <select
            value={emuPreset}
            onChange={(e) => handlePickPreset(e.target.value)}
            className="rounded border border-[var(--color-input)] bg-[var(--color-card)] px-1.5 py-1 text-[11px] outline-none focus:border-[var(--color-primary)]"
            title="Device preset"
          >
            {DEVICE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
            {emuPreset === 'custom' && <option value="custom">Custom</option>}
          </select>

          <div className="flex items-center gap-1">
            <input
              type="number"
              min={100}
              max={4096}
              value={emuWidth}
              onChange={(e) => handleEmuDimChange(Math.max(100, Number(e.target.value) || 0), emuHeight)}
              disabled={emuPreset === 'responsive'}
              className="w-16 rounded border border-[var(--color-input)] bg-[var(--color-card)] px-1.5 py-1 text-[11px] outline-none focus:border-[var(--color-primary)] disabled:opacity-40"
              title="Width (px)"
            />
            <span className="text-[var(--color-muted-foreground)]">×</span>
            <input
              type="number"
              min={100}
              max={4096}
              value={emuHeight}
              onChange={(e) => handleEmuDimChange(emuWidth, Math.max(100, Number(e.target.value) || 0))}
              disabled={emuPreset === 'responsive'}
              className="w-16 rounded border border-[var(--color-input)] bg-[var(--color-card)] px-1.5 py-1 text-[11px] outline-none focus:border-[var(--color-primary)] disabled:opacity-40"
              title="Height (px)"
            />
            <button
              type="button"
              onClick={handleEmuRotate}
              disabled={emuPreset === 'responsive'}
              className="rounded p-1 hover:bg-[var(--color-subtle)] disabled:opacity-40"
              title="Rotate (swap width/height)"
              aria-label="Rotate viewport"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          <label className="flex items-center gap-1" title="Device pixel ratio">
            <span className="text-[var(--color-muted-foreground)]">DPR</span>
            <select
              value={String(emuDpr)}
              onChange={(e) => handleEmuDpr(Number(e.target.value))}
              disabled={emuPreset === 'responsive'}
              className="rounded border border-[var(--color-input)] bg-[var(--color-card)] px-1 py-1 text-[11px] outline-none focus:border-[var(--color-primary)] disabled:opacity-40"
            >
              {[1, 1.5, 2, 3].map((d) => <option key={d} value={d}>{d}×</option>)}
            </select>
          </label>

          <label className="flex items-center gap-1" title="Emulate touch / mobile user-agent metrics">
            <input
              type="checkbox"
              checked={emuMobile}
              disabled={emuPreset === 'responsive'}
              onChange={(e) => {
                setEmuMobile(e.target.checked);
                applyEmulation({ on: true, preset: emuPreset, width: emuWidth, height: emuHeight, dpr: emuDpr, mobile: e.target.checked, zoom: emuZoom });
              }}
            />
            <span>Mobile</span>
          </label>

          <label className="flex items-center gap-1" title="Page zoom">
            <span className="text-[var(--color-muted-foreground)]">Zoom</span>
            <select
              value={String(emuZoom)}
              onChange={(e) => handleEmuZoom(Number(e.target.value))}
              className="rounded border border-[var(--color-input)] bg-[var(--color-card)] px-1 py-1 text-[11px] outline-none focus:border-[var(--color-primary)]"
            >
              {ZOOM_LEVELS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
            </select>
          </label>
        </div>
      )}

      {/* Annotate-mode status strip — the comment UI itself lives inside the
          page (native WCV overlay). Sending is via the Comments popover. */}
      {nativeAvailable && isOn && annotateOn && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-primary)_8%,var(--color-background))] px-3 py-1.5 text-[11px] text-[var(--color-muted-foreground)]">
          <MousePointerClick className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          <span>
            {annotateItems.length > 0
              ? `${annotateItems.length} comment${annotateItems.length > 1 ? 's' : ''} — open Comments to review & send`
              : 'Click an element or drag a region to leave a comment'}
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1 border-b border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[var(--color-danger-muted)] px-3 py-1 text-[11px] text-[var(--color-danger)]">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          <span className="truncate" title={error}>{error}</span>
          <button className="ml-auto rounded px-1 hover:bg-[color-mix(in_srgb,var(--color-danger)_20%,transparent)]" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Live view ─────────────────────────────────────── */}
      {nativeAvailable && workspaceId && nativeTabId ? (
        <NativeBrowserView
          tabId={nativeTabId}
          workspaceId={workspaceId}
          restoreUrl={restoreUrlRef.current}
          onUrlChange={(u) => setNativeUrl(isInternalBrowserUrl(u) ? null : u)}
          onTitleChange={(t) => setTabTitle(t ?? null)}
          onLoadingChange={(l) => setTabLoading(l)}
          onFaviconChange={(f) => setTabFavicon(f ?? null)}
          onError={(msg) => setError(msg)}
        />
      ) : (
        <div
          ref={liveContainerRef}
          className="relative flex flex-1 min-h-0 items-center justify-center bg-[var(--color-subtle)]"
        >
          {/*
            Mounted for the whole time the browser is on, not only once a frame
            has arrived: the decoder needs somewhere to draw before there is
            anything to show, and the canvas is also what holds the last frame
            on screen while the socket reconnects.
          */}
          {isOn && (
            <canvas
              ref={liveCanvasRef}
              role="img"
              aria-label="Browser live view"
              className={cn(
                'h-full w-full object-contain select-none focus:outline-none',
                !hasFrame && 'opacity-0',
                captureMode ? 'cursor-crosshair' : inspectorOn ? 'cursor-copy' : fullInteractivity ? 'cursor-pointer' : 'cursor-default',
              )}
              tabIndex={0}
              onClick={captureMode ? undefined : handleLiveClick}
              onContextMenu={(e) => { e.preventDefault(); if (!captureMode) handleLiveClick(e); }}
              onWheel={handleLiveWheel}
              onMouseMove={captureMode ? handleCaptureMouseMove : handleLiveMouseMove}
              onMouseDown={captureMode ? handleCaptureMouseDown : undefined}
              onMouseUp={captureMode ? handleCaptureMouseUp : undefined}
              onKeyDown={handleLiveKeyDown}
            />
          )}
          {!(isOn && hasFrame) && (
            <div className="absolute inset-0 flex h-full items-center justify-center text-center text-sm text-[var(--color-muted-foreground)]">
              <div>
                {status === 'starting' && (<><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" /><div>Starting Chromium…</div></>)}
                {isOn && !hasFrame && (<><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" /><div>Loading live view…</div></>)}
                {(status === 'off' || status === 'terminated') && (
                  <div>
                    <div className="mb-1">Browser is not running.</div>
                    {showNavControls ? (
                      <div className="text-xs opacity-80">
                        Type a URL and press <kbd className="rounded bg-[var(--color-subtle)] px-1 text-[var(--color-foreground)]">Start</kbd>.
                      </div>
                    ) : (
                      // Without full interactivity there is no URL bar, so the
                      // bare "not running" line was a dead end.
                      <div className="mx-auto max-w-xs text-xs opacity-80">
                        Ask the agent to browse a page, or enable{' '}
                        <span className="text-[var(--color-foreground)]">
                          Settings → Browser &amp; Terminal → interactive browser
                        </span>{' '}
                        to drive it yourself.
                      </div>
                    )}
                  </div>
                )}
                {status === 'error' && (
                  <div className="text-[var(--color-danger)]">
                    <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
                    Browser error. Try Start again.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Capture-drag rectangle overlay */}
          {captureMode && captureRect && (
            <div
              className="pointer-events-none absolute border-2 border-[var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)]"
              style={{
                left: captureRect.x,
                top: captureRect.y + (embedded ? 0 : 0),
                width: captureRect.w,
                height: captureRect.h,
              }}
            />
          )}

          {/* Overlay scrollbar — draggable */}
          {isOn && hasFrame && scrollState && scrollState.scrollHeight > scrollState.clientHeight + 4 && (() => {
            const { scrollY, scrollHeight, clientHeight } = scrollState;
            const trackRatio = clientHeight / scrollHeight;
            const scrollRatio = scrollY / (scrollHeight - clientHeight);
            const thumbHeightPct = Math.max(4, trackRatio * 100);
            const thumbTopPct = Math.min(100 - thumbHeightPct, scrollRatio * (100 - thumbHeightPct));
            return (
              <div
                ref={scrollBarRef}
                className="absolute right-1.5 top-2 bottom-2 w-2.5 rounded-full bg-[color-mix(in_srgb,var(--color-foreground)_15%,transparent)] shadow-lg ring-1 ring-[color-mix(in_srgb,var(--color-foreground)_20%,transparent)]"
                aria-hidden
              >
                <div
                  onMouseDown={handleScrollThumbDown}
                  className="absolute left-0 right-0 rounded-full bg-[color-mix(in_srgb,var(--color-foreground)_70%,transparent)] shadow-md cursor-grab active:cursor-grabbing"
                  style={{ top: `${thumbTopPct}%`, height: `${thumbHeightPct}%` }}
                />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
