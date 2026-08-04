// ────────────────────────────────────────────────────────────────
// TerminalPanel — xterm.js live terminal wired to the server-hosted PTY
// via WebSocket. Mirrors the topology of BrowserPanel.
//
// One React component == one "tab" in the RightPane. The stable `tabId`
// prop is used to persist the underlying server-side session id in
// localStorage — this survives page reloads (until the server restarts).
//
// Transport:
//   • Binary WS frames from the server → term.write(bytes, ackCallback)
//   • JSON control frames from the server → resize / ready / exit
//   • Client sends `{ t:'input' }`, `{ t:'resize' }`, `{ t:'ack' }`
//
// Flow control:
//   • ACK every ~64 KB written into xterm.
//   • Client-side we rely on the server's watermark logic (pause/resume
//     the PTY) — same shape documented on xtermjs.org.
//
// UX:
//   • Header: cwd/badge, shell name, host kind, [+ New] [🔍] [Clear]
//     [📎 Attach selection] [Kill].
//   • Sandbox tint when host === 'sandbox'.
//   • Fallback banner when host === 'fallback-child-process'.
//
// Multi-worktree navigation: when `worktrees` is provided we render a
// small `cd source/<alias>` dropdown so users don't have to type paths.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Terminal as TerminalIcon,
  Trash2,
  Eraser,
  Search,
  Send,
  FolderGit2,
  AlertTriangle,
  Loader2,
  Zap,
  X,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
} from 'lucide-react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { cn } from '@/lib/utils.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import { buildAuthenticatedSocketUrl } from '@/platform/authTransport.js';
import type { TerminalSessionDescriptor } from '@generatorai/shared';

// ── Types ────────────────────────────────────────────────────

export interface TerminalWorktreeOption {
  /** Alias shown in the dropdown (e.g. `backend`, `frontend`). */
  alias: string;
  /** Path relative to workspace root (e.g. `source/backend`). */
  path: string;
}

export interface TerminalPanelProps {
  workspaceId: string | undefined;
  /** Stable per-RightPane tab id. Used to key the server sid in localStorage. */
  tabId: string;
  /** When true the outer chrome/close chrome is hidden (RightPane host). */
  embedded?: boolean;
  /** Called with a `.txt` File when the user hits "Attach selection". */
  onCapture?: (file: File, kind: 'terminal') => void;
  /** Optional worktree quick-cd menu for the workflow-run page. */
  worktrees?: TerminalWorktreeOption[];
  /** True while the agent is streaming — visual hint only. */
  agentBusy?: boolean;
}

/** localStorage key for cached session id, keyed on (workspaceId, tabId). */
function sidStorageKey(workspaceId: string, tabId: string): string {
  return `generatorai:terminal:${workspaceId}:${tabId}`;
}

// ── HTTP helpers ─────────────────────────────────────────────

async function createSession(
  workspaceId: string,
  cols: number,
  rows: number,
): Promise<TerminalSessionDescriptor> {
  const res = await fetch(`/api/workspaces/${workspaceId}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`create terminal failed (${res.status}): ${t}`);
  }
  return (await res.json()) as TerminalSessionDescriptor;
}

async function describeSession(
  workspaceId: string,
  sid: string,
): Promise<TerminalSessionDescriptor | null> {
  const res = await fetch(`/api/workspaces/${workspaceId}/terminals/${sid}`);
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as TerminalSessionDescriptor;
}

async function fetchScrollback(workspaceId: string, sid: string): Promise<Uint8Array> {
  const res = await fetch(`/api/workspaces/${workspaceId}/terminals/${sid}/scrollback`);
  if (!res.ok) return new Uint8Array();
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function killSession(workspaceId: string, sid: string): Promise<void> {
  // `keepalive: true` lets the DELETE finish even if React unmounts /
  // the tab is closed before the response arrives. Without this the browser
  // aborts the pending fetch and the server-side PTY has to wait for the
  // idle reaper (~30 min) to notice — bad UX for repeated open/close.
  await fetch(`/api/workspaces/${workspaceId}/terminals/${sid}`, {
    method: 'DELETE',
    keepalive: true,
  }).catch(() => undefined);
}

// ── Constants ────────────────────────────────────────────────

/** ACK the server every ~64 KB of output we've written into xterm. */
const ACK_BYTE_INTERVAL = 64 * 1024;

// ── Component ────────────────────────────────────────────────

export function TerminalPanel({
  workspaceId,
  tabId,
  embedded = false,
  onCapture,
  worktrees,
  agentBusy = false,
}: TerminalPanelProps): React.JSX.Element {
  const [descriptor, setDescriptor] = useState<TerminalSessionDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [exitInfo, setExitInfo] = useState<{ code: number; signal?: string } | null>(null);
  /** Tracks whether xterm currently has a mouse-selected range. Drives Attach button. */
  const [hasSelection, setHasSelection] = useState(false);
  /** Inline search widget (Ctrl+F style) — visible when true. */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchNoMatch, setSearchNoMatch] = useState(false);
  /**
   * Transient hint under the toolbar — displays "Select text first." or
   * "✓ Attached to chat" briefly after clicking Attach.
   */
  const [attachHint, setAttachHint] = useState<
    | { kind: 'none' }
    | { kind: 'empty' }
    | { kind: 'attached'; bytes: number }
  >({ kind: 'none' });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sidRef = useRef<string | null>(null);
  const unackedRef = useRef(0);
  /** Bytes written into xterm since the last ACK sent to the server. */
  const writtenSinceAckRef = useRef(0);
  /**
   * React StrictMode double-invokes effects in dev — without this guard
   * we'd POST /terminals twice per mount and leak a session. This ref
   * survives the immediate unmount/remount cycle because it's stored on
   * the fiber, not per-effect.
   */
  const sessionInitStarted = useRef(false);

  const sessionEnded = exitInfo !== null;

  // Live theme — xterm's palette is refreshed when the user toggles
  // light/dark from Settings, and the surrounding chrome adopts the
  // active color tokens automatically via CSS vars.
  const { resolvedTheme } = useTheme();

  // ── Setup: mount xterm once ─────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Xterm({
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: 'JetBrainsMono, "Fira Code", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      allowProposedApi: true,
      theme: getXtermTheme(resolvedTheme),
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    try {
      // WebGL can fail on some GPUs / when CSP forbids it — fall back
      // silently to the DOM renderer.
      term.loadAddon(new WebglAddon());
    } catch { /* ignore */ }
    xtermRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    // Track selection state so the toolbar's Attach button reflects reality.
    const selectionSub = term.onSelectionChange(() => {
      setHasSelection(term.hasSelection());
    });

    // Ctrl+F / Cmd+F opens the inline search widget. We intercept before xterm
    // hands the sequence to the shell — otherwise pwsh would receive ^F.
    term.attachCustomKeyEventHandler((ev) => {
      const isFind = (ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'f';
      if (isFind && ev.type === 'keydown') {
        setSearchOpen(true);
        return false; // swallow — don't send to PTY
      }
      return true;
    });

    // Deferred fit — layout may not be settled on first render.
    const fitTimer = setTimeout(() => { try { fit.fit(); } catch { /* ignore */ } }, 50);

    return () => {
      clearTimeout(fitTimer);
      try { selectionSub.dispose(); } catch { /* ignore */ }
      // attachCustomKeyEventHandler doesn't expose a disposer — passing a
      // no-op replaces the handler on unmount.
      try { term.attachCustomKeyEventHandler(() => true); } catch { /* ignore */ }
      try { term.dispose(); } catch { /* ignore */ }
      xtermRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
    // Mounted once; the palette is refreshed reactively via a separate
    // effect (`term.options.theme = …`) when `resolvedTheme` changes.
  }, []);

  // ── Session lookup / create + WS attach ─────────────────
  useEffect(() => {
    if (!workspaceId || !xtermRef.current) return;
    // React StrictMode fires effects twice in dev — a second invocation
    // for the same (workspaceId, tabId) tuple would spawn a duplicate PTY.
    if (sessionInitStarted.current) return;
    sessionInitStarted.current = true;
    let cancelled = false;
    const term = xtermRef.current;
    const fit = fitRef.current;

    (async () => {
      setConnecting(true);
      setError(null);
      setExitInfo(null);

      // 1. Try cached sid.
      let sid: string | null = null;
      try {
        const cached = window.localStorage.getItem(sidStorageKey(workspaceId, tabId));
        if (cached) {
          const d = await describeSession(workspaceId, cached);
          if (d && d.exitCode === null) {
            sid = cached;
            setDescriptor(d);
          } else {
            window.localStorage.removeItem(sidStorageKey(workspaceId, tabId));
          }
        }
      } catch { /* ignore */ }

      // 2. Create a fresh session.
      if (!cancelled && !sid) {
        try {
          const cols = term.cols || 80;
          const rows = term.rows || 24;
          const d = await createSession(workspaceId, cols, rows);
          sid = d.id;
          // If a cleanup fired while we were awaiting the POST (React
          // StrictMode double-mount / rapid deps change), the session
          // we just created is orphaned. Kill it immediately.
          if (cancelled) {
            void killSession(workspaceId, sid);
            return;
          }
          setDescriptor(d);
          try { window.localStorage.setItem(sidStorageKey(workspaceId, tabId), sid); } catch { /* ignore */ }
        } catch (err) {
          if (!cancelled) {
            setError((err as Error).message);
            setConnecting(false);
          }
          return;
        }
      }
      if (cancelled || !sid) return;
      sidRef.current = sid;

      // 3. Replay scrollback.
      try {
        const bytes = await fetchScrollback(workspaceId, sid);
        if (!cancelled && bytes.length > 0) {
          term.write(bytes);
        }
      } catch { /* ignore */ }

      // 4. Open WS.
      // The socket is authorised by a single-use ticket minted over the
      // authenticated HTTP channel — a WebSocket handshake cannot carry an
      // Authorization header, and minting the ticket requires `exec:terminal`.
      let wsUrl: string;
      try {
        wsUrl = await buildAuthenticatedSocketUrl(
          `/api/workspaces/${workspaceId}/terminals/${sid}/stream`,
          { scope: 'terminal', id: sid },
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error && /INSUFFICIENT_SCOPE|403/.test(err.message)
              ? 'This device is not allowed to open terminals (missing exec:terminal).'
              : (err as Error).message,
          );
          setConnecting(false);
        }
        return;
      }
      if (cancelled) return;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      unackedRef.current = 0;
      writtenSinceAckRef.current = 0;

      ws.onopen = () => {
        if (cancelled) return;
        setConnecting(false);
        // Send an initial resize matching the current xterm dimensions.
        try {
          ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
        } catch { /* ignore */ }
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const frame = JSON.parse(ev.data) as
              | { t: 'ready'; descriptor: TerminalSessionDescriptor }
              | { t: 'exit'; code: number; signal?: string }
              | { t: 'resized'; cols: number; rows: number }
              | { t: 'error'; message: string };
            if (frame.t === 'ready') setDescriptor(frame.descriptor);
            else if (frame.t === 'exit') setExitInfo({ code: frame.code, ...(frame.signal ? { signal: frame.signal } : {}) });
            else if (frame.t === 'error') setError(frame.message);
          } catch { /* ignore */ }
          return;
        }
        // Binary frame — write into xterm and ACK back to the server.
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        term.write(bytes, () => {
          writtenSinceAckRef.current += bytes.length;
          if (writtenSinceAckRef.current >= ACK_BYTE_INTERVAL && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ t: 'ack', bytes: writtenSinceAckRef.current }));
              writtenSinceAckRef.current = 0;
            } catch { /* ignore */ }
          }
        });
      };

      ws.onerror = () => {
        if (!cancelled) setError('Terminal connection error');
      };
      ws.onclose = () => {
        if (!cancelled) {
          setConnecting(false);
        }
      };

      // 5. Wire xterm → WS.
      const inputSub = term.onData((data) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send(JSON.stringify({ t: 'input', data }));
        } catch { /* ignore */ }
      });
      const resizeSub = term.onResize((size) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send(JSON.stringify({ t: 'resize', cols: size.cols, rows: size.rows }));
        } catch { /* ignore */ }
      });

      // Refit on window resize (fires while dragging RightPane too).
      const onWindowResize = (): void => {
        try { fit?.fit(); } catch { /* ignore */ }
      };
      window.addEventListener('resize', onWindowResize);

      // Cleanup for THIS effect's async block.
      const cleanup = (): void => {
        cancelled = true;
        window.removeEventListener('resize', onWindowResize);
        try { inputSub.dispose(); } catch { /* ignore */ }
        try { resizeSub.dispose(); } catch { /* ignore */ }
        try { ws.close(); } catch { /* ignore */ }
        wsRef.current = null;
      };
      // Attach cleanup to the outer cancellation flag.
      (ws as unknown as { __cleanup?: () => void }).__cleanup = cleanup;
    })();

    return () => {
      cancelled = true;
      const ws = wsRef.current;
      if (ws) {
        const cleanup = (ws as unknown as { __cleanup?: () => void }).__cleanup;
        if (cleanup) cleanup();
        try { ws.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
      // Allow a legit deps change (new workspaceId or tabId) to spawn
      // a fresh session on the next mount.
      sessionInitStarted.current = false;
    };
  }, [workspaceId, tabId]);

  // ── Refit periodically via ResizeObserver (RightPane drag) ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      try { fitRef.current?.fit(); } catch { /* ignore */ }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Re-theme xterm when the app theme flips ─────────────
  //
  // xterm exposes a mutable `options.theme` — assigning a new object
  // triggers a repaint of the buffer/cursor. We keep this in a separate
  // effect so the terminal itself is created only once.
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    try { term.options.theme = getXtermTheme(resolvedTheme); } catch { /* ignore */ }
  }, [resolvedTheme]);

  // ── Cleanup on unmount: kill the server-side session ─────
  useEffect(() => {
    return () => {
      const ws = workspaceId;
      const sid = sidRef.current;
      // Kill via WS first — this is the reliable path because Vite dev
      // proxy + browser fetch abort race regularly cancels the DELETE
      // request on component unmount (net::ERR_ABORTED). The WS message
      // fires synchronously and the server acts on it before the socket
      // fully drains.
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        try { sock.send(JSON.stringify({ t: 'kill' })); } catch { /* ignore */ }
      }
      if (ws && sid) {
        void killSession(ws, sid);
        try { window.localStorage.removeItem(sidStorageKey(ws, tabId)); } catch { /* ignore */ }
      }
    };
    // Only bind to workspaceId + tabId so an in-place descriptor refresh
    // doesn't kill the session mid-life.
  }, [workspaceId, tabId]);

  // ── Actions ─────────────────────────────────────────────
  const handleClear = useCallback(() => {
    xtermRef.current?.clear();
    // Also nuke any current search decorations that no longer point anywhere.
    try { searchRef.current?.clearDecorations(); } catch { /* ignore */ }
    setSearchNoMatch(false);
  }, []);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchNoMatch(false);
    try { searchRef.current?.clearDecorations(); } catch { /* ignore */ }
    // Return focus to the terminal so the user can keep typing.
    xtermRef.current?.focus();
  }, []);

  const runSearch = useCallback((query: string, direction: 'next' | 'prev'): void => {
    const s = searchRef.current;
    if (!s) return;
    if (!query) {
      try { s.clearDecorations(); } catch { /* ignore */ }
      setSearchNoMatch(false);
      return;
    }
    // xterm-addon-search options: incremental + decoration highlighting.
    const options = {
      regex: false,
      wholeWord: false,
      caseSensitive: false,
      incremental: false,
      decorations: {
        matchBackground: '#4d4d00',
        matchOverviewRuler: '#d19a66',
        activeMatchBackground: '#d19a66',
        activeMatchColorOverviewRuler: '#f5c542',
      },
    };
    let found = false;
    try {
      found = direction === 'next'
        ? s.findNext(query, options)
        : s.findPrevious(query, options);
    } catch { /* ignore */ }
    setSearchNoMatch(!found);
  }, []);

  const handleAttachSelection = useCallback(() => {
    const term = xtermRef.current;
    if (!term) return;
    const sel = term.getSelection() ?? '';
    if (!sel.trim()) {
      setAttachHint({ kind: 'empty' });
      // Keep the hint on-screen for 2.5 s then clear.
      window.setTimeout(() => setAttachHint({ kind: 'none' }), 2500);
      return;
    }
    if (!onCapture) return;
    const bytes = new Blob([sel], { type: 'text/plain' });
    const file = new File([bytes], `terminal-selection-${Date.now()}.txt`, { type: 'text/plain' });
    onCapture(file, 'terminal');
    setAttachHint({ kind: 'attached', bytes: bytes.size });
    // Give visual confirmation, then reset.
    window.setTimeout(() => setAttachHint({ kind: 'none' }), 2000);
    // Clear the selection so the user knows the attach action consumed it.
    try { term.clearSelection(); } catch { /* ignore */ }
  }, [onCapture]);

  const handleCd = useCallback((absPath: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Quote for both POSIX and Windows shells — path may contain spaces.
    // We just use double quotes which both accept.
    const cmd = `cd "${absPath}"\r`;
    try {
      ws.send(JSON.stringify({ t: 'input', data: cmd }));
    } catch { /* ignore */ }
  }, []);

  const handleKill = useCallback(async () => {
    const ws = workspaceId;
    const sid = sidRef.current;
    if (!ws || !sid) return;
    await killSession(ws, sid);
  }, [workspaceId]);

  // ── Derived ─────────────────────────────────────────────
  const isSandbox = descriptor?.host === 'sandbox';
  const isFallback = descriptor?.host === 'fallback-child-process';
  const cwdShort = useMemo(() => shortenPath(descriptor?.cwd ?? ''), [descriptor?.cwd]);

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--color-muted-foreground)]">
        Workspace not ready. Send a message first.
      </div>
    );
  }

  return (
    <div
      data-testid="terminal-panel"
      className={cn(
        'flex h-full min-h-0 flex-col',
        !embedded && 'rounded-md border border-[var(--color-border)] bg-[var(--color-background)]',
        isSandbox && 'ring-1 ring-[var(--color-done)]/40',
      )}
    >
      {/* Header — hidden in some embeds but always useful for terminal */}
      <div
        data-testid="terminal-header"
        className={cn(
          'flex items-center gap-2 border-b px-2 py-1.5 text-[11px]',
          'border-[var(--color-border)] bg-[var(--color-card)]',
        )}
      >
        <TerminalIcon className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
        <span
          data-testid="terminal-cwd"
          title={descriptor?.cwd}
          className="max-w-[240px] truncate font-mono text-[10.5px] text-[var(--color-muted-foreground)]"
        >
          {cwdShort || '…'}
        </span>
        {descriptor && (
          <span
            className="rounded bg-[var(--color-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted-foreground)]"
            title={`${descriptor.shell} • pid ${descriptor.pid ?? '?'} • ${descriptor.host}`}
          >
            {descriptor.host === 'node-pty' ? 'pty' : descriptor.host === 'sandbox' ? 'sandbox' : 'fallback'}
          </span>
        )}
        {agentBusy && (
          <span
            className="inline-flex items-center gap-1 rounded bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-primary)]"
            title="Agent is running"
          >
            <Zap className="h-3 w-3" /> agent
          </span>
        )}
        <div className="flex-1" />

        {worktrees && worktrees.length > 0 && (
          <WorktreeQuickCd worktrees={worktrees} onCd={handleCd} />
        )}

        <button
          data-testid="terminal-attach-to-chat"
          onClick={handleAttachSelection}
          disabled={!onCapture}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] disabled:opacity-40',
            hasSelection && onCapture
              ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
              : 'border-[var(--color-border)] hover:bg-[var(--color-subtle)]',
          )}
          title={
            !onCapture
              ? 'Attach is only available when a chat can receive it'
              : hasSelection
                ? 'Attach the current selection to the chat'
                : 'Select text in the terminal, then click Attach'
          }
        >
          <Send className="h-3 w-3" />
          Attach
        </button>
        <button
          onClick={openSearch}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[10px]',
            searchOpen
              ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
              : 'border-[var(--color-border)] hover:bg-[var(--color-subtle)]',
          )}
          title="Find (Ctrl+F)"
        >
          <Search className="h-3 w-3" />
        </button>
        <button
          onClick={handleClear}
          className="inline-flex h-6 items-center gap-1 rounded border border-[var(--color-border)] px-1.5 text-[10px] hover:bg-[var(--color-subtle)]"
          title="Clear scrollback"
        >
          <Eraser className="h-3 w-3" />
        </button>
        <button
          onClick={handleKill}
          className="inline-flex h-6 items-center gap-1 rounded border border-[var(--color-border)] px-1.5 text-[10px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
          title="Kill the terminal process"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Sandbox / fallback banners */}
      {isSandbox && (
        <div className="border-b border-[var(--color-done)]/40 bg-[color-mix(in_srgb,var(--color-done)_12%,transparent)] px-2 py-1 text-[10.5px] text-[var(--color-done)]">
          Sandbox-attached terminal — commands run inside the run's container.
        </div>
      )}
      {isFallback && (
        <div className="border-b border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-[var(--color-warning-muted)] px-2 py-1 text-[10.5px] text-[var(--color-warning)]">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          Fallback shell — full-screen apps (vim, htop) will not render correctly. Install <code>node-pty</code> for
          a proper PTY.
        </div>
      )}

      {/* Error / connecting overlay + xterm host */}
      <div className="relative flex-1 min-h-0 bg-[var(--color-background)]">
        <div ref={containerRef} className="absolute inset-0" data-testid="terminal-container" />

        {/* Inline search widget — VSCode-style overlay in the top-right of the
            terminal viewport. Focus-managed so typing goes into the search
            input, not the shell. */}
        {searchOpen && (
          <TerminalSearchBar
            query={searchQuery}
            noMatch={searchNoMatch}
            onChange={(next) => {
              setSearchQuery(next);
              runSearch(next, 'next');
            }}
            onNext={() => runSearch(searchQuery, 'next')}
            onPrev={() => runSearch(searchQuery, 'prev')}
            onClose={closeSearch}
          />
        )}

        {/* Attach feedback toast — visible for a few seconds after user clicks
            the Attach button. */}
        {attachHint.kind === 'empty' && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded border border-[color-mix(in_srgb,var(--color-warning)_50%,transparent)] bg-[var(--color-warning-muted)] px-3 py-1 text-[11px] text-[var(--color-warning)] shadow-lg">
            Select text in the terminal first, then click Attach.
          </div>
        )}
        {attachHint.kind === 'attached' && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded border border-[color-mix(in_srgb,var(--color-success)_50%,transparent)] bg-[var(--color-success-muted)] px-3 py-1 text-[11px] text-[var(--color-success)] shadow-lg">
            <CheckCircle2 className="h-3 w-3" />
            Attached to chat ({attachHint.bytes} bytes) — will send with next message.
          </div>
        )}

        {connecting && !error && !sessionEnded && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-background)_60%,transparent)] text-xs text-[var(--color-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting terminal…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-background)_75%,transparent)] p-4 text-center text-xs text-[var(--color-danger)]">
            <div>
              <AlertTriangle className="mx-auto mb-1 h-4 w-4" />
              {error}
            </div>
          </div>
        )}
        {sessionEnded && (
          <div
            data-testid="terminal-exited"
            className="pointer-events-none absolute bottom-2 left-2 rounded border border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-[var(--color-warning-muted)] px-2 py-1 text-[10px] text-[var(--color-warning)]"
          >
            Process exited{exitInfo?.signal ? ` (${exitInfo.signal})` : ''} — code {exitInfo?.code ?? '?'}. Close the tab to restart.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * VSCode-style search bar. Absolute-positioned in the terminal viewport;
 * pointer-events on so the user can type into it. Escape closes the widget
 * and returns focus to xterm.
 */
function TerminalSearchBar({
  query,
  noMatch,
  onChange,
  onNext,
  onPrev,
  onClose,
}: {
  query: string;
  noMatch: boolean;
  onChange: (next: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    // Autofocus on open, but only once.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <div
      className="absolute top-1 right-2 z-10 flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)]/95 px-1.5 py-1 shadow-lg backdrop-blur"
      role="search"
      aria-label="Search terminal"
    >
      <Search className="h-3 w-3 text-[var(--color-muted-foreground)]" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
        placeholder="Find…"
        aria-label="Find in terminal"
        className={cn(
          'w-40 bg-transparent px-1 py-0.5 text-[11px] text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)]',
          noMatch && 'text-[var(--color-danger)]',
        )}
      />
      <button
        onClick={onPrev}
        title="Previous match (Shift+Enter)"
        className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--color-subtle)]"
      >
        <ChevronUp className="h-3 w-3" />
      </button>
      <button
        onClick={onNext}
        title="Next match (Enter)"
        className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--color-subtle)]"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
      <button
        onClick={onClose}
        title="Close (Escape)"
        className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--color-subtle)]"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function WorktreeQuickCd({
  worktrees,
  onCd,
}: {
  worktrees: TerminalWorktreeOption[];
  onCd: (absPath: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-6 items-center gap-1 rounded border border-[var(--color-border)] px-1.5 text-[10px] hover:bg-[var(--color-subtle)]"
        title="cd to a worktree"
      >
        <FolderGit2 className="h-3 w-3" />
        cd
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-10 w-40 rounded border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-lg">
          {worktrees.map((w) => (
            <button
              key={w.alias}
              onClick={() => { onCd(w.path); setOpen(false); }}
              className="block w-full truncate rounded px-2 py-1 text-left text-[11px] hover:bg-[var(--color-subtle)]"
            >
              {w.alias}
              <span className="ml-1 text-[10px] text-[var(--color-muted-foreground)]">{w.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────

function shortenPath(p: string): string {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return p;
  return '…/' + parts.slice(-3).join('/');
}

/** xterm palette matching the active app theme (light / dark). */
function getXtermTheme(
  appearance: 'light' | 'dark',
): NonNullable<ConstructorParameters<typeof Xterm>[0]>['theme'] {
  if (appearance === 'light') {
    // GitHub-Primer-ish light palette, tuned to match the `--background`
    // / `--foreground` tokens defined in globals.css so xterm blends into
    // the surrounding chrome.
    return {
      background: '#ffffff',
      foreground: '#1f2328',
      cursor: '#1f2328',
      cursorAccent: '#ffffff',
      selectionBackground: '#0969da33',
      black: '#24292f',
      red: '#cf222e',
      green: '#116329',
      yellow: '#4d2d00',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#1a7f37',
      brightYellow: '#633c01',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#8c959f',
    };
  }
  // Dark (default) palette — aligned with One Dark / VSCode dark+.
  return {
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#e6edf3',
    cursorAccent: '#0d1117',
    selectionBackground: '#1f6feb66',
    black: '#1e1e1e',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#d19a66',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#dcdfe4',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  };
}
