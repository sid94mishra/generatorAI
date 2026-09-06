// ────────────────────────────────────────────────────────────────
// OrphanProcessReaper — selection is the whole risk, so it is the whole test.
//
// The reaper must kill exactly the child processes a previous run of THIS
// installation left behind (rg scans and Claude CLI sessions whose parent is
// gone and whose command line names one of our directories) and nothing else
// on the machine: not a live session, not another tool's rg, not ourselves.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import { OrphanProcessReaper, selectOrphans, type OsProcess } from '../src/services/OrphanProcessReaper.js';

const ART = 'C:\\Users\\me\\.generatorai\\artifacts';
const WS = 'C:\\Users\\me\\.generatorai\\workspaces';
const OWNED = [ART, WS];

const p = (pid: number, parentPid: number, name: string, commandLine: string): OsProcess => ({ pid, parentPid, name, commandLine });

describe('selectOrphans', () => {
  it('selects an rg scan of our artifacts whose parent is dead', () => {
    const procs = [p(10, 999, 'claude.exe', `rg --no-config --files --hidden ${ART}`)];
    expect(selectOrphans(procs, OWNED, 1).map((x) => x.pid)).toEqual([10]);
  });

  it('matches paths case-insensitively and with either slash style', () => {
    const procs = [p(10, 999, 'rg.exe', `rg --files c:/users/ME/.generatorai/workspaces/executions/abc`)];
    expect(selectOrphans(procs, OWNED, 1)).toHaveLength(1);
  });

  it('leaves an rg scan alone while its parent is alive', () => {
    const procs = [p(5, 1, 'claude.exe', '--output-format stream-json --cwd x'), p(10, 5, 'claude.exe', `rg --files ${ART}`)];
    expect(selectOrphans(procs, OWNED, 1)).toHaveLength(0);
  });

  it('never touches an rg scan of a directory we do not own (another tool\'s orphan)', () => {
    const procs = [p(10, 999, 'claude.exe', 'rg --no-config --files --hidden C:\\Users\\me\\.claude\\plugins\\cache')];
    expect(selectOrphans(procs, OWNED, 1)).toHaveLength(0);
  });

  it('selects an orphaned Claude CLI session that was started for our workspace', () => {
    const procs = [
      p(20, 999, 'claude.exe', `C:\\bin\\claude.exe --output-format stream-json --input-format stream-json --cwd ${WS}\\executions\\run-1`),
    ];
    expect(selectOrphans(procs, OWNED, 1).map((x) => x.pid)).toEqual([20]);
  });

  it('leaves a live Claude CLI session alone even if its parent is the server we are', () => {
    const procs = [p(1, 0, 'node.exe', 'node server'), p(20, 1, 'claude.exe', `--output-format stream-json --cwd ${WS}`)];
    expect(selectOrphans(procs, OWNED, 1)).toHaveLength(0);
  });

  it('never selects itself or its ancestors, whatever their command lines say', () => {
    const procs = [
      p(100, 0, 'claude.exe', `rg --files ${ART}`), // an ancestor that happens to look like a scan
      p(200, 100, 'node.exe', `node server ${ART}`),
      p(300, 200, 'node.exe', `rg --files ${ART}`), // self, absurdly named
    ];
    expect(selectOrphans(procs, OWNED, 300)).toHaveLength(0);
  });

  it('ignores unrelated orphans (a dead-parent notepad in our directory is not a scan)', () => {
    const procs = [p(10, 999, 'notepad.exe', `notepad ${ART}\\notes.txt`)];
    expect(selectOrphans(procs, OWNED, 1)).toHaveLength(0);
  });

  it('selects nothing when no owned directories are configured', () => {
    const procs = [p(10, 999, 'rg.exe', `rg --files ${ART}`)];
    expect(selectOrphans(procs, [], 1)).toHaveLength(0);
  });
});

describe('OrphanProcessReaper.reap', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

  it('kills exactly the selected pids and reports counts', async () => {
    const kill = vi.fn(async () => {});
    const reaper = new OrphanProcessReaper({
      ownedDirs: OWNED,
      logger,
      platform: 'win32',
      selfPid: 1,
      listProcesses: async () => [
        p(10, 999, 'claude.exe', `rg --files ${ART}`),
        p(11, 999, 'claude.exe', 'rg --files C:\\elsewhere'),
        p(12, 1, 'claude.exe', `rg --files ${ART}`),
      ],
      killProcess: kill,
    });
    const summary = await reaper.reap();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(10);
    expect(summary).toMatchObject({ scanned: 3, candidates: 1, killed: 1, failed: 0, skipped: null });
  });

  it('a kill failure is counted, not thrown', async () => {
    const reaper = new OrphanProcessReaper({
      ownedDirs: OWNED,
      logger,
      platform: 'win32',
      selfPid: 1,
      listProcesses: async () => [p(10, 999, 'rg.exe', `rg ${ART}`)],
      killProcess: async () => { throw new Error('access denied'); },
    });
    const summary = await reaper.reap();
    expect(summary).toMatchObject({ candidates: 1, killed: 0, failed: 1 });
  });

  it('does nothing off Windows', async () => {
    const list = vi.fn(async () => [p(10, 999, 'rg', `rg ${ART}`)]);
    const reaper = new OrphanProcessReaper({ ownedDirs: OWNED, logger, platform: 'linux', selfPid: 1, listProcesses: list, killProcess: async () => {} });
    const summary = await reaper.reap();
    expect(summary.skipped).toBe('platform');
    expect(list).not.toHaveBeenCalled();
  });
});
