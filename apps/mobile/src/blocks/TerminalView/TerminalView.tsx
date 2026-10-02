// MB-27 TerminalView (MPaneTerminal, MPaneTerminalFull; MD-38): one shell — xterm.js in a WebView built from a LOCAL
// string (the engine in ./engine: bridge protocol, document, settings) with React Native owning the PTY socket
// (`apps/server/src/terminal-ws.ts`: binary frames are PTY bytes, text frames JSON control; the client acks every
// 64 KB or the server pauses the PTY). The WebView and the socket stay alive while the tab is hidden or the device
// rotates — only leaving the chat ends them (MD-24; the legacy view unmounted them and lost the screen). Toolbar: the
// host Badge (pty / fallback), "Agent working", "Attach N lines" (a selection → the composer), Find, Clear (full
// screen), Kill (confirmed), ⋯ (Restart, Copy selection, Scroll to bottom, Font size A− / A+, Send last N lines,
// the key row). Status footer "zsh · pid 18244 · 44×31". The KeyRow (MD-38) under it; pinch sets the font size with a
// `fontStep` haptic and a transient "14 pt". A focused terminal owns keys and gestures (MD-19: the shell's shortcuts
// and panel pans are suspended).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import { resourcePaths, type TerminalDescriptor } from '@generatorai/client-core';

import { useComposerCapture } from '../Composer/model/captureContext';
import { TERMINAL_CAPTURE_LINES } from '../Composer/model/captures';
import { useShellStore } from '../shell/shellStore';
import { useApi } from '../../services/api/useApi';
import { useAuth } from '../../services/auth/AuthProvider';
import { base64ToString, bytesToBase64 } from '../../services/lib/base64';
import { prefs } from '../../services/storage/prefs';
import { noteActiveTerminal, noteTerminalSelection } from '../../services/terminal/terminalFocus';
import { useTerminalTheme } from '../../ui/lib/terminalTheme';
import { confirm } from '../../ui/native/AlertDialog';
import { Menu } from '../../ui/native/Menu';
import { haptic } from '../../ui/platform/haptics';
import { useHardwareKeyboard } from '../../ui/platform/keyboard';
import { overflowIcon } from '../../ui/platform/overflow';
import { Badge } from '../../ui/primitives/Badge';
import { Callout } from '../../ui/primitives/Callout';
import { Chip } from '../../ui/primitives/Chip';
import { IconButton } from '../../ui/primitives/IconButton';
import { Input } from '../../ui/primitives/Input';
import { Spinner } from '../../ui/primitives/Spinner';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { OutputBatcher, isOpenableLink, parseFromWebView, type ToWebView } from './engine/bridgeProtocol';
import { FONT_SIZE_DEFAULT, SCROLLBACK_REPLAY_BYTES, TERMINAL_PREF_KEYS, type KeyBarMode } from './engine/terminalSettings';
import { getTerminalFont, setTerminalFont, subscribeTerminalFont } from './model/fontStore';
import { KeyRow } from './KeyRow';
import { hostLabel, statusLine, withModifiers, type KeyDef } from './model/keyRow';

// `./engine/terminalHtml` is loaded with a dynamic import below and nowhere else: it carries the ~570 KB vendored
// xterm bundle, which must stay off the startup path.

/** Matches the server's flow-control window. */
const ACK_BYTE_INTERVAL = 64 * 1024;
/** Reconnect backoff after an unexpected socket drop. */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000];

export type ConnectionState = 'connecting' | 'attached' | 'reconnecting' | 'closed';
type Phase = { state: 'idle' } | { state: 'live' } | { state: 'exited'; code: number | null; signal?: string } | { state: 'error'; message: string };

export interface TerminalViewProps {
  workspaceId: string;
  /** The session this view attaches to (the panel creates and closes sessions). */
  sessionId: string;
  /** This shell is the one on screen (the composer's "Terminal output" reads it; the keyboard may focus it). */
  active: boolean;
  /** Typed into the shell once attached, WITHOUT a newline (a link never runs anything). */
  initialInput?: string;
  /** The agent is running a turn ("Agent working" in the toolbar). */
  agentBusy?: boolean;
  /** The pane is full screen: Clear joins the toolbar. */
  fullscreen?: boolean;
  onTitle?: (title: string) => void;
  /** A restart replaced the session. */
  onSessionChange?: (descriptor: TerminalDescriptor) => void;
  onExit?: (info: { code: number | null; signal?: string }) => void;
}

function readKeyBarMode(): KeyBarMode {
  try {
    const stored = prefs.getString(TERMINAL_PREF_KEYS.keyBar);
    return stored === 'shown' || stored === 'hidden' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}
export function TerminalView({ workspaceId, sessionId, active, initialInput, agentBusy = false, fullscreen = false, onTitle, onSessionChange, onExit }: TerminalViewProps): React.ReactElement {
  const { socketUrl } = useAuth();
  const api = useApi();
  const theme = useTerminalTheme();
  const capture = useComposerCapture();
  const hardwareKeyboard = useHardwareKeyboard();

  const webRef = useRef<WebView>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sidRef = useRef<string>(sessionId);
  const unackedRef = useRef(0);
  const dimsRef = useRef({ cols: 80, rows: 24 });
  const attachingRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInputRef = useRef<string | null>(initialInput ?? null);
  const selectionRef = useRef('');
  const modsRef = useRef({ ctrl: false, alt: false });
  const attachRef = useRef<() => Promise<void>>(async () => undefined);

  const [phase, setPhase] = useState<Phase>({ state: 'idle' });
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [descriptor, setDescriptor] = useState<TerminalDescriptor | null>(null);
  const [dims, setDims] = useState({ cols: 80, rows: 24 });
  const [html, setHtml] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(getTerminalFont);
  const [fontPill, setFontPill] = useState(false);
  const [mods, setMods] = useState({ ctrl: false, alt: false });
  const [keyBarMode, setKeyBarMode] = useState<KeyBarMode>(readKeyBarMode);
  const [softKeysOnly, setSoftKeysOnly] = useState(true);
  const [selection, setSelection] = useState('');
  const [find, setFind] = useState<{ open: boolean; query: string; found: boolean | null }>({ open: false, query: '', found: null });

  // ── Bridge ─────────────────────────────────────────────────────
  const post = useCallback((message: ToWebView) => webRef.current?.postMessage(JSON.stringify(message)), []);
  // The output batcher lives outside render (it holds a timer and posts to the WebView).
  const batcherRef = useRef<OutputBatcher | null>(null);
  useEffect(() => {
    const batcher = new OutputBatcher((b64) => webRef.current?.postMessage(JSON.stringify({ type: 'data', b64 } satisfies ToWebView)));
    batcherRef.current = batcher;
    return () => {
      batcher.dispose();
      batcherRef.current = null;
    };
  }, []);
  const send = useCallback((frame: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(frame));
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
      // A close event from a discarded socket must not flip the phase of the one that replaced it.
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Already closing.
      }
      batcherRef.current?.drain();
    },
    [],
  );

  // ── Session ────────────────────────────────────────────────────
  /** Replay the scrollback, then open the live stream (live bytes before history would be shuffled behind it). */
  const openStream = useCallback(
    async (sid: string) => {
      try {
        const { data } = await api.resources.terminalBytes(workspaceId, sid, SCROLLBACK_REPLAY_BYTES);
        if (data.byteLength > 0) post({ type: 'data', b64: bytesToBase64(data) });
      } catch {
        // History is optional.
      }
      const url = await socketUrl(resourcePaths.terminalStream(workspaceId, sid), 'terminal', sid);
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      intentionalCloseRef.current = false;
      unackedRef.current = 0;
      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        reconnectAttemptRef.current = 0;
        setConnection('attached');
        setPhase({ state: 'live' });
        send({ t: 'resize', ...dimsRef.current });
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
          let frame: { t?: string; code?: number; signal?: string; message?: string; descriptor?: TerminalDescriptor };
          try {
            frame = JSON.parse(data) as typeof frame;
          } catch {
            return;
          }
          if (frame.t === 'ready' && frame.descriptor) setDescriptor(frame.descriptor);
          else if (frame.t === 'exit') {
            intentionalCloseRef.current = true;
            const info = { code: frame.code ?? null, ...(frame.signal ? { signal: frame.signal } : {}) };
            setPhase({ state: 'exited', ...info });
            setConnection('closed');
            onExit?.(info);
          } else if (frame.t === 'error') setPhase({ state: 'error', message: frame.message ?? 'Terminal error' });
          return;
        }
        const bytes = new Uint8Array(data as ArrayBuffer);
        batcherRef.current?.push(bytesToBase64(bytes));
        // The server pauses the PTY past its watermark: this keeps a long build streaming.
        unackedRef.current += bytes.byteLength;
        if (unackedRef.current >= ACK_BYTE_INTERVAL) {
          send({ t: 'ack', bytes: unackedRef.current });
          unackedRef.current = 0;
        }
      };
      socket.onerror = () => undefined;
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        if (intentionalCloseRef.current) {
          setConnection('closed');
          return;
        }
        // An unexpected drop: back off and re-attach (the replay covers the gap).
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
    [api, onExit, post, send, socketUrl, workspaceId],
  );

  /** Check the session still lives, then open the stream. Idempotent while in flight. */
  const attach = useCallback(async () => {
    if (attachingRef.current) return;
    if (socketRef.current && socketRef.current.readyState <= 1) return;
    attachingRef.current = true;
    setConnection('connecting');
    try {
      const current = await api.terminals.get(workspaceId, sidRef.current).catch(() => null);
      if (!current) throw new Error('This terminal session is gone.');
      setDescriptor(current);
      if (current.exitCode !== null) {
        setPhase({ state: 'exited', code: current.exitCode });
        setConnection('closed');
        return;
      }
      await openStream(sidRef.current);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConnection('closed');
      setPhase({ state: 'error', message: /INSUFFICIENT_SCOPE|403/.test(message) ? 'This device may not open terminals (missing exec:terminal).' : message });
    } finally {
      attachingRef.current = false;
    }
  }, [api, openStream, workspaceId]);
  useEffect(() => {
    attachRef.current = attach;
  }, [attach]);

  /** Replace the session: kill the old one, spawn a new one in the same place, attach. */
  const restart = useCallback(async () => {
    closeSocket(true);
    const old = sidRef.current;
    setPhase({ state: 'idle' });
    setConnection('connecting');
    post({ type: 'clear' });
    try {
      await api.terminals.kill(workspaceId, old).catch(() => undefined);
      const created = await api.terminals.create(workspaceId, dimsRef.current);
      sidRef.current = created.id;
      setDescriptor(created);
      onSessionChange?.(created);
      await openStream(created.id);
      haptic('success');
    } catch (err) {
      setConnection('closed');
      setPhase({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [api, closeSocket, onSessionChange, openStream, post, workspaceId]);

  const kill = useCallback(() => {
    send({ t: 'kill' });
    closeSocket(true);
    void api.terminals.kill(workspaceId, sidRef.current).catch(() => undefined);
    setPhase({ state: 'exited', code: null });
    setConnection('closed');
    onExit?.({ code: null });
    haptic('warning');
  }, [api, closeSocket, onExit, send, workspaceId]);

  // The composer's "Terminal output" reads the shell on screen.
  useEffect(() => {
    if (active) noteActiveTerminal(workspaceId, sidRef.current);
  }, [active, workspaceId, descriptor?.id]);

  // The renderer document, built once (a theme change is a message, not a rebuild that would drop the screen).
  useEffect(() => {
    let cancelled = false;
    void import('./engine/terminalHtml').then((mod) => {
      if (!cancelled) setHtml(mod.terminalHtml({ theme, fontSize: getTerminalFont() }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the palette is sent live below.
  }, []);
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    post({ type: 'theme', theme });
  }, [post, theme]);

  // Leaving the chat drops the socket (the panel kills sessions it closes); a focused terminal gives keys back.
  useEffect(
    () => () => {
      closeSocket(true);
      useShellStore.getState().setGestureOwner('shell');
    },
    [closeSocket],
  );

  // ── Input ──────────────────────────────────────────────────────
  const setModifiers = useCallback((next: { ctrl: boolean; alt: boolean }) => {
    modsRef.current = next;
    setMods(next);
  }, []);
  const sendInput = useCallback(
    (text: string, arrow?: KeyDef['arrow']) => {
      const latched = modsRef.current;
      send({ t: 'input', data: withModifiers(text, latched, arrow) });
      if (latched.ctrl || latched.alt) setModifiers({ ctrl: false, alt: false });
    },
    [send, setModifiers],
  );
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseFromWebView(event.nativeEvent.data);
      if (!message) return;
      switch (message.type) {
        case 'ready':
          if (socketRef.current?.readyState === 1) send({ t: 'resize', ...dimsRef.current });
          else void attach();
          break;
        case 'input':
          sendInput(base64ToString(message.b64));
          break;
        case 'resize':
          dimsRef.current = { cols: message.cols, rows: message.rows };
          setDims(dimsRef.current);
          send({ t: 'resize', cols: message.cols, rows: message.rows });
          break;
        case 'selection':
          selectionRef.current = message.text;
          setSelection(message.text);
          noteTerminalSelection(workspaceId, sidRef.current, message.text);
          break;
        case 'title':
          onTitle?.(message.title);
          break;
        case 'link':
          // http / https only: the renderer shows untrusted output.
          if (isOpenableLink(message.url)) void Linking.openURL(message.url).catch(() => toast({ kind: 'error', message: "Couldn't open that link." }));
          else toast({ kind: 'error', message: 'Only http and https links open from the terminal.' });
          break;
        case 'hwkey':
          setSoftKeysOnly(false);
          break;
        case 'searchResult':
          setFind((f) => ({ ...f, found: message.found }));
          break;
        case 'focused':
          // A surface that owns keys suspends the shell's shortcuts and panel pans (MD-19).
          useShellStore.getState().setGestureOwner('surface');
          break;
        case 'unfocused':
          useShellStore.getState().setGestureOwner('shell');
          break;
        case 'bell':
          haptic('threshold');
          break;
        default:
          break;
      }
    },
    [attach, onTitle, send, sendInput, workspaceId],
  );
  const onKey = useCallback(
    (key: KeyDef) => {
      if (key.action === 'ctrl') setModifiers({ ...modsRef.current, ctrl: !modsRef.current.ctrl });
      else if (key.action === 'alt') setModifiers({ ...modsRef.current, alt: !modsRef.current.alt });
      else if (key.action === 'find') setFind({ open: true, query: '', found: null });
      else if (key.action === 'paste') {
        void Clipboard.getStringAsync().then((text) => {
          if (text) send({ t: 'input', data: text });
          else toast({ kind: 'error', message: 'The clipboard is empty.' });
        });
      } else if (key.bytes !== undefined) sendInput(key.bytes, key.arrow);
    },
    [send, sendInput, setModifiers],
  );

  // ── Font size: pinch (a `fontStep` per point, MD-78) and A− / A+; one size for every shell ──
  useEffect(
    () =>
      subscribeTerminalFont((size) => {
        setFontSize(size);
        setFontPill(true);
        post({ type: 'fontSize', size });
      }),
    [post],
  );
  useEffect(() => {
    if (!fontPill) return undefined;
    const t = setTimeout(() => setFontPill(false), 900);
    return () => clearTimeout(t);
  }, [fontPill, fontSize]);
  const gestures = useMemo(() => fontPinchGesture(), []);

  // ── Find ───────────────────────────────────────────────────────
  const runFind = useCallback(
    (query: string, direction: 'search' | 'searchNext' | 'searchPrev') => {
      if (!query) {
        post({ type: 'clearSearch' });
        return;
      }
      post({ type: direction, query });
    },
    [post],
  );
  const closeFind = useCallback(() => {
    setFind({ open: false, query: '', found: null });
    post({ type: 'clearSearch' });
    post({ type: 'focus' });
  }, [post]);

  const keyRowShown = keyBarMode === 'shown' || (keyBarMode === 'auto' && softKeysOnly && !hardwareKeyboard);
  const selectedLines = selection ? selection.split('\n').length : 0;
  const menu = [
    { id: 'restart', label: 'Restart session', icon: 'restart' as const },
    { id: 'copy', label: 'Copy selection', icon: 'copy' as const, disabled: !selection },
    { id: 'bottom', label: 'Scroll to bottom', icon: 'latest' as const },
    { id: 'font', label: 'Font size', icon: 'zoom-in' as const, children: [
      { id: 'font-down', label: `A− (${fontSize - 1} pt)`, icon: 'zoom-out' as const, disabled: fontSize <= 10 },
      { id: 'font-up', label: `A+ (${fontSize + 1} pt)`, icon: 'zoom-in' as const, disabled: fontSize >= 20 },
    ] },
    ...(capture ? [{ id: 'send', label: 'Send to chat', icon: 'send' as const, children: TERMINAL_CAPTURE_LINES.map((n) => ({ id: `send-${n}`, label: `Last ${n} lines`, icon: 'terminal' as const })) }] : []),
    { id: 'keys', label: keyRowShown ? 'Hide the key row' : 'Show the key row', icon: 'keyboard' as const },
    ...(!fullscreen ? [{ id: 'clear', label: 'Clear scrollback', icon: 'x' as const }] : []),
  ];
  const onMenu = (id: string): void => {
    if (id === 'restart') void restart();
    else if (id === 'copy') void Clipboard.setStringAsync(selectionRef.current).then(() => haptic('success'));
    else if (id === 'bottom') post({ type: 'scrollToBottom' });
    else if (id === 'font-down') setTerminalFont(getTerminalFont() - 1);
    else if (id === 'font-up') setTerminalFont(getTerminalFont() + 1);
    else if (id.startsWith('send-') && capture) void capture.captureTerminalOutput(Number(id.slice(5)) as (typeof TERMINAL_CAPTURE_LINES)[number], sidRef.current);
    else if (id === 'keys') {
      const next: KeyBarMode = keyRowShown ? 'hidden' : 'shown';
      setKeyBarMode(next);
      try {
        prefs.setString(TERMINAL_PREF_KEYS.keyBar, next);
      } catch {
        // Best effort.
      }
    } else if (id === 'clear') post({ type: 'clear' });
  };
  const confirmKill = (): void => {
    void confirm({ title: `Kill ${descriptor?.shell.split(/[\\/]/).pop() ?? 'this shell'}?`, message: 'Stops whatever is running in it, mid-run.', confirmLabel: 'Kill', icon: 'power' }).then((yes) => {
      if (yes) kill();
    });
  };

  const status = agentBusy ? { state: 'running' as const, label: 'Agent working' } : connection === 'reconnecting' ? { state: 'waiting' as const, label: 'Reconnecting' } : null;

  return (
    <View className="flex-1 gap-2 pt-2" testID="terminal">
      <View className="min-h-control flex-row items-center gap-1.5 px-3">
        {descriptor ? <Badge label={hostLabel(descriptor.host)} mono size="sm" /> : null}
        {status ? <StatusBadge {...status} size="sm" /> : null}
        {selection && capture ? <Chip label={`Attach ${selectedLines} ${selectedLines === 1 ? 'line' : 'lines'}`} icon="attach" onPress={() => capture.captureTerminalSelection(selectionRef.current)} testID="terminal-attach-selection" /> : null}
        <View className="flex-1" />
        <IconButton icon="search" size="sm" label="Find in scrollback" selected={find.open} onPress={() => (find.open ? closeFind() : setFind({ open: true, query: '', found: null }))} testID="terminal-find" />
        {fullscreen ? <IconButton icon="x" size="sm" label="Clear scrollback" onPress={() => post({ type: 'clear' })} /> : null}
        <IconButton icon="power" size="sm" label="Kill the process" disabled={phase.state === 'exited'} onPress={confirmKill} testID="terminal-kill" />
        <Menu items={menu} onSelect={onMenu} accessibilityLabel="More terminal actions" trigger={<IconButton icon={overflowIcon} size="sm" label="More terminal actions" onPress={() => undefined} />} />
      </View>
      {phase.state === 'error' ? (
        <View className="px-3">
          <Callout tone="err" form="banner" title={phase.message} action={{ label: 'Restart', onPress: () => void restart() }} />
        </View>
      ) : phase.state === 'exited' ? (
        <View className="px-3">
          <Callout tone="warn" form="banner" title={`Process exited${phase.signal ? ` (${phase.signal})` : ''}${phase.code !== null ? ` — code ${phase.code}` : ''}`} action={{ label: 'Restart', onPress: () => void restart() }} />
        </View>
      ) : null}
      {find.open ? (
        <View className="flex-row items-center gap-1 px-3" testID="find-bar">
          <View className="flex-1">
            <Input
              label="Find in scrollback"
              kind="mono"
              presentation="standalone"
              value={find.query}
              autoFocus
              returnKeyType="search"
              onChangeText={(query) => {
                setFind((f) => ({ ...f, query }));
                runFind(query, 'search');
              }}
              onSubmitEditing={() => runFind(find.query, 'searchNext')}
              {...(find.found === false ? { error: 'No match' } : {})}
            />
          </View>
          <IconButton icon="chevron-up" size="sm" label="Previous match" onPress={() => runFind(find.query, 'searchPrev')} />
          <IconButton icon="chevron-down" size="sm" label="Next match" onPress={() => runFind(find.query, 'searchNext')} />
          <IconButton icon="x" size="sm" label="Close find" onPress={closeFind} />
        </View>
      ) : null}
      <GestureDetector gesture={gestures}>
        <View className="mx-2 flex-1 overflow-hidden rounded-card border border-line-soft bg-sunken">
          {html ? (
            <WebView
              testID="terminal-view"
              ref={webRef}
              accessibilityLabel="Terminal output"
              // A local string only: the WebView is a renderer, not a browser.
              source={{ html }}
              originWhitelist={['about:blank']}
              onMessage={onMessage}
              javaScriptEnabled
              // Hardening: this surface renders untrusted terminal output.
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              javaScriptCanOpenWindowsAutomatically={false}
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={(request) => /^(about:|data:|$)/.test(request.url)}
              keyboardDisplayRequiresUserAction={false}
              hideKeyboardAccessoryView
              textZoom={100}
              scrollEnabled={false}
              overScrollMode="never"
              bounces={false}
              className="flex-1"
              style={{ backgroundColor: theme.background }}
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Spinner label="Starting the terminal" />
            </View>
          )}
          {fontPill ? (
            <View pointerEvents="none" className="absolute inset-x-0 top-3 items-center">
              <View className="rounded-full bg-overlay px-3 py-1">
                <Text role="monoSm">{`${fontSize} pt`}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </GestureDetector>
      <View className="min-h-control flex-row items-center gap-2 px-3" accessibilityLiveRegion="polite">
        {connection === 'connecting' || agentBusy ? <Spinner size={14} /> : null}
        <Text role="monoSm" tone="fg-3" numberOfLines={1} className="flex-1">
          {connection === 'connecting' ? 'Connecting…' : statusLine(descriptor, dims)}
        </Text>
      </View>
      {keyRowShown ? <KeyRow ctrl={mods.ctrl} alt={mods.alt} onKey={onKey} /> : null}
    </View>
  );
}

/** Pinch → the terminal font size (10–20). */
function fontPinchGesture(): ReturnType<typeof Gesture.Pinch> {
  let base = FONT_SIZE_DEFAULT;
  return Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      base = getTerminalFont();
    })
    .onUpdate((e) => setTerminalFont(Math.round(base * e.scale)));
}
