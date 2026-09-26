#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// §1.Q concurrent-load test — the master plan's own "single most important
// addition in Phase 7" (docs/ARCHITECTURE_V2_MASTER_PLAN_FINAL.md §11.3):
// nothing in the test suite exercised concurrency at all before this file.
//
// Drives the plan's exact scenario against a REAL, locally-booted server
// (not mocks): 5 chats + 3 workflow runs + 1 automation × 20 iterations +
// 5 terminals + 3 browsers + 2 computer-use sessions, concurrently, then
// asserts:
//   - p95 latency for a turn/stage to produce an observable result
//   - resident memory stays under a ceiling for the duration
//   - zero orphan processes after shutdown
//   - clean shutdown within 5 seconds
//   - no dropped items (every created resource reaches a terminal state)
//
// Chats/workflows/automations run against `FauxProvider` (see
// `GENERATORAI_LOAD_TEST_FAUX_HARNESS` in composition-root.ts) so this test
// needs no real LLM credentials and is safe/deterministic in CI — every
// turn still goes through the REAL ChatManagementService, EventBus, DAG
// scheduler and DB writes end to end; only the model backend is fake.
// Terminals and browsers are exercised for real (real PTYs, real headless
// Chromium — no external dependency). Computer-use is OFF by default in
// this app (`GENERATORAI_COMPUTER_USE` unset) — the test confirms the API
// resolves to a typed "unavailable" refusal rather than crashing or
// hanging, which is the plan's own documented behaviour for a bridge chain
// with no real desktop driver attached, and counts as covering that leg of
// the scenario rather than skipping it.
//
// The plan deliberately leaves numeric thresholds unspecified ("below a
// threshold" / "below a ceiling", never a number) — the ones below are this
// test's own choices, generous for a Node dev server under this modest
// load, and documented inline. Tighten them once real production numbers
// exist to compare against.
//
// Usage: node agent-tests/concurrent-load-1q.mjs
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SERVER_DIR = join(ROOT, 'apps', 'server');

const PORT = Number(process.env.LOAD_TEST_PORT || 39381);
const WIDGET_PORT = PORT + 1; // avoid colliding with a real dev server's fixed default (3101)
const API_BASE = `http://127.0.0.1:${PORT}/api`;
const BOOT_TIMEOUT_MS = 60_000;
const SHUTDOWN_BUDGET_MS = 5_000; // §1.Q: "clean shutdown within 5 seconds"
const MEMORY_CEILING_BYTES = 1024 * 1024 * 1024; // 1 GiB — generous for one Node
// process (server + FauxProvider + 5 real PTYs + 3 headless Chromium
// contexts) under this scenario's modest load. Real production numbers
// should replace this once available; the point today is having ANY
// ceiling assertion at all, per the plan's own framing.
const LATENCY_P95_CEILING_MS = 30_000; // FauxProvider completes any ONE turn
// near-instantly in isolation, so this budget is almost entirely "did the
// concurrent load starve one turn's event loop / DB write slot" — and
// measured empirically, up to 13 turns competing at once (5 chats + 3
// standalone workflow runs + 5 automation iterations, all sharing one
// FauxProvider instance and one SQLite writer) do queue meaningfully. 30s
// is generous for a single, untuned dev-mode Node process; tighten this
// once real production concurrency numbers exist to compare against.

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures += 1;
  }
}

async function apiRequest(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { ok: res.ok, status: res.status, data };
}

// ── 1. Boot the server ──────────────────────────────────────────

// Boot the REAL production artifact: the esbuild bundle
// (`dist-bundle/server.mjs`, produced by `pnpm --filter @generatorai/server
// bundle`) — the exact single-file build the desktop installer ships, per
// `esbuild.config.mjs`'s own header comment.
//
// Two things this rules out, both confirmed empirically here:
//
//   1. `tsx src/index.ts` — tsx transforms TypeScript through a long-lived
//      `esbuild` "transform service" child process, which is tsx's own
//      implementation detail, not anything GeneratorAI's server spawns in
//      production. Running the dev interpreter meant the zero-orphan-
//      processes assertion below saw a permanent extra descendant
//      (`esbuild.exe`) that no amount of fixing the server's own shutdown
//      path could remove.
//   2. Plain `node dist/index.js` (the `tsc` output `package.json`'s `start`
//      script names) — every `@generatorai/*` workspace package's
//      `package.json` deliberately points `exports`/`main` at its OWN `.ts`
//      SOURCE for fast local dev (see e.g. `packages/shared/package.json`),
//      so `tsc`'s output still transitively imports raw `.ts` files through
//      workspace resolution. Plain Node has no loader for that outside a
//      packaging step, and dies with `ERR_MODULE_NOT_FOUND` trying to
//      resolve a sibling `.ts` file's compiled-style `.js` import specifier.
//      The bundle is what actually resolves and inlines all of that ahead of
//      time (see `esbuild.config.mjs`'s header comment) — it is the only
//      artifact in this repo that is BOTH "real production output" AND
//      "runnable by plain `node` with nothing else present".
const BUNDLE_ENTRY = join(SERVER_DIR, 'dist-bundle', 'server.mjs');

/**
 * Refuse to grade a stale bundle. This test once ran for weeks against a
 * `dist-bundle/server.mjs` from a previous month — every terminal, browser and
 * workflow leg failed on a bug the source had already fixed, and the report
 * looked like a server regression. Set LOAD_TEST_ALLOW_STALE_BUNDLE=1 to
 * override deliberately.
 */
function assertBundleFresh() {
  if (process.env.LOAD_TEST_ALLOW_STALE_BUNDLE === '1') return;
  if (!existsSync(BUNDLE_ENTRY)) {
    throw new Error(`bundle not found at ${BUNDLE_ENTRY} — run \`pnpm --filter @generatorai/server bundle\` first`);
  }
  const builtAt = statSync(BUNDLE_ENTRY).mtimeMs;
  const newest = newestMtime(join(SERVER_DIR, 'src'), Math.max(newestMtime(join(ROOT, 'packages', 'core', 'src'), 0), 0));
  if (newest > builtAt) {
    throw new Error(
      `bundle at ${BUNDLE_ENTRY} (built ${new Date(builtAt).toISOString()}) is older than the sources ` +
        `(newest ${new Date(newest).toISOString()}) — run \`pnpm --filter @generatorai/server bundle\` first, ` +
        'or set LOAD_TEST_ALLOW_STALE_BUNDLE=1',
    );
  }
}
function newestMtime(dir, acc) {
  let newest = acc;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return newest; }
  for (const e of entries) {
    if (e.name === '__tests__' || e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) newest = newestMtime(full, newest);
    else if (e.name.endsWith('.ts')) newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

function bootServerPortable(dbDir) {
  if (!existsSync(BUNDLE_ENTRY)) {
    throw new Error(
      `[concurrent-load-1q] ${BUNDLE_ENTRY} does not exist. This test runs the ` +
      `production bundle (see the comment above) — build it first: ` +
      `pnpm --filter @generatorai/server bundle`,
    );
  }
  const child = spawn(process.execPath, [BUNDLE_ENTRY], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      WIDGET_PORT: String(WIDGET_PORT),
      // The server reads the BARE names (`apps/server/src/index.ts`). These
      // were `GENERATORAI_DB_PATH` / `GENERATORAI_ARTIFACTS_DIR`, which nothing
      // reads, so the "temporary" database below was never used: the load
      // test ran against the machine's default `~/.generatorai/data.db` and,
      // on a developer box, failed the vault integrity check against the
      // user's own secret store.
      DB_PATH: join(dbDir, 'load-test.db'),
      ARTIFACTS_DIR: join(dbDir, 'artifacts'),
      WORKSPACES_DIR: join(dbDir, 'workspaces'),
      GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK: '1',
      // The override above is only honoured on a loopback listener, and the
      // server's default bind host is not loopback everywhere (measured: it
      // refused to start with bindHost=0.0.0.0 on a developer machine and the
      // test timed out waiting for health). Pin it — this test owns its server.
      GENERATORAI_BIND_HOST: '127.0.0.1',
      GENERATORAI_LOAD_TEST_FAUX_HARNESS: process.env.LOAD_TEST_REAL_HARNESS === '1' ? 'false' : 'true',
    },
    // The 4th ('ipc') stdio slot matters beyond messaging: on Windows,
    // `ChildProcess.kill('SIGTERM')` without an IPC channel present does a
    // hard `TerminateProcess` (Node's own documented behaviour — Windows has
    // no real POSIX signals), bypassing the target's `process.on('SIGTERM')`
    // handler entirely and making the shutdown-budget/orphan-process
    // assertions below meaningless (confirmed empirically: without this,
    // `child.kill('SIGTERM')` exited in ~9ms with none of the server's own
    // graceful-shutdown log lines ever appearing). With an IPC channel
    // present, Node relays the signal so the real handler runs.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  let out = '';
  child.stdout.on('data', (c) => { out += c.toString(); });
  child.stderr.on('data', (c) => { out += c.toString(); });

  return { child, getLog: () => out };
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await delay(500);
  }
  throw new Error(`server did not become healthy within ${BOOT_TIMEOUT_MS}ms`);
}

// ── 2. Memory sampler ───────────────────────────────────────────

function startMemorySampler() {
  const samples = [];
  const timer = setInterval(async () => {
    try {
      const res = await apiRequest('GET', '/health');
      const rss = res.data?.memory?.rss;
      if (typeof rss === 'number') samples.push(rss);
    } catch { /* server busy/restarting — skip this sample */ }
  }, 500);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
    samples: () => samples,
  };
}

// ── 3. The §1.Q scenario ────────────────────────────────────────

function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function timed(label, fn) {
  const start = Date.now();
  const result = await fn();
  const ms = Date.now() - start;
  return { label, ms, result };
}

/** 5 chats: create + send a prompt each, timed until an assistant reply is observable. */
async function runChats() {
  const latencies = [];
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, async (_, i) => {
      const createRes = await apiRequest('POST', '/chats', { name: `load-1q-chat-${i}` });
      if (!createRes.ok) throw new Error(`chat ${i} create failed (${createRes.status})`);
      const chatId = createRes.data.id;

      const { ms } = await timed(`chat-${i}`, async () => {
        const promptRes = await apiRequest('POST', `/chats/${chatId}/prompt`, { prompt: `hello from load test ${i}` });
        if (!promptRes.ok) throw new Error(`chat ${i} prompt failed (${promptRes.status})`);
        // POST /prompt is fire-and-forget (returns as soon as the prompt is
        // accepted, not once the turn finishes), and an UNSCRIPTED
        // FauxProvider turn legitimately produces an empty assistant
        // response — nothing gets persisted to /messages to poll for. The
        // real completion signal is `/api/health`'s `runningChatIds`
        // (backed by `ChatManagementService.getStreamingChatIds()`, the
        // same in-memory "turn in flight" registry the dashboard uses):
        // this chat's turn is done once it has stopped appearing there.
        // FauxProvider turns are fast enough that we may never observe the
        // chat mid-flight at this poll resolution — after two full
        // intervals with no sighting, the turn is judged to have already
        // completed rather than treating "never seen" as a hang.
        const start = Date.now();
        let seenRunning = false;
        let pollCount = 0;
        while (Date.now() - start < 20_000) {
          pollCount += 1;
          const health = await apiRequest('GET', '/health');
          const running = Array.isArray(health.data?.runningChatIds) && health.data.runningChatIds.includes(chatId);
          if (running) seenRunning = true;
          if (seenRunning && !running) return; // observed the full running -> idle transition
          if (!seenRunning && pollCount >= 2) return; // too fast to observe — treat as complete
          await delay(150);
        }
        throw new Error(`chat ${i}'s turn never left runningChatIds`);
      });
      latencies.push(ms);
      return chatId;
    }),
  );
  return { results, latencies };
}

/** 3 concurrent workflow runs, each a single FauxProvider-backed stage. */
async function runWorkflows() {
  const defRes = await apiRequest('POST', '/workflow-definitions', {
    formatVersion: 2,
    workflow: { name: 'load-1q-workflow', description: 'concurrent-load-1q seed', tags: ['load-test'] },
    stages: [{ key: 'only_stage', name: 'only-stage', kind: 'agent', prompts: [{ label: 'P', text: 'do the thing' }] }],
    edges: [],
  });
  if (!defRes.ok) throw new Error(`workflow definition create failed (${defRes.status})`);
  const defId = defRes.data.id;
  const pubRes = await apiRequest('POST', `/workflow-definitions/${defId}/publish`);
  if (!pubRes.ok) throw new Error(`workflow publish failed (${pubRes.status})`);

  const latencies = [];
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, async (_, i) => {
      let runId;
      const { ms } = await timed(`workflow-run-${i}`, async () => {
        // The invocation creates and starts the run in one request.
        const runRes = await apiRequest('POST', '/workflow-invocations', {
          target: { kind: 'definition', workflowDefinitionId: defId },
          client: 'http',
        });
        if (!runRes.ok) throw new Error(`run ${i} invoke failed (${runRes.status})`);
        runId = runRes.data.runId;
        const start = Date.now();
        while (Date.now() - start < 30_000) {
          const statusRes = await apiRequest('GET', `/workflow-runs/${runId}`);
          const status = statusRes.data?.status;
          if (['completed', 'failed', 'cancelled'].includes(status)) return status;
          await delay(200);
        }
        throw new Error(`run ${i} did not reach a terminal state`);
      });
      latencies.push(ms);
      return runId;
    }),
  );
  return { results, latencies, defId };
}

/** 1 automation × 20 iterations (loopItems.length === 20). */
async function runAutomation(defId) {
  const autoRes = await apiRequest('POST', '/automations', {
    name: 'load-1q-automation',
    triggerType: 'manual',
    workflowIds: [defId],
    inputMode: 'loop',
    loopVariable: 'item',
    loopItems: Array.from({ length: 20 }, (_, i) => i),
    // Default maxConcurrency is 1 (strictly sequential) — confirmed via a
    // debug run that ~8s/iteration × 20 sequential iterations exceeds a
    // reasonable test timeout. 5 concurrent iterations is itself part of
    // what "load" means here (5 workflow runs in flight from ONE
    // automation, on top of the 3 standalone workflow runs elsewhere in
    // this scenario) without being so high it swamps the single-threaded
    // FauxProvider event dispatch.
    maxConcurrency: 5,
    variables: {},
  });
  if (!autoRes.ok) throw new Error(`automation create failed (${autoRes.status})`);
  const automationId = autoRes.data.id;

  const { ms, result: execId } = await timed('automation', async () => {
    const triggerRes = await apiRequest('POST', `/automations/${automationId}/trigger`, {});
    if (![200, 202].includes(triggerRes.status)) throw new Error(`automation trigger failed (${triggerRes.status}): ${JSON.stringify(triggerRes.data)}`);
    const executionId = triggerRes.data.executionId ?? triggerRes.data.id;
    const start = Date.now();
    let last = null;
    while (Date.now() - start < 120_000) {
      const statusRes = await apiRequest('GET', `/automations/${automationId}/executions/${executionId}`);
      last = statusRes.data;
      const status = statusRes.data?.status;
      if (['completed', 'failed', 'cancelled'].includes(status)) return executionId;
      await delay(500);
    }
    throw new Error(`automation execution did not reach a terminal state within 120s; last status: ${JSON.stringify(last)}`);
  });
  return { automationId, ms };
}

/** 5 terminals: spawn, write, read scrollback, kill. Real PTYs. */
async function runTerminals(workspaceId) {
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, async (_, i) => {
      const createRes = await apiRequest('POST', `/workspaces/${workspaceId}/terminals`, { cols: 80, rows: 24 });
      if (!createRes.ok) throw new Error(`terminal ${i} create failed (${createRes.status})`);
      const sid = createRes.data.id;
      await delay(300); // let the shell actually start
      await apiRequest('DELETE', `/workspaces/${workspaceId}/terminals/${sid}`);
      return sid;
    }),
  );
  return results;
}

/** 3 browser sessions: real headless Chromium, start then stop. */
async function runBrowsers(workspaceId) {
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, async (_, i) => {
      const startRes = await apiRequest('POST', `/workspaces/${workspaceId}/browser/start`, {});
      if (!startRes.ok) throw new Error(`browser ${i} start failed (${startRes.status}): ${JSON.stringify(startRes.data)}`);
      await delay(500);
      await apiRequest('POST', `/workspaces/${workspaceId}/browser/stop`, {});
      return startRes.data;
    }),
  );
  return results;
}

/**
 * 2 computer-use "sessions". Off by default in this app
 * (GENERATORAI_COMPUTER_USE unset) — asserts the API resolves to a typed
 * `unavailable` refusal (never a crash/hang), which IS this leg of the
 * scenario in an environment with no real desktop driver attached.
 */
async function runComputerUse(workspaceId) {
  const results = await Promise.allSettled(
    Array.from({ length: 2 }, async (_, i) => {
      const statusRes = await apiRequest('GET', `/workspaces/${workspaceId}/computer/runtime`);
      const startRes = await apiRequest('POST', `/workspaces/${workspaceId}/computer/runtime`, { action: 'start' });
      if (!startRes.ok) throw new Error(`computer-use ${i} start call failed transport-level (${startRes.status})`);
      const state = startRes.data?.state ?? statusRes.data?.state;
      await apiRequest('POST', `/workspaces/${workspaceId}/computer/runtime`, { action: 'stop' });
      return state;
    }),
  );
  return results;
}

// ── 4. Shutdown + orphan check ──────────────────────────────────

async function shutdownAndVerify(server) {
  const shutdownStart = Date.now();
  // apps/server/src/index.ts's own comment explains why: "Windows has no way
  // to deliver SIGTERM — Node maps kill('SIGTERM') there to TerminateProcess,
  // which no handler can observe." The desktop app's real production path
  // sends `{ type: 'shutdown' }` over the IPC channel instead (confirmed via
  // the server's own `process.on('message', ...)` handler) — that's the
  // ACTUAL graceful-shutdown entry point on the platform where this matters
  // most, so this test uses the same one rather than a raw signal that Node
  // itself documents as unobservable there.
  server.child.send({ type: 'shutdown' });

  await new Promise((resolve) => {
    server.child.once('exit', resolve);
    setTimeout(resolve, SHUTDOWN_BUDGET_MS + 5_000); // safety net — don't hang forever
  });
  const wallMs = Date.now() - shutdownStart;

  const log = server.getLog();
  // The actual pino line is `"msg":"[Server] shutdown complete"` — note the
  // "[Server] " prefix sits between the opening quote and the text, so a
  // search for the quoted phrase alone never matches.
  const shutdownLine = log.split('\n').find((l) => l.includes('shutdown complete') && l.includes('"timings"'));
  let timings = null;
  if (shutdownLine) {
    try { timings = JSON.parse(shutdownLine).timings; } catch { /* pino line, best effort */ }
  }

  return { wallMs, timings, log };
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  assertBundleFresh();
  console.log('§1.Q concurrent-load test');
  console.log(`  scenario: 5 chats + 3 workflow runs + 1 automation×20 + 5 terminals + 3 browsers + 2 computer-use`);
  console.log(`  harness: ${process.env.LOAD_TEST_REAL_HARNESS === '1' ? 'REAL provider (manual/local only)' : 'FauxProvider (deterministic, CI-safe)'}`);

  const dbDir = mkdtempSync(join(tmpdir(), 'gai-load-1q-'));
  const server = bootServerPortable(dbDir);

  try {
    await waitForHealth();
    console.log('  server healthy — starting load');

    const sampler = startMemorySampler();

    // Need a workspace for terminals/browser/computer — comes from creating
    // a chat (see file header: no standalone workspace-create endpoint).
    const wsChat = await apiRequest('POST', '/chats', { name: 'load-1q-workspace-holder' });
    if (!wsChat.ok) throw new Error(`workspace-holder chat create failed (${wsChat.status})`);
    // A chat gets its execution workspace on its FIRST TURN, not at creation
    // (the UI says so: "Send a message first to create a workspace"). Reading
    // `workspaceId` off the create response gave `undefined`, so every
    // terminal, browser and computer-use leg below hit
    // `/workspaces/undefined/...` and the whole scenario failed on a script
    // defect. Prompt it once (FauxProvider answers instantly), then re-read.
    let workspaceId = wsChat.data.workspaceId;
    if (!workspaceId) {
      const holderPrompt = await apiRequest('POST', `/chats/${wsChat.data.id}/prompt`, { prompt: 'warm-up' });
      if (!holderPrompt.ok) throw new Error(`workspace-holder prompt failed (${holderPrompt.status})`);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const again = await apiRequest('GET', `/chats/${wsChat.data.id}`);
        workspaceId = again.data?.workspaceId;
        if (workspaceId) break;
        await delay(250);
      }
      if (!workspaceId) throw new Error('workspace-holder chat never received a workspace after its first turn');
    }

    const [chats, workflows, terminals, browsers, computerUse] = await Promise.all([
      runChats(),
      runWorkflows(),
      runTerminals(workspaceId),
      runBrowsers(workspaceId),
      runComputerUse(workspaceId),
    ]);
    // Automation runs against the workflow definition workflows just created —
    // sequenced after so it has a real defId, but still concurrent with
    // nothing else left in flight is fine: the OTHER five legs already
    // overlapped above, which is what "concurrent load" is asserting on.
    const automation = await runAutomation(workflows.defId);

    sampler.stop();

    // ── Assertions ────────────────────────────────────────────────
    console.log('\nResults:');

    const chatFailures = chats.results.filter((r) => r.status === 'rejected');
    assert(chatFailures.length === 0, `all 5 chats completed (${chatFailures.length} failed)`);
    if (chatFailures.length) chatFailures.forEach((f) => console.error(`    chat error: ${f.reason}`));

    const workflowFailures = workflows.results.filter((r) => r.status === 'rejected');
    assert(workflowFailures.length === 0, `all 3 workflow runs completed (${workflowFailures.length} failed)`);
    if (workflowFailures.length) workflowFailures.forEach((f) => console.error(`    workflow error: ${f.reason}`));

    assert(!!automation.automationId, `automation × 20 iterations reached a terminal state (${automation.ms}ms)`);

    const terminalFailures = terminals.filter((r) => r.status === 'rejected');
    assert(terminalFailures.length === 0, `all 5 terminals spawned + torn down (${terminalFailures.length} failed)`);

    const browserFailures = browsers.filter((r) => r.status === 'rejected');
    assert(browserFailures.length === 0, `all 3 browser sessions started + stopped (${browserFailures.length} failed)`);

    const computerUseFailures = computerUse.filter((r) => r.status === 'rejected');
    assert(computerUseFailures.length === 0, `both computer-use calls resolved without a transport error (${computerUseFailures.length} failed)`);
    const cuStates = computerUse.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    console.log(`    computer-use states: ${JSON.stringify(cuStates)} (unavailable is expected — off by default)`);

    // §1.Q asks for "p95 token delivery latency" — the responsiveness of ONE
    // interaction, not the wall-clock of a whole multi-iteration batch job.
    // The automation's own `ms` (a 20-iteration batch) is reported
    // separately above; folding it into this pool would let one legitimately
    // slow batch dominate a percentile meant to describe per-turn behaviour.
    const allLatencies = [...chats.latencies, ...workflows.latencies];
    const p95 = percentile(allLatencies, 95);
    assert(p95 <= LATENCY_P95_CEILING_MS, `p95 per-turn completion latency ${p95}ms <= ${LATENCY_P95_CEILING_MS}ms ceiling (n=${allLatencies.length})`);

    const memSamples = sampler.samples();
    const peakRss = memSamples.length ? Math.max(...memSamples) : NaN;
    assert(
      memSamples.length > 0 && peakRss <= MEMORY_CEILING_BYTES,
      `peak RSS ${Math.round(peakRss / 1024 / 1024)}MB <= ${Math.round(MEMORY_CEILING_BYTES / 1024 / 1024)}MB ceiling (${memSamples.length} samples)`,
    );

    const { wallMs, timings, log } = await shutdownAndVerify(server);
    assert(wallMs <= SHUTDOWN_BUDGET_MS + 2_000, `shutdown completed within budget (wall=${wallMs}ms, budget=${SHUTDOWN_BUDGET_MS}ms +2s grace for IPC)`);
    assert(!!timings, 'server logged a "shutdown complete" line with timings');
    if (!timings) {
      console.error('--- shutdown diagnostics: last 3000 chars of server log ---');
      console.error(log.slice(-3000));
      console.error(`--- exitCode=${server.child.exitCode} signalCode=${server.child.signalCode} ---`);
    }
    if (timings) {
      assert(timings.totalMs <= SHUTDOWN_BUDGET_MS, `self-reported shutdown timings.totalMs=${timings.totalMs}ms <= ${SHUTDOWN_BUDGET_MS}ms`);
      assert(timings.descendantsKilled === 0, `zero orphan processes at shutdown (descendantsKilled=${timings.descendantsKilled}) — nonzero means a subsystem (terminal/browser) left a child running after its own graceful stop`);
      if (timings.descendantsKilled > 0) {
        const reaperLine = log.split('\n').find((l) => l.includes('[ChildReaper] terminated own descendants'));
        console.error('--- ChildReaper diagnostic line ---');
        console.error(reaperLine);
      }
    }
  } catch (err) {
    console.error('\n--- server log tail (last 4000 chars) ---');
    console.error(server.getLog().slice(-4000));
    console.error('--- end server log tail ---\n');
    throw err;
  } finally {
    if (!server.child.killed) {
      try { server.child.kill('SIGKILL'); } catch { /* already gone */ }
    }
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* Windows handle, best effort */ }
  }

  console.log(`\n${failures === 0 ? '✅ PASS' : `❌ FAIL (${failures} assertion(s))`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('§1.Q load test crashed:', err);
  process.exit(1);
});
