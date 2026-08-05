// ────────────────────────────────────────────────────────────────
// TerminalView — the xterm renderer plus its PTY socket.
//
// The renderer is xterm.js in a WebView loaded from a LOCAL bundle with no
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
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Eraser, TerminalSquare, Trash2 } from 'lucide-react-native';
import type { TerminalDescriptor } from '@generatorai/client-core';

import { Touchable } from '../components/ui/Touchable';
import { IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/States';
import { useAuth } from '../auth/AuthProvider';
import { useApi } from '../api/useApi';
import { OutputBatcher, parseFromWebView } from './bridgeProtocol';
import { terminalHtml } from './terminalHtml';
import { useTheme } from '../theme/ThemeProvider';

/** Matches the server's flow-control window. */
const ACK_BYTE_INTERVAL = 64 * 1024;

/** Keys a phone keyboard cannot produce but a shell constantly needs. */
const KEY_BAR: Array<{ label: string; bytes: string }> = [
  { label: 'esc', bytes: '\u001b' },
  { label: 'tab', bytes: '\t' },
  { label: '^C', bytes: '\u0003' },
  { label: '^D', bytes: '\u0004' },
  { label: '^Z', bytes: '\u001a' },
  { label: '↑', bytes: '\u001b[A' },
  { label: '↓', bytes: '\u001b[B' },
  { label: '←', bytes: '\u001b[D' },
  { label: '→', bytes: '\u001b[C' },
  { label: '|', bytes: '|' },
  { label: '~', bytes: '~' },
  { label: '/', bytes: '/' },
];

type Phase =
  | { state: 'starting' }
  | { state: 'live'; descriptor: TerminalDescriptor }
  | { state: 'exited'; code: number | null; signal?: string }
  | { state: 'error'; message: string };

export function TerminalView({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const { socketUrl, fetch: authedFetch } = useAuth();
  const api = useApi();
  const { colors } = useTheme();
  const webRef = useRef<WebView>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const unackedRef = useRef(0);
  const startedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>({ state: 'starting' });

  // `react-native-webview` ships no web implementation, so on the browser
  // preview it renders its own "not supported" string in place of xterm. Say
  // what is actually going on instead of leaving a broken-looking pane.
  const rendererAvailable = Platform.OS !== 'web';

  const batcher = useMemo(
    () =>
      new OutputBatcher((b64) => {
        webRef.current?.postMessage(JSON.stringify({ type: 'data', b64 }));
      }),
    [],
  );

  const send = useCallback((frame: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify(frame));
  }, []);

  /**
   * Create the session, replay its scrollback, then attach.
   *
   * Ordering matters: live bytes written into xterm before the replay lands
   * would be shuffled behind history that arrived later, so the socket is
   * only opened once the backlog is on screen.
   */
  const start = useCallback(
    async (cols: number, rows: number) => {
      if (startedRef.current) return;
      startedRef.current = true;
      try {
        const descriptor = await api.terminals.create(workspaceId, { cols, rows });
        sessionRef.current = descriptor.id;

        // Best effort: a fresh terminal has no history, and failing to replay
        // must not stop the live stream from attaching.
        try {
          const res = await authedFetch(
            `/api/workspaces/${workspaceId}/terminals/${descriptor.id}/scrollback`,
          );
          if (res.ok) {
            const buffer = await res.arrayBuffer();
            if (buffer.byteLength > 0) {
              webRef.current?.postMessage(
                JSON.stringify({ type: 'data', b64: bytesToBase64(new Uint8Array(buffer)) }),
              );
            }
          }
        } catch {
          /* history is optional */
        }

        const url = await socketUrl(
          `/api/workspaces/${workspaceId}/terminals/${descriptor.id}/stream`,
          'terminal',
          descriptor.id,
        );
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';

        socket.onopen = () => {
          setPhase({ state: 'live', descriptor });
          send({ t: 'resize', cols, rows });
        };

        socket.onmessage = (event: WebSocketMessageEvent) => {
          const data = event.data as unknown;
          if (typeof data === 'string') {
            let frame: { t?: string; code?: number; signal?: string; message?: string };
            try {
              frame = JSON.parse(data) as typeof frame;
            } catch {
              return;
            }
            if (frame.t === 'exit') {
              setPhase({
                state: 'exited',
                code: frame.code ?? null,
                ...(frame.signal ? { signal: frame.signal } : {}),
              });
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

        socket.onerror = () => setPhase({ state: 'error', message: 'Terminal connection error' });
        socket.onclose = () => {
          socketRef.current = null;
          setPhase((prev) => (prev.state === 'live' ? { state: 'exited', code: null } : prev));
        };

        socketRef.current = socket;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPhase({
          state: 'error',
          message: /INSUFFICIENT_SCOPE|403/.test(message)
            ? 'This device is not allowed to open terminals (missing exec:terminal).'
            : message,
        });
      }
    },
    [api, authedFetch, batcher, send, socketUrl, workspaceId],
  );

  // Unmounting must kill the session, not just drop the socket: a detached
  // PTY lingers until the server's idle reaper notices, holding the worktree.
  useEffect(
    () => () => {
      const sid = sessionRef.current;
      const socket = socketRef.current;
      if (socket && socket.readyState === 1) {
        try {
          socket.send(JSON.stringify({ t: 'kill' }));
        } catch {
          /* closing anyway */
        }
      }
      socket?.close();
      socketRef.current = null;
      batcher.dispose();
      if (sid) void api.terminals.kill(workspaceId, sid).catch(() => undefined);
    },
    [api, batcher, workspaceId],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseFromWebView(event.nativeEvent.data);
      if (!message) return;

      switch (message.type) {
        case 'ready':
          // 80×24 until the WebView reports its real geometry, which it does
          // immediately afterwards via `resize`.
          void start(80, 24);
          break;
        case 'input':
          send({ t: 'input', data: base64ToString(message.b64) });
          break;
        case 'resize':
          send({ t: 'resize', cols: message.cols, rows: message.rows });
          break;
        default:
          break;
      }
    },
    [send, start],
  );

  const sendKey = useCallback((bytes: string) => send({ t: 'input', data: bytes }), [send]);

  const descriptor = phase.state === 'live' ? phase.descriptor : null;

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
      <View className="min-h-11 flex-row items-center gap-2 border-b border-border-muted px-3 py-1.5">
        <Text numberOfLines={1} className="flex-1 font-mono text-xs text-muted-foreground">
          {descriptor ? shortenPath(descriptor.cwd) : '—'}
        </Text>
        {descriptor ? (
          <View className="rounded bg-subtle px-1.5 py-0.5">
            <Text className="text-xs text-muted-foreground">{descriptor.host}</Text>
          </View>
        ) : null}
        <IconButton
          accessibilityLabel="Clear scrollback"
          icon={<Eraser size={16} color={colors['muted-foreground']} />}
          onPress={() => webRef.current?.postMessage(JSON.stringify({ type: 'clear' }))}
        />
        <IconButton
          accessibilityLabel="Kill the terminal process"
          icon={<Trash2 size={16} color={colors.danger} />}
          onPress={() => send({ t: 'kill' })}
        />
      </View>

      {phase.state === 'error' ? (
        <View className="border-b border-border bg-danger-muted px-3 py-2">
          <Text className="text-xs text-foreground">{phase.message}</Text>
        </View>
      ) : phase.state === 'exited' ? (
        <View className="border-b border-border bg-warning-muted px-3 py-2">
          <Text className="text-xs text-foreground">
            Process exited{phase.signal ? ` (${phase.signal})` : ''}
            {phase.code !== null ? ` — code ${phase.code}` : ''}. Close and reopen to restart.
          </Text>
        </View>
      ) : phase.state === 'starting' ? (
        <View className="border-b border-border bg-subtle px-3 py-1.5">
          <Text className="text-xs text-muted-foreground">Starting terminal…</Text>
        </View>
      ) : null}

      <WebView
        ref={webRef}
        // Local bundle only: the WebView is a renderer, not a browser. The
        // document is built from the ACTIVE palette — a WebView inherits no
        // CSS variables from the host, so the colours have to be baked in at
        // construction or the terminal ignores light/dark entirely.
        source={{
          html: terminalHtml({ background: colors.background, foreground: colors.foreground }),
        }}
        originWhitelist={['about:blank']}
        onMessage={onMessage}
        javaScriptEnabled
        // Hardening — this surface renders untrusted terminal output.
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        style={{ flex: 1, backgroundColor: colors.background }}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="max-h-14 border-t border-border bg-card"
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ gap: 6, paddingHorizontal: 8, paddingVertical: 8 }}
      >
        {KEY_BAR.map((key) => (
          <Touchable
            key={key.label}
            accessibilityLabel={`Send ${key.label}`}
            haptic="select"
            onPress={() => sendKey(key.bytes)}
            className="min-h-9 min-w-11 items-center justify-center rounded-xl bg-subtle px-2"
          >
            <Text className="font-mono text-xs text-foreground">{key.label}</Text>
          </Touchable>
        ))}
      </ScrollView>
    </View>
  );
}

/** `…/last/three/segments` — a full path never fits at 393pt. */
function shortenPath(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.length <= 3 ? cwd : `…/${parts.slice(-3).join('/')}`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Hermes has no `btoa`, and `Buffer` is not guaranteed on React Native. */
function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

/**
 * Decode the WebView's keystrokes back to a string.
 *
 * The server's `input` frame carries text, not bytes, so this reverses the
 * bridge's base64 rather than producing a byte array.
 */
function base64ToString(b64: string): string {
  const clean = b64.replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const ch of clean) {
    const index = B64.indexOf(ch);
    if (index === -1) continue;
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}
