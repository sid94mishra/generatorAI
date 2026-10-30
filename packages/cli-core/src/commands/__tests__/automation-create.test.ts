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
      definitions: { list: vi.fn(async () => ({ items: [WORKFLOW] })) },
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
  it('rejects invalid --data-schema JSON before creating anything', async () => {
    const createFn = vi.fn();
    const ctx = fakeContext({ create: createFn });

    await expect(
      create.handler(ctx, {
        args: {},
        flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', dataSchema: '{not json', iterationMode: '{"kind":"each_row"}' },
      } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('requires --iteration-mode with --data-schema (the server refuses a schema without one)', async () => {
    const createFn = vi.fn();
    const ctx = fakeContext({ create: createFn });

    await expect(
      create.handler(ctx, {
        args: {},
        flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', dataSchema: '{"format":"json_array","fields":[]}' },
      } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('forwards the parsed data schema and iteration mode', async () => {
    const createFn = vi.fn(async () => ({ id: 'auto_1', enabled: false }));
    const ctx = fakeContext({ create: createFn });

    await create.handler(ctx, {
      args: {},
      flags: {
        name: 'x',
        workflow: ['e2e'],
        trigger: 'manual',
        dataSchema: '{"format":"json_array","fields":[{"name":"file","type":"string"}]}',
        iterationMode: '{"kind":"each_row"}',
      },
    } as never);

    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSchema: { format: 'json_array', fields: [{ name: 'file', type: 'string' }] },
        iterationMode: { kind: 'each_row' },
      }),
    );
    expect(createFn).toHaveBeenCalledWith(expect.not.objectContaining({ inputMode: expect.anything() }));
  });

  it('requires --default-dataset-format with --default-dataset-file', async () => {
    const createFn = vi.fn();
    const ctx = fakeContext({ create: createFn });

    await expect(
      create.handler(ctx, {
        args: {},
        flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', defaultDatasetFile: '/tmp/rows.json' },
      } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('calls enable() as a follow-up when --enabled is set, since create has no such field', async () => {
    const createFn = vi.fn(async () => ({ id: 'auto_1', enabled: false }));
    const enableFn = vi.fn(async () => ({ id: 'auto_1', enabled: true }));
    const ctx = fakeContext({ create: createFn, enable: enableFn });

    const result = await create.handler(ctx, {
      args: {},
      flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', enabled: true },
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
      flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', enabled: true },
    } as never);

    expect(result.data).toEqual({ id: 'auto_1', enabled: false });
    expect(result.warnings).toEqual([expect.stringContaining('was not enabled')]);
  });

  it('does not call enable() when --enabled is omitted', async () => {
    const enableFn = vi.fn();
    const ctx = fakeContext({ enable: enableFn });

    await create.handler(ctx, {
      args: {},
      flags: { name: 'x', workflow: ['e2e'], trigger: 'manual' },
    } as never);

    expect(enableFn).not.toHaveBeenCalled();
  });

  it("caps --maxConcurrency at the server's limit of 10 via the command schema", () => {
    const result = create.schema!.safeParse({
      args: {},
      flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', maxConcurrency: '20' },
    });
    expect(result.success).toBe(false);
  });

  it('allows --maxConcurrency at exactly the cap', () => {
    const result = create.schema!.safeParse({
      args: {},
      flags: { name: 'x', workflow: ['e2e'], trigger: 'manual', maxConcurrency: '10' },
    });
    expect(result.success).toBe(true);
  });
});
