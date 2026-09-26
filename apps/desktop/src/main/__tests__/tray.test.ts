// tray.ts labels (G-05; P1-review P2-R23, P2-R25): the status line, the
// "· N agents" suffix, the Home needs-you count and the tooltip, in embedded
// and remote mode, with and without live attention counts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionCounts } from '@generatorai/shared';

type Item = { label?: string; enabled?: boolean; type?: string; click?: () => void };

const state = vi.hoisted(() => ({
  template: [] as Item[],
  tooltip: '',
  attention: null as AttentionCounts | null,
  status: { state: 'ready', port: 3100 as number | null },
  servers: {
    serverMode: 'embedded' as 'embedded' | 'remote',
    connections: [{ id: 'srv-1', label: 'Studio', url: 'https://studio.example:3100' }],
    activeConnectionId: null as string | null,
  },
}));

vi.mock('electron', () => {
  class Tray {
    setToolTip(t: string) {
      state.tooltip = t;
    }
    setContextMenu() {}
    on() {}
    destroy() {}
  }
  return {
    app: { quit: vi.fn() },
    Tray,
    Menu: {
      buildFromTemplate: (t: Item[]) => {
        state.template = t;
        return {};
      },
    },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize: () => ({ setTemplateImage() {} }) }) },
  };
});
const wmSetQuitting = vi.hoisted(() => vi.fn());
vi.mock('../window-manager', () => ({
  getWindowManager: () => ({ restoreFromTray: vi.fn(), sendCommand: vi.fn(), navigateTo: vi.fn(), setQuitting: wmSetQuitting }),
}));
vi.mock('../server-manager', () => ({
  getServerManager: () => ({ getStatus: () => state.status, on: vi.fn(), restart: vi.fn(async () => undefined) }),
}));
vi.mock('../logger', () => ({ log: { warn: vi.fn() } }));
vi.mock('../menu', () => ({ accel: () => undefined }));
vi.mock('../platform', () => ({ isMac: false }));
vi.mock('../attention-state', () => ({ getAttention: () => state.attention }));
vi.mock('../backend-switcher', () => ({ connectionState: () => state.servers }));

import { app } from 'electron';
import { createTray, destroyTray, refreshTrayMenu, trayStatusLines } from '../tray';

function counts(needsYou: number, runningChats: number): AttentionCounts {
  return {
    needsYou,
    running: runningChats + 2,
    byEntity: {
      chat: { needsYou, running: runningChats },
      workflow_run: { needsYou: 0, running: 2 },
      automation_execution: { needsYou: 0, running: 0 },
    },
  };
}

function labels(): string[] {
  return state.template.map((i) => i.label ?? `--${i.type ?? ''}`);
}

beforeEach(() => {
  destroyTray();
  state.attention = null;
  state.status = { state: 'ready', port: 3100 };
  state.servers.serverMode = 'embedded';
  state.servers.activeConnectionId = null;
});

describe('trayStatusLines', () => {
  it('embedded, no counts yet: server state and port only', () => {
    expect(trayStatusLines({ embedded: { state: 'ready', port: 3100 }, remoteLabel: null, attention: null })).toEqual([
      'Server: ready (:3100)',
    ]);
  });

  it('embedded with counts: running chats as agents, singular and plural', () => {
    expect(trayStatusLines({ embedded: { state: 'ready', port: 3100 }, remoteLabel: null, attention: counts(0, 3) })).toEqual([
      'Server: ready · 3 agents (:3100)',
    ]);
    expect(trayStatusLines({ embedded: { state: 'ready', port: 3100 }, remoteLabel: null, attention: counts(0, 1) })).toEqual([
      'Server: ready · 1 agent (:3100)',
    ]);
  });

  it('remote: the counts go with the remote server, the embedded server keeps its own line', () => {
    expect(trayStatusLines({ embedded: { state: 'ready', port: 3100 }, remoteLabel: 'Studio', attention: counts(0, 3) })).toEqual([
      'Studio · 3 agents',
      'This computer: ready (:3100)',
    ]);
  });

  it('no port while the embedded server is down', () => {
    expect(trayStatusLines({ embedded: { state: 'stopped', port: null }, remoteLabel: null, attention: null })).toEqual([
      'Server: stopped',
    ]);
  });
});

describe('refreshTrayMenu', () => {
  it('without counts: plain Home, plain tooltip', () => {
    createTray();
    expect(labels()[0]).toBe('Server: ready (:3100)');
    expect(labels()).toContain('Home');
    expect(state.tooltip).toBe('GeneratorAI');
  });

  it('with counts: agents suffix, Home (needsYou) and a needs-you tooltip', () => {
    createTray();
    state.attention = counts(2, 3);
    refreshTrayMenu();
    expect(labels()[0]).toBe('Server: ready · 3 agents (:3100)');
    expect(labels()).toContain('Home (2)');
    expect(labels()).toContain('Workflows');
    expect(state.tooltip).toBe('GeneratorAI — 2 need you');
    state.attention = counts(1, 0);
    refreshTrayMenu();
    expect(state.tooltip).toBe('GeneratorAI — 1 needs you');
  });

  it('remote mode shows two disabled status lines', () => {
    createTray();
    state.servers.serverMode = 'remote';
    state.servers.activeConnectionId = 'srv-1';
    state.attention = counts(0, 1);
    refreshTrayMenu();
    expect(state.template.slice(0, 2)).toEqual([
      { label: 'Studio · 1 agent', enabled: false },
      { label: 'This computer: ready (:3100)', enabled: false },
    ]);
  });

  it('cleared counts (attention-state after a renderer reset) drop the count text', () => {
    createTray();
    state.attention = counts(2, 3);
    refreshTrayMenu();
    state.attention = null;
    refreshTrayMenu();
    expect(labels()[0]).toBe('Server: ready (:3100)');
    expect(labels()).not.toContain('Home (2)');
    expect(state.tooltip).toBe('GeneratorAI');
  });
});

describe('Quit (P2-R38)', () => {
  it('only asks the app to quit; the quitting flag is left to quitApp', () => {
    createTray();
    const quit = state.template.find((i) => i.label === 'Quit GeneratorAI');
    quit?.click?.();
    expect(app.quit).toHaveBeenCalled();
    expect(wmSetQuitting).not.toHaveBeenCalled();
  });
});
