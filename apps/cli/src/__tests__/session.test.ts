import { describe, expect, it, vi } from 'vitest';
import type { CommandSpec } from '@generatorai/cli-core';
import { createContextFor, type Session } from '../session.js';
import type { OutputMode } from '../render/Renderer.js';

function fakeSession(outputMode: OutputMode): Session {
  return {
    config: { cli: { verbose: false, assumeYes: false }, server: { timeoutMs: 5000 } },
    capabilities: { columns: 80, rows: 24, isTTY: false, interactive: false },
    renderer: { handleEvent: vi.fn() } as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    outputMode,
    dispose: async () => {},
  } as unknown as Session;
}

function unboundedStreamSpec(): CommandSpec {
  return {
    id: 'chat.watch',
    group: 'chat',
    verb: 'watch',
    summary: '',
    args: [],
    flags: [],
    requiresServer: false, // avoids needing a real client for the negative-path test
    sinceVersion: '0.2.0',
    output: { kind: 'stream', unbounded: true },
    handler: async () => ({ data: null }),
  } as unknown as CommandSpec;
}

function boundedStreamSpec(): CommandSpec {
  return { ...unboundedStreamSpec(), output: { kind: 'stream' } };
}

describe('createContextFor — unbounded stream vs. bounded output modes', () => {
  it('refuses an unbounded stream command under --json before doing anything else', async () => {
    const spec = unboundedStreamSpec();
    await expect(
      createContextFor(spec, { session: fakeSession('json'), flags: {}, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('refuses an unbounded stream command under --yaml', async () => {
    const spec = unboundedStreamSpec();
    await expect(
      createContextFor(spec, { session: fakeSession('yaml'), flags: {}, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('allows an unbounded stream command under --ndjson, the mode designed for it', async () => {
    const spec = unboundedStreamSpec();
    await expect(
      createContextFor(spec, { session: fakeSession('ndjson'), flags: {}, signal: new AbortController().signal }),
    ).resolves.toBeTruthy();
  });

  it('allows a bounded stream command under --json', async () => {
    const spec = boundedStreamSpec();
    await expect(
      createContextFor(spec, { session: fakeSession('json'), flags: {}, signal: new AbortController().signal }),
    ).resolves.toBeTruthy();
  });
});
