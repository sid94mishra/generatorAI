// ────────────────────────────────────────────────────────────────
// Settings is a modal addressed by URL (D-26, 06 §2.4). Pinned here:
//   - it opens OVER the current page: the URL changes, the page stays mounted
//     and keeps seeing its own location;
//   - paging sections replaces the entry and keeps the background;
//   - Close returns to the background page; a direct load renders over Home;
//   - a plain link to /settings/… keeps the page and gains it as background;
//   - an unsaved-changes blocker (WorkflowBuilderPage's predicate) ignores the
//     overlay navigations but still stops leaving the page.
// The harness mirrors ShellRoute: one '*' data route rendering the pages with
// useRoutes(pages, pageLocation) and the modal on top.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, useBlocker, useLocation, useRoutes } from 'react-router';
import { RouterProvider } from 'react-router/dom';

vi.mock('@/app/registries/settingsSections.js', () => ({}));
vi.mock('@/features/settings/index.js', () => ({
  SettingsModal: ({ section, onClose }: { section: string; onClose: () => void }) => (
    <div data-testid="settings-modal" data-section={section}>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

import { useSettingsOpener, useShellLocations } from '@/app/shell/settingsRouting.js';
import { SettingsModalRoute } from '@/app/routes/settings.routes.js';
import { isOverlayNavigation } from '@/lib/overlayNavigation.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';

let chatMounts = 0;

function ChatPage() {
  const { pathname } = useLocation();
  useEffect(() => {
    chatMounts += 1;
  }, []);
  return <div data-testid="chat">{pathname}</div>;
}

function DirtyEditor() {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && !isOverlayNavigation(currentLocation, nextLocation),
  );
  return <div data-testid="editor" data-blocker={blocker.state} />;
}

const PAGES = [
  { path: '/', element: <div data-testid="home" /> },
  { path: '/chats/:id', element: <ChatPage /> },
  { path: '/edit', element: <DirtyEditor /> },
];

function Shell() {
  const { location, pageLocation, settingsSection, background } = useShellLocations();
  useSettingsOpener(location);
  const page = useRoutes(PAGES, pageLocation);
  return (
    <>
      {page}
      {settingsSection ? <SettingsModalRoute section={settingsSection} background={background} /> : null}
    </>
  );
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '*', element: <Shell /> }], { initialEntries: [entry] });
  render(<RouterProvider router={router} />);
  return router;
}

const bgPath = (router: ReturnType<typeof renderAt>) =>
  (router.state.location.state as { backgroundLocation?: { pathname: string } } | null)?.backgroundLocation?.pathname;

describe('Settings modal route (background location)', () => {
  beforeEach(() => {
    chatMounts = 0;
    useSettingsUiStore.setState({ section: 'general', opener: null });
    window.history.replaceState({ idx: 0 }, '');
  });

  it('opens over the current page: the URL changes and the page stays mounted', async () => {
    const router = renderAt('/chats/c1');
    await act(async () => useSettingsUiStore.getState().openSettings('appearance'));

    expect(router.state.location.pathname).toBe('/settings/appearance');
    expect(bgPath(router)).toBe('/chats/c1');
    expect(await screen.findByTestId('settings-modal')).toHaveAttribute('data-section', 'appearance');
    expect(screen.getByTestId('chat')).toHaveTextContent('/chats/c1');
    expect(chatMounts).toBe(1);
  });

  it('paging sections replaces the entry and keeps the background', async () => {
    const router = renderAt('/chats/c1');
    await act(async () => useSettingsUiStore.getState().openSettings('general'));
    await act(async () => useSettingsUiStore.getState().openSettings('security'));

    expect(router.state.location.pathname).toBe('/settings/security');
    expect(bgPath(router)).toBe('/chats/c1');
    await act(async () => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/chats/c1');
    expect(chatMounts).toBe(1);
  });

  it('Close returns to the page it was opened over', async () => {
    const router = renderAt('/chats/c1');
    await act(async () => useSettingsUiStore.getState().openSettings('general'));
    window.history.replaceState({ idx: 1 }, '');
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await act(async () => undefined);

    expect(router.state.location.pathname).toBe('/chats/c1');
    expect(screen.queryByTestId('settings-modal')).toBeNull();
    expect(chatMounts).toBe(1);
  });

  it('a direct load renders over Home, and Close goes home', async () => {
    const router = renderAt('/settings/security');
    expect(await screen.findByTestId('settings-modal')).toHaveAttribute('data-section', 'security');
    expect(screen.getByTestId('home')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => undefined);
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('a plain link to /settings keeps the page and records it as the background', async () => {
    const router = renderAt('/chats/c1');
    await act(async () => router.navigate('/settings/templates'));

    expect(await screen.findByTestId('settings-modal')).toHaveAttribute('data-section', 'templates');
    expect(screen.getByTestId('chat')).toHaveTextContent('/chats/c1');
    expect(bgPath(router)).toBe('/chats/c1');
    expect(chatMounts).toBe(1);
  });

  it('an unsaved-changes blocker ignores opening and closing Settings, not leaving the page', async () => {
    const router = renderAt('/edit');
    await act(async () => useSettingsUiStore.getState().openSettings('general'));
    expect(router.state.location.pathname).toBe('/settings/general');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-blocker', 'unblocked');

    await act(async () => useSettingsUiStore.getState().openSettings('audio'));
    expect(router.state.location.pathname).toBe('/settings/audio');

    await act(async () => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/edit');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-blocker', 'unblocked');

    await act(async () => router.navigate('/chats/c2'));
    expect(router.state.location.pathname).toBe('/edit');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-blocker', 'blocked');
  });
});
