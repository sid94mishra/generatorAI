// A command that needs a secret or the raw TTY cannot run inside the TUI.
// Before this, the palette dispatched it anyway and the user got a generic
// failure with no indication that the shell would have worked.

import { describe, expect, it, vi } from 'vitest';
import {
  CommandRegistry,
  defineCommand,
  shellOnlyHint,
  toPalette,
  type CliContext,
} from '@generatorai/cli-core';
import { createCommandRunner } from '../commandRunner.js';
import type { TuiActions } from '../store.js';

function registryWith(requires?: Array<'secret' | 'terminal'>): {
  registry: CommandRegistry;
  handler: ReturnType<typeof vi.fn>;
} {
  const handler = vi.fn(async () => ({ data: 'ran' }));
  const registry = new CommandRegistry();
  registry.register(
    defineCommand({
      id: 'demo.thing',
      group: 'demo',
      verb: 'thing',
      summary: 'A demo',
      requiresServer: false,
      sinceVersion: '0.0.0',
      args: [],
      flags: [],
      output: { kind: 'void' },
      ...(requires ? { requires } : {}),
      handler,
    }),
  );
  return { registry, handler };
}

function actionsSpy(): TuiActions & { toast: ReturnType<typeof vi.fn> } {
  return {
    toast: vi.fn(),
    showOverlay: vi.fn(),
  } as unknown as TuiActions & { toast: ReturnType<typeof vi.fn> };
}

describe('shellOnlyHint', () => {
  it('is the one sentence every surface shows, with the command when known', () => {
    expect(shellOnlyHint('terminal attach <ws>')).toBe(
      'Run `generatorai terminal attach <ws>` in your shell — needs a secret/terminal',
    );
    expect(shellOnlyHint()).toBe('Run `generatorai <cmd>` in your shell — needs a secret/terminal');
  });
});

describe('palette entries for shell-only commands', () => {
  it('carry the hint so the row can be drawn disabled', () => {
    const { registry } = registryWith(['secret']);
    const [entry] = toPalette(registry);
    expect(entry?.requires).toEqual(['secret']);
    expect(entry?.shellOnlyHint).toBe(
      'Run `generatorai demo thing` in your shell — needs a secret/terminal',
    );
  });

  it('carry nothing extra for an ordinary command', () => {
    const { registry } = registryWith();
    const [entry] = toPalette(registry);
    expect(entry?.requires).toEqual([]);
    expect(entry?.shellOnlyHint).toBeUndefined();
  });
});

describe('runFromPalette', () => {
  it('refuses a shell-only command with the hint instead of running it', async () => {
    const { registry, handler } = registryWith(['terminal']);
    const actions = actionsSpy();
    const runner = createCommandRunner({
      registry,
      makeContext: async () => ({}) as unknown as CliContext,
      actions,
    });

    const [entry] = toPalette(registry);
    await runner.runFromPalette(entry!);

    expect(handler).not.toHaveBeenCalled();
    expect(actions.toast).toHaveBeenCalledWith(
      'Run `generatorai demo thing` in your shell — needs a secret/terminal',
      'warning',
    );
  });

  it('still runs an ordinary command', async () => {
    const { registry, handler } = registryWith();
    const actions = actionsSpy();
    const runner = createCommandRunner({
      registry,
      makeContext: async () => ({ dispose: async () => {} }) as unknown as CliContext,
      actions,
    });

    const [entry] = toPalette(registry);
    await runner.runFromPalette(entry!);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
