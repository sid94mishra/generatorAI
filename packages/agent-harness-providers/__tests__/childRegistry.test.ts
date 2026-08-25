// ────────────────────────────────────────────────────────────────
// childRegistry — the boot reaper's attribution predicate.
//
// This is the only code in the repository that terminates processes it did not
// spawn. The failure that matters is not "an orphan survived" — it is "we
// killed the user's own `claude` session". These tests pin the predicate in
// BOTH directions: the refusals below, and the kill decision further down,
// driven through an injected process table so the terminate call is observable.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let registryDir: string;

beforeEach(() => {
  registryDir = mkdtempSync(join(tmpdir(), 'gai-childreg-'));
  process.env['GENERATORAI_CHILD_REGISTRY_DIR'] = registryDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env['GENERATORAI_CHILD_REGISTRY_DIR'];
  rmSync(registryDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function loadModule() {
  return import('../src/childRegistry.js');
}

function writeRecord(
  bootId: string,
  record: { pid: number; startedAt: number; lastSeenAt: number },
): void {
  writeFileSync(
    join(registryDir, `server-${bootId}.json`),
    JSON.stringify({ bootId, ...record }),
    'utf8',
  );
}

/** A pid that is certainly not running. */
const DEAD_PID = 2 ** 30;

describe('startChildReaperHeartbeat', () => {
  it('publishes a liveness record and removes it on stop', async () => {
    const mod = await loadModule();
    mod.startChildReaperHeartbeat();
    const files = readdirSync(registryDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`server-${mod.SPAWN_BOOT_ID}.json`);

    mod.stopChildReaperHeartbeat();
    expect(existsSync(join(registryDir, files[0]!))).toBe(false);
  });
});

describe('reapOrphanedHarnessChildren', () => {
  it('ignores its own record — a running server does not reap itself', async () => {
    const mod = await loadModule();
    mod.startChildReaperHeartbeat();

    const result = await mod.reapOrphanedHarnessChildren();

    expect(result.recordsInspected).toBe(0);
    expect(result.terminated).toEqual([]);
    // Our own record must survive: the NEXT boot needs it.
    expect(readdirSync(registryDir)).toHaveLength(1);
    mod.stopChildReaperHeartbeat();
  });

  it('leaves a record alone while its server is still alive', async () => {
    const mod = await loadModule();
    // Our own pid stands in for "a second instance that is still running".
    writeRecord('other-boot', {
      pid: process.pid,
      startedAt: Date.now() - 60_000,
      lastSeenAt: Date.now(),
    });

    const result = await mod.reapOrphanedHarnessChildren();

    expect(result.terminated).toEqual([]);
    expect(readdirSync(registryDir)).toHaveLength(1);
  });

  it('discards a record older than the trust window without killing anything', async () => {
    const mod = await loadModule();
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    writeRecord('ancient-boot', {
      pid: DEAD_PID,
      startedAt: Date.now() - eightDays - 60_000,
      lastSeenAt: Date.now() - eightDays,
    });

    const result = await mod.reapOrphanedHarnessChildren();

    expect(result.terminated).toEqual([]);
    expect(readdirSync(registryDir)).toHaveLength(0);
  });

  it('discards a malformed record rather than acting on it', async () => {
    const mod = await loadModule();
    writeFileSync(join(registryDir, 'server-broken.json'), '{ not json', 'utf8');

    const result = await mod.reapOrphanedHarnessChildren();

    expect(result.recordsInspected).toBe(0);
    expect(result.terminated).toEqual([]);
    expect(readdirSync(registryDir)).toHaveLength(0);
  });

  it('does nothing when there is no record at all', async () => {
    const mod = await loadModule();
    const result = await mod.reapOrphanedHarnessChildren();
    expect(result).toEqual({ recordsInspected: 0, terminated: [], skipped: [] });
  });

  it('refuses to act on a dead server whose pid now has unrelated children', async () => {
    // The pid-reuse case. A dead server's pid gets recycled; whatever holds it
    // now may have children of its own, which are nothing to do with us. The
    // record is consumed either way, but nothing is terminated, because no live
    // process on this machine is a child of DEAD_PID inside that window.
    const mod = await loadModule();
    const deadServerStart = Date.now() - 10 * 60_000;

    writeRecord('dead-boot', {
      pid: DEAD_PID,
      startedAt: deadServerStart,
      lastSeenAt: deadServerStart + 60_000,
    });

    const result = await mod.reapOrphanedHarnessChildren();

    expect(result.recordsInspected).toBe(1);
    expect(result.terminated).toEqual([]);
    expect(readdirSync(registryDir)).toHaveLength(0);
  });
});

// ── The kill decision ───────────────────────────────────────────────────────
//
// Everything above pins a REFUSAL. Refusals are the safe direction, so pinning
// only those leaves the predicate untested exactly where it does harm. These
// drive a synthetic process table through the same code with a recording
// `terminate`, so the decision itself is observable.

describe('reapOrphanedHarnessChildren — the kill decision', () => {
  const DEAD_SERVER_START = Date.now() - 10 * 60_000;
  const DEAD_SERVER_LAST_SEEN = DEAD_SERVER_START + 60_000;

  function deadServerRecord(bootId = 'dead-boot'): void {
    writeRecord(bootId, {
      pid: DEAD_PID,
      startedAt: DEAD_SERVER_START,
      lastSeenAt: DEAD_SERVER_LAST_SEEN,
    });
  }

  function deps(rows: Array<{ pid: number; ppid: number; name: string; createdAt?: number }>) {
    const killed: number[] = [];
    return {
      killed,
      deps: {
        snapshot: async () => rows,
        terminate: (pid: number) => killed.push(pid),
        isAlive: (pid: number) => pid !== DEAD_PID,
      },
    };
  }

  it('terminates a child created inside the dead server\u2019s lifetime', async () => {
    const mod = await loadModule();
    deadServerRecord();
    const { killed, deps: d } = deps([
      { pid: 4242, ppid: DEAD_PID, name: 'claude.exe', createdAt: DEAD_SERVER_START + 5_000 },
    ]);

    const result = await mod.reapOrphanedHarnessChildren(undefined, d);

    expect(killed).toEqual([4242]);
    expect(result.terminated).toEqual([{ pid: 4242, name: 'claude.exe' }]);
  });

  it("spares a same-named process created BEFORE the dead server started", async () => {
    // The user's own `claude` session, launched from a shell that has since
    // exited and left it reparented onto a pid the dead server later held.
    // Killing this is the worst outcome the reaper can produce.
    const mod = await loadModule();
    deadServerRecord();
    const { killed, deps: d } = deps([
      { pid: 4242, ppid: DEAD_PID, name: 'claude.exe', createdAt: DEAD_SERVER_START - 60_000 },
    ]);

    const result = await mod.reapOrphanedHarnessChildren(undefined, d);

    expect(killed).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toMatch(/pid was reused/);
  });

  it('spares a process created after the dead server was last seen', async () => {
    const mod = await loadModule();
    deadServerRecord();
    const { killed, deps: d } = deps([
      {
        pid: 4242,
        ppid: DEAD_PID,
        name: 'claude.exe',
        // Beyond lastSeenAt + CREATION_WINDOW_SLACK_MS (2 x 30 s).
        createdAt: DEAD_SERVER_LAST_SEEN + 10 * 60_000,
      },
    ]);

    const result = await mod.reapOrphanedHarnessChildren(undefined, d);

    expect(killed).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/pid was reused/);
  });

  it('spares a process that is not a child of the dead server at all', async () => {
    const mod = await loadModule();
    deadServerRecord();
    const { killed, deps: d } = deps([
      { pid: 4242, ppid: 999_999, name: 'claude.exe', createdAt: DEAD_SERVER_START + 5_000 },
    ]);

    await mod.reapOrphanedHarnessChildren(undefined, d);

    expect(killed).toEqual([]);
  });

  it('spares a process with no creation time \u2014 attribution cannot be confirmed', async () => {
    const mod = await loadModule();
    deadServerRecord();
    const { killed, deps: d } = deps([
      { pid: 4242, ppid: DEAD_PID, name: 'claude' },
    ]);

    const result = await mod.reapOrphanedHarnessChildren(undefined, d);

    expect(killed).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/no creation time/);
  });

  it('KEEPS the record when process enumeration fails, so the next boot retries', async () => {
    // Deleting first meant one failed enumeration orphaned that server's
    // children permanently — recovery destroyed by the code meant to perform it.
    const mod = await loadModule();
    deadServerRecord();

    const result = await mod.reapOrphanedHarnessChildren(undefined, {
      snapshot: async () => [],
      terminate: () => {
        throw new Error('must not be called');
      },
      isAlive: (pid: number) => pid !== DEAD_PID,
    });

    expect(result.terminated).toEqual([]);
    expect(readdirSync(registryDir)).toHaveLength(1);
  });

  it('never signals a process that died between snapshot and kill', async () => {
    const mod = await loadModule();
    deadServerRecord();
    const killed: number[] = [];

    await mod.reapOrphanedHarnessChildren(undefined, {
      snapshot: async () => [
        { pid: 4242, ppid: DEAD_PID, name: 'claude.exe', createdAt: DEAD_SERVER_START + 5_000 },
      ],
      terminate: (pid: number) => killed.push(pid),
      isAlive: () => false,
    });

    expect(killed).toEqual([]);
  });
});

describe('isUsableRecord', () => {
  const now = Date.now();
  const base = { pid: 1234, bootId: 'b', startedAt: now - 60_000, lastSeenAt: now - 1_000 };

  it('accepts a well-formed recent record', async () => {
    const mod = await loadModule();
    expect(mod.isUsableRecord(base, now)).toBe(true);
  });

  it('rejects a record with no startedAt', async () => {
    // `x < undefined` is false, so an absent lower bound does not narrow the
    // attribution window — it REMOVES it, and every child of that pid becomes a
    // candidate at any age.
    const mod = await loadModule();
    expect(mod.isUsableRecord({ ...base, startedAt: undefined as never }, now)).toBe(false);
  });

  it('rejects startedAt after lastSeenAt', async () => {
    const mod = await loadModule();
    expect(mod.isUsableRecord({ ...base, startedAt: now + 60_000 }, now)).toBe(false);
  });

  it('rejects a window wider than a day', async () => {
    const mod = await loadModule();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    expect(mod.isUsableRecord({ ...base, startedAt: weekAgo }, now)).toBe(false);
  });

  it('rejects a non-positive pid', async () => {
    const mod = await loadModule();
    expect(mod.isUsableRecord({ ...base, pid: 0 }, now)).toBe(false);
  });
});

describe('parseEtimeMs', () => {
  // This is what makes recovery work on macOS and Linux at all: without a
  // creation time every POSIX row is skipped.
  it.each([
    ['01:30', 90_000],
    ['00:05', 5_000],
    ['02:00:00', 7_200_000],
    ['1-00:00:00', 86_400_000],
    ['3-04:05:06', 3 * 86_400_000 + 4 * 3_600_000 + 5 * 60_000 + 6_000],
  ])('parses %s', async (raw, expected) => {
    const mod = await loadModule();
    expect(mod.parseEtimeMs(raw)).toBe(expected);
  });

  it('returns undefined for an unparseable field, so the row is skipped', async () => {
    const mod = await loadModule();
    expect(mod.parseEtimeMs('not-a-time')).toBeUndefined();
    expect(mod.parseEtimeMs('')).toBeUndefined();
  });
});

// `killOwnDescendants` is deliberately NOT exercised here. It terminates every
// descendant of the calling process, and a vitest worker's descendants are the
// test runner's business, not ours — a bug in the walk would take down the
// suite rather than fail it. Its safety properties are structural and reviewed
// at the call site: it starts strictly below `process.pid`, re-checks liveness
// immediately before each signal, and runs only on the shutdown path.
