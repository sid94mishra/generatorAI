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
// Also here, because neither needs aim: "Share with agent" (POST
// /browser/attach | /detach — web's Share toggle; the server re-attaches on
// the next prompt anyway) and "Send to chat" (a screenshot or the page's
// text, into this chat's composer — web's `onCapture`).
//
// Tabs: web's Browser tab can be opened up to five times, but each instance
// is a separate Electron WebContentsView keyed by tab id on the DESKTOP
// shell. The server's REST surface (routes/browser.ts) has exactly one
// session per workspace and no tab parameter, so over it every "tab" would
// be the same page. Mobile therefore shows the one session, honestly.
//
// Frames are polled rather than streamed: RN's `Image` cannot consume the
// multipart MJPEG response, and a poll stops the moment the sheet closes,
// which a socket would not.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  FileText,
  Globe,
  Link2Off,
  MessageSquarePlus,
  Play,
  RotateCw,
  Share2,
  Square,
} from 'lucide-react-native';
import { describeErrorBody } from '@generatorai/client-core';

import { IconButton } from '../../ui/Button';
import { ActionSheet, type MenuAction } from '../../ui/ActionSheet';
import { Chip } from '../../ui/Chip';
import { useComposerCapture } from '../composer/captureContext';
import { EmptyState, ErrorState, LoadingState, Spinner } from '../../ui/States';
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
  /** "Share with agent" — false once detached. Absent on older servers → shared. */
  attachedToChat?: boolean;
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
  agentBusy = false,
}: {
  workspaceId: string;
  /** Whether the pane is the visible page; gates the step-up prompt. */
  active?: boolean;
  /** A turn is streaming — sharing cannot be toggled mid-turn (web parity). */
  agentBusy?: boolean;
}): React.ReactElement {
  return (
    <StepUpGate reason="Confirm opening the browser" active={active}>
      <BrowserPanel workspaceId={workspaceId} agentBusy={agentBusy} />
    </StepUpGate>
  );
}

function BrowserPanel({ workspaceId, agentBusy }: { workspaceId: string; agentBusy: boolean }): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { fetch: authFetch } = useAuth();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [frame, setFrame] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [dirty, setDirty] = useState(false);
  const inFlight = useRef(false);
  const capture = useComposerCapture();
  const [sendOpen, setSendOpen] = useState(false);

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
    // Await navigation separately: /start navigates in the background and
    // otherwise reports success even when the host blocks the requested URL.
    mutationFn: async (next: 'start' | 'stop') => {
      if (next === 'stop') return post('stop');
      const response = await post('start');
      const url = targetUrl();
      if (url) await post('actions', { kind: 'navigate', url });
      return response;
    },
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
    onMutate: () => startStop.reset(),
    mutationFn: (action: BrowserAction) => post('actions', action),
    onSuccess: () => {
      setDirty(false);
      invalidate();
      void pullFrame();
    },
    onError: (err) =>
      toast({ message: err instanceof Error ? err.message : 'Navigation failed', tone: 'error' }),
  });

  const attachedToChat = descriptor.data?.attachedToChat !== false;
  const share = useMutation({
    mutationFn: async (next: boolean) => {
      const response = await post(next ? 'attach' : 'detach');
      return (await response.json()) as { attachedToChat?: boolean };
    },
    onSuccess: (out) => {
      queryClient.setQueryData<Descriptor>(key, (prev) =>
        prev ? { ...prev, attachedToChat: out.attachedToChat !== false } : prev,
      );
      invalidate();
    },
    onError: (err) =>
      toast({ message: err instanceof Error ? err.message : 'Could not change sharing', tone: 'error' }),
  });

  const sendActions: MenuAction[] = capture
    ? [
        {
          label: 'Screenshot',
          icon: <Camera size={18} color={capture.attachAvailable ? colors.foreground : colors['muted-foreground']} />,
          disabled: !capture.attachAvailable,
          detail: capture.attachAvailable
            ? 'The whole visible page, attached to your next message'
            : 'Screenshots need permission to attach files.',
          onPress: () => void capture.captureBrowserScreenshot(),
        },
        {
          label: 'Page text',
          icon: <FileText size={18} color={colors.foreground} />,
          detail: capture.attachAvailable
            ? 'The page’s structure and text, attached to your next message'
            : 'Added to your message as text',
          onPress: () => void capture.captureBrowserPageText(),
        },
      ]
    : [];

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
    <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
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

      {live && (act.isError || startStop.isError) ? (
        <View accessibilityRole="alert" className="border-b border-border-muted bg-card px-3 py-2">
          <Text className="text-sm text-danger">
            {(act.error ?? startStop.error)?.message ?? 'Browser action failed. Check the address and try again.'}
          </Text>
        </View>
      ) : null}
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
      ) : startStop.isError ? (
        <ErrorState
          title="Could not start the browser"
          message={startStop.error instanceof Error ? startStop.error.message : 'Check the host browser setup and try again.'}
          onRetry={() => startStop.mutate('start')}
        />
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
        <View className="gap-1 border-t border-border-muted px-3 py-1.5">
          <View className="min-h-11 flex-row items-center gap-2">
            <Chip
              label={attachedToChat ? 'Sharing with agent' : 'Not shared'}
              icon={
                attachedToChat ? (
                  <Share2 size={13} color={colors.primary} />
                ) : (
                  <Link2Off size={13} color={colors['muted-foreground']} />
                )
              }
              selected={attachedToChat}
              tone={attachedToChat ? 'accent' : 'neutral'}
              disabled={share.isPending || agentBusy}
              accessibilityLabel={attachedToChat ? 'Stop sharing the browser with the agent' : 'Share the browser with the agent'}
              accessibilityHint={
                agentBusy
                  ? 'Unavailable while the agent is working'
                  : attachedToChat
                    ? 'The agent loses browser access until your next message'
                    : 'Lets the agent use this browser again'
              }
              onPress={() => share.mutate(!attachedToChat)}
            />
            <View className="flex-1" />
            {capture ? (
              <Chip
                label="Send to chat"
                icon={<MessageSquarePlus size={13} color={colors['muted-foreground']} />}
                accessibilityHint="Attach a screenshot or the page text to your next message"
                onPress={() => setSendOpen(true)}
              />
            ) : null}
          </View>
          <Text className="text-xs text-muted-foreground">
            Preview only. Send a capture to your agent to work with this page.
          </Text>
        </View>
      ) : null}

      <ActionSheet
        visible={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Send to chat"
        message={url || undefined}
        actions={sendActions}
      />
    </View>
  );
}
