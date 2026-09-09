#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Sweep leaked test temp directories.
//
// The suite creates throwaway workspaces with `mkdtemp(join(tmpdir(), 'gai-…'))`.
// 53 of the 57 files that do this already have an `afterEach`/`rmSync` cleanup
// — and it still leaks, because on Windows `rm` fails with EPERM/EBUSY while a
// SQLite handle or a spawned child still holds a file, and every one of those
// call sites passes `force: true`, which swallows the error.
//
// Measured on this machine: **6,807 leaked `gai-*` / `genai-*` directories
// totalling 18.8 GB**, accumulated over six days, which had taken the system
// disk down to 244 MB free.
//
// Fixing 53 call sites individually would not help: the failure is a race with
// handle release, not a missing call. A sweep is the right shape — it runs when
// nothing holds the handles any more, and it cannot break a test.
//
//   node scripts/sweep-temp-workspaces.mjs            # older than 2h
//   node scripts/sweep-temp-workspaces.mjs --all      # everything
//   node scripts/sweep-temp-workspaces.mjs --dry-run
// ────────────────────────────────────────────────────────────────

import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Prefixes this repo's tests use for throwaway directories. */
const PREFIXES = [/^gai-/, /^genai-/];

/**
 * Directories younger than this are left alone, so a sweep can never delete a
 * fixture a concurrently running test is still using.
 */
const DEFAULT_MIN_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * The floor that `--all` lowers to — sixty seconds, not zero.
 *
 * `--all` used to mean "no age guard at all", and the vitest teardown passes it
 * on the reasoning that "by the time teardown runs the suite is finished, so
 * nothing is holding a fixture". That is true of ONE vitest project and false
 * under `turbo test`, which runs every package's suite in parallel: one
 * package's teardown fires while another package's tests are still going, and
 * the sweep deletes a fixture out from under them. Both prefixes below are
 * shared by every suite in the repo, so there is nothing to distinguish "my
 * leftovers" from "someone else's live fixture".
 *
 * Observed exactly once, and only in a full parallel run:
 *   childRegistry.test.ts → ENOENT: scandir '…/gai-childreg-e0UVXx'
 * — a directory the test had created moments earlier and was still asserting
 * against. It passes alone every time, which is what makes this kind of flake
 * expensive: it reddens CI without pointing at anything real.
 *
 * A directory written to within the last minute is by definition still in use.
 * Everything this sweep exists to reclaim — thousands of leaked directories
 * from runs that have long since exited — is far older than that, so the floor
 * costs nothing and closes the race.
 */
const ALL_MIN_AGE_MS = 60_000;

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const minAgeMs = args.has('--all') ? ALL_MIN_AGE_MS : DEFAULT_MIN_AGE_MS;
  const root = tmpdir();
  const cutoff = Date.now() - minAgeMs;

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    console.error(`[sweep] cannot read ${root}: ${String(err)}`);
    process.exit(0); // never fail a build over housekeeping
  }

  const candidates = entries.filter((e) => e.isDirectory() && PREFIXES.some((p) => p.test(e.name)));

  let removed = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  for (const entry of candidates) {
    const full = join(root, entry.name);
    try {
      const info = await stat(full);
      if (info.mtimeMs > cutoff) {
        skipped += 1;
        continue;
      }
      bytes += await sizeOf(full);
      if (!dryRun) await rm(full, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      removed += 1;
    } catch {
      // Still locked, or vanished under us. Either way the next sweep gets it.
      failed += 1;
    }
  }

  const mb = Math.round(bytes / 1048576);
  console.log(
    `[sweep] ${dryRun ? 'would remove' : 'removed'} ${removed} temp dir(s) (~${mb} MB); ` +
      `${skipped} too recent, ${failed} still locked`,
  );
}

/** Best-effort recursive size. Never throws — a locked subtree just counts 0. */
async function sizeOf(dir) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    try {
      if (e.isDirectory()) total += await sizeOf(full);
      else total += (await stat(full)).size;
    } catch {
      // Unreadable entry — skip it.
    }
  }
  return total;
}

await main();
