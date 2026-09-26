// The native menu and tray are driven by the shared command registry (D-24,
// 06-desktop-and-shell.md §5.3): section labels/order from NAV_DESTINATIONS,
// every accelerator from COMMANDS for this platform, and renderer commands
// sent by registry id. Exercised on a fake Electron for both macOS and
// Windows/Linux accelerator columns.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, NAV_DESTINATIONS, type CommandId } from '@generatorai/shared/ui-contract';

interface Item {
  label?: string;
  role?: string;
  type?: string;
  accelerator?: string;
  enabled?: boolean;
  click?: () => void;
  submenu?: Item[];
}

const state = vi.hoisted(() => ({
  mac: false,
  template: [] as unknown[],
  trayTemplate: [] as unknown[],
  sendCommand: vi.fn(),
  navigateTo: vi.fn(),
  sendAppearanceRequest: vi.fn(),
  nativeTheme: { shouldUseDarkColors: true, themeSource: 'system' },
  restoreFromTray: vi.fn(),
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
}));

vi.mock('electron', () => {
  class Tray {
    setToolTip() {}
    on() {}
    setContextMenu() {}
    destroy() {}
  }
  return {
    app: { name: 'GeneratorAI', getPath: () => '/tmp', quit: vi.fn() },
    shell: { openPath: vi.fn() },
    nativeTheme: state.nativeTheme,
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => false, resize: () => ({ setTemplateImage() {} }) }),
    },
    Tray,
    Menu: {
      buildFromTemplate: (t: unknown[]) => {
        state.trayTemplate = t;
        return { items: t };
      },
      setApplicationMenu: (m: { items: unknown[] }) => {
        state.template = m.items;
      },
    },
  };
});

vi.mock('../platform', () => ({
  get isMac() {
    return state.mac;
  },
  mnemonic: (label: string) => label,
}));

vi.mock('../window-manager', () => ({
  getWindowManager: () => ({
    sendCommand: state.sendCommand,
    navigateTo: state.navigateTo,
    restoreFromTray: state.restoreFromTray,
    getMainWindow: () => null,
    reload: vi.fn(),
    toggleDevtools: vi.fn(),
    openExternalSafely: vi.fn(),
    setQuitting: vi.fn(),
    sendAppearanceRequest: state.sendAppearanceRequest,
  }),
}));

vi.mock('../server-manager', () => ({
  getServerManager: () => ({ restart: vi.fn(async () => undefined), url: null, getStatus: () => ({ state: 'running', port: 3100 }), on: vi.fn() }),
}));
vi.mock('../paths', () => ({ resolvePaths: () => ({ dataDir: '/tmp/data' }) }));
vi.mock('../config', () => ({ loadSettings: () => ({ appearance: { mode: 'system' } }) }));
vi.mock('../logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../backend-switcher', () => ({
  connectionState: () => ({ serverMode: 'embedded', connections: [], activeConnectionId: null }),
  forgetRemoteConnection: vi.fn(),
  promptForRemoteServer: vi.fn(),
  switchToEmbedded: vi.fn(),
  switchToRemote: vi.fn(),
}));

async function loadMenu(mac: boolean) {
  state.mac = mac;
  vi.resetModules();
  const menu = await import('../menu');
  menu.buildMenu({ showAbout: vi.fn(), checkForUpdates: state.checkForUpdates, installUpdate: state.installUpdate });
  return { menu, items: state.template as Item[] };
}

function find(items: Item[] | undefined, label: string): Item | undefined {
  for (const i of items ?? []) {
    if (i.label === label) return i;
    const hit = find(i.submenu, label);
    if (hit) return hit;
  }
  return undefined;
}

const column = (mac: boolean) => (mac ? 'desktopMac' : 'desktopWinLinux');
const expected = (id: CommandId, mac: boolean) => COMMANDS[id][column(mac)] ?? undefined;

beforeEach(() => {
  state.checkForUpdates.mockReset();
  state.installUpdate.mockReset();
  state.sendCommand.mockReset();
  state.navigateTo.mockReset();
  state.restoreFromTray.mockReset();
});

describe.each([true, false])('application menu (mac=%s)', (mac) => {
  it('View lists the NAV_DESTINATIONS in sidebar order with registry accelerators', async () => {
    const { items } = await loadMenu(mac);
    const view = find(items, 'View');
    const labels = (view?.submenu ?? []).map((i) => i.label);
    const start = labels.indexOf('Home');
    expect(labels.slice(start, start + NAV_DESTINATIONS.length)).toEqual(NAV_DESTINATIONS.map((d) => d.label));
    for (const d of NAV_DESTINATIONS) {
      const item = find(view?.submenu, d.label)!;
      expect(item.accelerator, d.label).toBe(expected(d.command, mac));
      item.click?.();
      expect(state.navigateTo).toHaveBeenLastCalledWith(d.path);
    }
    expect(find(view?.submenu, 'Dashboard')).toBeUndefined();
  });

  it.each([
    ['Command Palette…', 'palette.toggle'],
    ['New Chat', 'chat.new'],
    ['New Workflow', 'workflow.new'],
    ['Toggle Sidebar', 'sidebar.toggle'],
    ['Toggle Side Dock', 'dock.toggle'],
    ['Find…', 'find.open'],
    ['Find Next', 'find.next'],
    ['Find Previous', 'find.previous'],
    ['Keyboard Shortcuts', 'shortcuts.show'],
  ] as const)('%s sends %s with its registry accelerator', async (label, id) => {
    const { items } = await loadMenu(mac);
    const item = find(items, label)!;
    expect(item.accelerator).toBe(expected(id, mac));
    item.click?.();
    expect(state.sendCommand).toHaveBeenCalledWith(id);
  });

  it('Help ▸ Keyboard Shortcuts sends the (formerly dead) shortcuts command', async () => {
    const { items } = await loadMenu(mac);
    find(find(items, 'Help')?.submenu, 'Keyboard Shortcuts')!.click?.();
    expect(state.sendCommand).toHaveBeenCalledWith('shortcuts.show');
  });

  it('Reload Scripts sends scripts.reload without navigating', async () => {
    const { items } = await loadMenu(mac);
    find(items, 'Reload Scripts')!.click?.();
    expect(state.sendCommand).toHaveBeenCalledWith('scripts.reload');
    expect(state.navigateTo).not.toHaveBeenCalled();
  });

  it('Settings sends app.settings', async () => {
    const { items } = await loadMenu(mac);
    const settings = find(items, mac ? 'Settings…' : 'Settings')!;
    expect(settings.accelerator).toBe(expected('app.settings', mac));
    settings.click?.();
    expect(state.sendCommand).toHaveBeenCalledWith('app.settings');
  });

  it('main-side items take registry accelerators too', async () => {
    const { items } = await loadMenu(mac);
    expect(find(items, 'Back')?.accelerator).toBe(expected('nav.back', mac));
    expect(find(items, 'Forward')?.accelerator).toBe(expected('nav.forward', mac));
    expect(find(items, 'Reload')?.accelerator).toBe(expected('window.reload', mac));
    expect(find(items, 'Toggle Developer Tools')?.accelerator).toBe(expected('devtools.toggle', mac));
  });

  it('accel() never yields a Mod or a sequence', async () => {
    const { menu } = await loadMenu(mac);
    for (const d of NAV_DESTINATIONS) expect(menu.accel(d.command)).not.toMatch(/Mod| /);
    expect(menu.accel('project.new')).toBeUndefined();
  });
});

describe.each([true, false])('registry-driven labels and updates (mac=%s, P3-06)', (mac) => {
  it('File ▸ New lists every global create command, title-cased, each sending its id', async () => {
    const { items } = await loadMenu(mac);
    const file = find(items, 'File')!;
    const labels = (file.submenu ?? []).map((i) => i.label);
    expect(labels.slice(0, 5)).toEqual(['New Chat', 'New Workflow', 'New Project', 'New Automation', 'New Agent']);
    find(file.submenu, 'New Agent')!.click?.();
    expect(state.sendCommand).toHaveBeenCalledWith('agent.new');
  });

  it('Restart Server (Help ▸ Troubleshooting) is the server.restart command', async () => {
    const { items } = await loadMenu(mac);
    expect(find(find(items, 'Help')?.submenu, 'Restart Server')).toBeDefined();
  });

  it('"Check for Updates…" becomes "Restart to Update (v…)" while an update is ready, and back', async () => {
    const { menu } = await loadMenu(mac);
    const help = () => find(state.template as Item[], 'Help')!;
    expect(find(help().submenu, 'Check for Updates…')).toBeDefined();
    menu.setMenuUpdateReady('1.4.0');
    const install = find(help().submenu, 'Restart to Update (v1.4.0)')!;
    expect(install).toBeDefined();
    expect(find(help().submenu, 'Check for Updates…')).toBeUndefined();
    install.click?.();
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
    if (mac) expect(find(find(state.template as Item[], 'GeneratorAI')?.submenu, 'Restart to Update (v1.4.0)')).toBeDefined();
    menu.setMenuUpdateReady(null);
    find(help().submenu, 'Check for Updates…')!.click?.();
    expect(state.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe('View ▸ Appearance (D-25: the renderer is the only appearance writer)', () => {
  const radio = (label: string) =>
    find(state.template as Item[], 'Appearance')!.submenu!.find((i) => i.label === label) as Item & { checked?: boolean };

  it('asks the renderer and writes nothing itself', async () => {
    await loadMenu(false);
    radio('Light').click?.();
    expect(state.sendAppearanceRequest).toHaveBeenCalledWith('light');
    expect(state.nativeTheme.themeSource).toBe('system');
  });

  it('the radio follows the persisted mode and each renderer push', async () => {
    const { menu } = await loadMenu(false);
    menu.syncMenuThemeFromSettings();
    expect(radio('Follow System').checked).toBe(true);
    menu.updateMenuState({ mode: 'dark' });
    expect(radio('Dark').checked).toBe(true);
    expect(radio('Follow System').checked).toBe(false);
  });
});

describe('tray', () => {
  it('Go to lists the tray destinations; New chat restores and sends chat.new', async () => {
    state.mac = false;
    vi.resetModules();
    const tray = await import('../tray');
    tray.createTray();
    const items = state.trayTemplate as Item[];
    const labels = items.map((i) => i.label);
    const goTo = labels.indexOf('Go to');
    expect(goTo).toBeGreaterThan(-1);
    const tail = labels.slice(goTo + 1, goTo + 1 + NAV_DESTINATIONS.filter((d) => d.tray).length);
    expect(tail).toEqual(NAV_DESTINATIONS.filter((d) => d.tray).map((d) => d.label));
    expect(labels).not.toContain('Dashboard');

    find(items, 'Agents')!.click?.();
    expect(state.navigateTo).toHaveBeenCalledWith('/agents');

    const newChat = find(items, 'New chat')!;
    expect(newChat.accelerator).toBe(COMMANDS['chat.new'].desktopWinLinux);
    newChat.click?.();
    expect(state.restoreFromTray).toHaveBeenCalled();
    expect(state.sendCommand).toHaveBeenCalledWith('chat.new');
    tray.destroyTray();
  });
});
