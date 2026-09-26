// ────────────────────────────────────────────────────────────────
// Atomic, permission-restricted file writes (Node only).
//
// Moved from @generatorai/secrets (P01 WP-1.7) so the workflow-script
// upload can validate a script and then install it atomically with the
// same helper the secret vault uses (R-9: OneDrive-style EPERM on rename).
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * `fs.renameSync` with a short retry, for Windows' transient EPERM/EBUSY.
 *
 * Deliberately synchronous and bounded: this sits on the boot path, so it must
 * not become a place the process can hang. A failure that outlives the budget
 * is a real one and is rethrown with the original cause.
 */
export function renameWithRetry(
  from: string,
  to: string,
  attempts = 10,
  delayMs = 30,
  /** Injectable purely so the retry can be tested; ESM exports cannot be spied on. */
  rename: (a: string, b: string) => void = fs.renameSync,
): void {
  for (let i = 0; ; i += 1) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (transient && i >= attempts - 1) {
        // Not transient after all: something holds the DESTINATION open for as
        // long as it likes. A file-syncing client (OneDrive — and this repo
        // lives under a synced Desktop) or an endpoint scanner both do this,
        // and a rename can never replace a directory entry whose target is
        // held. Observed for real: months of orphaned `.tmp` files next to the
        // vault, and a FATAL boot failure every time the server restarted.
        //
        // Copy the bytes into the existing file instead. That gives up the
        // rename's atomicity — a crash mid-copy can leave a short file — which
        // is why it is the fallback and not the path: the alternative here is
        // not "atomic write", it is "the server does not start".
        try {
          fs.copyFileSync(from, to);
          try {
            fs.unlinkSync(from);
          } catch {
            /* best effort */
          }
          return;
        } catch {
          // Fall through and report the original rename failure.
        }
      }
      if (!transient || i >= attempts - 1) {
        // Leave no stray temp file behind on a genuine failure.
        try {
          fs.unlinkSync(from);
        } catch {
          /* best effort */
        }
        throw err;
      }
      // Busy-wait: there is no synchronous sleep, and the window is milliseconds.
      const until = Date.now() + delayMs;
      while (Date.now() < until) {
        /* spin briefly */
      }
    }
  }
}

/**
 * Atomic, permission-restricted write: temp file in the same directory →
 * fsync → rename → fsync(dir). `mode: 0o600` is applied at creation time so
 * there is never a window where the file is world-readable.
 *
 * On Windows the mode bits are ignored by the OS; inherited ACLs from the
 * per-user AppData/userData directory provide the equivalent protection.
 */
export function writeFileAtomicRestricted(filePath: string, data: Buffer | string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    /* Windows / unsupported FS */
  }
  // Windows fails an otherwise-valid rename with EPERM/EBUSY whenever anything
  // else holds the destination open for even a moment — a virus scanner, the
  // search indexer, or the previous server process on a fast restart. It is
  // transient, and it was FATAL here: a dev-server restart killed the whole
  // process with `EPERM: operation not permitted, rename …secrets.vault.json`
  // before it finished booting. Retry briefly, then report honestly.
  renameWithRetry(tmp, filePath);
  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Directory fsync is not supported on Windows; the rename is still atomic.
  }
}
