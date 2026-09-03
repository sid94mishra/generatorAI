import { describe, it, expect } from 'vitest';
import { SessionDemux } from '../SessionDemux.js';
import { tokenEvent } from './helpers/fakeHarness.js';

const ev = (text: string) => ({ kind: 'event' as const, event: tokenEvent(text) });
const textOf = (entry: { frame: { kind: string; event?: unknown } }): string =>
  entry.frame.kind === 'event' ? (entry.frame.event as { data: { text: string } }).data.text : 'ENDED';

describe('SessionDemux (W12)', () => {
  it('interleaves sessions round-robin instead of draining one to completion', () => {
    const demux = new SessionDemux();
    for (let i = 0; i < 3; i++) demux.dispatch('A', ev(`a${i}`));
    demux.dispatch('B', ev('b0'));

    const written: string[] = [];
    demux.drainTo((sessionId, entry) => {
      written.push(`${sessionId}:${textOf(entry)}`);
      return true;
    });

    // B's single frame must be written in the FIRST round, not after all of A.
    expect(written.indexOf('B:b0')).toBe(1);
    expect(written).toEqual(['A:a0', 'B:b0', 'A:a1', 'A:a2']);
  });

  it('stops draining when the sink signals backpressure and resumes where it left off', () => {
    const demux = new SessionDemux();
    demux.dispatch('A', ev('a0'));
    demux.dispatch('A', ev('a1'));
    demux.dispatch('B', ev('b0'));

    const first: string[] = [];
    const completed = demux.drainTo((_sid, entry) => {
      first.push(textOf(entry));
      return first.length < 2; // refuse after two writes
    });

    expect(completed).toBe(false);
    expect(first).toEqual(['a0', 'b0']);
    expect(demux.hasPending()).toBe(true);

    const rest: string[] = [];
    expect(demux.drainTo((_sid, entry) => {
      rest.push(textOf(entry));
      return true;
    })).toBe(true);
    expect(rest).toEqual(['a1']);
  });

  it('does not re-serve the backpressured session first on resume', () => {
    // The cursor must advance BEFORE the write, otherwise a session whose write
    // was refused is served again ahead of everyone else on every resume.
    const demux = new SessionDemux();
    demux.dispatch('A', ev('a0'));
    demux.dispatch('A', ev('a1'));
    demux.dispatch('B', ev('b0'));

    demux.drainTo(() => false); // refuse the very first write (A's a0 is consumed)

    const order: string[] = [];
    demux.drainTo((sid, entry) => {
      order.push(`${sid}:${textOf(entry)}`);
      return true;
    });
    expect(order[0]).toBe('B:b0');
  });

  it('bounds each session independently — a flooding session cannot evict another', () => {
    const demux = new SessionDemux(4);
    for (let i = 0; i < 1000; i++) demux.dispatch('loud', ev(`x${i}`));
    demux.dispatch('quiet', ev('important'));

    const stats = demux.stats();
    expect(stats.sessions).toBe(2);
    expect(stats.queuedFrames).toBe(5); // 4 from `loud` + 1 from `quiet`
    expect(stats.droppedFrames).toBe(996);

    const delivered: string[] = [];
    demux.drainTo((sid, entry) => {
      if (sid === 'quiet') delivered.push(textOf(entry));
      return true;
    });
    expect(delivered).toEqual(['important']);
  });

  it('requeue() gives an undelivered frame back to the head of its session', () => {
    // B1: the writer takes the entry out of the queue before it knows whether
    // the write will succeed. A failed write must be able to put it back.
    const demux = new SessionDemux();
    demux.dispatch('A', ev('a0'));
    demux.dispatch('A', ev('a1'));

    let firstEntry: { frame: { kind: string } } | undefined;
    demux.drainTo((sid, entry) => {
      firstEntry = entry;
      demux.requeue(sid, entry); // the write failed
      return false;
    });

    expect(demux.hasPending()).toBe(true);
    const order: string[] = [];
    demux.drainTo((_sid, entry) => {
      order.push(textOf(entry));
      return true;
    });
    expect(order).toEqual(['a0', 'a1']);
    expect(textOf(firstEntry as never)).toBe('a0');
  });

  it('requeue() drops the frame when the session was torn down mid-write', () => {
    // Re-creating the queue here would leak one per dead session.
    const demux = new SessionDemux();
    demux.dispatch('A', ev('a0'));
    const entry = { frame: ev('a0'), seq: 1, droppedBefore: 0 };
    demux.remove('A');
    expect(demux.requeue('A', entry)).toBe(false);
    expect(demux.stats().sessions).toBe(0);
  });

  it('remove() clears a session and its queue', () => {
    const demux = new SessionDemux();
    demux.dispatch('A', ev('a0'));
    demux.remove('A');
    expect(demux.hasPending()).toBe(false);
    expect(demux.stats().sessions).toBe(0);
  });
});
