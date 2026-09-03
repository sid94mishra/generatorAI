import { describe, expect, it } from 'vitest';
import { decideClosePane } from '../App.js';
import type { PaneContent } from '@generatorai/cli-core';

// Phase 4 item 6 — `pane.close` used to only ever remove local UI state,
// silently orphaning a terminal/browser pane's live server-side resource.
// Pulled out as a pure function so the decision itself is testable without
// mounting the TUI (which, for these two pane kinds, would otherwise need a
// live server to populate a real terminalId/browser session).
describe('decideClosePane', () => {
  it('closes outright for a pane with no live externally-killable resource (chat, run, list, ...)', () => {
    const chat: PaneContent = { kind: 'chat', title: 'Chat' };
    expect(decideClosePane(chat)).toEqual({ kind: 'closeOnly' });
    expect(decideClosePane(undefined)).toEqual({ kind: 'closeOnly' });
  });

  it('asks before terminating a terminal pane that has a live terminalId', () => {
    const terminal: PaneContent = {
      kind: 'terminal',
      title: 'terminal',
      entityId: 'ws_1',
      state: { terminalId: 'term_1' },
    };
    const decision = decideClosePane(terminal);
    expect(decision).toEqual({
      kind: 'confirmTerminate',
      message: expect.stringContaining('terminate this terminal session'),
      command: 'terminal.kill',
      args: { workspace: 'ws_1', terminal: 'term_1' },
    });
  });

  it('closes outright for a terminal pane with no terminal created yet (nothing to terminate)', () => {
    const terminal: PaneContent = { kind: 'terminal', title: 'terminal', entityId: 'ws_1' };
    expect(decideClosePane(terminal)).toEqual({ kind: 'closeOnly' });
  });

  it('asks before stopping a browser pane bound to a workspace', () => {
    const browser: PaneContent = { kind: 'browser', title: 'browser', entityId: 'ws_1' };
    const decision = decideClosePane(browser);
    expect(decision).toEqual({
      kind: 'confirmTerminate',
      message: expect.stringContaining('stop the browser session'),
      command: 'browser.stop',
      args: { workspace: 'ws_1' },
    });
  });

  it('closes outright for a browser pane with no workspace bound (should not happen in practice, but must not crash)', () => {
    const browser: PaneContent = { kind: 'browser', title: 'browser' };
    expect(decideClosePane(browser)).toEqual({ kind: 'closeOnly' });
  });
});
