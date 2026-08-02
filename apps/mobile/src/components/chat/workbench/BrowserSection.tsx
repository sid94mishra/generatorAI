// ────────────────────────────────────────────────────────────────
// Workbench › Browser.
//
// VIEW-ONLY, deliberately.
//
// The remote page is laid out for a desktop viewport. Forwarding phone
// touches to it means every tap lands somewhere the user did not aim, and
// the resulting mis-clicks are indistinguishable from the agent misbehaving.
// So this shows what the agent's browser is looking at — live frame, URL,
// status — and stops there. Driving it is a desktop job.
//
// Frames are polled rather than streamed: the MJPEG endpoint is a long-lived
// multipart response, and RN's `Image` cannot consume one. A poll also stops
// the moment the sheet closes, which a stream would not.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Globe, RefreshCw } from 'lucide-react-native';

import { Badge, type Tone } from '../../ui/primitives';
import { IconButton } from '../../ui/Button';
import { EmptyState, LoadingState } from '../../ui/States';
import { useAuth } from '../../../auth/AuthProvider';
import { useTheme } from '../../../theme/ThemeProvider';

interface Descriptor {
  status: string;
  mode?: string;
  currentUrl?: string | null;
  ready?: boolean;
  viewport?: { width: number; height: number };
}

const STATUS_TONE: Record<string, Tone> = {
  running: 'success',
  starting: 'warning',
  stopped: 'neutral',
  error: 'danger',
};

/** How often a frame is refreshed while the section is on screen. */
const FRAME_INTERVAL_MS = 2_000;

export function BrowserSection({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const { fetch: authFetch } = useAuth();
  const { colors } = useTheme();
  const [frame, setFrame] = useState<string | null>(null);
  const [frameError, setFrameError] = useState(false);
  const inFlight = useRef(false);

  const descriptor = useQuery<Descriptor>({
    queryKey: ['workspaces', workspaceId, 'browser', 'descriptor'],
    queryFn: async () => {
      const response = await authFetch(`/api/workspaces/${workspaceId}/browser/descriptor`);
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as Descriptor;
    },
    refetchInterval: 5_000,
  });

  const live = descriptor.data?.status === 'running';

  /**
   * Pull one JPEG and turn it into a data URI.
   *
   * `Image source={{uri}}` cannot carry DPoP headers, so the bytes have to
   * come through the authenticated fetch and be inlined.
   */
  const pullFrame = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await authFetch(`/api/workspaces/${workspaceId}/browser/screencast.jpg`);
      if (!response.ok) {
        setFrameError(true);
        return;
      }
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      setFrame(`data:image/jpeg;base64,${globalThis.btoa(binary)}`);
      setFrameError(false);
    } catch {
      setFrameError(true);
    } finally {
      inFlight.current = false;
    }
  }, [authFetch, workspaceId]);

  useEffect(() => {
    if (!live) return undefined;
    void pullFrame();
    const timer = setInterval(() => void pullFrame(), FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [live, pullFrame]);

  if (descriptor.isLoading) return <LoadingState label="Checking the browser…" />;

  if (!live) {
    return (
      <EmptyState
        title="Browser is not running"
        message="It starts when the agent needs a page. Whatever it is looking at appears here."
        icon={<Globe size={22} color={colors['muted-foreground']} />}
      />
    );
  }

  return (
    <View className="flex-1">
      <View className="gap-2 border-b border-border-muted px-4 pb-2.5">
        <View className="flex-row items-center gap-2">
          <Badge
            label={descriptor.data?.status ?? 'unknown'}
            tone={STATUS_TONE[descriptor.data?.status ?? ''] ?? 'neutral'}
          />
          <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
            {descriptor.data?.currentUrl ?? 'about:blank'}
          </Text>
          <IconButton
            accessibilityLabel="Refresh frame"
            icon={<RefreshCw size={16} color={colors['muted-foreground']} />}
            onPress={() => void pullFrame()}
          />
        </View>
        <Text className="text-xs text-muted-foreground">
          View only — the page is laid out for a desktop window, so taps are not forwarded.
        </Text>
      </View>

      <View className="flex-1 items-center justify-center bg-canvas-bg p-3">
        {frame ? (
          <Image
            accessibilityLabel="Browser preview"
            source={{ uri: frame }}
            resizeMode="contain"
            style={{ width: '100%', height: '100%', borderRadius: 12 }}
          />
        ) : frameError ? (
          <Text className="text-sm text-muted-foreground">
            No frame available yet. The page may still be loading.
          </Text>
        ) : (
          <LoadingState />
        )}
      </View>
    </View>
  );
}
