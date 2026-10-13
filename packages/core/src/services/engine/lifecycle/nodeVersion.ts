// ────────────────────────────────────────────────────────────────
// U-25 — a run warns when the codebase asks for a newer Node than its shells have.
//
// Stages run the host's `node` (the login-shell PATH the desktop starts the server with). A repo pinned to
// Node 22 checked under Node 20 fails in ways that read like code bugs (native modules, newer APIs). The
// owner's rule: an older Node is warned about; a newer one is not (it usually works, and nothing is pinned).
//
// The requirement comes from the first of `.nvmrc`, `.node-version`, `.tool-versions` (nodejs), and
// `package.json` `engines.node`; aliases such as `lts/*` say nothing checkable and are ignored. The probe
// runs `node --version` in the codebase, so a version manager's shims (asdf, mise, volta) answer for it.
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type Version = readonly [number, number, number];

export interface NodeRequirement {
  /** The file that set it (`.nvmrc`, `package.json engines.node`, …). */
  source: string;
  /** As written ("22", ">=20.11 <23"). */
  spec: string;
  /** The lowest version the spec accepts. */
  min: Version;
}

/** "22", "v22.11", "22.x", "22.11.0" → [22, 11, 0]; anything else → null. */
export function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.exec(text.trim());
  if (!m) return null;
  const n = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : 0);
  return [Number(m[1]), n(m[2]), n(m[3])];
}

export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The lowest version an `engines` range accepts ("^20.11 || >=22" → 20.11.0); null when none can be read. */
export function minimumOfRange(range: string): Version | null {
  let lowest: Version | null = null;
  for (const alternative of range.split('||')) {
    const floors: Version[] = [];
    // A hyphen range ("20 - 22") starts at its first version; comparators that all apply start at the highest floor.
    const hyphen = /^\s*(\S+)\s+-\s+\S+\s*$/.exec(alternative);
    const tokens = hyphen ? [hyphen[1]!] : alternative.trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (token.startsWith('<')) continue; // a ceiling, not a floor
      const v = parseVersion(token.replace(/^(>=|>|\^|~|=)/, ''));
      if (v) floors.push(v);
    }
    const floor = floors.sort(compareVersions).pop();
    if (floor && (!lowest || compareVersions(floor, lowest) < 0)) lowest = floor;
  }
  return lowest;
}

async function read(file: string): Promise<string | null> {
  return fs.readFile(file, 'utf8').catch(() => null);
}

/** What Node the codebase at `dir` asks for, or null when it does not say (checkably). */
export async function readNodeRequirement(dir: string): Promise<NodeRequirement | null> {
  for (const name of ['.nvmrc', '.node-version']) {
    const text = await read(path.join(dir, name));
    const spec = text?.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).find(Boolean);
    if (!spec) continue;
    const min = parseVersion(spec);
    return min ? { source: name, spec, min } : null;
  }
  const tools = await read(path.join(dir, '.tool-versions'));
  const line = tools?.split(/\r?\n/).find((l) => /^\s*(nodejs|node)\s/.test(l));
  if (line) {
    const spec = line.trim().split(/\s+/)[1] ?? '';
    const min = parseVersion(spec);
    if (min) return { source: '.tool-versions', spec, min };
  }
  const pkg = await read(path.join(dir, 'package.json'));
  if (pkg) {
    try {
      const engines = (JSON.parse(pkg) as { engines?: { node?: unknown } }).engines;
      const spec = typeof engines?.node === 'string' ? engines.node.trim() : '';
      const min = spec ? minimumOfRange(spec) : null;
      if (min) return { source: 'package.json engines.node', spec, min };
    } catch {
      /* not JSON — nothing to read */
    }
  }
  return null;
}

/** `node --version` as the codebase's shells would run it, or null when there is no `node`. */
export function probeNodeVersion(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('node', ['--version'], { cwd, env: process.env, timeout: 10_000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
}

/** The warning for one codebase, or null when its Node is new enough (or nothing is asked for). */
export function nodeVersionWarning(alias: string, required: NodeRequirement, host: string | null): string | null {
  const want = `Node ${required.spec.replace(/^v/, '')}`;
  if (!host) {
    return `${alias} asks for ${want} (${required.source}), and no \`node\` was found on the PATH. Install Node ${required.min[0]} or newer and restart GeneratorAI.`;
  }
  const have = parseVersion(host);
  if (!have || compareVersions(have, required.min) >= 0) return null;
  return (
    `${alias} asks for ${want} (${required.source}), but this run's shells use Node ${host.replace(/^v/, '')}. ` +
    `Installs, tests and builds may fail for that reason alone. Install Node ${required.min.join('.')} or newer ` +
    '(or select it with your version manager) and restart GeneratorAI.'
  );
}

/** The run's Node warnings, one per codebase that asks for a newer Node than its shells have. Never throws. */
export async function nodeVersionWarnings(
  codebases: Record<string, { path: string }>,
  probe: (cwd: string) => Promise<string | null> = probeNodeVersion,
): Promise<string[]> {
  const out: string[] = [];
  for (const [alias, { path: dir }] of Object.entries(codebases)) {
    try {
      const required = await readNodeRequirement(dir);
      if (!required) continue;
      const warning = nodeVersionWarning(alias, required, await probe(dir));
      if (warning) out.push(warning);
    } catch {
      /* a warning is best-effort; it never fails the run */
    }
  }
  return out;
}
