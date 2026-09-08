// ────────────────────────────────────────────────────────────────
// Workbench › Browser.
//
// Web renders a live CDP screencast and forwards every click, drag and
// keystroke back to the page. Mobile deliberately does NOT forward pointer
// input: the remote page is laid out for a desktop viewport, so a tap at
// phone coordinates lands somewhere the user did not aim, and the resulting
// mis-clicks are indistinguishable from the agent misbehaving.
//
// What IS here is everything that does not depend on pixel-accurate aim —
// start/stop, the address bar, back/forward/reload — because those are the
// controls you actually reach for when the agent has parked on the wrong
// page and you want to put it back on the right one.
//
// Frames are polled rather than streamed: RN's `Image` cannot consume the
// multipart MJPEG response, and a poll stops the moment the sheet closes,
// which a socket would not.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Globe, Play, RotateCw, Square } from 'lucide-react-native';
import { describeErrorBody } from '@generatorai/client-core';

import { IconButton } from '../../ui/Button';
import { EmptyState, LoadingState, Spinner } from '../../ui/States';
import { Field } from '../../ui/Form';
import { useToast } from '../../ui/Toast';
import { useAuth } from '../../../auth/AuthProvider';
import { StepUpGate } from '../../../auth/StepUpGate';
import { bytesToBase64 } from '../../../lib/base64';
import { useTheme } from '../../../theme/ThemeProvider';

/** Mirrors the server's `ActionBodySchema` union so a bad shape cannot compile. */
type BrowserAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'reload' }
  | { kind: 'back' }
  | { kind: 'forward' };

interface Descriptor {
  status: string;
  mode?: string;
  currentUrl?: string | null;
  ready?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  viewport?: { width: number; height: number };
}

/** How often a frame is refreshed while the section is on screen. */
const FRAME_INTERVAL_MS = 2_000;

/**
 * The pane, behind the session's biometric step-up (plan §5.1): driving the
 * browser is an `exec:browser` action. The pager pre-mounts this beside the
 * Terminal pane, so the prompt waits for `active` — the moment it is swiped
 * into view — rather than firing for a page the user cannot see.
 */
export function BrowserSection({
  workspaceId,
  active = true,
}: {
  workspaceId: string;
  /** Whether the pane is the visible page; gates the step-up prompt. */
  active?: boolean;
}): React.ReactElement {
  return (
    <StepUpGate reason="Confirm opening the browser" active={active}>
      <BrowserPanel workspaceId={workspaceId} />
    </StepUpGate>
  );
}

function BrowserPanel({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const { fetch: authFetch } = useAuth();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [frame, setFrame] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [dirty, setDirty] = useState(false);
  const inFlight = useRef(false);

  const key = ['workspaces', workspaceId, 'browser', 'descriptor'] as const;

  const descriptor = useQuery<Descriptor>({
    queryKey: key,
    queryFn: async () => {
      const response = await authFetch(`/api/workspaces/${workspaceId}/browser/descriptor`);
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as Descriptor;
    },
    refetchInterval: 5_000,
  });

  // `ready` rather than `status`: the session row exists (`status:'active'`)
  // long before Chromium is actually up, and only `ready` means there is a
  // page worth screencasting.
  const live = descriptor.data?.ready === true;
  const url = descriptor.data?.currentUrl ?? '';

  // The field follows the page until the user starts typing, then stops —
  // otherwise a navigation mid-edit silently rewrites what they were typing.
  useEffect(() => {
    if (!dirty) setAddress(url);
  }, [url, dirty]);

  const post = useCallback(
    async (path: string, body?: unknown) => {
      const response = await authFetch(`/api/workspaces/${workspaceId}/browser/${path}`, {
        method: 'POST',
        ...(body ? { headers: { 'content-type': 'application/json' } } : {}),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        // The raw body is a JSON envelope whose `message` can be several
        // hundred characters of stack-adjacent detail. Toasting it verbatim
        // put `{"error":{...,"requestId":"..."}}` in front of the user; this
        // is the same rendering every other call in the app gets.
        const raw = await response.text();
        let described: string | null = null;
        try {
          described = describeErrorBody(JSON.parse(raw));
        } catch {
          described = raw;
        }
        const message = (described ?? `${response.status} ${response.statusText}`)
          .split(/\r?\n/)[0]!
          .trim();
        throw new Error(message.length > 160 ? `${message.slice(0, 157)}…` : message);
      }
      return response;
    },
    [authFetch, workspaceId],
  );

  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: key });

  /** The address bar's text as a navigable URL, or '' when it is empty. */
  const targetUrl = useCallback((): string => {
    const raw = address.trim();
    if (!raw) return '';
    return /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  }, [address]);

  const startStop = useMutation({
    // `/start` takes the first URL too, so typing an address and pressing run
    // is ONE call — otherwise the session comes up on about:blank and the
    // address the user typed is silently dropped.
    mutationFn: (next: 'start' | 'stop') =>
      next === 'start' ? post('start', targetUrl() ? { url: targetUrl() } : undefined) : post('stop'),
    onSuccess: () => {
      setDirty(false);
      invalidate();
    },
    onError: (err) =>
      toast({ message: err instanceof Error ? err.message : 'Browser failed', tone: 'error' }),
  });

  // The body is a Zod discriminated union on `kind` (see routes/browser.ts).
  // Sending `action` instead made every navigation fail 400 VALIDATION.
  const act = useMutation({
    mutationFn: (action: BrowserAction) => post('actions', action),
    onSuccess: () => {
      setDirty(false);
      invalidate();
      void pullFrame();
    },
    onError: (err) =>
      toast({ message: err instanceof Error ? err.message : 'Navigation failed', tone: 'error' }),
  });

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
      const response = await authFetch(
        `/api/workspaces/${workspaceId}/browser/screencast.jpg?quality=45&k=${Date.now()}`,
      );
      if (!response.ok) return;
      const buffer = await response.arrayBuffer();
      setFrame(`data:image/jpeg;base64,${bytesToBase64(new Uint8Array(buffer))}`);
    } catch {
      /* a dropped frame is not worth surfacing; the next poll retries */
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

  // Chromium takes seconds to come up, and the session row exists well before
  // it does. Without a distinct "starting" phase the panel said "not running"
  // the whole time and Start looked ignored.
  const starting =
    !live &&
    (startStop.isPending ||
      descriptor.data?.status === 'active' ||
      descriptor.data?.status === 'starting');

  // Submitting an address while the browser is down should START it there,
  // not post a navigate the server has nothing to run.
  const navigate = (): void => {
    if (!targetUrl()) return;
    if (!live) {
      startStop.mutate('start');
      return;
    }
    act.mutate({ kind: 'navigate', url: targetUrl() });
  };

  return (
    <View className="flex-1">
      {/* One row, the way every mobile browser arranges it: navigation left,
          the address filling the middle, run/stop right. Compact icons —
          three 44pt buttons left barely a third of a phone for the URL. */}
      <View className="flex-row items-center gap-0.5 border-b border-border-muted px-1.5 py-1.5">
        {/* Named for the page, not the app: the screen header already has a
            "Back", and two controls with the same accessible name on one
            screen is ambiguous to anyone navigating by voice or reader. */}
        {/* Navigation only exists once there is a page to navigate. Three
            permanently dead arrows in front of the address bar made the
            toolbar look broken before the browser had even been started. */}
        {live ? (
          <>
            <IconButton
              compact
              accessibilityLabel="Browser back"
              icon={<ArrowLeft size={16} color={colors['muted-foreground']} />}
              disabled={descriptor.data?.canGoBack === false}
              onPress={() => act.mutate({ kind: 'back' })}
            />
            <IconButton
              compact
              accessibilityLabel="Browser forward"
              icon={<ArrowRight size={16} color={colors['muted-foreground']} />}
              disabled={descriptor.data?.canGoForward === false}
              onPress={() => act.mutate({ kind: 'forward' })}
            />
            <IconButton
              compact
              accessibilityLabel="Reload page"
              icon={<RotateCw size={16} color={colors['muted-foreground']} />}
              onPress={() => act.mutate({ kind: 'reload' })}
            />
          </>
        ) : null}
        <View className="mx-1 flex-1">
          <Field
            placeholder="Search or enter address"
            value={address}
            onChangeText={(next) => {
              setAddress(next);
              setDirty(true);
            }}
            onSubmitEditing={navigate}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            // Typing an address is how you START a session, so the field must
            // stay editable while the browser is down.
            accessibilityLabel="Address"
          />
        </View>
        {/* Bare glyph, not a filled pill: a solid accent block next to the
            address bar reads as the primary action of the whole panel. */}
        <IconButton
          compact
          accessibilityLabel={live ? 'Stop the browser' : 'Start the browser'}
          disabled={startStop.isPending}
          icon={
            startStop.isPending ? (
              <Spinner />
            ) : live ? (
              <Square size={17} color={colors.danger} />
            ) : (
              <Play size={17} color={colors.primary} />
            )
          }
          onPress={() => startStop.mutate(live ? 'stop' : 'start')}
        />
      </View>

      {live ? (
        <View className="flex-1 items-center justify-center bg-canvas-bg p-3">
          {frame ? (
            <Image
              accessibilityLabel={`Browser showing ${url || 'a page'}`}
              source={{ uri: frame }}
              resizeMode="contain"
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <LoadingState label="Loading live view…" />
          )}
        </View>
      ) : starting ? (
        // Chromium takes several seconds to come up. Without this the panel
        // still said "not running" the whole time, so Start looked ignored.
        <LoadingState label="Starting the browser…" />
      ) : (
        // The action is IN the empty state. The copy used to name a control
        // ("press Start") that was an unlabelled ▶ at the far end of the
        // toolbar, past three arrows that do nothing yet.
        <EmptyState
          compact
          title="Browser is not running"
          message="Start it here, or leave it — the agent starts it when it needs a page."
          icon={<Globe size={16} color={colors['muted-foreground']} />}
          action={{ label: 'Start browser', onPress: () => startStop.mutate('start') }}
        />
      )}

      {live ? (
        <View className="border-t border-border-muted px-3 py-2">
          <Text className="text-xs text-muted-foreground">
            View only — the page is sized for a desktop window, so taps are not forwarded.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
