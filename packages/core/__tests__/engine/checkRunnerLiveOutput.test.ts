// A running check's output reaches the run page while it prints (D-173): whole
// lines, redacted, ANSI stripped, batched in order with the last lines sent
// before the outcome.

import { describe, expect, it, vi } from 'vitest';
import { MemorySecretStore, setSecretString } from '@generatorai/secrets';
import { CheckStageSchema, type CheckStage } from '@generatorai/workflow-spec';
import type { IScriptRunner } from '../../src/domain/ports/IScriptRunner.js';
import { McpCredentialVault } from '../../src/mcp/McpCredentialVault.js';
import { outputBatches, runCheck } from '../../src/services/engine/CheckRunner.js';

/** Prints `chunks` through `streamTo` as a process would, split anywhere. */
function chunkRunner(chunks: string[]): IScriptRunner {
  return {
    run: async (_cmd, _args, options) => {
      for (const c of chunks) options.streamTo?.(c, 'stdout');
      return { exitCode: 0, stdout: chunks.join(''), stderr: '', durationMs: 1 };
    },
    isAvailable: async () => true,
  };
}

describe('check live output', () => {
  it('hands on whole lines, masks a secret split across chunks and strips ANSI', async () => {
    const secrets = new MemorySecretStore();
    await setSecretString(secrets, 'workflow', 'deploy-token', 'wf-secret-value');
    const stage = CheckStageSchema.parse({
      kind: 'check',
      key: 'c',
      name: 'c',
      check: { command: 'node', args: ['check.js'], env: { TOKEN: 'secretref:workflow/deploy-token' } },
    }) as CheckStage;
    const seen: string[] = [];
    await runCheck({
      stage,
      run: { permissionMode: 'acceptEdits', systemVars: {} } as never,
      primaryDir: process.cwd(),
      scope: {},
      scriptRunner: chunkRunner(['\u001b[32mProgress\u001b[0m: 1\ntoken=wf-sec', 'ret-value ok\nDo', 'ne']),
      secrets: new McpCredentialVault(secrets),
      onOutput: (text) => seen.push(text),
      signal: new AbortController().signal,
    });
    expect(seen).toEqual(['Progress: 1\n', 'token=•••• ok\n', 'Done']);
  });
});

describe('outputBatches', () => {
  it('sends at most one batch per window, in order, and end flushes the rest before resolving', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const batches = outputBatches(async (text) => {
      sent.push(text);
    }, 300);
    batches.push('a\n');
    batches.push('b\n');
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toEqual(['a\nb\n']);
    batches.push('c\n');
    await batches.end();
    expect(sent).toEqual(['a\nb\n', 'c\n']);
    vi.useRealTimers();
  });
});
