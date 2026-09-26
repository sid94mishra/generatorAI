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

/**
 * Resolve how to invoke `pnpm` itself as a child process without ever
 * spawning a `.cmd`/`.ps1` shim directly.
 *
 * Prefers `process.env.npm_execpath`: pnpm sets this to its OWN JS entry
 * point (a `.js`/`.cjs` file) whenever the current process was itself
 * launched via `pnpm ...` — that is run with `process.execPath`, exactly
 * like `resolveBinScript`'s targets, so it is exempt from the shim problem
 * entirely (it is never a `.cmd`).
 *
 * Only when that variable is absent (this script was run directly with
 * `node`, not through `pnpm exec`/`pnpm run`) does this fall back to a bare
 * `pnpm` resolved from PATH. That fallback is spawned with `shell: true` —
 * a deliberate, narrow, documented exception to "never spawn a shim without
 * a shell": every argument here is fixed by this codebase, never end-user or
 * network input, so the usual shell-injection risk of `shell: true` does not
 * apply, and it is the only way to reach a global `pnpm` install (which has
 * no JS entry point of ours to resolve).
 *
 * @returns {{ command: string, args: string[], options: { shell?: boolean } }}
 */
export function pnpmCommand(extraArgs = []) {
  const execPath = process.env['npm_execpath'];
  if (execPath && /\.(m?js|cjs)$/i.test(execPath) && fs.existsSync(execPath)) {
    return { command: process.execPath, args: [execPath, ...extraArgs], options: {} };
  }
  return { command: 'pnpm', args: extraArgs, options: { shell: true } };
}
