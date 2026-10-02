// MB-28 BrowserView (MPaneBrowser, MPaneBrowserStates; MD-37, MD-114): the workspace's server-side browser, view only —
// the polled stream frame, the nav bar (Back, Forward, Reload, the URL field: submit navigates, or starts the browser
// there), "<agent> is browsing" while the agent drives it, and the toolbar: Comment (the inspector — a tap on the
// frame is mapped from the scaled frame to page coordinates and sent as a page click; the page's pick arrives as
// `browser.selection` and becomes a numbered comment card with "Send to chat"), Capture screenshot (→ the composer),
// the device preset, ⋯ (Share / Stop sharing with the agent, Send page text, Stop the browser, DevTools on desktop
// only). States: starting, session limit, page failed to load (Retry, Open Terminal), no page open (address + Start).
// One session per workspace: the server has no page tabs, so no page chips are drawn (MD-27).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import type { BrowserDescriptorView } from '@generatorai/client-core';

import { useComposerCapture } from '../Composer/model/captureContext';
import { usePaneStore } from '../WorkspacePane/paneStore';
import { Menu } from '../../ui/native/Menu';
import { haptic } from '../../ui/platform/haptics';
import { overflowIcon } from '../../ui/platform/overflow';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Chip } from '../../ui/primitives/Chip';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { Input } from '../../ui/primitives/Input';
import { Spinner } from '../../ui/primitives/Spinner';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import { useBrowserActions, useBrowserDescriptor, useBrowserEvents, useBrowserFrame } from './BrowserView.queries';
import { DEVICE_PRESETS, addressToUrl, classifyFailure, commentForChat, framePointToPage, type BrowserSelection, type Size } from './model/browserModel';

export interface BrowserViewProps {
  workspaceId: string;
  /** The tab is on screen: the frame and descriptor poll. */
  active: boolean;
  /** The agent is running a turn (sharing cannot change mid-turn; the browsing strip shows). */
  agentBusy?: boolean;
  agentName?: string | null;
}

interface Comment extends BrowserSelection {
  n: number;
  text: string;
}

const errorText = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback);

export function BrowserView({ workspaceId, active, agentBusy = false, agentName = null }: BrowserViewProps): React.ReactElement {
  const capture = useComposerCapture();
  const descriptor = useBrowserDescriptor(workspaceId, active);
  const actions = useBrowserActions(workspaceId);
  const d: BrowserDescriptorView | undefined = descriptor.data;
  const live = d?.ready === true;
  const url = d?.currentUrl ?? '';
  const frame = useBrowserFrame(workspaceId, live && active);
  const [address, setAddress] = useState<string | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [preset, setPreset] = useState('responsive');
  const [view, setView] = useState<Size>({ width: 0, height: 0 });
  const [failure, setFailure] = useState<string | null>(null);
  const shown = address ?? url;

  const onSelection = useCallback((sel: BrowserSelection) => {
    haptic('success');
    setComments((prev) => (prev.some((c) => c.artifactId === sel.artifactId) ? prev : [...prev, { ...sel, n: prev.length + 1, text: '' }]));
  }, []);
  useBrowserEvents(workspaceId, active || commenting, onSelection);

  // Leaving comment mode (or the tab) turns the page's inspector off again.
  const { inspector } = actions;
  useEffect(() => {
    if (!commenting || !live) return undefined;
    void inspector(true).catch(() => setCommenting(false));
    return () => {
      void inspector(false).catch(() => undefined);
    };
  }, [commenting, live, inspector]);

  const go = (target: string): void => {
    const next = addressToUrl(target);
    if (!next) return;
    setFailure(null);
    if (!live) actions.start.mutate(next, { onError: (err) => setFailure(errorText(err, "The browser didn't start.")), onSuccess: () => setAddress(null) });
    else actions.act.mutate({ kind: 'navigate', url: next }, { onError: (err) => setFailure(errorText(err, "This page didn't load.")), onSuccess: () => setAddress(null) });
  };
  const pick = (e: GestureResponderEvent): void => {
    if (!commenting || !d?.viewport) return;
    const point = framePointToPage({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }, view, d.viewport);
    if (!point) return;
    haptic('selection');
    void actions.click(point.x, point.y).catch((err: unknown) => toast({ kind: 'error', message: errorText(err, "Couldn't reach the page.") }));
  };
  const setDevice = (id: string): void => {
    const next = DEVICE_PRESETS.find((p) => p.id === id);
    if (!next) return;
    setPreset(id);
    if (next.size) void actions.resize(next.size.width, next.size.height).catch((err: unknown) => toast({ kind: 'error', message: errorText(err, "Couldn't resize the page.") }));
  };
  const attached = d?.attachedToChat !== false;
  const menu = useMemo(
    () => [
      { id: 'share', label: attached ? 'Stop sharing' : 'Share with the agent', icon: 'view' as const, disabled: agentBusy, ...(agentBusy ? { subtitle: 'Not while the agent is working' } : {}) },
      ...(capture ? [{ id: 'page-text', label: 'Send page text to chat', icon: 'file-text' as const }] : []),
      { id: 'stop', label: 'Stop the browser', icon: 'stop' as const },
      { type: 'separator' as const },
      { id: 'devtools', label: 'DevTools', subtitle: 'Desktop app only', icon: 'tool' as const, disabled: true },
    ],
    [attached, agentBusy, capture],
  );
  const onMenu = (id: string): void => {
    if (id === 'share') actions.share.mutate(!attached, { onError: (err) => toast({ kind: 'error', message: errorText(err, "Couldn't change sharing.") }) });
    else if (id === 'page-text') void capture?.captureBrowserPageText();
    else if (id === 'stop') actions.stop.mutate();
  };

  const starting = !live && (actions.start.isPending || d?.status === 'active' || d?.status === 'starting');
  const failed = failure ? classifyFailure(failure, addressToUrl(shown)) : null;

  const navBar = (
    <View className="flex-row items-center gap-0.5 px-2">
      {live ? (
        <>
          <IconButton icon="back" size="sm" label="Browser back" disabled={d?.canGoBack === false} onPress={() => actions.act.mutate({ kind: 'back' })} />
          <IconButton icon="forward" size="sm" label="Browser forward" disabled={d?.canGoForward === false} onPress={() => actions.act.mutate({ kind: 'forward' })} />
          <IconButton icon="refresh" size="sm" label="Reload page" onPress={() => actions.act.mutate({ kind: 'reload' })} />
        </>
      ) : null}
      <View className="flex-1 px-1">
        <Input label="Address" kind="url" presentation="standalone" value={shown} placeholder="Search or enter address" returnKeyType="go" onChangeText={setAddress} onSubmitEditing={() => go(shown)} testID="browser-address" />
      </View>
      {!live ? (
        <Button
          label="Start"
          icon="play"
          size="sm"
          loading={actions.start.isPending}
          onPress={() => {
            setFailure(null);
            actions.start.mutate(addressToUrl(shown), { onError: (err) => setFailure(errorText(err, "The browser didn't start.")), onSuccess: () => setAddress(null) });
          }}
          testID="browser-start"
        />
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (descriptor.isLoading) {
    body = (
      <View className="flex-1 items-center justify-center">
        <Spinner label="Checking the browser" />
      </View>
    );
  } else if (failed && failed.kind === 'poolFull') {
    body = (
      <View className="gap-2 px-3">
        <Text role="footnote" weight={600} tone="fg-3">
          Session limit
        </Text>
        <Callout tone="err" title="All browser sessions are in use" body={`Up to 5 run at once, one per chat. ${failed.detail}`} action={{ label: 'Retry', onPress: () => go(shown) }} />
      </View>
    );
  } else if (failed && failed.kind === 'loadFailed') {
    body = (
      <View className="gap-2 px-3">
        <Callout tone="warn" title="This page didn’t load" body={failed.host ? `Nothing is answering on ${failed.host}. Start the dev server, then retry.` : failed.detail} action={{ label: 'Retry', onPress: () => go(shown) }} />
        <View className="flex-row gap-2">
          <Button label="Open Terminal" icon="terminal" size="sm" onPress={() => usePaneStore.getState().select('terminal')} />
        </View>
        <Text role="monoSm" tone="fg-3">
          {failed.detail}
        </Text>
      </View>
    );
  } else if (starting) {
    body = (
      <View className="flex-1 items-center justify-center gap-2">
        <Spinner label="Starting the browser" />
        <Text role="footnote" tone="fg-3">
          Starting the browser…
        </Text>
      </View>
    );
  } else if (!live) {
    body = (
      <View className="gap-2">
        {failed ? (
          <View className="px-3">
            <Callout tone="err" title="The browser didn’t start" body={failed.detail} action={{ label: 'Retry', onPress: () => go(shown) }} />
          </View>
        ) : null}
        <EmptyState icon="browser" title="No page open" description="The agent opens pages here, or enter a URL above and press Start." />
      </View>
    );
  } else {
    body = (
      <View className="flex-1 gap-2">
        {agentBusy && attached ? (
          <View className="mx-3 min-h-control flex-row items-center gap-2 rounded-card bg-selected px-3" accessibilityLiveRegion="polite">
            <Spinner size={14} />
            <Text role="footnote" weight={600} numberOfLines={1} className="flex-1">
              {`${agentName ?? 'The agent'} is browsing`}
            </Text>
          </View>
        ) : null}
        <View className="flex-row items-center gap-2 px-3">
          <Chip label="Comment" icon="message" selected={commenting} onPress={() => setCommenting((v) => !v)} testID="browser-comment" />
          {capture ? <IconButton icon="camera" size="sm" variant="bordered" label="Capture screenshot" disabled={!capture.attachAvailable} onPress={() => void capture.captureBrowserScreenshot()} /> : null}
          <Menu
            items={DEVICE_PRESETS.map((p) => ({ id: p.id, label: p.label, checked: p.id === preset }))}
            onSelect={setDevice}
            accessibilityLabel="Device"
            trigger={<Chip label={DEVICE_PRESETS.find((p) => p.id === preset)?.label.split(' · ')[0] ?? 'Responsive'} variant="dropdown" icon="device" />}
          />
          <View className="flex-1" />
          <Menu items={menu} onSelect={onMenu} accessibilityLabel="More browser actions" trigger={<IconButton icon={overflowIcon} size="sm" label="More browser actions" onPress={() => undefined} />} />
        </View>
        <View
          className="mx-3 flex-1 overflow-hidden rounded-card border border-line bg-sunken"
          onLayout={(e: LayoutChangeEvent) => setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
          onStartShouldSetResponder={() => commenting}
          onResponderRelease={pick}
          accessibilityLabel={commenting ? 'Live view. Tap an element to comment on it' : `Browser showing ${url || 'a page'}`}
          testID="browser-frame"
        >
          {frame ? <Image source={{ uri: frame }} resizeMode="contain" className="h-full w-full" accessibilityIgnoresInvertColors /> : <Spinner label="Loading the live view" />}
        </View>
        <View className="flex-row items-center gap-1.5 px-4">
          <Icon concept="view" size={14} tone="fg-3" />
          <Text role="caption" tone="fg-3" numberOfLines={1} className="flex-1">
            {commenting ? 'View only · tap an element to comment' : 'View only'}
          </Text>
          {d?.viewport ? (
            <Text role="monoSm" tone="fg-3">
              {`${d.viewport.width} × ${d.viewport.height}`}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 gap-2 pt-2" testID="browser">
      {navBar}
      {body}
      {comments.map((c) => (
        <View key={c.artifactId} className="mx-3 gap-2 rounded-card-lg border border-line-soft bg-raised p-3" testID="browser-comment-card">
          <View className="flex-row items-center gap-2">
            <View className="size-5 items-center justify-center rounded-full bg-fg">
              <Text role="caption" tone="surface" chrome>
                {String(c.n)}
              </Text>
            </View>
            <Text role="monoSm" tone="fg-2" numberOfLines={1} className="flex-1">
              {c.cssSelector || c.xpath}
            </Text>
            <Icon concept="user" size={12} tone="fg-3" />
            <Text role="caption" tone="fg-3">
              You
            </Text>
          </View>
          <Textarea label="Comment" value={c.text} onChangeText={(text) => setComments((prev) => prev.map((x) => (x.artifactId === c.artifactId ? { ...x, text } : x)))} placeholder="What is wrong here?" minRows={2} presentation="standalone" />
          <View className="flex-row items-center justify-between">
            <Button label="Delete" variant="ghost" size="sm" onPress={() => setComments((prev) => prev.filter((x) => x.artifactId !== c.artifactId))} />
            {capture ? (
              <Button
                label="Send to chat"
                variant="primary"
                size="sm"
                icon="send"
                disabled={!c.text.trim()}
                onPress={() => {
                  capture.insertText(`Comment on ${c.cssSelector || 'an element'}`, commentForChat(c, c.text));
                  setComments((prev) => prev.filter((x) => x.artifactId !== c.artifactId));
                }}
              />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}
