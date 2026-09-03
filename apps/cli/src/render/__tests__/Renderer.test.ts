import { describe, expect, it } from 'vitest';
import type { CommandResult, CommandSpec } from '@generatorai/cli-core';
import { Renderer, type NdjsonFrame, type OutputMode } from '../Renderer.js';

function fakeCapabilities() {
  return { columns: 120, rows: 40, colorDepth: 'truecolor', interactive: true, isTTY: true } as never;
}

function makeRenderer(mode: OutputMode) {
  const out: string[] = [];
  const err: string[] = [];
  const renderer = new Renderer({
    mode,
    capabilities: fakeCapabilities(),
    color: false,
    unicode: true,
    write: (t) => out.push(t),
    writeError: (t) => err.push(t),
  });
  return { renderer, out, err };
}

const STREAM_SPEC = {
  id: 'chat.send',
  group: 'chat',
  verb: 'send',
  summary: '',
  args: [],
  flags: [],
  requiresServer: true,
  sinceVersion: '0.2.0',
  output: { kind: 'stream' },
  handler: async () => ({ data: null }),
} as unknown as CommandSpec;

const LIST_SPEC = {
  id: 'chat.list',
  group: 'chat',
  verb: 'list',
  summary: '',
  args: [],
  flags: [],
  requiresServer: true,
  sinceVersion: '0.2.0',
  output: { kind: 'list' },
  handler: async () => ({ data: [] }),
} as unknown as CommandSpec;

function parseFrames(lines: string[]): NdjsonFrame[] {
  return lines.map((l) => JSON.parse(l.trim()) as NdjsonFrame);
}

describe('Renderer — --json mode never mixes stream frames into the final document', () => {
  it('handleEvent writes nothing at all', () => {
    const { renderer, out } = makeRenderer('json');
    renderer.handleEvent({ type: 'chunk', text: 'hello' });
    renderer.handleEvent({ type: 'log', level: 'info', message: 'starting' });
    renderer.handleEvent({ type: 'stream', kind: 'harness.token', data: { text: 'x' } });
    expect(out).toEqual([]);
  });

  it('render() writes exactly one line, and it is one parseable JSON document', () => {
    const { renderer, out } = makeRenderer('json');
    renderer.handleEvent({ type: 'chunk', text: 'hello' });
    renderer.render(STREAM_SPEC, { data: { ok: true } } as CommandResult);
    expect(out).toHaveLength(1);
    expect(() => JSON.parse(out[0]!)).not.toThrow();
    expect(JSON.parse(out[0]!)).toMatchObject({ apiVersion: 1, kind: 'chat.send', data: { ok: true } });
  });
});

describe('Renderer — --yaml mode never mixes stream frames into the final document', () => {
  it('handleEvent writes nothing', () => {
    const { renderer, out } = makeRenderer('yaml');
    renderer.handleEvent({ type: 'chunk', text: 'hello' });
    renderer.handleEvent({ type: 'stream', kind: 'x', data: {} });
    expect(out).toEqual([]);
  });

  it('render() writes exactly one document', () => {
    const { renderer, out } = makeRenderer('yaml');
    renderer.render(STREAM_SPEC, { data: { ok: true } } as CommandResult);
    expect(out).toHaveLength(1);
  });
});

describe('Renderer — --ndjson mode: every line is a versioned frame', () => {
  it('classifies chunk/log/stream/row/progress events into the right frame kind', () => {
    const { renderer, out } = makeRenderer('ndjson');
    renderer.handleEvent({ type: 'chunk', text: 'hi', channel: 'stdout' });
    renderer.handleEvent({ type: 'log', level: 'error', message: 'boom' });
    renderer.handleEvent({ type: 'log', level: 'warn', message: 'careful' });
    renderer.handleEvent({ type: 'log', level: 'info', message: 'note' });
    renderer.handleEvent({ type: 'stream', kind: 'harness.token', data: { text: 'x' } });
    renderer.handleEvent({ type: 'row', row: { id: 1 } });
    renderer.handleEvent({ type: 'progress', message: '50%' });

    const frames = parseFrames(out);
    expect(frames.every((f) => f.v === 1)).toBe(true);
    expect(frames.map((f) => f.frame)).toEqual([
      'data', // chunk
      'error', // log/error
      'warning', // log/warn
      'lifecycle', // log/info
      'data', // stream
      'data', // row
      'lifecycle', // progress
    ]);
  });

  it('render() on a stream command ends with exactly one completion frame', () => {
    const { renderer, out } = makeRenderer('ndjson');
    renderer.handleEvent({ type: 'chunk', text: 'partial' });
    renderer.render(STREAM_SPEC, { data: { done: true }, message: 'Sent.' } as CommandResult);

    const frames = parseFrames(out);
    const completions = frames.filter((f) => f.frame === 'completion');
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ v: 1, kind: 'chat.send', data: { done: true }, message: 'Sent.' });
  });

  it('render() on a list command emits one data frame per row plus one completion frame', () => {
    const { renderer, out } = makeRenderer('ndjson');
    renderer.render(LIST_SPEC, { data: [{ id: 1 }, { id: 2 }] } as CommandResult);

    const frames = parseFrames(out);
    expect(frames.filter((f) => f.frame === 'data')).toHaveLength(2);
    expect(frames.filter((f) => f.frame === 'completion')).toHaveLength(1);
    expect(frames.at(-1)?.frame).toBe('completion');
  });
});

describe('Renderer — --quiet mode', () => {
  it('handleEvent writes nothing on either stream', () => {
    const { renderer, out, err } = makeRenderer('quiet');
    renderer.handleEvent({ type: 'chunk', text: 'hi' });
    renderer.handleEvent({ type: 'log', level: 'error', message: 'boom' });
    expect(out).toEqual([]);
    expect(err).toEqual([]);
  });
});
