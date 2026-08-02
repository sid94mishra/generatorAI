// ────────────────────────────────────────────────────────────────
// TerminalView — the xterm renderer plus its PTY socket.
//
// Extracted from the terminal screen so the same implementation backs both
// the full-screen route and the Workbench section. Two copies of a socket
// lifecycle is how you end up with one of them leaking a connection.
//
// The renderer is xterm.js in a WebView loaded from a LOCAL bundle with no
// network access; React Native owns the socket. See bridgeProtocol.ts for why
// that split is not negotiable.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Touchable } from '../components/ui/Touchable';
import { useAuth } from '../auth/AuthProvider';
import { OutputBatcher, parseFromWebView } from './bridgeProtocol';
import { terminalHtml } from './terminalHtml';
import { useTheme } from '../theme/ThemeProvider';

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

export function TerminalView({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const { socketUrl } = useAuth();
  const { colors } = useTheme();
  const webRef = useRef<WebView>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const batcher = useMemo(
    () =>
      new OutputBatcher((b64) => {
        webRef.current?.postMessage(JSON.stringify({ type: 'data', b64 }));
      }),
    [],
  );

  /**
   * Open the PTY socket once the WebView reports it is ready.
   *
   * Ordering matters: bytes that arrive before xterm exists are lost, and a
   * terminal that silently drops its first prompt looks hung.
   */
  const connect = useCallback(async () => {
    if (socketRef.current) return;
    try {
      const url = await socketUrl(
        `/api/workspaces/${workspaceId}/terminals/default/stream`,
        'terminal',
        workspaceId,
      );
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        socketRef.current = null;
      };
      socket.onmessage = (event: WebSocketMessageEvent) => {
        // Batched at the frame boundary; a build log emits far more writes
        // per second than the bridge can carry one at a time.
        batcher.push(toBase64(event.data));
      };
      socketRef.current = socket;
    } catch {
      setConnected(false);
    }
  }, [batcher, socketUrl, workspaceId]);

  // Unmounting must close the socket. Without this, dismissing the Workbench
  // leaves a PTY attached for the lifetime of the app.
  useEffect(
    () => () => {
      socketRef.current?.close();
      socketRef.current = null;
    },
    [],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseFromWebView(event.nativeEvent.data);
      if (!message) return;

      switch (message.type) {
        case 'ready':
          void connect();
          break;
        case 'input':
          socketRef.current?.send(fromBase64(message.b64));
          break;
        case 'resize':
          socketRef.current?.send(
            JSON.stringify({ type: 'resize', cols: message.cols, rows: message.rows }),
          );
          break;
        default:
          break;
      }
    },
    [connect],
  );

  const sendKey = useCallback((bytes: string) => {
    socketRef.current?.send(bytes);
  }, []);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {!connected ? (
        <View className="border-b border-border bg-warning-muted px-3 py-1.5">
          <Text className="text-xs text-foreground">Connecting…</Text>
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

      <View className="flex-row flex-wrap gap-1 border-t border-border bg-card px-2 py-2">
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
      </View>
    </View>
  );
}

/** WebSocket payloads arrive as ArrayBuffer (binary) or string (text). */
function toBase64(data: unknown): string {
  if (typeof data === 'string') {
    return globalThis.btoa(unescape(encodeURIComponent(data)));
  }
  const bytes = new Uint8Array(data as ArrayBuffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function fromBase64(b64: string): string {
  return globalThis.atob(b64);
}
