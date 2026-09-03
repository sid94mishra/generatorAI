import { describe, expect, it, vi } from 'vitest';
import { automationCommands } from '../automation.js';
import type { CliContext } from '../../context/CliContext.js';

const WORKFLOW = { id: '00000000-0000-0000-0000-000000000001', name: 'e2e', status: 'active', createdAt: 0 };

function fakeContext(overrides: {
  create?: ReturnType<typeof vi.fn>;
  enable?: ReturnType<typeof vi.fn>;
}): CliContext {
  return {
    api: {
      definitions: { list: vi.fn(async () => [WORKFLOW]) },
      projects: { list: vi.fn(async () => []) },
      automations: {
        create: overrides.create ?? vi.fn(async () => ({ id: 'auto_1', enabled: false })),
        enable: overrides.enable ?? vi.fn(async () => ({ id: 'auto_1', enabled: true })),
      },
    },
  } as unknown as CliContext;
}

const create = automationCommands().find((c) => c.id === 'automation.create')!;

describe('automation create', () => {
  it('rejects invalid --dataSource JSON before creating anything', async () => {
    const createFn = vi.fn();
    const ctx = fakeContext({ create: createFn });

    await expect(
      create.handler(ctx, {
        args: {},
        flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', inputMode: 'single', dataSource: '{not json' },
      } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('rejects a --dataSource object missing a valid "type" discriminant', async () => {
    const createFn = vi.fn();
    const ctx = fakeContext({ create: createFn });

    await expect(
      create.handler(ctx, {
        args: {},
        flags: {
          name: 'x',
          workflow: ['e2e'],
          trigger: 'manual',
          inputMode: 'single',
          dataSource: JSON.stringify({ scriptId: 'abc' }),
        },
      } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('accepts a valid typed --dataSource and forwards it as dataSourceConfig', async () => {
    const createFn = vi.fn(async () => ({ id: 'auto_1', enabled: false }));
    const ctx = fakeContext({ create: createFn });

    await create.handler(ctx, {
      args: {},
      flags: {
        name: 'x',
        workflow: ['e2e'],
        trigger: 'manual',
        inputMode: 'single',
        dataSource: JSON.stringify({ type: 'script', command: 'python fetch.py' }),
      },
    } as never);

    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ dataSourceConfig: { type: 'script', command: 'python fetch.py' } }),
    );
  });

  it('calls enable() as a follow-up when --enabled is set, since create has no such field', async () => {
    const createFn = vi.fn(async () => ({ id: 'auto_1', enabled: false }));
    const enableFn = vi.fn(async () => ({ id: 'auto_1', enabled: true }));
    const ctx = fakeContext({ create: createFn, enable: enableFn });

    const result = await create.handler(ctx, {
      args: {},
      flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', inputMode: 'single', enabled: true },
    } as never);

    expect(createFn).toHaveBeenCalledWith(expect.not.objectContaining({ enabled: expect.anything() }));
    expect(enableFn).toHaveBeenCalledWith('auto_1');
    // The returned record must reflect enable()'s response, not create()'s
    // pre-enable one — otherwise `--json`/the printed record says
    // `enabled: false` for an automation the server just enabled.
    expect(result.data).toEqual({ id: 'auto_1', enabled: true });
  });

  it('falls back to the pre-enable record (with a warning) when the enable() follow-up fails', async () => {
    const createFn = vi.fn(async () => ({ id: 'auto_1', enabled: false }));
    const enableFn = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctx = fakeContext({ create: createFn, enable: enableFn });

    const result = await create.handler(ctx, {
      args: {},
      flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', inputMode: 'single', enabled: true },
    } as never);

    expect(result.data).toEqual({ id: 'auto_1', enabled: false });
    expect(result.warnings).toEqual([expect.stringContaining('was not enabled')]);
  });

  it('does not call enable() when --enabled is omitted', async () => {
    const enableFn = vi.fn();
    const ctx = fakeContext({ enable: enableFn });

    await create.handler(ctx, {
      args: {},
      flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', inputMode: 'single' },
    } as never);

    expect(enableFn).not.toHaveBeenCalled();
  });

  it('--input-mode loop requires --loop-items, which the server also requires non-empty', async () => {
    const createFn = vi.fn();
    const ctx = fakeContext({ create: createFn });

    await expect(
      create.handler(ctx, {
        args: {},
        flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', inputMode: 'loop', loopVariable: 'file' },
      } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('rejects --loop-items that is not a non-empty JSON array', async () => {
    const createFn = vi.fn();
    const ctx = fakeContext({ create: createFn });

    await expect(
      create.handler(ctx, {
        args: {},
        flags: {
          name: 'x',
          workflow: ['e2e'],
          trigger: 'manual',
          inputMode: 'loop',
          loopVariable: 'file',
          loopItems: '[]',
        },
      } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('sends parsed loopItems through to automations.create for a valid loop-mode request', async () => {
    const createFn = vi.fn(async () => ({ id: 'auto_1', enabled: false }));
    const ctx = fakeContext({ create: createFn });

    await create.handler(ctx, {
      args: {},
      flags: {
        name: 'x',
        workflow: ['e2e'],
        trigger: 'manual',
        inputMode: 'loop',
        loopVariable: 'file',
        loopItems: '["a.ts","b.ts"]',
      },
    } as never);

    expect(createFn).toHaveBeenCalledWith(expect.objectContaining({ loopItems: ['a.ts', 'b.ts'] }));
  });

  it('--input-mode batch requires --batch-format and --batch-data (server 400s without either)', async () => {
    const createFn = vi.fn();
    const ctx = fakeContext({ create: createFn });

    await expect(
      create.handler(ctx, {
        args: {},
        flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', inputMode: 'batch', batchFormat: 'csv' },
      } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('accepts --batch-data directly and forwards it', async () => {
    const createFn = vi.fn(async () => ({ id: 'auto_1', enabled: false }));
    const ctx = fakeContext({ create: createFn });

    await create.handler(ctx, {
      args: {},
      flags: {
        name: 'x',
        workflow: ['e2e'],
        trigger: 'manual',
        inputMode: 'batch',
        batchFormat: 'csv',
        batchData: 'a,b\n1,2',
      },
    } as never);

    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ batchDataFormat: 'csv', batchData: 'a,b\n1,2' }),
    );
  });

  it('rejects --batch-data and --batch-data-file together', async () => {
    const createFn = vi.fn();
    const ctx = fakeContext({ create: createFn });

    await expect(
      create.handler(ctx, {
        args: {},
        flags: {
          name: 'x',
          workflow: ['e2e'],
          trigger: 'manual',
          inputMode: 'batch',
          batchFormat: 'csv',
          batchData: 'a,b',
          batchDataFile: '/tmp/whatever.csv',
        },
      } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(createFn).not.toHaveBeenCalled();
  });

  it("caps --maxConcurrency at the server's limit of 10 via the command schema", () => {
    const result = create.schema!.safeParse({
      args: {},
      flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', inputMode: 'single', maxConcurrency: '20' },
    });
    expect(result.success).toBe(false);
  });

  it('allows --maxConcurrency at exactly the cap', () => {
    const result = create.schema!.safeParse({
      args: {},
      flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', inputMode: 'single', maxConcurrency: '10' },
    });
    expect(result.success).toBe(true);
  });
});
