// ────────────────────────────────────────────────────────────────
// MuxStreamClient — reconnect backoff must key off a STREAM, not a POST.
//
// Opening the multiplexed stream is two round trips:
//
//   1. `POST /api/stream/connections`  → a connection record + a ticket
//   2. `GET  /api/stream?c=<id>`       → the long-lived body the frames
//                                        arrive on, opened with `hello`
//
// Only (2) is a working stream. A server that is up enough to answer (1) but
// cannot serve (2) — a reverse proxy that buffers `text/event-stream`, an
// `expo/fetch` attach whose ticket was rejected, a server mid-restart — is
// exactly the failure this backoff exists for, and it is the one shape where
// resetting on (1) makes the backoff never engage: every cycle POSTs, resets
// the attempt counter to zero, fails the attach, and reschedules at `baseMs`.
//
// The consequence is not a slow reconnect, it is an unbounded one: with the
// counter pinned at zero the `MAX_RECONNECT_ATTEMPTS` ceiling is never
// reached either, so the client never reports giving up and a phone on a bad
// link hammers a dead endpoint at ~1/s for as long as the app is open.
//
// Both assertions below fail against a client that resets on the POST.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MuxStreamClient } from '../stream/MuxStreamClient.js';

/**
 * A server that accepts the connection POST and then refuses every attach.
 *
 * Returns the POST count so a test can measure retry PRESSURE (attempts per
 * unit of virtual time) rather than guess at individual delays.
 */
function halfOpenServer(): {
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>;
  posts: () => number;
} {
  let posts = 0;
  const fetchImpl = async (path: string, init?: RequestInit): Promise<Response> => {
    if (path === '/api/stream/connections' && init?.method === 'POST') {
      posts += 1;
      return new Response(JSON.stringify({ connectionId: `c${posts}` }), { status: 201 });
    }
    if (path.startsWith('/api/stream?c=')) {
      // Up enough to mint a connection, unable to serve the stream itself.
      return new Response(null, { status: 503 });
    }
    return new Response('{}', { status: 200 });
  };
  return { fetchImpl, posts: () => posts };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Jitter only ever subtracts, so pinning it to 0 keeps every delay at its
  // upper bound — the most generous possible reading for the client.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MuxStreamClient reconnect backoff', () => {
  it('backs off when the attach fails, even though the connection POST succeeded', async () => {
    const { fetchImpl, posts } = halfOpenServer();
    const client = new MuxStreamClient({ fetch: fetchImpl });
    client.subscribe('chat', 'c1', () => {});

    // Sixty seconds of a server in this state.
    await vi.advanceTimersByTimeAsync(60_000);

    // baseMs 1000, factor 1.5 → 1.0s, 1.5s, 2.25s, 3.4s, 5.1s, 7.6s, 11.4s,
    // 17.1s, 25.6s … so a client that is actually backing off has spent its
    // first ~8 attempts by 60s. One that resets on the POST has made ~60.
    expect(
      posts(),
      'the reconnect is not backing off — the attempt counter is being reset by a ' +
      'response that is not a stream',
    ).toBeLessThanOrEqual(12);

    client.disposeAll();
  });

  it('eventually gives up instead of retrying a half-open server forever', async () => {
    const { fetchImpl } = halfOpenServer();
    const client = new MuxStreamClient({ fetch: fetchImpl });
    const reasons: string[] = [];
    client.subscribe('chat', 'c1', () => {}, {
      onDisconnected: (reason) => reasons.push(reason ?? ''),
    });

    // Comfortably past the sum of 20 backed-off delays (~7 minutes).
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(
      reasons.some((r) => r.startsWith('giving up')),
      'the client never reached a terminal state: MAX_RECONNECT_ATTEMPTS is ' +
      'unreachable while the attempt counter is reset every cycle',
    ).toBe(true);

    client.disposeAll();
  });

  it('does reset the backoff once a real stream is established', async () => {
    // The positive direction: `hello` off the attached body is the signal that
    // a stream exists, and it must clear the attempt counter — otherwise a
    // long-lived client that reconnected once would keep escalating forever.
    let posts = 0;
    let helloSent = false;
    const fetchImpl = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path === '/api/stream/connections' && init?.method === 'POST') {
        posts += 1;
        return new Response(JSON.stringify({ connectionId: `c${posts}` }), { status: 201 });
      }
      if (path.startsWith('/api/stream?c=')) {
        if (posts < 3) return new Response(null, { status: 503 });
        // Third attach works and greets the client properly.
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              helloSent = true;
              controller.enqueue(
                new TextEncoder().encode(
                  `event: hello\ndata: ${JSON.stringify({ connectionId: 'c3', active: ['chat:c1'] })}\n\n`,
                ),
              );
              // Left open, like a real stream.
            },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    };

    const client = new MuxStreamClient({ fetch: fetchImpl });
    const attempts: number[] = [];
    client.subscribe('chat', 'c1', () => {}, {
      onReconnecting: (attempt) => attempts.push(attempt),
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(helloSent, 'the third attach should have succeeded within 30s').toBe(true);
    // Two failures before the good one, so the escalation stopped at 2.
    expect(Math.max(...attempts)).toBeLessThanOrEqual(3);

    client.disposeAll();
  });
});
