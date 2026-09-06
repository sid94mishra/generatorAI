// ────────────────────────────────────────────────────────────────
// Review finding 5.1 — the CLI half of the tool-permission gate.
//
// `respondToChatGate` (App.tsx) answers a chat-scoped HITL gate through the
// same `confirm`/`input` overlay pattern the plan-review branch already
// uses (y = allow, n = deny, then an optional-reason `input` overlay). This
// pins two things:
//
//   1. The overlay actually appears with the tool name/description, and
//      pressing 'y' answers it (mirrors `overlays.closeKeys.test.tsx`'s
//      mount pattern, which is the reference for driving an overlay from
//      real keystrokes rather than calling its callback directly).
//   2. The body posted to `api.chats.respondPermission` is exactly what the
//      confirm/input flow produces — via the pure `permissionResponseBody`
//      helper `respondToChatGate` itself calls, pulled out for testability
//      the same way `decideClosePane` was (see `App.decideClosePane.test.ts`).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { CommandRegistry, DEFAULT_KEYMAP, detectTerminal, Keymap } from '@generatorai/cli-core';
import { ThemeProvider } from '@generatorai/tui-kit';
import { OverlayHost } from '../overlays.js';
import { createTuiStore, setStore, type OverlayKind } from '../store.js';
import { permissionConfirmMessage, permissionResponseBody } from '../App.js';
import type { PendingChatInteraction } from '@generatorai/cli-core';

const capabilities = detectTerminal({
  stdout: { isTTY: true, columns: 100, rows: 30 },
  overrides: { isTTY: true, columns: 100, rows: 30, colorDepth: 'truecolor', unicode: true },
});

const tick = () => new Promise((r) => setTimeout(r, 30));

const pending: Extract<PendingChatInteraction, { kind: 'permission' }> = {
  kind: 'permission',
  interactionId: 'i1',
  toolName: 'Bash',
  permissionType: 'shell_exec',
  description: 'Run a shell command',
  inputSummary: 'rm -rf /tmp/scratch',
  permissionMode: 'default',
};

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
  return instance;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe('permissionConfirmMessage / permissionResponseBody (pure helpers)', () => {
  it('formats the tool name, description and redacted input summary for the confirm overlay', () => {
    expect(permissionConfirmMessage(pending)).toBe(
      'Bash — Run a shell command\n\nrm -rf /tmp/scratch',
    );
  });

  it('omits the input summary line when the server sent none', () => {
    expect(permissionConfirmMessage({ ...pending, inputSummary: '' })).toBe(
      'Bash — Run a shell command',
    );
  });

  it('allow posts {behavior:"allow"} with no message', () => {
    expect(permissionResponseBody('allow', '')).toEqual({ behavior: 'allow' });
  });

  it('deny with a blank/whitespace-only reason posts no message — same "Enter to skip" rule as plan-reject', () => {
    expect(permissionResponseBody('deny', '   ')).toEqual({ behavior: 'deny' });
  });

  it('deny with a reason posts the trimmed message', () => {
    expect(permissionResponseBody('deny', '  looks unsafe  ')).toEqual({
      behavior: 'deny',
      message: 'looks unsafe',
    });
  });
});

describe('the permission overlay appears and answers on keypress', () => {
  it('renders the tool name and description, and "y" allows', async () => {
    const onAnswer = vi.fn();
    const h = mount({
      kind: 'confirm',
      message: permissionConfirmMessage(pending),
      danger: false,
      onAnswer,
    });
    cleanups.push(h.unmount);
    await tick();

    const frame = h.lastFrame() ?? '';
    expect(frame).toContain('Bash');
    expect(frame).toContain('Run a shell command');

    h.stdin.write('y');
    await tick();

    expect(onAnswer).toHaveBeenCalledWith(true);
    // What `respondToChatGate` does with that answer — posts allow, no
    // deny-reason overlay.
    expect(permissionResponseBody('allow', '')).toEqual({ behavior: 'allow' });
  });

  it('"n" denies, and the reason typed into the follow-up input overlay reaches the posted body', async () => {
    const onAnswer = vi.fn();
    const h = mount({
      kind: 'confirm',
      message: permissionConfirmMessage(pending),
      danger: false,
      onAnswer,
    });
    cleanups.push(h.unmount);
    await tick();

    h.stdin.write('n');
    await tick();
    expect(onAnswer).toHaveBeenCalledWith(false);

    // `respondToChatGate`'s deny branch opens exactly this overlay next —
    // reproduce it here to drive the real `input` keystroke path rather
    // than asserting on the callback alone.
    const onSubmit = vi.fn();
    const h2 = mount({
      kind: 'input',
      message: 'Why deny? (optional, Enter to skip)',
      initial: '',
      onSubmit,
    });
    cleanups.push(h2.unmount);
    await tick();

    h2.stdin.write('looks unsafe');
    await tick();
    h2.stdin.write('\r');
    await tick();

    expect(onSubmit).toHaveBeenCalledWith('looks unsafe');
    expect(permissionResponseBody('deny', onSubmit.mock.calls[0]![0] as string)).toEqual({
      behavior: 'deny',
      message: 'looks unsafe',
    });
  });

  it('skipping the reason (bare Enter) posts deny with no message', async () => {
    const onSubmit = vi.fn();
    const h = mount({
      kind: 'input',
      message: 'Why deny? (optional, Enter to skip)',
      initial: '',
      onSubmit,
    });
    cleanups.push(h.unmount);
    await tick();

    h.stdin.write('\r');
    await tick();

    expect(onSubmit).toHaveBeenCalledWith('');
    expect(permissionResponseBody('deny', '')).toEqual({ behavior: 'deny' });
  });
});
