import { describe, it, expect, vi } from 'vitest';
import { EditorLauncherService, buildFallbackUrl } from '../EditorLauncherService.js';
import { silentLogger } from './helpers.js';

function make(opts: {
  onPath?: string[];
  installed?: string[];
  defaultEditor?: 'vscode' | 'cursor' | null;
  spawnThrows?: boolean;
}) {
  const spawned: Array<{ cmd: string; args: string[] }> = [];
  const unref = vi.fn();
  const runner = {
    run: vi.fn(async (cmd: string) => ({
      exitCode: (opts.onPath ?? []).includes(cmd) ? 0 : 127,
      stdout: '',
      stderr: '',
    })),
  };
  const service = new EditorLauncherService({
    logger: silentLogger,
    processRunner: runner,
    fileExists: async (p: string) => (opts.installed ?? []).includes(p),
    defaultEditor: opts.defaultEditor === undefined ? undefined : () => opts.defaultEditor!,
    spawn: (cmd, args) => {
      if (opts.spawnThrows) throw new Error('ENOENT');
      spawned.push({ cmd, args });
      return { unref };
    },
  });
  return { service, spawned, unref, runner };
}

const MAC_CODE = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';

describe('buildFallbackUrl', () => {
  it('builds a vscode://file URL with line and column', () => {
    expect(buildFallbackUrl('vscode', { path: '/src/a.ts', line: 12, column: 3 })).toBe(
      'vscode://file/src/a.ts:12:3',
    );
  });

  it('omits the column when absent and the suffix when there is no line', () => {
    expect(buildFallbackUrl('cursor', { path: '/src/a.ts', line: 12 })).toBe(
      'cursor://file/src/a.ts:12',
    );
    expect(buildFallbackUrl('cursor', { path: '/src/a.ts' })).toBe('cursor://file/src/a.ts');
  });

  it('normalises a Windows path to a leading-slash forward-slash path', () => {
    expect(buildFallbackUrl('vscode', { path: 'C:\\src\\a.ts', line: 4 })).toBe(
      'vscode://file/C:/src/a.ts:4',
    );
  });
});

describe('EditorLauncherService', () => {
  it('reports availability from PATH', async () => {
    const { service, runner } = make({ onPath: ['code'] });
    const editors = await service.listEditors();
    expect(editors.find((e) => e.id === 'vscode')).toMatchObject({
      name: 'VS Code',
      available: true,
      scheme: 'vscode',
    });
    expect(editors.find((e) => e.id === 'cursor')?.available).toBe(false);
    expect(await service.resolve('vscode')).toBe('code');
    // The 60s cache means the probe does not run again.
    const calls = runner.run.mock.calls.length;
    await service.resolve('vscode');
    expect(runner.run.mock.calls.length).toBe(calls);
  });

  it('reports availability from the well-known install table', async () => {
    const { service } = make({ onPath: [], installed: [MAC_CODE] });
    // Only meaningful on macOS, where that path is in the table.
    if (process.platform === 'darwin') {
      expect(await service.resolve('vscode')).toBe(MAC_CODE);
    } else {
      expect(await service.resolve('vscode')).toBeNull();
    }
  });

  it('reports an editor that is nowhere as unavailable', async () => {
    const { service } = make({ onPath: [], installed: [] });
    expect(await service.resolve('windsurf')).toBeNull();
    expect((await service.listEditors()).every((e) => !e.available)).toBe(true);
  });

  it('opens with -g path:line:col and always returns a fallbackUrl', async () => {
    const { service, spawned, unref } = make({ onPath: ['code'] });
    const result = await service.open({ path: '/src/a.ts', line: 12, column: 3 });
    expect(result).toEqual({
      ok: true,
      editor: 'vscode',
      fallbackUrl: 'vscode://file/src/a.ts:12:3',
    });
    expect(spawned).toEqual([{ cmd: 'code', args: ['-g', '/src/a.ts:12:3'] }]);
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('opens with a bare path when no line is given', async () => {
    const { service, spawned } = make({ onPath: ['code'] });
    await service.open({ path: '/src/a.ts' });
    expect(spawned[0]!.args).toEqual(['/src/a.ts']);
  });

  it('honours the configured default editor', async () => {
    const { service, spawned } = make({ onPath: ['code', 'cursor'], defaultEditor: 'cursor' });
    const result = await service.open({ path: '/src/a.ts' });
    expect(result.editor).toBe('cursor');
    expect(spawned[0]!.cmd).toBe('cursor');
  });

  it('falls back to the first available editor', async () => {
    const { service } = make({ onPath: ['windsurf'], defaultEditor: null });
    expect((await service.open({ path: '/src/a.ts' })).editor).toBe('windsurf');
  });

  it('returns ok:false with an error AND a fallbackUrl for an unavailable editor', async () => {
    const { service } = make({ onPath: [], installed: [] });
    const result = await service.open({ path: '/src/a.ts', line: 9, editor: 'cursor' });
    expect(result.ok).toBe(false);
    expect(result.editor).toBe('cursor');
    expect(result.fallbackUrl).toBe('cursor://file/src/a.ts:9');
    expect(result.error).toContain('Cursor');
  });

  it('returns ok:false with a fallbackUrl when nothing at all is installed', async () => {
    const { service } = make({ onPath: [], installed: [], defaultEditor: null });
    const result = await service.open({ path: '/src/a.ts' });
    expect(result.ok).toBe(false);
    expect(result.editor).toBeUndefined();
    expect(result.fallbackUrl).toBe('vscode://file/src/a.ts');
    expect(result.error).toContain('No supported editor');
  });

  it('never throws when the spawn fails', async () => {
    const { service } = make({ onPath: ['code'], spawnThrows: true });
    const result = await service.open({ path: '/src/a.ts' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ENOENT');
    expect(result.fallbackUrl).toBe('vscode://file/src/a.ts');
  });
});
