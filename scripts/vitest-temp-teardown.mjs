// ────────────────────────────────────────────────────────────────
// Vitest global setup/teardown.
//
// Two jobs, both about the filesystem the suite runs against:
//
//   1. SETUP pins the CLI's config directory to a throwaway one, so no test
//      can touch the developer's real `~/.generatorai`.
//   2. TEARDOWN reclaims the throwaway workspaces the suite leaks.
//
// Vitest has no `globalTeardown` option: a `globalSetup` file may export a
// `teardown`, which runs once after the whole project's tests finish.
//
// Never throws. Housekeeping must not be able to fail a green test run.
// ────────────────────────────────────────────────────────────────

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

/** The directory this run created, so teardown can remove it. */
let ownedConfigDir = null;

/**
 * Give the run its own CLI identity.
 *
 * `getUserConfigDir()` (packages/cli-core/src/config/paths.ts) falls back to
 * `~/.generatorai`, which holds the developer's real config, connection
 * catalog AND credential vault. Several suites drive command handlers that
 * work on that directory rather than over the wire — `device forget` opens
 * the vault and deletes the entry — so running the tests silently signed the
 * developer out of their CLI. Measured: the vault went from 1,663 bytes to 48
 * (`{"entries":{}}`) and `device status` reported `unpaired`.
 *
 * Nothing failed while it happened, which is what made it expensive: the
 * damage is to a file no assertion looks at, and it only shows up the next
 * time you run a CLI command.
 *
 * Fixing it per-suite is whack-a-mole — it reproduced only when enough files
 * ran together, so the responsible handler depends on what else the worker
 * pool happened to load. Pinning the variable for the whole run removes the
 * class of bug instead of one instance of it. An explicit value is respected,
 * so a suite that wants its own directory still gets one.
 */
export async function setup() {
  if (process.env['GENERATORAI_CONFIG_DIR']) return;
  try {
    ownedConfigDir = mkdtempSync(join(tmpdir(), 'gai-test-config-'));
    process.env['GENERATORAI_CONFIG_DIR'] = ownedConfigDir;
    // Same default, same problem: `~/.generatorai/children`.
    process.env['GENERATORAI_CHILD_REGISTRY_DIR'] ??= join(ownedConfigDir, 'children');
    // And the server's own default, which is the one that actually did the
    // damage. `apps/server` derives its secrets directory from the DATABASE
    // path — `path.dirname(path.resolve(dbPath))`, with `dbPath` falling back
    // to `~/.generatorai` when `DB_PATH` is unset. So any suite that boots a
    // container without setting it opened a secret store on the developer's
    // real vault and left it empty, which is what kept unpairing the CLI.
    // Pinning `GENERATORAI_CONFIG_DIR` alone did not cover this: the CLI and
    // the server read different variables for the same directory.
    process.env['DB_PATH'] ??= join(ownedConfigDir, 'test.db');
  } catch {
    // A run that cannot make a temp dir is a run with bigger problems; do not
    // fail it here. The per-suite isolation still applies.
    ownedConfigDir = null;
  }
}

export async function teardown() {
  if (ownedConfigDir) {
    try {
      rmSync(ownedConfigDir, { recursive: true, force: true });
    } catch {
      // The sweeper below, or the next run, will get it.
    }
  }

  // `--all`: by the time teardown runs the suite is finished, so nothing is
  // holding a fixture and the age guard the standalone script uses would only
  // defer the work to the next run.
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [resolve(here, 'sweep-temp-workspaces.mjs'), '--all'],
      { timeout: 60_000 },
    );
    const line = stdout.trim();
    if (line) console.log(line);
  } catch {
    // A sweep that cannot run leaves the directories for the next one.
  }
}
