// ────────────────────────────────────────────────────────────────
// P3-06: the "Restart to update" pill and the Servers menu, wired.
//
// Pill: shown only while a downloaded update is ready (or installing) — never
// for idle / checking / downloading / plain web — in the slot of each layout
// (title strip on the strip layout; sidebar footer and rail on mac/native);
// a click runs the install once; `installing` shows busy and ignores clicks.
// Servers menu: real servers with their status, the active one checked,
// switching, "Add server…" only where the shell can add one, "Manage servers"
// → Settings ▸ Security & devices; opens by keyboard and by mouse.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopUpdateState } from '@generatorai/shared';
import { renderWithProviders } from '../helpers/renderWithProviders.js';

const update = vi.hoisted(() => ({
  state: null as DesktopUpdateState | null,
  restart: vi.fn(async () => undefined),
}));
vi.mock('@/hooks/updateQueries.js', () => ({
  useUpdateState: () => update.state,
  restartToUpdate: update.restart,
}));

const servers = vi.hoisted(() => ({
  data: undefined as unknown[] | undefined,
  error: null as Error | null,
  canAdd: false,
  switchServer: vi.fn(),
  addServer: vi.fn(),
}));
vi.mock('@/hooks/serverQueries.js', () => ({
  useServers: () => ({ data: servers.data, error: servers.error }),
  switchServer: servers.switchServer,
  addServer: servers.addServer,
  canAddServer: () => servers.canAdd,
}));
vi.mock('@/hooks/attentionQueries.js', () => ({
  useAttention: () => ({ data: undefined, error: null, isLoading: true, refetch: async () => {} }),
  useAttentionCounts: () => undefined,
}));

import { ConnectedUpdatePill, readyUpdate } from '@/app/shell/ConnectedUpdatePill.js';
import { ConnectedSidebar } from '@/app/shell/ConnectedSidebar.js';
import { ConnectedRail } from '@/app/shell/ConnectedRail.js';
import { ConnectedTitleStrip } from '@/app/shell/ConnectedTitleStrip.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';

const READY: DesktopUpdateState = { status: 'ready', currentVersion: '0.0.1', nextVersion: '0.0.2', downloadedVersion: '0.0.2' };

const SERVERS = [
  { id: 'embedded', label: 'This computer', url: 'http://127.0.0.1:3100', kind: 'embedded', active: true, status: 'connected' },
  { id: 'srv-1', label: 'build-box', url: 'http://10.0.4.12:3100', kind: 'remote', active: false, status: 'offline' },
  { id: 'srv-2', label: 'Studio', url: 'https://studio.example', kind: 'remote', active: false, status: 'unknown' },
];

beforeEach(() => {
  update.state = null;
  update.restart.mockReset().mockResolvedValue(undefined);
  servers.data = SERVERS;
  servers.error = null;
  servers.canAdd = false;
  servers.switchServer.mockReset();
  servers.addServer.mockReset();
});

describe('readyUpdate', () => {
  it('is the downloaded version while ready or installing, and nothing otherwise', () => {
    expect(readyUpdate(null)).toBeNull();
    expect(readyUpdate({ status: 'idle', currentVersion: '1' })).toBeNull();
    expect(readyUpdate({ status: 'checking', currentVersion: '1' })).toBeNull();
    expect(readyUpdate({ status: 'downloading', currentVersion: '1', nextVersion: '2', percent: 40 })).toBeNull();
    // A failed check after the download keeps the update installable (G-04 R7).
    expect(readyUpdate({ ...READY, error: 'net::ERR' })).toEqual({ version: '0.0.2', installing: false, error: 'net::ERR' });
    expect(readyUpdate({ ...READY, status: 'installing' })).toEqual({ version: '0.0.2', installing: true });
    expect(readyUpdate({ status: 'ready', currentVersion: '1' })).toBeNull();
  });
});

describe('ConnectedUpdatePill', () => {
  it('renders nothing without a ready update (web, idle, downloading)', () => {
    const { container, rerender } = renderWithProviders(<ConnectedUpdatePill placement="strip" />);
    expect(container.querySelector('button')).toBeNull();
    update.state = { status: 'downloading', currentVersion: '0.0.1', nextVersion: '0.0.2', percent: 90 };
    rerender(<ConnectedUpdatePill placement="strip" />);
    expect(screen.queryByRole('button', { name: 'Restart to update' })).toBeNull();
  });

  it('installs once on click, and ignores clicks while the install starts', async () => {
    update.state = READY;
    let resolve!: () => void;
    update.restart.mockImplementation(() => new Promise<undefined>((r) => (resolve = () => r(undefined))));
    renderWithProviders(<ConnectedUpdatePill placement="strip" />);
    const pill = screen.getByTestId('titlebar-update-pill');
    expect(pill).toHaveAccessibleName('Restart to update');
    fireEvent.click(pill);
    fireEvent.click(pill);
    expect(update.restart).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pill).toHaveAttribute('aria-busy', 'true'));
    await act(async () => resolve());
    await waitFor(() => expect(pill).not.toHaveAttribute('aria-busy'));
  });

  it('while installing (committed) it stays busy and does nothing', () => {
    update.state = { ...READY, status: 'installing' };
    renderWithProviders(<ConnectedUpdatePill placement="footer" />);
    const pill = screen.getByTestId('sidebar-update-pill');
    expect(pill).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(pill);
    expect(update.restart).not.toHaveBeenCalled();
  });

  it('sits in each layout slot: strip → title strip only; mac/native → sidebar footer and rail', () => {
    update.state = READY;
    const strip = renderWithProviders(
      <>
        <ConnectedTitleStrip />
        <ConnectedSidebar layout="strip" />
        <ConnectedRail layout="strip" />
      </>,
    );
    expect(screen.getByTestId('titlebar-update-pill')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-update-pill')).toBeNull();
    expect(screen.queryByTestId('rail-update')).toBeNull();
    // Before the server chip, as the board draws it.
    const end = screen.getByTestId('titlebar-update-pill').compareDocumentPosition(screen.getByTestId('titlebar-server'));
    expect(end & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    strip.unmount();

    renderWithProviders(
      <>
        <ConnectedSidebar layout="mac" />
        <ConnectedRail layout="native" />
      </>,
    );
    expect(within(screen.getByTestId('sidebar-connection')).getByTestId('sidebar-update-pill')).toBeTruthy();
    expect(screen.getByTestId('rail-update')).toHaveAccessibleName('Restart to update');
  });
});

describe('ServersMenu', () => {
  async function openFromSidebar() {
    renderWithProviders(<ConnectedSidebar layout="native" />);
    fireEvent.click(screen.getByTestId('sidebar-server-switcher'));
    return screen.findByTestId('servers-menu');
  }

  it('lists the real servers with address and status, the active one checked', async () => {
    const menu = await openFromSidebar();
    expect(menu.closest('[data-gai-overlay="menu"]')).not.toBeNull();
    const rows = within(menu).getAllByTestId('servers-menu-server');
    expect(rows.map((r) => r.textContent)).toEqual([
      'This computerlocal:3100Connected',
      'build-box10.0.4.12:3100Offline',
      // A web page cannot probe another origin: no status rather than an invented one.
      'Studiostudio.example',
    ]);
    expect(rows[0]).toHaveAttribute('aria-checked', 'true');
    expect(rows[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('switches to another server, and does nothing for the active one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConnectedSidebar layout="native" />);
    await user.click(screen.getByTestId('sidebar-server-switcher'));
    let menu = await screen.findByTestId('servers-menu');
    await user.click(within(menu).getAllByTestId('servers-menu-server')[0]!);
    expect(servers.switchServer).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('sidebar-server-switcher'));
    menu = await screen.findByTestId('servers-menu');
    await user.click(within(menu).getAllByTestId('servers-menu-server')[1]!);
    expect(servers.switchServer).toHaveBeenCalledWith('srv-1');
  });

  it('"Add server…" only where the shell can add one; "Manage servers" opens Security & devices', async () => {
    const openSettings = vi.spyOn(useSettingsUiStore.getState(), 'openSettings').mockImplementation(() => undefined);
    let menu = await openFromSidebar();
    expect(within(menu).queryByTestId('servers-menu-add')).toBeNull();
    fireEvent.click(within(menu).getByTestId('servers-menu-manage'));
    expect(openSettings).toHaveBeenCalledWith('security');
    openSettings.mockRestore();
  });

  it('desktop: Add server… runs the shell prompt', async () => {
    servers.canAdd = true;
    const menu = await openFromSidebar();
    fireEvent.click(within(menu).getByTestId('servers-menu-add'));
    expect(servers.addServer).toHaveBeenCalledTimes(1);
  });

  it('says so while the list loads or fails, never an empty invented list', async () => {
    servers.data = undefined;
    let menu = await openFromSidebar();
    expect(within(menu).getByText('Loading servers…')).toBeTruthy();
  });

  it('opens from the title-strip chip and from the rail mark too', async () => {
    renderWithProviders(
      <>
        <ConnectedTitleStrip />
        <ConnectedRail layout="native" />
      </>,
    );
    fireEvent.click(screen.getByTestId('titlebar-server'));
    expect(await screen.findByTestId('servers-menu')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('servers-menu')).toBeNull());
    fireEvent.click(screen.getByTestId('rail-server'));
    expect(await screen.findByTestId('servers-menu')).toBeTruthy();
  });

  it('opens from the keyboard (ArrowDown on the focused trigger)', async () => {
    renderWithProviders(<ConnectedSidebar layout="native" />);
    const trigger = screen.getByTestId('sidebar-server-switcher');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByTestId('servers-menu')).toBeTruthy();
  });
});
