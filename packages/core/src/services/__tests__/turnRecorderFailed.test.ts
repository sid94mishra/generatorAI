import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@generatorai/shared';
import { TurnRecorder } from '../session/TurnRecorder.js';

const ev = (kind: string, data: Record<string, unknown>) => ({ kind, data }) as unknown as AgentEvent;

describe('TurnRecorder — a failed turn', () => {
  it('is recorded with what it streamed and its error, not dropped and not "stopped"', () => {
    const r = new TurnRecorder();
    r.begin({ turnId: 't1' });
    r.observe(ev('harness.token', { text: 'Running the build…' }));
    r.observe(ev('harness.error', { message: 'pnpm typecheck exited 2' }));
    const turn = r.take();
    expect(turn?.content).toBe('Running the build…');
    expect(turn?.metadata.systemMessages).toEqual(['Error: pnpm typecheck exited 2']);
    expect(turn?.metadata.partial).toBeUndefined();
    expect(turn?.complete).toBe(true);
  });

  it('a completed turn without text is still not recorded', () => {
    const r = new TurnRecorder();
    r.begin({ turnId: 't2' });
    expect(r.take()).toBeUndefined();
  });
});
