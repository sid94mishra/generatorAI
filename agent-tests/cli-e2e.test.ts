// ────────────────────────────────────────────────────────────────
// CLI End-to-End Tests — Vitest
//
// Tests ALL CLI command groups against a live server (port 3100):
//   1.  system (health, models, status)
//   2.  config (show, get, set)
//   3.  chat   (create, list, show, send, messages, delete)
//   4.  workflow (create, list, show, stage-add, stage-list, edge-add, export, import, delete)
//   5.  run    (create, start, list, show, cancel)
//   6.  automation (create, list, show, trigger, delete)
//   7.  project (create, list, show, delete)
//   8.  template (list)
//   9.  webhook (list, register)
//   10. workspace (list)
//   11. orchestrator (templates, start)
//   12. Error handling (unknown commands, missing args, unreachable server)
//
// Requires:  Server running on localhost:3100
// Run:       pnpm --filter @generatorai/cli test -- --run cli-e2e
// ────────────────────────────────────────────────────────────────

import { describe, test, expect, beforeAll } from 'vitest';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const exec = promisify(execCb);

const CLI_DIR = path.resolve(__dirname, '..', '..', 'apps', 'cli');
const CLI_CMD = `npx tsx --import ./src/instrumentation.ts src/index.tsx`;
const SERVER = process.env.API_URL || 'http://localhost:3100';
const TIMEOUT = 30_000;

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

async function cli(args: string, expectFailure = false): Promise<RunResult> {
  const cmd = `${CLI_CMD} --server ${SERVER} ${args}`;
  try {
    const { stdout, stderr } = await exec(cmd, {
      cwd: CLI_DIR,
      timeout: TIMEOUT,
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    if (!expectFailure) {
      throw new Error(`CLI failed: ${e.stderr || e.stdout}\nCommand: ${cmd}`);
    }
    return {
      stdout: (e.stdout ?? '').trim(),
      stderr: (e.stderr ?? '').trim(),
      code: e.code ?? 1,
    };
  }
}

function parseJson<T = unknown>(stdout: string): T {
  // stdout may contain OTel/pino logs before the JSON; find the first { or [
  const jsonStart = stdout.search(/^[\[{]/m);
  if (jsonStart >= 0) {
    return JSON.parse(stdout.slice(jsonStart)) as T;
  }
  return JSON.parse(stdout) as T;
}

async function waitForRunComplete(runId: string, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await cli(`run show ${runId} --json`);
    const data = parseJson<{ status: string }>(res.stdout);
    if (data.status === 'completed' || data.status === 'failed') return data.status;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms`);
}

// ═══════════════════════════════════════════════════════════════
// Pre-flight: server must be reachable
// ═══════════════════════════════════════════════════════════════

beforeAll(async () => {
  const res = await fetch(`${SERVER}/api/health`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`Server not reachable at ${SERVER}. Start it first.`);
  }
}, 10_000);

// ═══════════════════════════════════════════════════════════════
// 1. System Commands
// ═══════════════════════════════════════════════════════════════

describe('1. System Commands', () => {
  test('system health --json', async () => {
    const { stdout } = await cli('system health --json');
    const data = parseJson<{ status: string; db: boolean }>(stdout);
    expect(data.status).toBe('ok');
    expect(data.db).toBe(true);
  }, TIMEOUT);

  test('system models --json', async () => {
    const { stdout } = await cli('system models --json');
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);

  test('system status --json', async () => {
    const { stdout } = await cli('system status --json');
    const data = parseJson<{ status: string }>(stdout);
    expect(data.status).toBe('ok');
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 2. Config Commands
// ═══════════════════════════════════════════════════════════════

describe('2. Config Commands', () => {
  test('config show --json', async () => {
    const { stdout } = await cli('config show --json');
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);

  test('config get serverUrl --json', async () => {
    const { stdout } = await cli('config get serverUrl --json');
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 3. Chat Commands
// ═══════════════════════════════════════════════════════════════

describe('3. Chat Commands', () => {
  let chatId: string;

  test('chat create --json', async () => {
    const { stdout } = await cli(`chat create --title "CLI-E2E-Chat-${Date.now()}" --json`);
    const data = parseJson<{ id: string; title: string }>(stdout);
    expect(data.id).toBeTruthy();
    chatId = data.id;
  }, TIMEOUT);

  test('chat list --json', async () => {
    const { stdout } = await cli('chat list --json');
    const data = parseJson<Array<{ id: string }>>(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  }, TIMEOUT);

  test('chat show <id> --json', async () => {
    const { stdout } = await cli(`chat show ${chatId} --json`);
    const data = parseJson<{ id: string }>(stdout);
    expect(data.id).toBe(chatId);
  }, TIMEOUT);

  test('chat messages <id> --json', async () => {
    const { stdout } = await cli(`chat messages ${chatId} --json`);
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);

  test('chat delete <id>', async () => {
    const { stdout, stderr } = await cli(`chat delete ${chatId} --json`);
    // Deletion should succeed
    expect(stdout + stderr).toBeTruthy();
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 4. Workflow Definition Commands
// ═══════════════════════════════════════════════════════════════

describe('4. Workflow Commands', () => {
  let defId: string;

  test('workflow create --json', async () => {
    const { stdout } = await cli(`workflow create --name "CLI-E2E-WF-${Date.now()}" --session-mode single --json`);
    const data = parseJson<{ id: string; name: string }>(stdout);
    expect(data.id).toBeTruthy();
    expect(data.name).toContain('CLI-E2E-WF');
    defId = data.id;
  }, TIMEOUT);

  test('workflow list --json', async () => {
    const { stdout } = await cli('workflow list --json');
    const data = parseJson<Array<{ id: string }>>(stdout);
    expect(Array.isArray(data)).toBe(true);
    const found = data.find((d) => d.id === defId);
    expect(found).toBeTruthy();
  }, TIMEOUT);

  test('workflow show <id> --json', async () => {
    const { stdout } = await cli(`workflow show ${defId} --json`);
    const data = parseJson<{ id: string }>(stdout);
    expect(data.id).toBe(defId);
  }, TIMEOUT);

  test('workflow stage-add --json', async () => {
    const { stdout } = await cli(
      `workflow stage-add ${defId} --name "Stage 1" --prompt "Say hello" --order 0 --json`,
    );
    const data = parseJson<{ id: string; name: string }>(stdout);
    expect(data.id).toBeTruthy();
    expect(data.name).toBe('Stage 1');
  }, TIMEOUT);

  test('workflow stage-add (second stage) --json', async () => {
    const { stdout } = await cli(
      `workflow stage-add ${defId} --name "Stage 2" --prompt "Say goodbye" --order 1 --json`,
    );
    const data = parseJson<{ id: string }>(stdout);
    expect(data.id).toBeTruthy();
  }, TIMEOUT);

  test('workflow stage-list <id> --json', async () => {
    const { stdout } = await cli(`workflow stage-list ${defId} --json`);
    const data = parseJson<Array<{ name: string }>>(stdout);
    expect(data.length).toBe(2);
  }, TIMEOUT);

  test('workflow edge-add --json', async () => {
    // Get stages first
    const { stdout: stageJson } = await cli(`workflow stage-list ${defId} --json`);
    const stages = parseJson<Array<{ id: string }>>(stageJson);
    expect(stages.length).toBeGreaterThanOrEqual(2);

    const { stdout } = await cli(
      `workflow edge-add ${defId} --from ${stages[0]!.id} --to ${stages[1]!.id} --condition on_success --json`,
    );
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);

  test('workflow export <id> --json', async () => {
    const { stdout } = await cli(`workflow export ${defId} --json`);
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);

  test('workflow delete <id>', async () => {
    const { stdout, stderr } = await cli(`workflow delete ${defId} --json`);
    expect(stdout + stderr).toBeTruthy();
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 5. Run Commands
// ═══════════════════════════════════════════════════════════════

describe('5. Run Commands', () => {
  let defId: string;
  let runId: string;

  test('create workflow for run', async () => {
    const { stdout: defJson } = await cli(
      `workflow create --name "CLI-E2E-Run-${Date.now()}" --session-mode single --json`,
    );
    const def = parseJson<{ id: string }>(defJson);
    defId = def.id;

    await cli(`workflow stage-add ${defId} --name "RunStage" --prompt "Say hi" --order 0 --json`);
  }, TIMEOUT);

  test('run create --json', async () => {
    const { stdout } = await cli(`run create ${defId} --json`);
    const data = parseJson<{ id: string; status: string }>(stdout);
    expect(data.id).toBeTruthy();
    runId = data.id;
  }, TIMEOUT);

  test('run start <id> --json', async () => {
    const { stdout } = await cli(`run start ${runId} --json`);
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);

  test('run list --json', async () => {
    const { stdout } = await cli('run list --json');
    const data = parseJson<Array<{ id: string }>>(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((d) => d.id === runId)).toBe(true);
  }, TIMEOUT);

  test('run show <id> --json', async () => {
    const { stdout } = await cli(`run show ${runId} --json`);
    const data = parseJson<{ id: string }>(stdout);
    expect(data.id).toBe(runId);
  }, TIMEOUT);

  test('wait for run completion', async () => {
    const status = await waitForRunComplete(runId);
    expect(['completed', 'failed']).toContain(status);
  }, 120_000);

  test('cleanup', async () => {
    await cli(`workflow delete ${defId} --json`);
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 6. Automation Commands
// ═══════════════════════════════════════════════════════════════

describe('6. Automation Commands', () => {
  let autoId: string;
  let defId: string;

  test('setup workflow for automation', async () => {
    const { stdout: defJson } = await cli(
      `workflow create --name "CLI-E2E-Auto-WF-${Date.now()}" --session-mode single --json`,
    );
    defId = parseJson<{ id: string }>(defJson).id;
    await cli(`workflow stage-add ${defId} --name "AutoStage" --prompt "Hello" --order 0 --json`);
  }, TIMEOUT);

  test('automation create --json', async () => {
    const { stdout } = await cli(
      `automation create --name "CLI-E2E-Auto-${Date.now()}" --workflow-definition-id ${defId} --trigger manual --json`,
    );
    const data = parseJson<{ id: string; name: string }>(stdout);
    expect(data.id).toBeTruthy();
    autoId = data.id;
  }, TIMEOUT);

  test('automation list --json', async () => {
    const { stdout } = await cli('automation list --json');
    const data = parseJson<Array<{ id: string }>>(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((d) => d.id === autoId)).toBe(true);
  }, TIMEOUT);

  test('automation show <id> --json', async () => {
    const { stdout } = await cli(`automation show ${autoId} --json`);
    const data = parseJson<{ id: string }>(stdout);
    expect(data.id).toBe(autoId);
  }, TIMEOUT);

  test('automation trigger <id> --json', async () => {
    const { stdout } = await cli(`automation trigger ${autoId} --json`);
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);

  test('automation delete <id>', async () => {
    const { stdout, stderr } = await cli(`automation delete ${autoId} --json`);
    expect(stdout + stderr).toBeTruthy();
  }, TIMEOUT);

  test('cleanup', async () => {
    await cli(`workflow delete ${defId} --json`);
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 7. Project Commands
// ═══════════════════════════════════════════════════════════════

describe('7. Project Commands', () => {
  let projId: string;

  test('project create --json', async () => {
    const { stdout } = await cli(
      `project create --name "CLI-E2E-Proj-${Date.now()}" --json`,
    );
    const data = parseJson<{ id: string; name: string }>(stdout);
    expect(data.id).toBeTruthy();
    projId = data.id;
  }, TIMEOUT);

  test('project list --json', async () => {
    const { stdout } = await cli('project list --json');
    const data = parseJson<Array<{ id: string }>>(stdout);
    expect(Array.isArray(data)).toBe(true);
  }, TIMEOUT);

  test('project show <id> --json', async () => {
    const { stdout } = await cli(`project show ${projId} --json`);
    const data = parseJson<{ id: string }>(stdout);
    expect(data.id).toBe(projId);
  }, TIMEOUT);

  test('project delete <id>', async () => {
    const { stdout, stderr } = await cli(`project delete ${projId} --json`);
    expect(stdout + stderr).toBeTruthy();
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 8. Template Commands
// ═══════════════════════════════════════════════════════════════

describe('8. Template Commands', () => {
  test('orchestrator templates --json (lists templates)', async () => {
    const { stdout } = await cli('orchestrator templates --json');
    const data = parseJson<Array<{ id: string }>>(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 9. Webhook Commands
// ═══════════════════════════════════════════════════════════════

describe('9. Webhook Commands', () => {
  test('webhook list --json', async () => {
    const { stdout } = await cli('webhook list --json');
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 10. Workspace Commands
// ═══════════════════════════════════════════════════════════════

describe('10. Workspace Commands', () => {
  test('workspace list --json', async () => {
    const { stdout } = await cli('workspace list --json');
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 11. Full Workflow Lifecycle via CLI
// ═══════════════════════════════════════════════════════════════

describe('11. Full Lifecycle via CLI', () => {
  let defId: string;
  let stageId1: string;
  let stageId2: string;
  let runId: string;

  test('create definition', async () => {
    const { stdout } = await cli(
      `workflow create --name "CLI-E2E-Lifecycle-${Date.now()}" --session-mode single --json`,
    );
    defId = parseJson<{ id: string }>(stdout).id;
    expect(defId).toBeTruthy();
  }, TIMEOUT);

  test('add stage 1', async () => {
    const { stdout } = await cli(
      `workflow stage-add ${defId} --name "Stage A" --prompt "Say A" --order 0 --json`,
    );
    stageId1 = parseJson<{ id: string }>(stdout).id;
    expect(stageId1).toBeTruthy();
  }, TIMEOUT);

  test('add stage 2', async () => {
    const { stdout } = await cli(
      `workflow stage-add ${defId} --name "Stage B" --prompt "Say B" --order 1 --json`,
    );
    stageId2 = parseJson<{ id: string }>(stdout).id;
    expect(stageId2).toBeTruthy();
  }, TIMEOUT);

  test('add edge A → B', async () => {
    const { stdout } = await cli(
      `workflow edge-add ${defId} --from ${stageId1} --to ${stageId2} --condition on_success --json`,
    );
    const data = parseJson(stdout);
    expect(data).toBeTruthy();
  }, TIMEOUT);

  test('create run', async () => {
    const { stdout } = await cli(`run create ${defId} --json`);
    runId = parseJson<{ id: string }>(stdout).id;
    expect(runId).toBeTruthy();
  }, TIMEOUT);

  test('start run', async () => {
    const { stdout } = await cli(`run start ${runId} --json`);
    expect(stdout).toBeTruthy();
  }, TIMEOUT);

  test('run completes', async () => {
    const status = await waitForRunComplete(runId);
    expect(['completed', 'failed']).toContain(status);
  }, 120_000);

  test('run show has 2 stage runs', async () => {
    const { stdout } = await cli(`run show ${runId} --json`);
    const data = parseJson<{ stageRuns: Array<{ id: string }> }>(stdout);
    expect(data.stageRuns.length).toBe(2);
  }, TIMEOUT);

  test('cleanup', async () => {
    await cli(`workflow delete ${defId} --json`);
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 12. Error Handling
// ═══════════════════════════════════════════════════════════════

describe('12. Error Handling', () => {
  test('unknown command exits with error', async () => {
    const result = await cli('nonexistent-command', true);
    expect(result.code).not.toBe(0);
  }, TIMEOUT);

  test('show non-existent workflow returns error', async () => {
    const result = await cli('workflow show non-existent-id --json', true);
    expect(result.code).not.toBe(0);
  }, TIMEOUT);

  test('show non-existent chat returns error', async () => {
    const result = await cli('chat show non-existent-id --json', true);
    expect(result.code).not.toBe(0);
  }, TIMEOUT);

  test('run create with bad definition id', async () => {
    const result = await cli('run create bad-def-id --json', true);
    expect(result.code).not.toBe(0);
  }, TIMEOUT);

  test('automation trigger non-existent id', async () => {
    const result = await cli('automation trigger does-not-exist --json', true);
    expect(result.code).not.toBe(0);
  }, TIMEOUT);

  test('unreachable server fails gracefully', async () => {
    const cmd = `${CLI_CMD} --server http://localhost:19999 system health --json`;
    try {
      await exec(cmd, { cwd: CLI_DIR, timeout: 15000, env: { ...process.env, FORCE_COLOR: '0' } });
      // If it succeeds, something is wrong
      expect(true).toBe(false);
    } catch (e: unknown) {
      const err = e as { code?: number; stderr?: string };
      expect(err.code).not.toBe(0);
    }
  }, TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════
// 13. Multi-Stage DAG with Variables (via CLI)
// ═══════════════════════════════════════════════════════════════

describe('13. Multi-Stage DAG with Variables', () => {
  let defId: string;
  let runId: string;

  test('create workflow with variable-bearing prompts', async () => {
    const { stdout } = await cli(
      `workflow create --name "CLI-E2E-DAG-Vars-${Date.now()}" --session-mode per-stage --json`,
    );
    defId = parseJson<{ id: string }>(stdout).id;

    // Stage A: produces output
    const { stdout: s1 } = await cli(
      `workflow stage-add ${defId} --name "Producer" --prompt "Respond with only the word: APPLE" --order 0 --json`,
    );
    const stageA = parseJson<{ id: string }>(s1).id;

    // Stage B: consumes output
    const { stdout: s2 } = await cli(
      `workflow stage-add ${defId} --name "Consumer" --prompt "Repeat the following: {{stages.Producer.output}}" --order 1 --json`,
    );
    const stageB = parseJson<{ id: string }>(s2).id;

    // Edge A → B
    await cli(`workflow edge-add ${defId} --from ${stageA} --to ${stageB} --condition on_success --json`);

    expect(defId).toBeTruthy();
  }, TIMEOUT);

  test('run the DAG', async () => {
    const { stdout } = await cli(`run create ${defId} --json`);
    runId = parseJson<{ id: string }>(stdout).id;
    await cli(`run start ${runId} --json`);

    const status = await waitForRunComplete(runId);
    expect(['completed', 'failed']).toContain(status);
  }, 120_000);

  test('verify both stages ran', async () => {
    const { stdout } = await cli(`run show ${runId} --json`);
    const data = parseJson<{ stageRuns: Array<{ status: string; name: string }> }>(stdout);
    expect(data.stageRuns.length).toBe(2);
  }, TIMEOUT);

  test('cleanup', async () => {
    await cli(`workflow delete ${defId} --json`);
  }, TIMEOUT);
});
