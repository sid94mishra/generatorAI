// menu.ts rebuild rules (P1-review P2-R16, P2-R23): a renderer push that
// changes nothing the menu shows does not rebuild it (a rebuild can close an
// open menu on macOS), and View ▸ Appearance with no window puts the radio
// back on the mode actually in effect.

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Item {
  label?: string;
  type?: string;
  checked?: boolean;
  click?: () => void;
  submenu?: Item[];
}

const state = vi.hoisted(() => ({
  builds: 0,
  template: [] as Item[],
  canGoBack: false,
  sendAppearanceRequest: vi.fn(() => false),
}));

vi.mock('electron', () => ({
  app: { name: 'GeneratorAI', getPath: () => '/tmp' },
  shell: { openPath: vi.fn() },
  Menu: {
    buildFromTemplate: (t: Item[]) => ({ items: t }),
    setApplicationMenu: (m: { items: Item[] }) => {
      state.builds += 1;
      state.template = m.items;
    },
  },
}));
vi.mock('../platform', () => ({ isMac: false, mnemonic: (label: string) => label }));
vi.mock('../window-manager', () => ({
  getWindowManager: () => ({
    getMainWindow: () => ({
      webContents: {
        navigationHistory: { canGoBack: () => state.canGoBack, canGoForward: () => false },
      },
    }),
    sendAppearanceRequest: state.sendAppearanceRequest,
    sendCommand: vi.fn(),
  }),
}));
vi.mock('../server-manager', () => ({ getServerManager: () => ({ url: null }) }));
vi.mock('../paths', () => ({ resolvePaths: () => ({ dataDir: '/tmp/data' }) }));
vi.mock('../config', () => ({ loadSettings: () => ({ appearance: { mode: 'dark' } }) }));
vi.mock('../logger', () => ({ log: { error: vi.fn() } }));
vi.mock('../backend-switcher', () => ({
  connectionState: () => ({ serverMode: 'embedded', connections: [], activeConnectionId: null }),
  forgetRemoteConnection: vi.fn(),
  promptForRemoteServer: vi.fn(),
  switchToEmbedded: vi.fn(),
  switchToRemote: vi.fn(),
}));

async function loadMenu() {
  vi.resetModules();
  const menu = await import('../menu');
  menu.buildMenu({ showAbout: vi.fn(), checkForUpdates: vi.fn() });
  return menu;
}

function find(items: Item[] | undefined, label: string): Item | undefined {
  for (const i of items ?? []) {
    if (i.label === label) return i;
    const hit = find(i.submenu, label);
    if (hit) return hit;
  }
  return undefined;
}

beforeEach(() => {
  state.builds = 0;
  state.canGoBack = false;
  state.sendAppearanceRequest.mockReset().mockReturnValue(false);
});

describe('applyMenuPush', () => {
  it('does not rebuild when the push changes nothing the menu shows', async () => {
    const menu = await loadMenu();
    const before = state.builds;
    menu.applyMenuPush({ sidebarOpen: true, rightPaneOpen: false, recent: [] });
    expect(state.builds).toBe(before);
  });

  it('rebuilds when a shown value changes', async () => {
    const menu = await loadMenu();
    const before = state.builds;
    menu.applyMenuPush({ sidebarOpen: false });
    expect(state.builds).toBe(before + 1);
    expect(find(state.template, 'Toggle Sidebar')?.checked).toBe(false);
  });

  it('rebuilds when Back/Forward availability changed since the last build', async () => {
    const menu = await loadMenu();
    const before = state.builds;
    state.canGoBack = true;
    menu.applyMenuPush({ sidebarOpen: true });
    expect(state.builds).toBe(before + 1);
  });
});

describe('View ▸ Appearance with no window (R23)', () => {
  it('rebuilds so the radio stays on the mode in effect', async () => {
    const menu = await loadMenu();
    menu.syncMenuThemeFromSettings();
    const light = find(state.template, 'Appearance')!.submenu!.find((i) => i.label === 'Light')!;
    const before = state.builds;
    light.click!();
    expect(state.sendAppearanceRequest).toHaveBeenCalledWith('light');
    expect(state.builds).toBe(before + 1);
    const radios = find(state.template, 'Appearance')!.submenu!;
    expect(radios.find((i) => i.checked)?.label).toBe('Dark');
  });

  it('leaves the radio to the renderer push when a window took the request', async () => {
    const menu = await loadMenu();
    state.sendAppearanceRequest.mockReturnValue(true);
    const before = state.builds;
    find(state.template, 'Appearance')!.submenu!.find((i) => i.label === 'Light')!.click!();
    expect(state.builds).toBe(before);
    expect(menu).toBeTruthy();
  });
});
