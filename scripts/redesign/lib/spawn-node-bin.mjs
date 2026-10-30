// ────────────────────────────────────────────────────────────────
// P2-R10 — cross-platform child-process spawning for CLI tools that ship
// as npm package "bin" entries (vite, tsx, ...).
//
// `spawn(path.join('node_modules/.bin', name))` resolves to a `.cmd` shim
// on Windows (pnpm/npm write a `<name>.cmd` wrapper next to the POSIX shell
// script), and Node >= 18.20.2 / 20.12.2 / 22 refuses to spawn a `.cmd`/`.bat`
// file without `shell: true` — it throws EINVAL (the CVE-2024-27980
// hardening). The repo requires Node 22, so that code path is dead on
// Windows today.
//
// The fix: never spawn the shim. Resolve the package's own JS entry point
// from its `package.json` "bin" field with Node's module resolver, rooted at
// the workspace package that actually declares the dependency (not a
// hardcoded node_modules path — pnpm's hoisting layout is not part of the
// contract), and run that file directly with `process.execPath`. There is
// then no shell and no OS-specific shim anywhere in the child-process path,
// and the resulting child IS the real process (no cmd.exe wrapper hiding the
// PID), so a caller can signal/kill it directly on every OS.
//
// Used by scripts/redesign/sandbox.mjs. Any sibling script that spawns an
// npm-package CLI should use this instead of node_modules/.bin/<name>.
// ────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Resolve an npm package's CLI entry script as an absolute path.
 *
 * @param {string} fromDir A directory *inside* the workspace package that
 *   declares `pkgName` as a dependency (e.g. `apps/web` for `vite`,
 *   `apps/server` for `tsx`). Resolution is rooted here via `createRequire`,
 *   so it follows whatever node_modules layout pnpm actually produced —
 *   hoisted to the repo root, nested under the package, or symlinked —
 *   instead of assuming one.
 * @param {string} pkgName The npm package name (e.g. 'vite', 'tsx').
 * @param {string} [binName] Which entry of `package.json#bin` to use when
 *   it is an object with more than one key. Defaults to `pkgName`; when
 *   that key is absent, falls back to the object's only entry (or to `bin`
 *   itself when it's a plain string, npm's single-executable shorthand).
 * @returns {string} Absolute path to the package's JS entry point.
 */
export function resolveBinScript(fromDir, pkgName, binName = pkgName) {
  const req = createRequire(pathToFileURL(path.join(fromDir, 'package.json')));
  const pkgJsonPath = req.resolve(`${pkgName}/package.json`);
  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const bin = pkg.bin;

  let rel;
  if (typeof bin === 'string') {
    rel = bin;
  } else if (bin && typeof bin === 'object') {
    const values = Object.values(bin);
    rel = bin[binName] ?? (values.length === 1 ? values[0] : undefined);
  }
  if (!rel) {
    throw new Error(
      `spawn-node-bin: "${pkgName}" (resolved from ${fromDir}) has no usable package.json "bin" entry for "${binName}"`,
    );
  }
  return path.join(pkgDir, rel);
}

/**
 * `resolveBinScript` plus the `process.execPath` invocation, ready to spread
 * into `spawn`/`execFileSync`/`execFileSync`: `fn(...nodeBinArgs(...))` or
 * `spawn(command, args)`.
 *
 * @returns {{ command: string, args: string[] }}
 */
export function nodeBinArgs(fromDir, pkgName, binName, extraArgs = []) {
  return { command: process.execPath, args: [resolveBinScript(fromDir, pkgName, binName), ...extraArgs] };
}

// P2-R43 — `npm_execpath` is not proof of pnpm: under `npm run`/`npm exec` it
// points at npm's own JS entry (e.g. `.../npm/bin/npm-cli.js`), and under
// yarn at yarn's (e.g. `.../yarn/bin/yarn.js`) — both are real, existing
// `.js` files, so the old check (extension + existence only) happily ran
// `npm --filter ... bundle` or `yarn --filter ... bundle`, neither of which
// understands `--filter`. Require the path to actually look like a pnpm
// entry point: pnpm's own bin script is named `pnpm.cjs`/`pnpm.mjs`/`pnpm.js`
// (`.../pnpm/bin/pnpm.cjs`), and corepack's generated shim for it also lives
// under a path segment literally named `pnpm` (e.g.
// `.../corepack/v1/pnpm/<version>/pnpm.cjs`). Checked case-insensitively and
// on both `/` and `\` separators so it works from a Windows-style
// `npm_execpath` too.
function isPnpmEntryPath(execPath) {
  const segments = execPath.split(/[\\/]+/).filter(Boolean);
  const base = (segments[segments.length - 1] ?? '').toLowerCase();
  const baseIsPnpmEntry = /^pnpm(\.(c|m)?js)?$/.test(base);
  const hasPnpmSegment = segments.some((seg) => /^pnpm(@.+)?$/i.test(seg));
  return baseIsPnpmEntry || hasPnpmSegment;
}

// A fixed argument never contains a shell metacharacter beyond a plain
// space in this codebase (package names, `--filter`, task names), but quote
// defensively anyway: double-quote anything outside a safe unquoted-char
// set, escaping embedded double quotes. Safe for both POSIX `sh -c` and
// Windows `cmd.exe`, the two shells `{ shell: true }` resolves to.
function quoteShellArg(arg) {
  if (/^[A-Za-z0-9@_\-./:]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Resolve how to invoke `pnpm` itself as a child process without ever
 * spawning a `.cmd`/`.ps1` shim directly.
 *
 * Prefers `process.env.npm_execpath`, but only when it both looks like a
 * `.js`/`.cjs`/`.mjs` file AND resolves to a real pnpm entry point (see
 * `isPnpmEntryPath`) — pnpm sets this variable to its OWN JS entry point
 * whenever the current process was itself launched via `pnpm ...`, which is
 * run with `process.execPath`, exactly like `resolveBinScript`'s targets, so
 * it is exempt from the shim problem entirely (it is never a `.cmd`).
 *
 * Only when that fails (this script was run directly with `node`, or via
 * `npm run`/`yarn`, none of which point `npm_execpath` at a pnpm entry) does
 * this fall back to a bare `pnpm` resolved from PATH. That fallback is
 * spawned with `shell: true` — a deliberate, narrow, documented exception to
 * "never spawn a shim without a shell": every argument here is fixed by this
 * codebase, never end-user or network input, so the usual shell-injection
 * risk of `shell: true` does not apply, and it is the only way to reach a
 * global `pnpm` install (which has no JS entry point of ours to resolve).
 * The whole invocation is joined into a single command string with no
 * separate `args` — Node 24 deprecates (DEP0190) passing an `args` array
 * together with `shell: true`.
 *
 * @returns {{ command: string, args: string[], options: { shell?: boolean } }}
 */
export function pnpmCommand(extraArgs = []) {
  const execPath = process.env['npm_execpath'];
  if (
    execPath &&
    /\.(m?js|cjs)$/i.test(execPath) &&
    isPnpmEntryPath(execPath) &&
    fs.existsSync(execPath)
  ) {
    return { command: process.execPath, args: [execPath, ...extraArgs], options: {} };
  }
  return { command: ['pnpm', ...extraArgs].map(quoteShellArg).join(' '), args: [], options: { shell: true } };
}
