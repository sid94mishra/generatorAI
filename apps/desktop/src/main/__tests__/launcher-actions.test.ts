// OS launcher shortcuts from the registry (06 §8, P3-06): the macOS Dock menu
// runs LAUNCHER_ACTIONS in-process (commands through the held sendCommand),
// the Windows JumpList relaunches the exe with each action's deep link — the
// same links `resolveDeepLink` accepts — and Linux ships them as .desktop
// actions (build-config.test.mjs checks that side).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LAUNCHER_ACTIONS, launcherActionLink } from '@generatorai/shared/ui-contract';

const state = vi.hoisted(() => ({
  mac: false,
  win: false,
  dockMenu: null as unknown,
  userTasks: null as unknown,
  sendCommand: vi.fn(),
  navigateTo: vi.fn(),
  restoreFromTray: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    get dock() {
      return state.mac ? { setMenu: (m: unknown) => (state.dockMenu = m) } : undefined;
    },
    setUserTasks: (t: unknown) => (state.userTasks = t),
  },
  Menu: { buildFromTemplate: (t: unknown) => ({ template: t }) },
}));
vi.mock('../platform', () => ({
  get isMac() {
    return state.mac;
  },
  get isWindows() {
    return state.win;
  },
}));
vi.mock('../window-manager', () => ({
  getWindowManager: () => ({
    sendCommand: state.sendCommand,
    navigateTo: state.navigateTo,
    restoreFromTray: state.restoreFromTray,
  }),
}));

import { dockMenuTemplate, jumpListTasks, registerLauncherActions } from '../launcher-actions';
import { resolveDeepLink } from '../deep-link-route';

type Item = { label?: string; type?: string; click?: () => void };

beforeEach(() => {
  state.mac = false;
  state.win = false;
  state.dockMenu = null;
  state.userTasks = null;
  state.sendCommand.mockReset();
  state.navigateTo.mockReset();
  state.restoreFromTray.mockReset();
});

describe('macOS Dock menu', () => {
  it('New Chat · New Workflow · — · Home, in registry order and title case', () => {
    const items = dockMenuTemplate() as Item[];
    expect(items.map((i) => i.label ?? `--${i.type}`)).toEqual(['New Chat', 'New Workflow', '--separator', 'Home']);
  });

  it('commands go through sendCommand (was a plain /chats navigation), after bringing a window back', () => {
    const items = dockMenuTemplate() as Item[];
    items[0]!.click?.();
    expect(state.restoreFromTray).toHaveBeenCalledTimes(1);
    expect(state.sendCommand).toHaveBeenCalledWith('chat.new');
    items[1]!.click?.();
    expect(state.sendCommand).toHaveBeenLastCalledWith('workflow.new');
    items[3]!.click?.();
    expect(state.navigateTo).toHaveBeenCalledWith('/');
  });

  it('is installed only where the Dock exists', () => {
    registerLauncherActions();
    expect(state.dockMenu).toBeNull();
    state.mac = true;
    registerLauncherActions();
    expect((state.dockMenu as { template: Item[] }).template.map((i) => i.label)).toContain('New Chat');
    expect(state.userTasks).toBeNull();
  });
});

describe('Windows JumpList', () => {
  it('one task per launcher action, each relaunching the exe with the action deep link', () => {
    const tasks = jumpListTasks('C:\\Program Files\\GeneratorAI\\GeneratorAI.exe');
    expect(tasks.map((t) => [t.title, t.arguments])).toEqual([
      ['New Chat', 'generatorai://command/chat.new'],
      ['New Workflow', 'generatorai://command/workflow.new'],
      ['Home', 'generatorai://'],
    ]);
    for (const t of tasks) expect(t.program).toBe('C:\\Program Files\\GeneratorAI\\GeneratorAI.exe');
  });

  it('every task link is one the deep-link handler runs (no rejected commands)', () => {
    for (const a of LAUNCHER_ACTIONS) {
      const target = resolveDeepLink(launcherActionLink(a));
      expect(target?.kind, launcherActionLink(a)).toBe(a.kind === 'command' ? 'command' : 'route');
    }
  });

  it('development: Electron needs the app entry before the link', () => {
    const tasks = jumpListTasks('C:\\electron.exe', ['C:\\repo\\apps\\desktop']);
    expect(tasks[0]!.arguments).toBe('"C:\\repo\\apps\\desktop" generatorai://command/chat.new');
  });

  it('is installed only on Windows', () => {
    state.win = true;
    registerLauncherActions();
    expect((state.userTasks as unknown[]).length).toBe(LAUNCHER_ACTIONS.length);
    expect(state.dockMenu).toBeNull();
  });
});
