// ────────────────────────────────────────────────────────────────
// Settings is a PAGE, not a modal.
//
// The old modal had no URL, so "Connect GitHub" call-to-actions had nothing
// to link to and a reload dropped the user back on the dashboard. These
// tests pin the three things that made it worth moving: the section is in
// the URL, switching sections replaces (never stacks) history, and Back
// returns to where the user came from — or home when there is nowhere.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

// The real registry pulls every settings section (and every query they make)
// into this test. Routing is what is under test here.
vi.mock('@/components/settings/sectionRegistry.js', () => ({
  SETTINGS_NAV: [
    {
      heading: 'App',
      items: [
        { id: 'general', label: 'General', icon: () => null },
        { id: 'source-control', label: 'Source Control', icon: () => null },
      ],
    },
  ],
  SETTINGS_SECTIONS: {
    general: <div data-testid="section-general">General section</div>,
    'source-control': <div data-testid="section-source-control">Source Control section</div>,
  },
  settingsSectionLabel: (id: string) => id,
}));

import { SettingsPage } from '@/pages/SettingsPage.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';

/**
 * React Router stamps `history.state.idx` on every entry it pushes; the page
 * reads it to tell "there is a page behind me" from "opened straight into a
 * fresh tab". A memory router never touches window.history, so the test
 * states that fact explicitly.
 */
function setHistoryDepth(idx: number) {
  window.history.replaceState({ idx }, '');
}

function renderAt(entries: string[], index?: number) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <div data-testid="dashboard">Dashboard</div> },
      { path: '/chats/:id', element: <div data-testid="chat">Chat</div> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/settings/:section', element: <SettingsPage /> },
    ],
    { initialEntries: entries, ...(index !== undefined ? { initialIndex: index } : {}) },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('SettingsPage', () => {
  beforeEach(() => {
    useSettingsUiStore.setState({ section: 'general', navigator: null });
    setHistoryDepth(0);
  });

  it('renders the section named in the URL', () => {
    renderAt(['/settings/source-control']);
    expect(screen.getByTestId('section-source-control')).toBeInTheDocument();
    expect(screen.queryByTestId('section-general')).toBeNull();
  });

  it('falls back to General for bare /settings and for an unknown section', () => {
    renderAt(['/settings']);
    expect(screen.getByTestId('section-general')).toBeInTheDocument();
  });

  it('treats an unknown section id as General rather than 404-ing', () => {
    renderAt(['/settings/not-a-section']);
    expect(screen.getByTestId('section-general')).toBeInTheDocument();
  });

  it('puts the chosen section in the URL, replacing the entry', async () => {
    const router = renderAt(['/chats/c1', '/settings/general'], 1);
    const before = router.state.location.key;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Source Control' }));
    });

    expect(router.state.location.pathname).toBe('/settings/source-control');
    expect(router.state.location.key).not.toBe(before);
    // Replaced, not pushed: Back still reaches the chat, not the previous
    // section — otherwise paging through fifteen sections buries it.
    await act(async () => { await router.navigate(-1); });
    expect(router.state.location.pathname).toBe('/chats/c1');
  });

  it('Back returns to the page the user came from', async () => {
    setHistoryDepth(1);
    const router = renderAt(['/chats/c1', '/settings/general'], 1);
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-back'));
    });
    expect(router.state.location.pathname).toBe('/chats/c1');
  });

  it('Back goes home when Settings was opened directly (nothing behind it)', async () => {
    const router = renderAt(['/settings/general']);
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-back'));
    });
    expect(router.state.location.pathname).toBe('/');
  });

  it('Escape leaves the page like the modal used to', async () => {
    setHistoryDepth(1);
    const router = renderAt(['/chats/c1', '/settings/general'], 1);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(router.state.location.pathname).toBe('/chats/c1');
  });

  it('remembers the section so a later bare openSettings() returns to it', () => {
    renderAt(['/settings/source-control']);
    expect(useSettingsUiStore.getState().section).toBe('source-control');
  });
});

describe('openSettings()', () => {
  it('navigates instead of opening a modal', () => {
    const navigate = vi.fn();
    useSettingsUiStore.setState({ section: 'general', navigator: navigate });

    useSettingsUiStore.getState().openSettings('diagnostics');

    expect(navigate).toHaveBeenCalledWith('/settings/diagnostics');
    expect(useSettingsUiStore.getState().section).toBe('diagnostics');
  });

  it('with no argument returns to the last section the user was on', () => {
    const navigate = vi.fn();
    useSettingsUiStore.setState({ section: 'templates', navigator: navigate });
    useSettingsUiStore.getState().openSettings();
    expect(navigate).toHaveBeenCalledWith('/settings/templates');
  });
});
