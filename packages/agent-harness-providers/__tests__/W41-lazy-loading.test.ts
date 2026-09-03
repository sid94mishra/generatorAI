// ────────────────────────────────────────────────────────────────
// W41-lazy-loading.test.ts
//
// "Boot loads zero provider SDK code" — proved against the BUILT output, in a
// real Node process, not by reading the source.
//
// The previous audit caught exactly that mistake: the source looked lazy
// (`HarnessFactory` had `await import(...)` loaders) while `dist/index.js`
// statically re-exported all six provider classes and every provider
// value-imported its SDK at module top level. By the time `loadCopilotModule()`
// ran, both SDKs had been resolved and evaluated. Source inspection said
// "lazy"; the module graph said otherwise.
//
// So this suite does not read TypeScript. It:
//   1. builds the package (or reuses a fresh `dist/`),
//   2. spawns a Node subprocess with an ESM loader hook that records the URL
//      of EVERY module the runtime loads,
//   3. imports the package barrel and nothing else,
//   4. asserts that no provider SDK and no provider implementation module
//      appears in that recording.
//
// A probe that records nothing would pass vacuously, so there is a positive
// control: the same probe, with one `createHarnessProvider({type:'codex'})`
// appended, MUST show `CodexProvider.js` being loaded. If the control fails,
// the negative result is worthless and the suite says so.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolvePath(HERE, '..');
const PACKAGES_DIR = resolvePath(PKG_ROOT, '..');
const DIST_BARREL = join(PKG_ROOT, 'dist', 'index.js');

/** Newest mtime under a directory tree (used to decide whether dist is stale). */
function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const t = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}

function buildPackage(): void {
  const require_ = createRequire(import.meta.url);
  // Resolve the real tsc entry point rather than shelling out to `pnpm exec`,
  // which is slow to start and differs between platforms.
  const tscBin = join(dirname(require_.resolve('typescript/package.json')), 'bin', 'tsc');
  execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.json'], {
    cwd: PKG_ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

/** The two files the probe subprocess needs. Written to a fresh temp dir. */
function writeProbeScripts(dir: string): { runner: string } {
  writeFileSync(
    join(dir, 'hooks.mjs'),
    `import { appendFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
let logFile, packagesDir;
export async function initialize(data) { logFile = data.logFile; packagesDir = data.packagesDir; }
export async function resolve(specifier, context, nextResolve) {
  // Workspace deps declare their TypeScript sources as \`main\`, which plain
  // Node cannot load. Point them at their built output. This affects only the
  // DEPENDENCIES — the module under test is always the real dist/ barrel.
  const m = /^@generatorai\\/([a-z0-9-]+)$/.exec(specifier);
  if (m && packagesDir) {
    const built = packagesDir + '/' + m[1] + '/dist/index.js';
    if (existsSync(built)) return { url: pathToFileURL(built).href, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (logFile) { try { appendFileSync(logFile, url + '\\n'); } catch {} }
  return nextLoad(url, context);
}
`,
    'utf8',
  );

  const runner = join(dir, 'run.mjs');
  writeFileSync(
    runner,
    `import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
const [barrel, logFile, packagesDir, mode] = process.argv.slice(2);
register('./hooks.mjs', import.meta.url, { data: { logFile, packagesDir } });
const mod = await import(pathToFileURL(barrel).href);
if (mode === 'create-codex') { await mod.createHarnessProvider({ type: 'codex' }); }
`,
    'utf8',
  );
  return { runner };
}

/** Run the probe and return every module URL the runtime loaded. */
function probe(mode: 'import-only' | 'create-codex'): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'w41-probe-'));
  const { runner } = writeProbeScripts(dir);
  const logFile = join(dir, `${mode}.log`);
  execFileSync(process.execPath, [runner, DIST_BARREL, logFile, PACKAGES_DIR, mode], {
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 60_000,
  });
  return readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
}

/** The three provider SDKs W41's acceptance criterion is about. */
const PROVIDER_SDKS = [
  '@anthropic-ai/claude-agent-sdk',
  '@github/copilot-sdk',
  '@agentclientprotocol/sdk',
];

/** The five provider implementations — none should be reachable from the barrel. */
const PROVIDER_MODULES = [
  'ClaudeAgentProvider.js',
  'CopilotProvider.js',
  'WorkspacedCopilotPool.js',
  'CodexProvider.js',
  'OpenCodeProvider.js',
  'AcpProvider.js',
];

let importOnly: string[];
let withCodex: string[];

describe('W41 — boot loads zero provider SDK code (verified against dist/)', () => {
  beforeAll(() => {
    // Reuse a dist that is already newer than every source file; otherwise
    // build, because a stale dist would make this suite test the wrong artifact.
    const needsBuild =
      !existsSync(DIST_BARREL) || statSync(DIST_BARREL).mtimeMs < newestMtime(join(PKG_ROOT, 'src'));
    if (needsBuild) buildPackage();
    importOnly = probe('import-only');
    withCodex = probe('create-codex');
  }, 300_000);

  it('the probe actually observes module loads (positive control)', () => {
    // Without this, every assertion below could pass because the hook recorded
    // nothing at all. Creating a codex provider MUST pull its module in.
    expect(importOnly.length).toBeGreaterThan(10);
    expect(withCodex.some((u) => u.includes('CodexProvider.js'))).toBe(true);
  });

  it.each(PROVIDER_SDKS)('importing the barrel does not load %s', (sdk) => {
    expect(importOnly.filter((u) => u.includes(sdk))).toEqual([]);
  });

  it.each(PROVIDER_MODULES)('importing the barrel does not load %s', (mod) => {
    expect(importOnly.filter((u) => u.endsWith(`/${mod}`))).toEqual([]);
  });

  it('does not load either tool-factory (both value-import an SDK)', () => {
    expect(importOnly.filter((u) => u.includes('tool-factory'))).toEqual([]);
  });

  it('the built barrel contains no static import of a provider module', () => {
    // Belt-and-braces on the artifact itself: the runtime probe proves nothing
    // was LOADED, this proves nothing is even referenced, so a future edit that
    // re-adds `export { CopilotProvider } from …` fails here with a clear
    // message rather than only via the subprocess.
    // Match the module SPECIFIERS only. A plain substring search would trip
    // over the prose comments that (rightly) name these packages.
    const built = readFileSync(DIST_BARREL, 'utf8');
    const specifiers = [...built.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    const offenders = specifiers.filter((s) =>
      [...PROVIDER_MODULES, ...PROVIDER_SDKS].some((name) => s.includes(name.replace(/\.js$/, ''))),
    );
    expect(offenders).toEqual([]);
  });

  it('still exposes the documented value exports consumers rely on', () => {
    const built = readFileSync(DIST_BARREL, 'utf8');
    // apps/server, apps/agent-host and packages/sdk import these as VALUES.
    for (const name of [
      'createHarnessProvider',
      'HarnessProxy',
      'HarnessRegistry',
      'MultiHarness',
      'ALL_HARNESS_TYPES',
      'ProviderInstanceRegistry',
      'FauxProvider',
      'AgentHostSupervisor',
      'reapOrphanedHarnessChildren',
    ]) {
      expect(built).toContain(name);
    }
  });
});
