#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Live workflow E2E runner (P00 WP-0.3).
//
//   pnpm workflow:e2e --phase 00 [--provider claude-agent|faux] [--only T1,T5]
//                     [--retries 2] [--fresh] [--no-server] [--keep-server]
//
// 1. starts the isolated server on :3111 (server.mjs), unless --no-server;
// 2. pairs ONE device into a fresh creds file under C:/gaiwf/creds/ (deleted
//    again when the run ends);
// 3. runs every scenario the phase lists in scenarios.json, one at a time,
//    each in its own `tsx scenario.mts` process (sequential, same creds);
// 4. judges each result against `expect` (or `expectFaux`), retrying a
//    failed scenario up to --retries times (live runs are advisory, RV-35:
//    model noise is retried; a persistent failure must reproduce on the
//    testkit before it blocks a phase);
// 5. writes scripts/workflow-e2e/out/<ts>/report.json (pass/fail, timings,
//    failed checks, each attempt's captured result) and ALWAYS stops the
//    server it started, including on error and Ctrl-C.
// Exit code: 0 when every scenario passed, 1 otherwise.
// ────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_ROOT, startServer, stopServer } from './server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const TSX = path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next;
      i += 1;
    } else out[a.slice(2)] = true;
  }
  return out;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Judge one scenario result; returns the list of failed checks (empty = pass). */
export function judge(result, expect) {
  const failures = [];
  const byName = new Map((result.stages ?? []).map((s) => [s.name, s]));
  const userMsgs = (stage) => (result.messages?.[stage] ?? []).filter((m) => m.role === 'user');
  const contextOf = (stage) => userMsgs(stage).filter((m) => m.flags.includes('isContextMessage'));
  if (expect.runStatus && result.runStatus !== expect.runStatus) {
    failures.push(`run status ${result.runStatus} (expected ${expect.runStatus})${result.runError ? `: ${result.runError}` : ''}`);
  }
  if (expect.sessionMode && result.sessionMode !== expect.sessionMode) {
    failures.push(`sessionMode ${result.sessionMode} (expected ${expect.sessionMode})`);
  }
  for (const [name, want] of Object.entries(expect.stages ?? {})) {
    const got = byName.get(name)?.status;
    const ok = Array.isArray(want) ? want.includes(got) : got === want;
    if (!ok) failures.push(`stage ${name} ${got ?? 'missing'} (expected ${want})`);
  }
  if (expect.allStages) {
    for (const s of result.stages ?? []) {
      if (s.status !== expect.allStages) failures.push(`stage ${s.name} ${s.status} (expected ${expect.allStages})`);
    }
  }
  for (const [name, n] of Object.entries(expect.retryCount ?? {})) {
    if (byName.get(name)?.retryCount !== n) failures.push(`stage ${name} retryCount ${byName.get(name)?.retryCount} (expected ${n})`);
  }
  for (const stage of expect.hasContext ?? []) {
    if (contextOf(stage).length === 0) failures.push(`stage ${stage} received no context message`);
  }
  for (const stage of expect.noContext ?? []) {
    if (contextOf(stage).length > 0) failures.push(`stage ${stage} received a context message (expected none)`);
  }
  for (const { stage, text } of expect.contextContains ?? []) {
    if (!contextOf(stage).some((m) => m.content.includes(text))) failures.push(`stage ${stage} context lacks ${JSON.stringify(text)}`);
  }
  for (const { stage, text } of expect.promptStartsWith ?? []) {
    const prompts = userMsgs(stage).filter((m) => m.flags.length === 0);
    if (!prompts.some((m) => m.content.startsWith(text))) failures.push(`stage ${stage} prompt does not start with ${JSON.stringify(text)}`);
  }
  for (const infoType of expect.sessionInfo ?? []) {
    if (!(result.sse?.sessionInfo ?? []).some((e) => e.infoType === infoType)) failures.push(`no harness.session_info ${infoType} on the run stream`);
  }
  if ((result.sse?.errors ?? []).length > 0) failures.push(`SSE errors: ${result.sse.errors.join('; ').slice(0, 200)}`);
  return failures;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const phase = String(args.phase ?? '00').padStart(2, '0');
  const provider = typeof args.provider === 'string' ? args.provider : 'claude-agent';
  const retries = args.retries !== undefined ? Number(args.retries) : 2;
  const registry = JSON.parse(readFileSync(path.join(HERE, 'scenarios.json'), 'utf8'));
  let ids = registry.phases[phase];
  if (!ids) throw new Error(`scenarios.json has no phase "${phase}" (known: ${Object.keys(registry.phases).join(', ')})`);
  if (typeof args.only === 'string') {
    const only = new Set(args.only.split(',').map((s) => s.trim()));
    ids = ids.filter((id) => only.has(id));
  }

  const ts = stamp();
  const outDir = path.join(HERE, 'out', ts);
  mkdirSync(outDir, { recursive: true });
  const creds = path.join(E2E_ROOT, 'creds', `e2e-${ts}.json`);
  const env = { ...process.env, CREDS: creds, E2E_DATA_DIR: path.join(E2E_ROOT, 'data'), E2E_DB_PATH: path.join(E2E_ROOT, 'data', 'data.db') };

  const report = {
    phase,
    provider,
    startedAt: new Date().toISOString(),
    retries,
    server: null,
    scenarios: [],
    passed: false,
  };
  const writeReport = () => writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  let started = false;
  const cleanup = async () => {
    // The device credential is only good for this run's server; never let
    // them pile up (they are paired, all-scope device keys).
    rmSync(creds, { force: true });
    if (started && !args['keep-server']) {
      started = false;
      await stopServer();
    }
  };
  process.once('SIGINT', () => {
    void cleanup().finally(() => process.exit(130));
  });

  try {
    if (!args['no-server']) {
      const t = Date.now();
      const s = await startServer({ provider, fresh: !!args.fresh });
      started = true;
      report.server = { pid: s.pid, baseUrl: s.baseUrl, bootMs: Date.now() - t };
    }

    const pair = spawnSync(process.execPath, [TSX, path.join(HERE, 'pair.mts')], { env, encoding: 'utf8', cwd: REPO });
    if (pair.status !== 0) throw new Error(`pairing failed: ${pair.stderr || pair.stdout}`);

    for (const id of ids) {
      const sc = registry.scenarios[id];
      if (!sc) throw new Error(`scenario ${id} is listed for phase ${phase} but not defined`);
      const expect = provider === 'faux' && sc.expectFaux ? sc.expectFaux : sc.expect;
      const entry = { id, spec: sc.spec, knownBugs: sc.knownBugs ?? [], attempts: [], passed: false };
      report.scenarios.push(entry);
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const resultFile = path.join(outDir, `${id}-attempt${attempt + 1}.json`);
        const t = Date.now();
        console.log(`[workflow-e2e] ${id} attempt ${attempt + 1}/${retries + 1} (${provider})`);
        const r = spawnSync(
          process.execPath,
          [TSX, path.join(HERE, 'scenario.mts'), '--spec', path.join(HERE, sc.spec), '--provider', provider, '--out', resultFile],
          { env, encoding: 'utf8', cwd: REPO, timeout: 30 * 60_000 },
        );
        const a = { attempt: attempt + 1, ms: Date.now() - t, exit: r.status, failures: [], resultFile: path.relative(outDir, resultFile) };
        let result;
        try {
          result = JSON.parse(readFileSync(resultFile, 'utf8'));
        } catch {
          a.failures.push(`scenario process failed (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(-600)}`);
        }
        if (result) {
          a.runId = result.runId;
          a.runStatus = result.runStatus;
          a.wallMs = result.wallMs;
          a.stages = Object.fromEntries(result.stages.map((s) => [s.name, `${s.status}/r${s.retryCount}`]));
          a.failures = judge(result, expect);
        }
        entry.attempts.push(a);
        writeReport();
        console.log(`[workflow-e2e] ${id} ${a.failures.length === 0 ? 'PASS' : `FAIL: ${a.failures.join(' | ')}`}`);
        if (a.failures.length === 0) {
          entry.passed = true;
          break;
        }
      }
    }
    report.passed = report.scenarios.every((s) => s.passed);
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    console.error(`[workflow-e2e] ${report.error}`);
  } finally {
    report.finishedAt = new Date().toISOString();
    writeReport();
    await cleanup();
  }
  console.log(`[workflow-e2e] report: ${path.join(outDir, 'report.json')} — ${report.passed ? 'ALL PASSED' : 'FAILURES'}`);
  process.exit(report.passed ? 0 : 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void main();
