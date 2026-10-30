// One close-key rule for every overlay (see the header of overlays.tsx):
// Escape always closes; `q` closes only where nothing is typing. This table
// is the thing that keeps a new overlay from quietly picking a third option.

import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { CommandRegistry, DEFAULT_KEYMAP, detectTerminal, Keymap } from '@generatorai/cli-core';
import { ThemeProvider } from '@generatorai/tui-kit';
import { OverlayHost } from '../overlays.js';
import { createTuiStore, setStore, type OverlayKind } from '../store.js';

const capabilities = detectTerminal({
  stdout: { isTTY: true, columns: 100, rows: 30 },
  overrides: { isTTY: true, columns: 100, rows: 30, colorDepth: 'truecolor', unicode: true },
});

const ESC = '\x1b';
const tick = () => new Promise((r) => setTimeout(r, 30));

function mount(overlay: OverlayKind) {
  const store = createTuiStore();
  setStore(store);
  store.getState().showOverlay(overlay);
  const instance = render(
    <ThemeProvider capabilities={capabilities} theme="default">
      <OverlayHost
        registry={new CommandRegistry()}
        keymap={new Keymap({}, DEFAULT_KEYMAP)}
        implemented={new Set()}
        onRunCommand={() => undefined}
      />
    </ThemeProvider>,
  );
  return { store, ...instance, isOpen: () => store.getState().overlay.kind !== 'none' };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function pressAndCheck(overlay: OverlayKind, key: string): Promise<boolean> {
  const h = mount(overlay);
  cleanups.push(h.unmount);
  await tick();
  h.stdin.write(key);
  await tick();
  return h.isOpen();
}

const stageDetail: OverlayKind = {
  kind: 'stageDetail',
  runId: 'r1',
  paneId: 'p1',
  stages: [{ id: 's1', name: 'Build', status: 'completed' }],
  variables: {},
};
const validation: OverlayKind = {
  kind: 'validation',
  title: 'Validation',
  valid: false,
  issues: [{ severity: 'error', code: 'X', path: '/stages/0', message: 'broken' }],
  onNavigate: () => undefined,
};

describe('overlays without a text input', () => {
  const table: Array<[string, OverlayKind]> = [
    ['help', { kind: 'help' }],
    ['notifications', { kind: 'notifications' }],
    ['stageDetail', stageDetail],
    ['validation', validation],
  ];

  for (const [name, overlay] of table) {
    it(`${name}: Escape closes`, async () => {
      expect(await pressAndCheck(overlay, ESC)).toBe(false);
    });
    it(`${name}: q closes`, async () => {
      expect(await pressAndCheck(overlay, 'q')).toBe(false);
    });
  }
});

describe('overlays that type into a field', () => {
  it('palette: Escape closes, q is typed into the query', async () => {
    expect(await pressAndCheck({ kind: 'palette' }, ESC)).toBe(false);

    const h = mount({ kind: 'palette' });
    cleanups.push(h.unmount);
    await tick();
    h.stdin.write('q');
    await tick();
    expect(h.isOpen()).toBe(true);
    expect(h.lastFrame()).toContain('> q');
  });

  it('tab navigator: Escape closes, q is typed into the filter', async () => {
    expect(await pressAndCheck({ kind: 'tabs' }, ESC)).toBe(false);

    const h = mount({ kind: 'tabs' });
    cleanups.push(h.unmount);
    await tick();
    h.stdin.write('q');
    await tick();
    expect(h.isOpen()).toBe(true);
    expect(h.lastFrame()).toContain('> q');
  });

  it('input: Escape cancels, q is typed', async () => {
    const input: OverlayKind = { kind: 'input', message: 'Name?', initial: '', onSubmit: () => undefined };
    expect(await pressAndCheck(input, ESC)).toBe(false);

    const h = mount(input);
    cleanups.push(h.unmount);
    await tick();
    h.stdin.write('q');
    await tick();
    expect(h.isOpen()).toBe(true);
    expect(h.lastFrame()).toContain('q');
  });
});
