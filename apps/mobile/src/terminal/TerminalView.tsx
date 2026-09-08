// ────────────────────────────────────────────────────────────────
// TerminalView — the xterm renderer plus its PTY socket.
//
// The renderer is xterm.js in a WebView built from a LOCAL string with no
// network access; React Native owns the socket. See bridgeProtocol.ts for why
// that split is not negotiable.
//
// ── The wire protocol is not ad-hoc ──────────────────────────────
// `apps/server/src/terminal-ws.ts` defines it, and every field matters:
//
//   a session is created over HTTP FIRST — the socket path contains its id,
//   so there is no such thing as connecting to a "default" terminal
//
//   server → client   binary frames are raw PTY bytes
//                     text frames are JSON control: ready | exit | resized | error
//   client → server   JSON ONLY: {t:'input'} {t:'resize'} {t:'ack'} {t:'kill'}
//
// The ACK is load-bearing rather than advisory: the server pauses the PTY
// once unacked bytes cross a watermark, so a client that never acks gets one
// screenful of output and then silence that looks exactly like a hang.
//
// ── Memory ───────────────────────────────────────────────────────
// A WebView is the most expensive thing this app can hold. When `active` is
// false the socket is closed after a short grace period and the WebView is
// UNMOUNTED — not hidden. Becoming active again rebuilds the document and
// replays the server-side scrollback, which is why nothing is lost.
//
// ── Session ownership ────────────────────────────────────────────
// With `sessionId` the caller owns the session (a tab host that lists and
// closes shells); without it this view creates one and kills it on unmount,
// so a detached PTY never lingers for the server's idle reaper.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import {
  ChevronDown,
  ChevronUp,
  Eraser,
  Keyboard as KeyboardIcon,
  MoreHorizontal,
  Search,
  TerminalSquare,
  X,
} from 'lucide-react-native';
import type { TerminalDescriptor } from '@generatorai/client-core';

import { Touchable } from '../components/ui/Touchable';
import { Button, IconButton } from '../components/ui/Button';
import { ActionSheet, type MenuAction } from '../components/ui/ActionSheet';
import { EmptyState, Spinner } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { haptics } from '../components/ui/haptics';
import { MAX_SCALE } from '../components/ui/accessibility';
import { useAuth } from '../auth/AuthProvider';
import { useApi } from '../api/useApi';
import { prefs } from '../storage/prefs';
import { base64ToString, bytesToBase64 } from '../lib/base64';
import { useTheme } from '../theme/ThemeProvider';
import {
  OutputBatcher,
  isOpenableLink,
  parseFromWebView,
  type ToWebView,
} from './bridgeProtocol';
import {
  FONT_SIZE_DEFAULT,
  SCROLLBACK_REPLAY_BYTES,
  TERMINAL_PREF_KEYS,
  clampFontSize,
  type KeyBarMode,
} from './terminalSettings';

// NOTE: `./terminalHtml` is imported with a dynamic `import()` inside the
// component (see `useEffect` below) and nowhere else — it pulls in the
// ~570 KB vendored xterm bundle, which must stay off the startup path.

/** Matches the server's flow-control window. */
const ACK_BYTE_INTERVAL = 64 * 1024;

/** How long an inactive terminal keeps its socket before letting go. */
const INACTIVE_GRACE_MS = 5000;

/** Reconnect backoff after an unexpected socket drop. */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000];

export type ConnectionState = 'connecting' | 'attached' | 'reconnecting' | 'closed';

type Phase =
  | { state: 'idle' }
  | { state: 'live' }
  | { state: 'exited'; code: number | null; signal?: string }
  | { state: 'error'; message: string };

export interface TerminalViewProps {
  workspaceId: string;
  /**
   * Attach to an existing session. When omitted the view creates its own
   * and kills it on unmount.
   */
  sessionId?: string;
  /**
   * False when this terminal is not the one on screen. The socket closes
   * after a grace period and the WebView unmounts; `true` again re-attaches
   * with a scrollback replay. Defaults to true.
   */
  active?: boolean;
  /** Typed into the shell once attached, WITHOUT a newline. */
  initialInput?: string;
  /** OSC title from the shell — a tab host shows it on the chip. */
  onTitle?: (title: string) => void;
  /**
   * The session id changed: the view created its own, or a restart replaced
   * it. A tab host records the new id so a later close kills the right one.
   */
  onSessionChange?: (descriptor: TerminalDescriptor) => void;
  onExit?: (info: { code: number | null; signal?: string }) => void;
}

interface KeyDef {
  label: string;
  /** Raw bytes; `action` keys have none. */
  bytes?: string;
  action?: 'ctrl' | 'alt' | 'find' | 'paste';
  /** Arrow keys take a CSI modifier parameter when Ctrl/Alt is armed. */
  arrow?: 'A' | 'B' | 'C' | 'D';
  a11y: string;
}

/** Keys a phone keyboard cannot produce but a shell constantly needs. */
const KEY_BAR: KeyDef[] = [
  { label: 'esc', bytes: '\u001b', a11y: 'Escape' },
  { label: 'tab', bytes: '\t', a11y: 'Tab' },
  { label: 'ctrl', action: 'ctrl', a11y: 'Control modifier, sticky' },
  { label: 'alt', action: 'alt', a11y: 'Alt modifier, sticky' },
  { label: '←', bytes: '\u001b[D', arrow: 'D', a11y: 'Left arrow' },
  { label: '↑', bytes: '\u001b[A', arrow: 'A', a11y: 'Up arrow' },
  { label: '↓', bytes: '\u001b[B', arrow: 'B', a11y: 'Down arrow' },
  { label: '→', bytes: '\u001b[C', arrow: 'C', a11y: 'Right arrow' },
  { label: 'home', bytes: '\u001b[H', a11y: 'Home' },
  { label: 'end', bytes: '\u001b[F', a11y: 'End' },
  { label: 'pgup', bytes: '\u001b[5~', a11y: 'Page up' },
  { label: 'pgdn', bytes: '\u001b[6~', a11y: 'Page down' },
  { label: '^C', bytes: '\u0003', a11y: 'Control C, interrupt' },
  { label: '^D', bytes: '\u0004', a11y: 'Control D, end of input' },
  { label: '^Z', bytes: '\u001a', a11y: 'Control Z, suspend' },
  { label: '^L', bytes: '\u000c', a11y: 'Control L, clear screen' },
  { label: '/', action: 'find', a11y: 'Find in scrollback' },
  { label: 'paste', action: 'paste', a11y: 'Paste from clipboard' },
];

function readFontSize(): number {
  const stored = prefs.getString(TERMINAL_PREF_KEYS.fontSize);
  return clampFontSize(stored === undefined ? FONT_SIZE_DEFAULT : Number(stored));
}

function readKeyBarMode(): KeyBarMode {
  const stored = prefs.getString(TERMINAL_PREF_KEYS.keyBar);
  return stored === 'shown' || stored === 'hidden' ? stored : 'auto';
}

export function TerminalView({
  workspaceId,
  sessionId,
  active = true,
  initialInput,
  onTitle,
  onSessionChange,
  onExit,
}: TerminalViewProps): React.ReactElement {
  const { socketUrl, fetch: authedFetch } = useAuth();
  const api = useApi();
  const { colors, terminal: terminalTheme } = useTheme();
  const toast = useToast();

  const ownsSession = sessionId === undefined;

  const webRef = useRef<WebView>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sidRef = useRef<string | null>(sessionId ?? null);
  const unackedRef = useRef(0);
  const dimsRef = useRef({ cols: 80, rows: 24 });
  const attachingRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInputRef = useRef<string | null>(initialInput ?? null);
  const selectionRef = useRef('');
  const fontSizeRef = useRef(readFontSize());
  const pinchBaseRef = useRef(fontSizeRef.current);
  // Modifiers are read inside the WebView's message handler, which is a
  // stable callback — refs keep it from closing over a stale value.
  const ctrlRef = useRef(false);
  const altRef = useRef(false);

  const [phase, setPhase] = useState<Phase>({ state: 'idle' });
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [descriptor, setDescriptor] = useState<TerminalDescriptor | null>(null);
  const [webMounted, setWebMounted] = useState(active);
  const [html, setHtml] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(fontSizeRef.current);
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [altArmed, setAltArmed] = useState(false);
  const [keyBarMode, setKeyBarMode] = useState<KeyBarMode>(readKeyBarMode);
  const [hardwareKeyboard, setHardwareKeyboard] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFound, setSearchFound] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // `react-native-webview` ships no web implementation, so on the browser
  // preview it renders its own "not supported" string in place of xterm. Say
  // what is actually going on instead of leaving a broken-looking pane.
  const rendererAvailable = Platform.OS !== 'web';

  // ── Bridge helpers ─────────────────────────────────────────────

  const post = useCallback((message: ToWebView) => {
    webRef.current?.postMessage(JSON.stringify(message));
  }, []);

  const batcher = useMemo(() => new OutputBatcher((b64) => post({ type: 'data', b64 })), [post]);

  const send = useCallback((frame: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify(frame));
  }, []);

  const closeSocket = useCallback(
    (intentional: boolean) => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const socket = socketRef.current;
      socketRef.current = null;
      if (!socket) return;
      intentionalCloseRef.current = intentional;
      // Detach the handlers first: a close event from a socket we discarded
      // must not flip the phase of the one that replaced it.
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      batcher.drain();
    },
    [batcher],
  );

  // ── Session lifecycle ──────────────────────────────────────────

  /**
   * Open the stream for `sid`: replay scrollback, then attach.
   *
   * Ordering matters: live bytes written into xterm before the replay lands
   * would be shuffled behind history that arrived later, so the socket is
   * only opened once the backlog is on screen.
   */
  const openStream = useCallback(
    async (sid: string) => {
      // Best effort: a fresh terminal has no history, and failing to replay
      // must not stop the live stream from attaching. `tailBytes` bounds the
      // transfer; the renderer keeps 2,000 lines regardless.
      try {
        const res = await authedFetch(
          `/api/workspaces/${workspaceId}/terminals/${sid}/scrollback?tailBytes=${SCROLLBACK_REPLAY_BYTES}`,
        );
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          if (buffer.byteLength > 0) {
            post({ type: 'data', b64: bytesToBase64(new Uint8Array(buffer)) });
          }
        }
      } catch {
        /* history is optional */
      }

      const url = await socketUrl(
        `/api/workspaces/${workspaceId}/terminals/${sid}/stream`,
        'terminal',
        sid,
      );
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      intentionalCloseRef.current = false;
      unackedRef.current = 0;

      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        reconnectAttemptRef.current = 0;
        setConnection('attached');
        setPhase({ state: 'live' });
        const { cols, rows } = dimsRef.current;
        send({ t: 'resize', cols, rows });
        post({ type: 'scrollToBottom' });
        const pending = pendingInputRef.current;
        if (pending) {
          pendingInputRef.current = null;
          send({ t: 'input', data: pending });
        }
      };

      socket.onmessage = (event: WebSocketMessageEvent) => {
        const data = event.data as unknown;
        if (typeof data === 'string') {
          let frame: {
            t?: string;
            code?: number;
            signal?: string;
            message?: string;
            descriptor?: TerminalDescriptor;
          };
          try {
            frame = JSON.parse(data) as typeof frame;
          } catch {
            return;
          }
          if (frame.t === 'ready' && frame.descriptor) {
            setDescriptor(frame.descriptor);
          } else if (frame.t === 'exit') {
            intentionalCloseRef.current = true;
            const info = {
              code: frame.code ?? null,
              ...(frame.signal ? { signal: frame.signal } : {}),
            };
            setPhase({ state: 'exited', ...info });
            setConnection('closed');
            onExit?.(info);
          } else if (frame.t === 'error') {
            setPhase({ state: 'error', message: frame.message ?? 'Terminal error' });
          }
          return;
        }

        const bytes = new Uint8Array(data as ArrayBuffer);
        batcher.push(bytesToBase64(bytes));

        // The server pauses the PTY past its watermark, so this is what
        // keeps a long build streaming instead of stalling after 64KB.
        unackedRef.current += bytes.byteLength;
        if (unackedRef.current >= ACK_BYTE_INTERVAL) {
          send({ t: 'ack', bytes: unackedRef.current });
          unackedRef.current = 0;
        }
      };

      socket.onerror = () => {
        /* `onclose` follows and decides what to do */
      };
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        if (intentionalCloseRef.current) {
          setConnection('closed');
          return;
        }
        // Unexpected drop with a live session: back off and re-attach. The
        // replay on re-attach is what makes this safe — output that arrived
        // during the gap is on the server's ring, not lost.
        const attempt = reconnectAttemptRef.current;
        const delay = RECONNECT_DELAYS_MS[attempt];
        if (delay === undefined) {
          setConnection('closed');
          setPhase({ state: 'error', message: 'Lost the terminal connection.' });
          return;
        }
        reconnectAttemptRef.current = attempt + 1;
        setConnection('reconnecting');
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          post({ type: 'clear' });
          void attachRef.current();
        }, delay);
      };

      socketRef.current = socket;
    },
    [authedFetch, batcher, onExit, post, send, socketUrl, workspaceId],
  );

  /**
   * Resolve a session (create one if this view owns it), then open the
   * stream. Idempotent while in flight; `ready` and reconnects both call it.
   */
  const attach = useCallback(async () => {
    if (attachingRef.current) return;
    if (socketRef.current && socketRef.current.readyState <= 1) return;
    attachingRef.current = true;
    setConnection('connecting');
    try {
      let sid = sidRef.current;
      if (!sid) {
        if (!ownsSession) throw new Error('Terminal session is gone.');
        const created = await api.terminals.create(workspaceId, dimsRef.current);
        sid = created.id;
        sidRef.current = sid;
        setDescriptor(created);
        onSessionChange?.(created);
      } else {
        // A session handed to us may have died while this tab was inactive;
        // attaching to it would 404 at the upgrade with no useful message.
        const current = await api.terminals.get(workspaceId, sid).catch(() => null);
        if (!current) throw new Error('Terminal session is gone.');
        setDescriptor(current);
        if (current.exitCode !== null) {
          setPhase({ state: 'exited', code: current.exitCode });
          setConnection('closed');
          return;
        }
      }
      await openStream(sid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConnection('closed');
      setPhase({
        state: 'error',
        message: /INSUFFICIENT_SCOPE|403/.test(message)
          ? 'This device is not allowed to open terminals (missing exec:terminal).'
          : message,
      });
    } finally {
      attachingRef.current = false;
    }
  }, [api, onSessionChange, openStream, ownsSession, workspaceId]);

  // The socket's close handler needs the latest `attach` without being
  // re-created every time it changes.
  const attachRef = useRef(attach);
  attachRef.current = attach;

  /** D31 — replace the session: kill the old one, spawn a new one, attach. */
  const restart = useCallback(async () => {
    closeSocket(true);
    const old = sidRef.current;
    sidRef.current = null;
    setPhase({ state: 'idle' });
    setConnection('connecting');
    post({ type: 'clear' });
    try {
      if (old) await api.terminals.kill(workspaceId, old).catch(() => undefined);
      const created = await api.terminals.create(workspaceId, dimsRef.current);
      sidRef.current = created.id;
      setDescriptor(created);
      onSessionChange?.(created);
      await openStream(created.id);
      haptics.success();
    } catch (err) {
      setConnection('closed');
      setPhase({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [api, closeSocket, onSessionChange, openStream, post, workspaceId]);

  /** Kill the process. The banner then offers a restart. */
  const kill = useCallback(() => {
    // Via the socket first — the server acts on it before the DELETE lands.
    send({ t: 'kill' });
    intentionalCloseRef.current = true;
    closeSocket(true);
    const sid = sidRef.current;
    if (sid) void api.terminals.kill(workspaceId, sid).catch(() => undefined);
    setPhase({ state: 'exited', code: null });
    setConnection('closed');
    onExit?.({ code: null });
    haptics.warn();
  }, [api, closeSocket, onExit, send, workspaceId]);

  // ── Active / inactive ──────────────────────────────────────────

  useEffect(() => {
    if (active) {
      setWebMounted(true);
      return;
    }
    const timer = setTimeout(() => {
      closeSocket(true);
      setConnection('closed');
      // Unmounting the WebView is the point: a hidden one still holds its
      // renderer, its scrollback and a JS heap.
      setWebMounted(false);
    }, INACTIVE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [active, closeSocket]);

  // Load the document only when a WebView is about to be mounted. The
  // dynamic import is what keeps the vendored xterm string off the startup
  // path; Metro bundles it but Hermes does not evaluate the module until
  // this line runs.
  useEffect(() => {
    if (!webMounted || !rendererAvailable) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    void import('./terminalHtml').then((mod) => {
      if (cancelled) return;
      setHtml(mod.terminalHtml({ theme: terminalTheme, fontSize: fontSizeRef.current }));
    });
    return () => {
      cancelled = true;
    };
    // The palette is deliberately NOT a dependency: a theme change is sent
    // as a message below rather than rebuilding (and so re-attaching) the
    // whole document.
  }, [webMounted, rendererAvailable]);

  // Live re-theme, same as the web panel's `term.options.theme = …`.
  const firstThemeRef = useRef(true);
  useEffect(() => {
    if (firstThemeRef.current) {
      firstThemeRef.current = false;
      return;
    }
    post({ type: 'theme', theme: terminalTheme });
  }, [post, terminalTheme]);

  // Unmount: drop the socket, and kill the session only if this view owns it.
  useEffect(
    () => () => {
      const sid = sidRef.current;
      if (ownsSession && socketRef.current?.readyState === 1) {
        try {
          socketRef.current.send(JSON.stringify({ t: 'kill' }));
        } catch {
          /* closing anyway */
        }
      }
      closeSocket(true);
      batcher.dispose();
      if (ownsSession && sid) void api.terminals.kill(workspaceId, sid).catch(() => undefined);
    },
    [api, batcher, closeSocket, ownsSession, workspaceId],
  );

  // ── Input ──────────────────────────────────────────────────────

  const disarm = useCallback(() => {
    ctrlRef.current = false;
    altRef.current = false;
    setCtrlArmed(false);
    setAltArmed(false);
  }, []);

  /** Apply a sticky Ctrl/Alt to the next keystroke, then release it. */
  const sendInput = useCallback(
    (text: string, arrow?: KeyDef['arrow']) => {
      let data = text;
      if (arrow && (ctrlRef.current || altRef.current)) {
        // CSI 1;<mod> <letter>: 5 = Ctrl, 3 = Alt, 7 = both.
        const mod = 1 + (altRef.current ? 2 : 0) + (ctrlRef.current ? 4 : 0);
        data = `\u001b[1;${mod}${arrow}`;
      } else {
        if (ctrlRef.current) data = controlChord(data);
        if (altRef.current) data = `\u001b${data}`;
      }
      if (ctrlRef.current || altRef.current) disarm();
      send({ t: 'input', data });
    },
    [disarm, send],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseFromWebView(event.nativeEvent.data);
      if (!message) return;

      switch (message.type) {
        case 'ready':
          // The document reports its real geometry via `resize` just before
          // this, so the session is created at the right size. If a socket
          // is already open (a remount raced the grace period) just resync.
          if (socketRef.current?.readyState === 1) {
            send({ t: 'resize', ...dimsRef.current });
          } else {
            void attach();
          }
          break;
        case 'input':
          // The renderer UTF-8-encodes keystrokes before base64, and the
          // server's `input` frame carries text — so this is bytes → string.
          sendInput(base64ToString(message.b64));
          break;
        case 'resize':
          dimsRef.current = { cols: message.cols, rows: message.rows };
          send({ t: 'resize', cols: message.cols, rows: message.rows });
          break;
        case 'selection':
          selectionRef.current = message.text;
          break;
        case 'title':
          onTitle?.(message.title);
          break;
        case 'link':
          // http/https only — see `isOpenableLink`. The renderer shows
          // untrusted output, and `Linking.openURL` runs with the app's
          // identity.
          if (isOpenableLink(message.url)) {
            void Linking.openURL(message.url).catch(() =>
              toast({ message: 'Could not open that link.', tone: 'error' }),
            );
          } else {
            toast({ message: 'Only http and https links can be opened.', tone: 'info' });
          }
          break;
        case 'hwkey':
          // Heuristic, not a platform API: React Native exposes no "is a
          // hardware keyboard attached" signal, so the renderer reports keys
          // a soft keyboard cannot produce. A user toggle overrides it.
          setHardwareKeyboard(true);
          break;
        case 'searchResult':
          setSearchFound(message.found);
          break;
        case 'bell':
          haptics.threshold();
          break;
        default:
          break;
      }
    },
    [attach, onTitle, send, sendInput, toast],
  );

  const onKey = useCallback(
    (key: KeyDef) => {
      switch (key.action) {
        case 'ctrl': {
          const next = !ctrlRef.current;
          ctrlRef.current = next;
          setCtrlArmed(next);
          return;
        }
        case 'alt': {
          const next = !altRef.current;
          altRef.current = next;
          setAltArmed(next);
          return;
        }
        case 'find':
          setSearchOpen(true);
          return;
        case 'paste':
          void Clipboard.getStringAsync().then((text) => {
            if (!text) {
              toast({ message: 'Clipboard is empty.', tone: 'info' });
              return;
            }
            // Bracketed paste is the shell's problem to opt into; sending
            // raw text matches what the web panel does.
            send({ t: 'input', data: text });
          });
          return;
        default:
          if (key.bytes !== undefined) sendInput(key.bytes, key.arrow);
      }
    },
    [send, sendInput, toast],
  );

  // ── Gestures ───────────────────────────────────────────────────
  //
  // UNVERIFIED ON DEVICE: a WebView is a native view that consumes touches;
  // whether an ancestor GestureDetector still sees a two-finger pinch over
  // it differs between Android and iOS. The intent is Race so a pinch and a
  // two-finger swipe cannot both fire.

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onStart(() => {
          pinchBaseRef.current = fontSizeRef.current;
        })
        .onUpdate((e) => {
          const next = clampFontSize(pinchBaseRef.current * e.scale);
          if (next === fontSizeRef.current) return;
          fontSizeRef.current = next;
          setFontSize(next);
          post({ type: 'fontSize', size: next });
          haptics.select();
        })
        .onEnd(() => {
          prefs.setString(TERMINAL_PREF_KEYS.fontSize, String(fontSizeRef.current));
        }),
    [post],
  );

  const twoFingerSwipe = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minPointers(2)
        .maxPointers(2)
        .activeOffsetX([-40, 40])
        .failOffsetY([-30, 30])
        .onEnd((e) => {
          if (Math.abs(e.translationX) < 60) return;
          send({ t: 'input', data: e.translationX > 0 ? '\u001b[C' : '\u001b[D' });
          haptics.select();
        }),
    [send],
  );

  const gestures = useMemo(() => Gesture.Race(pinch, twoFingerSwipe), [pinch, twoFingerSwipe]);

  // ── Search ─────────────────────────────────────────────────────

  const runSearch = useCallback(
    (query: string, direction: 'search' | 'searchNext' | 'searchPrev') => {
      if (!query) {
        post({ type: 'clearSearch' });
        setSearchFound(null);
        return;
      }
      post({ type: direction, query });
    },
    [post],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchFound(null);
    post({ type: 'clearSearch' });
    post({ type: 'focus' });
  }, [post]);

  // ── Key bar visibility ─────────────────────────────────────────

  const keyBarVisible =
    keyBarMode === 'shown' || (keyBarMode === 'auto' && !hardwareKeyboard);

  const toggleKeyBar = useCallback(() => {
    const next: KeyBarMode = keyBarVisible ? 'hidden' : 'shown';
    setKeyBarMode(next);
    prefs.setString(TERMINAL_PREF_KEYS.keyBar, next);
  }, [keyBarVisible]);

  // ── Menu ───────────────────────────────────────────────────────

  const menuActions = useMemo<MenuAction[]>(
    () => [
      {
        label: 'Restart session',
        detail: 'Kill this shell and open a fresh one in the same place.',
        onPress: () => void restart(),
      },
      {
        label: 'Copy selection',
        disabled: selectionRef.current.length === 0,
        detail: selectionRef.current.length === 0 ? 'Long-press text in the terminal first.' : undefined,
        onPress: () => {
          void Clipboard.setStringAsync(selectionRef.current).then(() =>
            toast({ message: 'Copied.', tone: 'success' }),
          );
        },
      },
      {
        label: 'Scroll to bottom',
        onPress: () => post({ type: 'scrollToBottom' }),
      },
      {
        label: 'Clear scrollback',
        onPress: () => post({ type: 'clear' }),
      },
      {
        label: 'Kill process',
        destructive: true,
        disabled: phase.state === 'exited',
        onPress: kill,
      },
    ],
    [kill, phase.state, post, restart, toast],
  );

  // ── Render ─────────────────────────────────────────────────────

  if (!rendererAvailable) {
    return (
      <EmptyState
        title="Terminal needs the device build"
        message="The renderer is a WebView, which the browser preview cannot host. Open this chat in the iOS or Android build to use the terminal."
        icon={<TerminalSquare size={22} color={colors['muted-foreground']} />}
      />
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View className="min-h-11 flex-row items-center gap-1.5 border-b border-border-muted px-2 py-1">
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.chrome}
          className="flex-1 font-mono text-xs text-muted-foreground"
        >
          {descriptor ? shortenPath(descriptor.cwd) : '—'}
        </Text>
        <ConnectionPill state={connection} />
        {descriptor ? (
          <View className="rounded bg-subtle px-1.5 py-0.5">
            <Text className="text-[10px] text-muted-foreground">{hostLabel(descriptor.host)}</Text>
          </View>
        ) : null}
        <IconButton
          accessibilityLabel="Find in scrollback"
          compact
          selected={searchOpen}
          icon={<Search size={16} color={searchOpen ? colors.primary : colors['muted-foreground']} />}
          onPress={() => setSearchOpen((v) => !v)}
        />
        <IconButton
          accessibilityLabel={keyBarVisible ? 'Hide the key bar' : 'Show the key bar'}
          compact
          selected={keyBarVisible}
          icon={
            <KeyboardIcon
              size={16}
              color={keyBarVisible ? colors.primary : colors['muted-foreground']}
            />
          }
          onPress={toggleKeyBar}
        />
        <IconButton
          accessibilityLabel="Clear scrollback"
          compact
          icon={<Eraser size={16} color={colors['muted-foreground']} />}
          onPress={() => post({ type: 'clear' })}
        />
        <IconButton
          accessibilityLabel="More terminal actions"
          compact
          icon={<MoreHorizontal size={16} color={colors['muted-foreground']} />}
          onPress={() => setMenuOpen(true)}
        />
      </View>

      {/* Status banners */}
      {phase.state === 'error' ? (
        <View className="flex-row items-center gap-2 border-b border-border bg-danger-muted px-3 py-2">
          <Text className="flex-1 text-xs text-foreground">{phase.message}</Text>
          <Button label="Retry" size="sm" variant="ghost" onPress={() => void attach()} />
          <Button label="Restart" size="sm" variant="secondary" onPress={() => void restart()} />
        </View>
      ) : phase.state === 'exited' ? (
        <View className="flex-row items-center gap-2 border-b border-border bg-warning-muted px-3 py-2">
          <Text className="flex-1 text-xs text-foreground">
            Process exited{phase.signal ? ` (${phase.signal})` : ''}
            {phase.code !== null ? ` — code ${phase.code}` : ''}.
          </Text>
          <Button label="Restart" size="sm" variant="secondary" onPress={() => void restart()} />
        </View>
      ) : connection === 'reconnecting' ? (
        <View className="flex-row items-center gap-2 border-b border-border bg-subtle px-3 py-1.5">
          <Spinner />
          <Text className="text-xs text-muted-foreground">Reconnecting…</Text>
        </View>
      ) : phase.state === 'idle' && webMounted ? (
        <View className="flex-row items-center gap-2 border-b border-border bg-subtle px-3 py-1.5">
          <Spinner />
          <Text className="text-xs text-muted-foreground">Starting terminal…</Text>
        </View>
      ) : null}

      {/* Search bar */}
      {searchOpen ? (
        <View className="flex-row items-center gap-1 border-b border-border bg-card px-2 py-1">
          <TextInput
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            placeholder="Find…"
            placeholderTextColor={colors['muted-foreground']}
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              runSearch(text, 'search');
            }}
            onSubmitEditing={() => runSearch(searchQuery, 'searchNext')}
            accessibilityLabel="Search the scrollback"
            className="min-h-9 flex-1 rounded-lg bg-subtle px-2 font-mono text-sm text-foreground"
            style={{ color: colors.foreground }}
          />
          {searchFound === false ? (
            <Text className="text-[10px] text-warning">No match</Text>
          ) : null}
          <IconButton
            accessibilityLabel="Previous match"
            compact
            icon={<ChevronUp size={16} color={colors['muted-foreground']} />}
            onPress={() => runSearch(searchQuery, 'searchPrev')}
          />
          <IconButton
            accessibilityLabel="Next match"
            compact
            icon={<ChevronDown size={16} color={colors['muted-foreground']} />}
            onPress={() => runSearch(searchQuery, 'searchNext')}
          />
          <IconButton
            accessibilityLabel="Close search"
            compact
            icon={<X size={16} color={colors['muted-foreground']} />}
            onPress={closeSearch}
          />
        </View>
      ) : null}

      {/* Renderer */}
      <GestureDetector gesture={gestures}>
        <View className="flex-1" style={{ backgroundColor: colors.background }}>
          {webMounted && html ? (
            <WebView
              ref={webRef}
              // Local string only: the WebView is a renderer, not a browser.
              source={{ html }}
              originWhitelist={['about:blank']}
              onMessage={onMessage}
              javaScriptEnabled
              // Hardening — this surface renders untrusted terminal output.
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              javaScriptCanOpenWindowsAutomatically={false}
              setSupportMultipleWindows={false}
              // Any navigation is a link the web-links addon did not catch;
              // refuse it — the document is the only page this view shows.
              // UNVERIFIED ON DEVICE: the initial `source.html` load reports
              // `about:blank` on both platforms in current react-native-webview;
              // an empty or data: URL is tolerated in case that differs.
              onShouldStartLoadWithRequest={(request) => /^(about:|data:|$)/.test(request.url)}
              // Tapping the terminal must be able to raise the keyboard.
              keyboardDisplayRequiresUserAction={false}
              hideKeyboardAccessoryView
              textZoom={100}
              scrollEnabled={false}
              overScrollMode="never"
              bounces={false}
              style={{ flex: 1, backgroundColor: colors.background }}
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-xs text-muted-foreground">
                {webMounted ? 'Loading renderer…' : 'Terminal paused'}
              </Text>
            </View>
          )}
        </View>
      </GestureDetector>

      {/* Key bar */}
      {keyBarVisible && webMounted ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          className="max-h-14 border-t border-border bg-card"
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 8, paddingVertical: 8 }}
        >
          {KEY_BAR.map((key) => {
            const armed =
              (key.action === 'ctrl' && ctrlArmed) || (key.action === 'alt' && altArmed);
            return (
              <Touchable
                key={key.label}
                accessibilityLabel={key.a11y}
                accessibilityState={armed ? { selected: true } : undefined}
                haptic="select"
                onPress={() => onKey(key)}
                className={`min-h-9 min-w-11 items-center justify-center rounded-xl px-2 ${
                  armed ? 'border border-primary bg-accent' : 'bg-subtle'
                }`}
              >
                <Text
                  maxFontSizeMultiplier={MAX_SCALE.chrome}
                  className={`font-mono text-xs ${armed ? 'text-primary' : 'text-foreground'}`}
                >
                  {key.label}
                </Text>
              </Touchable>
            );
          })}
          <View className="min-h-9 items-center justify-center px-1">
            <Text className="text-[10px] text-muted-foreground">{fontSize}pt</Text>
          </View>
        </ScrollView>
      ) : null}

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={descriptor ? shortenPath(descriptor.cwd) : 'Terminal'}
        actions={menuActions.map((action) => ({
          ...action,
          onPress: () => {
            setMenuOpen(false);
            action.onPress();
          },
        }))}
      />
    </View>
  );
}

// ── Pieces ───────────────────────────────────────────────────────

const PILL_LABEL: Record<ConnectionState, string> = {
  connecting: 'connecting',
  attached: 'attached',
  reconnecting: 'reconnecting',
  closed: 'closed',
};

function ConnectionPill({ state }: { state: ConnectionState }): React.ReactElement {
  const { colors } = useTheme();
  const dot =
    state === 'attached'
      ? colors.success
      : state === 'closed'
        ? colors['muted-foreground']
        : colors.warning;
  return (
    <View
      accessibilityLabel={`Connection ${PILL_LABEL[state]}`}
      className="flex-row items-center gap-1 rounded-full bg-subtle px-1.5 py-0.5"
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
      <Text className="text-[10px] text-muted-foreground">{PILL_LABEL[state]}</Text>
    </View>
  );
}

function hostLabel(host: string): string {
  switch (host) {
    case 'node-pty':
    case 'pty-host':
      return 'pty';
    case 'sandbox':
      return 'sandbox';
    case 'fallback-child-process':
      return 'fallback';
    default:
      return host;
  }
}

/** `…/last/three/segments` — a full path never fits at 393pt. */
function shortenPath(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.length <= 3 ? cwd : `…/${parts.slice(-3).join('/')}`;
}

/**
 * Ctrl + a printable character → the control code a keyboard would send.
 * Letters map to 0x01–0x1a; `[ \ ] ^ _` and `@`/space to 0x1b–0x1f and 0x00.
 * Anything else passes through unchanged.
 */
export function controlChord(text: string): string {
  if (text.length !== 1) return text;
  const code = text.toUpperCase().charCodeAt(0);
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f);
  if (text === ' ') return '\u0000';
  return text;
}
