import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCommandRunner, runCommand } from '@/lib/commandRunner.js';

describe('commandRunner', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('runs a command through the registered host', () => {
    const run = vi.fn();
    cleanup = registerCommandRunner(run);
    runCommand('theme.toggle');
    expect(run).toHaveBeenCalledWith('theme.toggle');
  });

  it('throws when no host is mounted, and a stale cleanup never removes a newer host', () => {
    const first = vi.fn();
    const second = vi.fn();
    const removeFirst = registerCommandRunner(first);
    cleanup = registerCommandRunner(second);
    removeFirst();
    runCommand('nav.chats');
    expect(second).toHaveBeenCalledWith('nav.chats');
    expect(first).not.toHaveBeenCalled();
    cleanup();
    cleanup = null;
    expect(() => runCommand('nav.chats')).toThrow(/No command host/);
  });
});
