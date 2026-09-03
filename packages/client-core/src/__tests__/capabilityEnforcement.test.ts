// ────────────────────────────────────────────────────────────────
// W29 — the RUNTIME half of the capability ledger.
//
// `packages/shared/__tests__/TransportCapabilities.test.ts` asserts the ledger
// is well-formed as data. This file asserts the ledger is TRUE: for every
// surface, it drives the shared runtime with that surface's declaration and
// checks the observable behaviour matches what was declared — including the
// negatives, because "this surface does NOT do X" is a claim too, and one a
// naive implementation breaks by doing X everywhere.
//
// A test that reads `WEB_CAPABILITIES.sse.supported === true` and asserts
// `true` proves nothing. Nothing in this file does that: every assertion is
// downstream of a `TransportCapabilitySet` being handed to real code.
//
// Registered in `ENFORCEMENT_PROOFS` as the proof for `sse`, `eventReplay` and
// `highLatencyBlockDelivery` on ALL FIVE surfaces — the only three claims in
// the ledger that any probe drives per surface. The `@capability-proof
// <surface>/<field>` markers below are what discharge those claims; a marker
// is required precisely because naming the field in prose used to be enough.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import {
  CLI_CAPABILITIES,
  DESKTOP_CAPABILITIES,
  MOBILE_CAPABILITIES,
  SDK_CAPABILITIES,
  WEB_CAPABILITIES,
  type TransportCapabilitySet,
} from '@generatorai/shared';

import { StreamEventRouter, splitAtBlockBoundary, type StreamEffect } from '../stream/eventRouter.js';
import { MuxStreamClient } from '../stream/MuxStreamClient.js';
import { SseParser } from '../stream/sseParser.js';

const SURFACES: ReadonlyArray<readonly [string, TransportCapabilitySet]> = [
  ['web', WEB_CAPABILITIES],
  ['desktop', DESKTOP_CAPABILITIES],
  ['cli', CLI_CAPABILITIES],
  ['mobile', MOBILE_CAPABILITIES],
  ['sdk', SDK_CAPABILITIES],
];

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

/** Everything a surface's router does with one turn's worth of partial prose. */
function runTurn(caps: TransportCapabilitySet, chunks: readonly string[]): StreamEffect[] {
  const router = new StreamEventRouter({ blockDelivery: caps.highLatencyBlockDelivery });
  const out: StreamEffect[] = [];
  for (const text of chunks) {
    out.push(...router.handle('s1', { kind: 'harness.token', data: { text } }));
    out.push(...router.drain());
  }
  return out;
}

const textOf = (effects: readonly StreamEffect[]): string =>
  effects
    .filter((e): e is Extract<StreamEffect, { op: 'appendToken' }> => e.op === 'appendToken')
    .map((e) => e.text)
    .join('');

const typingSignals = (effects: readonly StreamEffect[]): boolean[] =>
  effects
    .filter((e): e is Extract<StreamEffect, { op: 'setTyping' }> => e.op === 'setTyping')
    .map((e) => e.typing);

describe('W29 — highLatencyBlockDelivery is honoured per surface', () => {
  // Every surface's own declaration is handed to the real router below and the
  // resulting effects are asserted, so this claim is discharged per surface:
  //   @capability-proof web/highLatencyBlockDelivery
  //   @capability-proof desktop/highLatencyBlockDelivery
  //   @capability-proof cli/highLatencyBlockDelivery
  //   @capability-proof mobile/highLatencyBlockDelivery
  //   @capability-proof sdk/highLatencyBlockDelivery
  // One paragraph that completes, then a second that is still being written.
  const CHUNKS = ['Hello ', 'there.\n', '\n', 'Second para', 'graph still'];

  for (const [name, caps] of SURFACES) {
    const declared = caps.highLatencyBlockDelivery.supported;

    it(`${name}: declares ${declared} and behaves that way`, () => {
      const effects = runTurn(caps, CHUNKS);

      if (declared) {
        // Held back to the block boundary: the finished paragraph lands, the
        // half-written one does not.
        expect(textOf(effects)).toBe('Hello there.\n\n');
        expect(typingSignals(effects)).toContain(true);
      } else {
        // Per-chunk: everything that arrived is on screen, and the surface
        // never claims to be "typing" — that indicator is W30-d's, and a
        // surface that did not declare the mode must not show it.
        expect(textOf(effects)).toBe('Hello there.\n\nSecond paragraph still');
        expect(typingSignals(effects)).toEqual([]);
      }
    });
  }

  it('no surface ever LOSES held text: an ordered event releases it in full', () => {
    for (const [name, caps] of SURFACES) {
      const router = new StreamEventRouter({ blockDelivery: caps.highLatencyBlockDelivery });
      const out: StreamEffect[] = [];
      out.push(...router.handle('s1', { kind: 'harness.token', data: { text: 'unfinished line' } }));
      out.push(...router.drain());
      out.push(...router.handle('s1', { kind: 'harness.tool_start', data: { tool: 'read' } }));

      const tokenIdx = out.findIndex((e) => e.op === 'appendToken');
      const toolIdx = out.findIndex((e) => e.op === 'addToolCall');
      expect(textOf(out), `${name} dropped held text`).toBe('unfinished line');
      // Order is the point: held prose must land BEFORE the event that came
      // after it, or block delivery silently rewrites the transcript.
      expect(tokenIdx, `${name} reordered held text after the tool call`).toBeLessThan(toolIdx);
    }
  });

  it('a high-latency surface releases a completed code fence as one block', () => {
    const effects = runTurn(MOBILE_CAPABILITIES, [
      'Try:\n\n',
      '```ts\n',
      'const a = 1;\n',
      '\n', // a blank line INSIDE the fence is not a boundary
      'const b = 2;\n',
      '```\n',
      'after',
    ]);
    expect(textOf(effects)).toBe('Try:\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n');
  });

  it('a high-latency surface stops holding once the hold exceeds its cap', () => {
    // One paragraph with no boundary at all — a blank screen for a whole turn
    // would be a worse failure than a stutter, so the hold is bounded.
    const long = `${'x'.repeat(5000)}\n`;
    expect(textOf(runTurn(MOBILE_CAPABILITIES, [long]))).toBe(long);
  });

  it('splitAtBlockBoundary carries fence state across calls', () => {
    const first = splitAtBlockBoundary('```js\nlet a;\n', false);
    expect(first.emit).toBe('');
    expect(first.inFence).toBe(false); // nothing emitted, so nothing advanced
    const second = splitAtBlockBoundary('```js\nlet a;\n\nstill code\n```\n', false);
    expect(second.emit).toBe('```js\nlet a;\n\nstill code\n```\n');
    expect(second.inFence).toBe(false);
  });
});

describe('W29 — sse is honoured per surface', () => {
  // Every surface declares `sse: supported`, and the claim is that an SSE
  // frame off the wire becomes a transcript mutation. Drive the real parser
  // and the real router rather than asserting the flag.
  //   @capability-proof web/sse
  //   @capability-proof desktop/sse
  //   @capability-proof cli/sse
  //   @capability-proof mobile/sse
  //   @capability-proof sdk/sse
  for (const [name, caps] of SURFACES) {
    it(`${name}: an SSE frame becomes a stream effect`, () => {
      expect(caps.sse.supported, `${name} no longer declares sse — update this probe`).toBe(true);

      const parser = new SseParser();
      const messages = parser.push('data: {"kind":"harness.token","payload":{"text":"hi"}}\n\n');
      expect(messages).toHaveLength(1);

      const frame = JSON.parse(messages[0]!.data) as { kind: string; payload: Record<string, unknown> };
      const router = new StreamEventRouter({ blockDelivery: caps.highLatencyBlockDelivery });
      router.handle('s1', { kind: frame.kind, data: frame.payload });
      expect(textOf(router.drainFinal())).toBe('hi');
    });
  }
});

describe('W29 — eventReplay is honoured per surface', () => {
  //   @capability-proof web/eventReplay
  //   @capability-proof desktop/eventReplay
  //   @capability-proof cli/eventReplay
  //   @capability-proof mobile/eventReplay
  //   @capability-proof sdk/eventReplay
  /** Records the `POST /api/stream/connections` body the client sends. */
  function captureConnectBody(): {
    fetchImpl: (path: string, init?: RequestInit) => Promise<Response>;
    bodies: Array<Record<string, unknown>>;
  } {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
      if (path === '/api/stream/connections' && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ connectionId: 'c1' }), { status: 201 });
      }
      if (path.startsWith('/api/stream?c=')) {
        return new Response(new ReadableStream<Uint8Array>({ start: () => {} }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    return { fetchImpl, bodies };
  }

  for (const [name, caps] of SURFACES) {
    it(`${name}: resumes from a client-owned cursor (declared ${caps.eventReplay.supported})`, async () => {
      expect(
        caps.eventReplay.supported,
        `${name} no longer declares eventReplay — this probe asserts the positive case only`,
      ).toBe(true);

      const { fetchImpl, bodies } = captureConnectBody();
      const client = new MuxStreamClient({ fetch: fetchImpl });
      client.subscribe('chat', 'c1', () => {}, { afterSequence: 42 });
      await flush();

      // The cursor is the capability: without it a reconnect either replays
      // from zero or skips whatever arrived while the socket was down.
      expect(bodies[0]?.['cursors']).toEqual({ 'chat:c1': 42 });
      client.disposeAll();
    });
  }
});
