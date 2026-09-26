// Final review PLATFORM R2 / LOOP R11: a check's `secretref:` env value is
// resolved through the namespace-restricted vault reader, never passed on
// verbatim, and its value is masked in the output tails.

import { describe, expect, it } from 'vitest';
import { MemorySecretStore, setSecretString } from '@generatorai/secrets';
import { CheckStageSchema, type CheckStage } from '@generatorai/workflow-spec';
import type { IScriptRunner, ScriptRunOptions } from '../../src/domain/ports/IScriptRunner.js';
import { McpCredentialVault } from '../../src/mcp/McpCredentialVault.js';
import { runCheck } from '../../src/services/engine/CheckRunner.js';

function echoRunner(seen: ScriptRunOptions[]): IScriptRunner {
  return {
    run: async (_cmd, _args, options) => {
      seen.push(options);
      return { exitCode: 0, stdout: `token=${options.env?.['TOKEN']} target=${options.env?.['TARGET']}`, stderr: '', durationMs: 1 };
    },
    isAvailable: async () => true,
  };
}

async function check(env: Record<string, string>, seen: ScriptRunOptions[]) {
  const secrets = new MemorySecretStore();
  await setSecretString(secrets, 'workflow', 'deploy-token', 'wf-secret-value');
  await setSecretString(secrets, 'provider', 'openai', 'sk-provider-value');
  const stage = CheckStageSchema.parse({ kind: 'check', key: 'c', name: 'c', check: { command: 'node', args: ['check.js'], env } }) as CheckStage;
  return runCheck({
    stage,
    run: { permissionMode: 'acceptEdits', systemVars: {} } as never,
    primaryDir: process.cwd(),
    scope: { variables: { target: 'prod' } },
    scriptRunner: echoRunner(seen),
    secrets: new McpCredentialVault(secrets),
    signal: new AbortController().signal,
  });
}

describe('check env secrets', () => {
  it('resolves secretref:workflow/<name>, renders templates, and masks the value in the tails', async () => {
    const seen: ScriptRunOptions[] = [];
    const outcome = await check({ TOKEN: 'secretref:workflow/deploy-token', TARGET: '{{variables.target}}' }, seen);
    expect(seen[0]?.env?.['TOKEN']).toBe('wf-secret-value');
    expect(seen[0]?.env?.['TARGET']).toBe('prod');
    expect(outcome.kind).toBe('succeeded');
    const data = (outcome as { output: { data: { stdoutTail: string } } }).output.data;
    expect(data.stdoutTail).toBe('token=•••• target=prod');
  });

  it('fails to launch on a pointer outside the workflow namespace or a failed render; nothing runs', async () => {
    const seen: ScriptRunOptions[] = [];
    for (const env of [{ TOKEN: 'secretref:provider/openai' }, { TOKEN: 'secretref:workflow/missing' }, { TARGET: '{{nope(}}' }]) {
      const outcome = await check(env, seen);
      expect(outcome.kind).toBe('failed');
      expect((outcome as { error: { code: string } }).error.code).toBe('check_launch_failed');
    }
    expect(seen).toEqual([]);
  });
});
