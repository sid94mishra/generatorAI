import { describe, expect, it } from 'vitest';
import type { StreamBlock } from '@generatorai/client-core';
import { outputTail, stepDetailView, stepExitCode, stepInput, stepOutput } from './stepDetailModel';

type ToolCall = Extract<StreamBlock, { type: 'tool_call' }>;
const call = (callId: string, tool: string, args: unknown, result?: unknown, error = false): ToolCall =>
  ({ type: 'tool_call', blockId: Number(callId.replace(/\D/g, '')) || 1, callId, tool, args, result, status: 'complete', error }) as ToolCall;

describe('StepDetail model (MB-14)', () => {
  it('reads the command, the output and the exit code', () => {
    const c = call('c1', 'Bash', { command: 'pnpm test' }, { stdout: 'ok', exitCode: 1 });
    expect(stepInput(c)).toBe('pnpm test');
    expect(stepOutput(c)).toBe('ok');
    expect(stepExitCode(c)).toBe(1);
    expect(stepOutput(call('c2', 'Read', { path: 'a' }, 'text'))).toBe('text');
  });

  it('tails long output', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    expect(outputTail(text, 10)).toMatchObject({ shown: 10, total: 50 });
    expect(outputTail('a\nb').total).toBe(2);
  });

  it('places the step among the chat’s steps with its neighbours', () => {
    const calls = [call('c1', 'Read', { file_path: 'a.ts' }), call('c2', 'Bash', { command: 'ls' }), call('c3', 'Edit', { file_path: 'b.ts' })];
    const view = stepDetailView(calls, 'c2', false)!;
    expect(view).toMatchObject({ index: 1, total: 3, noun: 'Command', shell: true });
    expect(view.previous?.callId).toBe('c1');
    expect(view.next?.callId).toBe('c3');
    expect(stepDetailView(calls, 'missing', false)).toBeNull();
  });
});
