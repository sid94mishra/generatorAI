// MD-162 regression: the chat screen crashed with "Maximum update depth exceeded" on iOS. It rendered the workspace
// Header with fresh props each render and claimed the pane with a renderer rebuilt each render; the claim effect
// stored a new claim, `usePaneToggle` (subscribed to the whole claim) re-rendered the screen, and the Header's
// toolbars re-registered their navigator options in a layout effect on every pass. This mounts that wiring in a real
// expo-router stack (the iOS project: the native toolbars are iOS-only; Android's header hides the native bar) and
// asserts the render count stays bounded.
import React from 'react';
import { Platform } from 'react-native';
import { create } from 'zustand';
import type * as ExpoRouter from 'expo-router';
import type * as RouterTesting from 'expo-router/testing-library';
import type * as HeaderModule from '../../ui/native/router/Header';
import type * as Themed from '../../ui/__tests__/themed';
import type * as Pane from './WorkspacePane';
import type * as PaneStore from './paneStore';

jest.mock('expo-glass-effect', () => ({ GlassView: () => null, GlassContainer: () => null, isLiquidGlassAvailable: () => false, isGlassEffectAPIAvailable: () => false }));
jest.mock('expo-router/build/toolbar/native', () => ({ RouterToolbarHost: () => null, RouterToolbarItem: () => null }));

/* eslint-disable @typescript-eslint/no-require-imports -- expo-router's stack only loads under the iOS project. */
const ios = Platform.OS === 'ios';
const load = <T,>(path: () => T): T => (ios ? path() : ({} as T));
const { Stack } = load(() => require('expo-router') as typeof ExpoRouter);
const { act, renderRouter } = load(() => require('expo-router/testing-library') as typeof RouterTesting);
const { Header } = load(() => require('../../ui/native/router/Header') as typeof HeaderModule);
const { themed } = load(() => require('../../ui/__tests__/themed') as typeof Themed);
const { useClaimPaneScope, usePaneToggle } = load(() => require('./WorkspacePane') as typeof Pane);
const { usePaneStore } = require('./paneStore') as typeof PaneStore;
/* eslint-enable @typescript-eslint/no-require-imports */

const useTick = create<{ n: number }>(() => ({ n: 0 }));
let renders = 0;

function ChatLike(): React.ReactElement {
  renders += 1;
  const n = useTick((s) => s.n);
  // Deliberately careless, like an inline callback: a new renderer (and so a new claim) on every render.
  const renderTab = (): null => null;
  const claim = { scope: { serverId: 's', kind: 'chat' as const, id: 'c1' }, title: `Chat ${n}`, path: '/', tabs: [], renderTab };
  useClaimPaneScope(claim as never);
  const toggle = usePaneToggle();
  return (
    <Header
      role="workspace"
      title={`Chat ${n}`}
      breadcrumb={[{ label: 'Chats', onPress: () => undefined }]}
      status={{ state: 'running', label: 'Running' }}
      onBack={() => undefined}
      paneToggle={{ ...toggle, onPress: () => toggle.onPress() }}
      actions={[{ id: 'chat-menu', icon: 'more', label: 'Chat actions', menu: [{ id: 'rename', label: 'Rename' }], onMenuSelect: () => undefined }]}
    />
  );
}

(ios ? describe : describe.skip)('chat header + pane claim (MD-162)', () => {
  it('renders a bounded number of times across re-renders', async () => {
    await renderRouter({ _layout: () => themed(<Stack />), index: ChatLike }, { initialUrl: '/' });
    const mounted = renders;
    expect(mounted).toBeLessThan(10);
    for (let i = 0; i < 3; i++) await act(async () => useTick.setState({ n: i + 1 }));
    expect(renders - mounted).toBeLessThanOrEqual(3 * 3);
    // Toggling the pane re-renders the screen for what the toggle shows, and settles.
    const before = renders;
    await act(async () => usePaneStore.getState().toggle());
    expect(renders - before).toBeLessThanOrEqual(3);
  });
});
