import { describe, it, expect } from 'vitest';
import { SessionQueue } from '../SessionQueue.js';
import { tokenEvent } from './helpers/fakeHarness.js';

const frame = (text: string) => ({ kind: 'event' as const, event: tokenEvent(text) });

describe('SessionQueue (W12)', () => {
  it('is bounded and never grows past maxSize', () => {
    const q = new SessionQueue(4);
    for (let i = 0; i < 100; i++) q.push(frame(`t${i}`));
    expect(q.size).toBe(4);
    expect(q.droppedCount).toBe(96);
  });

  it('drops the OLDEST frame on overflow, keeping the newest', () => {
    const q = new SessionQueue(3);
    for (const t of ['a', 'b', 'c', 'd']) q.push(frame(t));
    const texts = q.drain().map((e) => (e.frame.kind === 'event' ? (e.frame.event as { data: { text: string } }).data.text : 'ended'));
    expect(texts).toEqual(['b', 'c', 'd']);
  });

  it('assigns a monotonic per-session seq that is never reused', () => {
    const q = new SessionQueue(2);
    q.push(frame('a'));
    q.push(frame('b'));
    q.push(frame('c')); // drops 'a'
    const seqs = q.drain().map((e) => e.seq);
    // 'a' consumed seq 1 and is gone: the gap in seq is the loss signal.
    expect(seqs).toEqual([2, 3]);
  });

  it('reports the drop count on the NEXT delivered frame, once', () => {
    const q = new SessionQueue(2);
    q.push(frame('a'));
    q.push(frame('b'));
    q.push(frame('c')); // drops 'a'
    q.push(frame('d')); // drops 'b'

    const first = q.shift();
    const second = q.shift();
    expect(first?.droppedBefore).toBe(2);
    // The marker is consumed, not repeated on every subsequent frame.
    expect(second?.droppedBefore).toBe(0);
  });

  it('never drops a terminal frame — it is always the newest when pushed', () => {
    const q = new SessionQueue(2);
    q.push(frame('a'));
    q.push(frame('b'));
    q.push({ kind: 'ended', reason: 'complete' });
    const kinds = q.drain().map((e) => e.frame.kind);
    expect(kinds).toContain('ended');
    expect(kinds[kinds.length - 1]).toBe('ended');
  });

  it('restores an undelivered frame at the head, keeping its seq and gap stamp', () => {
    // B1: `drainTo` removes an entry before handing it to the writer, so a
    // write that FAILED has to be able to give it back — otherwise the frame is
    // gone, and when it is the turn's terminal frame the turn hangs forever.
    const q = new SessionQueue(4);
    q.push(frame('a'));
    q.push(frame('b'));

    const first = q.shift()!;
    q.unshift(first);

    const again = q.shift()!;
    expect(again.seq).toBe(first.seq);
    expect(again.frame).toBe(first.frame);
    // …and the frame behind it is still behind it.
    const next = q.shift()!;
    expect(next.seq).toBe(first.seq + 1);
  });

  it('a restored frame does not lose the drops already stamped on it', () => {
    const q = new SessionQueue(2);
    q.push(frame('a'));
    q.push(frame('b'));
    q.push(frame('c')); // drops 'a'

    const entry = q.shift()!;
    expect(entry.droppedBefore).toBe(1);
    q.unshift(entry);
    expect(q.shift()?.droppedBefore).toBe(1);
  });

  it('does not fabricate an AgentEvent for the gap marker', () => {
    // Regression: the gap used to be `{kind:'harness.gap'}` cast through
    // `as unknown as AgentEvent` — a kind that does not exist in the union.
    const q = new SessionQueue(1);
    q.push(frame('a'));
    q.push(frame('b'));
    const entry = q.shift();
    expect(entry?.frame.kind).toBe('event');
    const event = entry?.frame.kind === 'event' ? entry.frame.event : undefined;
    expect((event as { kind: string }).kind).toBe('harness.token');
    expect(entry?.droppedBefore).toBe(1);
  });
});
