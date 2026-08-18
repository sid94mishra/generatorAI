// ────────────────────────────────────────────────────────────────
// CLI end-to-end scenario catalogue.
//
// Drives the built single-file bundle exactly as a user would, against a live
// server, and reports one line per scenario. Read-only and lifecycle scenarios
// are separated so a failure in one cannot cascade: anything this script
// creates, it also tears down.
//
//   node agent-tests/cli-scenarios.mjs [--server URL] [--only <substring>]
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CLI = resolve(ROOT, 'apps/cli/dist-bundle/generatorai.mjs');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const SERVER = argOf('server', 'http://127.0.0.1:3100');
const ONLY = argOf('only', '');

let pass = 0;
let fail = 0;
const failures = [];

function run(args, { timeout = 90000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, '--server', SERVER, ...args], {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

/** Runs a command and parses its `--json` envelope. */
async function json(args) {
  const r = await run([...args, '--json']);
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop() ?? 'null');
  } catch {
    /* not JSON */
  }
  return { ...r, json: parsed };
}

async function scenario(name, fn) {
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  const started = Date.now();
  try {
    await fn();
    pass++;
    console.log(`  PASS  ${name}  (${Date.now() - started}ms)`);
  } catch (error) {
    fail++;
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name, message });
    console.log(`  FAIL  ${name}  (${Date.now() - started}ms)\n        ${message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Asserts the command exited 0 and returned a well-formed envelope. */
function assertOk(r, name) {
  assert(r.code === 0, `${name}: exit ${r.code} — ${(r.stderr || r.stdout).slice(0, 220)}`);
  assert(r.json !== null, `${name}: no JSON on stdout — ${r.stdout.slice(0, 220)}`);
  assert(r.json.error === undefined, `${name}: ${JSON.stringify(r.json.error)}`);
  assert(r.json.apiVersion === 1, `${name}: missing apiVersion envelope`);
  return r.json.data;
}

function section(title) {
  if (ONLY) return;
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);
}

// ── Surface & help ────────────────────────────────────────────────

section('Surface');

await scenario('--version prints a semver', async () => {
  const r = await run(['--version']);
  assert(r.code === 0, `exit ${r.code}`);
  assert(/^\d+\.\d+\.\d+/.test(r.stdout.trim()), `got "${r.stdout.trim()}"`);
});

await scenario('--help lists every command group', async () => {
  const r = await run(['--help']);
  assert(r.code === 0, `exit ${r.code}`);
  for (const group of [
    'chat', 'workflow', 'run', 'automation', 'project', 'workspace', 'agent',
    'device', 'connect', 'config', 'system', 'security', 'terminal', 'browser',
    'computer', 'extension', 'widget', 'review', 'source-control', 'hook',
    'webhook', 'script', 'template', 'harness', 'companion',
  ]) {
    assert(r.stdout.includes(group), `missing group "${group}"`);
  }
});

await scenario('unknown command exits non-zero with guidance', async () => {
  const r = await run(['definitely-not-a-command']);
  assert(r.code !== 0, 'expected non-zero exit');
  assert(/unknown|error/i.test(r.stderr + r.stdout), 'expected an error message');
});

await scenario('completions generate for every shell', async () => {
  for (const shell of ['bash', 'zsh', 'fish', 'powershell', 'nushell']) {
    const r = await run(['completions', shell]);
    assert(r.code === 0, `${shell}: exit ${r.code} ${r.stderr.slice(0, 150)}`);
    assert(r.stdout.length > 200, `${shell}: suspiciously short output`);
  }
});

// ── System & security ─────────────────────────────────────────────

section('System');

await scenario('system health reports status', async () => {
  const data = assertOk(await json(['system', 'health']), 'system health');
  assert(data.status === 'ok', `status=${data.status}`);
});

await scenario('system models lists models (or times out cleanly)', async () => {
  // Backed by the provider SDK, which can wedge independently of the CLI.
  // What is under test here is that the CLI bounds the wait and says so,
  // rather than hanging with no output.
  const r = await json(['system', 'models', '--timeout', '8000']);
  if (r.json?.error) {
    assert(r.json.error.code === 'TIMEOUT', `unexpected error ${JSON.stringify(r.json.error)}`);
    assert(r.json.error.hint, 'a timeout must tell the user what to do next');
    return;
  }
  assert(Array.isArray(assertOk(r, 'system models')), 'expected an array');
});

await scenario('system version negotiates with the server', async () => {
  assertOk(await json(['system', 'version']), 'system version');
});

await scenario('system artifacts lists system artifacts', async () => {
  assertOk(await json(['system', 'artifacts']), 'system artifacts');
});

await scenario('system mcp-servers lists servers', async () => {
  assertOk(await json(['system', 'mcp-servers']), 'system mcp-servers');
});

await scenario('security posture reports warnings', async () => {
  const data = assertOk(await json(['security', 'posture']), 'security posture');
  assert(data.authentication !== undefined, 'missing authentication block');
});

await scenario('harness show reports the provider (or times out cleanly)', async () => {
  const r = await json(['harness', 'show', '--timeout', '8000']);
  if (r.json?.error) {
    assert(r.json.error.code === 'TIMEOUT', `unexpected error ${JSON.stringify(r.json.error)}`);
    return;
  }
  const data = assertOk(r, 'harness show');
  // `type` is a property of each provider, not of the payload root. Asserting
  // it at the root only ever passed because this endpoint used to time out.
  assert(typeof data.primary === 'string', 'missing primary harness');
  assert(Array.isArray(data.providers) && data.providers.length > 0, 'missing providers');
  assert(
    data.providers.every((p) => typeof p.type === 'string'),
    'a provider is missing its type',
  );
});

// ── Config & connections ──────────────────────────────────────────

section('Config');

await scenario('config show resolves the layered config', async () => {
  const data = assertOk(await json(['config', 'show']), 'config show');
  assert(data.server !== undefined, 'missing server block');
});

await scenario('config get reads a nested key', async () => {
  const r = await json(['config', 'get', 'server.url']);
  assertOk(r, 'config get');
});

await scenario('connect list shows known servers', async () => {
  assertOk(await json(['connect', 'list']), 'connect list');
});

await scenario('connect test probes reachability', async () => {
  assertOk(await json(['connect', 'test']), 'connect test');
});

await scenario('device status reports the vault backend', async () => {
  const data = assertOk(await json(['device', 'status']), 'device status');
  assert(data.vault !== undefined, 'missing vault block');
});

await scenario('device list enumerates registered devices', async () => {
  assertOk(await json(['device', 'list']), 'device list');
});

// ── Read-only listings across every domain ────────────────────────

section('Listings');

const listings = [
  ['chat', 'list'],
  ['workflow', 'list'],
  ['run', 'list'],
  ['automation', 'list'],
  ['project', 'list'],
  ['workspace', 'list'],
  ['agent', 'list'],
  ['script', 'list'],
  ['template', 'list'],
  ['extension', 'list'],
  ['widget', 'list'],
  ['webhook', 'list'],
  ['hook', 'phases'],
  ['source-control', 'status'],
];

for (const args of listings) {
  await scenario(`${args.join(' ')} returns a list`, async () => {
    const data = assertOk(await json(args), args.join(' '));
    assert(data !== undefined && data !== null, 'expected data');
  });
}

// ── Output modes ──────────────────────────────────────────────────

section('Output modes');

await scenario('--json emits a versioned envelope', async () => {
  const r = await json(['workflow', 'list']);
  assertOk(r, 'workflow list');
  assert(r.json.kind === 'workflow.list', `kind=${r.json.kind}`);
});

await scenario('--ndjson emits one object per line', async () => {
  const r = await run(['workflow', 'list', '--ndjson']);
  assert(r.code === 0, `exit ${r.code}`);
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  for (const line of lines) JSON.parse(line);
});

await scenario('--yaml emits YAML', async () => {
  const r = await run(['system', 'health', '--yaml']);
  assert(r.code === 0, `exit ${r.code}`);
  assert(/:\s/.test(r.stdout), 'does not look like YAML');
});

await scenario('--quiet prints nothing and signals via exit code', async () => {
  const r = await run(['system', 'health', '--quiet']);
  assert(r.code === 0, `exit ${r.code}`);
  assert(r.stdout.trim() === '', `expected empty stdout, got "${r.stdout.slice(0, 80)}"`);
});

await scenario('default output is a human table', async () => {
  const r = await run(['workflow', 'list']);
  assert(r.code === 0, `exit ${r.code}`);
  assert(!r.stdout.trim().startsWith('{'), 'expected human output, got JSON');
});

// ── Lifecycle: project → workflow → run ───────────────────────────

section('Lifecycle');

const stamp = Date.now();
let projectId = null;
let workflowId = null;
let chatId = null;

await scenario('project create → show → update → delete', async () => {
  const created = assertOk(
    await json(['project', 'create', `cli-e2e-${stamp}`, '--description', 'CLI E2E']),
    'project create',
  );
  projectId = created.id;
  assert(projectId, 'no project id returned');

  const shown = assertOk(await json(['project', 'show', projectId]), 'project show');
  assert(shown.id === projectId, 'project show returned a different id');

  assertOk(
    await json(['project', 'update', projectId, '--description', 'updated']),
    'project update',
  );

  // Prefix resolution is a headline feature: an 8-char prefix must resolve.
  const byPrefix = assertOk(
    await json(['project', 'show', projectId.slice(0, 8)]),
    'project show by prefix',
  );
  assert(byPrefix.id === projectId, 'prefix resolved to the wrong project');
});

await scenario('workflow create → stage add → edge add → validate → export', async () => {
  const created = assertOk(
    await json(['workflow', 'create', `cli-e2e-wf-${stamp}`, '--description', 'CLI E2E']),
    'workflow create',
  );
  workflowId = created.id;
  assert(workflowId, 'no workflow id returned');

  const a = assertOk(
    await json(['workflow', 'stage', 'add', workflowId, '--name', 'first', '--prompt', 'Say hello']),
    'stage add first',
  );
  const b = assertOk(
    await json(['workflow', 'stage', 'add', workflowId, '--name', 'second', '--prompt', 'Say bye']),
    'stage add second',
  );

  assertOk(
    await json(['workflow', 'edge', 'add', workflowId, '--from', a.id, '--to', b.id, '--on', 'on_success']),
    'edge add',
  );

  const stages = assertOk(await json(['workflow', 'stage', 'list', workflowId]), 'stage list');
  assert(stages.length === 2, `expected 2 stages, got ${stages.length}`);

  const edges = assertOk(await json(['workflow', 'edge', 'list', workflowId]), 'edge list');
  assert(edges.length === 1, `expected 1 edge, got ${edges.length}`);

  const validation = assertOk(await json(['workflow', 'validate', workflowId]), 'workflow validate');
  assert(validation.valid === true, `invalid: ${JSON.stringify(validation.errors)}`);

  assertOk(await json(['workflow', 'export', workflowId]), 'workflow export');
});

await scenario('workflow show renders the DAG', async () => {
  const r = await run(['workflow', 'show', workflowId]);
  assert(r.code === 0, `exit ${r.code} ${r.stderr.slice(0, 200)}`);
  assert(/first|second/.test(r.stdout), 'stages not rendered');
});

await scenario('run profile generate produces a valid profile', async () => {
  assertOk(await json(['run', 'profile', 'generate', workflowId]), 'run profile generate');
});

await scenario('chat create → show → messages → archive → delete', async () => {
  const created = assertOk(
    await json(['chat', 'create', `cli-e2e-chat-${stamp}`]),
    'chat create',
  );
  chatId = created.id;
  assert(chatId, 'no chat id returned');

  assertOk(await json(['chat', 'show', chatId]), 'chat show');
  assertOk(await json(['chat', 'messages', chatId]), 'chat messages');
  assertOk(await json(['chat', 'archive', chatId]), 'chat archive');
});

await scenario('chat send delivers a prompt the server accepts', async () => {
  const created = assertOk(await json(['chat', 'create', `cli-send-${stamp}`]), 'chat create');
  const id = created.id;
  try {
    // The regression that mattered most: the payload used to carry `content`,
    // which the prompt schema strips, so every send 400'd. What is under test
    // is acceptance of the request, not the agent's reply — waiting for a
    // full turn would make this a test of the model provider.
    const r = await run(['chat', 'send', id, 'Reply with exactly: PONG', '--no-stream', '--ndjson'], {
      timeout: 45000,
    });
    const output = r.stdout + r.stderr;
    // Matching "400" anywhere flags any UUID that happens to contain those
    // digits, so look for an actual error envelope instead.
    const rejection = output
      .split('\n')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.error || entry?.type === 'error');
    assert(
      !rejection,
      `the server rejected the prompt: ${JSON.stringify(rejection ?? null).slice(0, 300)}`,
    );

    // A turn actually started: the session emits events against the chat.
    let started = false;
    for (let attempt = 0; attempt < 20 && !started; attempt++) {
      const shown = await json(['chat', 'show', id]);
      const chat = shown.json?.data ?? {};
      started = Boolean(chat.sessionId) || chat.status === 'running';
      if (!started) await new Promise((r) => setTimeout(r, 1000));
    }
    assert(started, 'no session was created for the prompt');
  } finally {
    await json(['chat', 'delete', id, '--yes']);
  }
});

await scenario('chat permission-mode is accepted by the server', async () => {
  const created = assertOk(await json(['chat', 'create', `cli-mode-${stamp}`]), 'chat create');
  try {
    assertOk(
      await json(['chat', 'permission-mode', created.id, 'acceptEdits']),
      'chat permission-mode',
    );
  } finally {
    await json(['chat', 'delete', created.id, '--yes']);
  }
});

await scenario('run hitl exposes approve, reject and changes-request', async () => {
  const r = await run(['run', 'hitl', '--help']);
  assert(r.code === 0, `exit ${r.code}`);
  for (const verb of ['approve', 'reject', 'changes-request']) {
    assert(r.stdout.includes(verb), `missing "run hitl ${verb}"`);
  }
});

await scenario('config show redacts the shared API key', async () => {
  const data = assertOk(await json(['config', 'show']), 'config show');
  const key = data?.server?.apiKey;
  if (key) assert(String(key).includes('redacted'), `apiKey printed in the clear: ${key}`);
});

// ── Teardown ──────────────────────────────────────────────────────

section('Teardown');

await scenario('chat delete removes the chat', async () => {
  if (!chatId) return;
  assertOk(await json(['chat', 'delete', chatId, '--yes']), 'chat delete');
});

await scenario('workflow delete removes the definition', async () => {
  if (!workflowId) return;
  assertOk(await json(['workflow', 'delete', workflowId, '--yes']), 'workflow delete');
});

await scenario('project delete removes the project', async () => {
  if (!projectId) return;
  assertOk(await json(['project', 'delete', projectId, '--yes', '--force']), 'project delete');
});

// ── Error handling ────────────────────────────────────────────────

section('Errors');

await scenario('missing entity reports NOT_FOUND, not a stack trace', async () => {
  const r = await json(['workflow', 'show', '00000000-0000-0000-0000-000000000000']);
  assert(r.code !== 0, 'expected non-zero exit');
  assert(r.json?.error !== undefined, 'expected an error envelope');
  assert(!/at Object\.|at Module\./.test(r.stdout + r.stderr), 'leaked a stack trace');
});

await scenario('bad flag value is rejected by validation', async () => {
  const r = await json(['run', 'list', '--limit', 'not-a-number']);
  assert(r.code !== 0, 'expected non-zero exit');
});

await scenario('unreachable server fails fast with guidance', async () => {
  const r = await run(['--server', 'http://127.0.0.1:59999', 'system', 'health', '--json'], {
    timeout: 30000,
  });
  assert(r.code !== 0, 'expected non-zero exit');
  assert(/connect|refused|unreachable|ECONNREFUSED/i.test(r.stdout + r.stderr), 'no guidance');
});

// ── Report ────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(64)}`);
console.log(`  ${pass} passed · ${fail} failed · ${pass + fail} total`);
if (failures.length) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`   • ${f.name}\n     ${f.message}`);
}
console.log('═'.repeat(64));
process.exit(fail === 0 ? 0 : 1);
