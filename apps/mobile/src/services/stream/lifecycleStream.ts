import type { MuxStreamClient, MuxStreamEvent, MuxSubscribeOptions } from '@generatorai/client-core';

type Stream = Pick<MuxStreamClient, 'subscribe' | 'disposeAll' | 'resetRejections' | 'rejectedScopes'>;
type Subscription = { scope: string; id: string; handler: (event: MuxStreamEvent) => void; options: MuxSubscribeOptions; release?: () => void };
type Replay = (scope: string, id: string, after: number) => Promise<{ rows: Array<{ kind: string; payload?: Record<string, unknown>; seq: number }>; nextAfterSeq?: number }>;
export interface LifecycleStream extends Stream {
  suspend(): void;
  resume(): Promise<void>;
}

/** Keep mounted subscriptions and their cursors while the native process sleeps. */
export function createLifecycleStream(create: () => Stream, replay: Replay): LifecycleStream {
  const subscriptions = new Set<Subscription>();
  const cursors = new Map<string, number>();
  let client: Stream | null = null;
  let generation = 0;
  let disposed = false;
  let paused = true;
  let pending: Promise<void> | null = null;
  const key = (sub: Subscription) => JSON.stringify([sub.scope, sub.id]);
  const deliver = (sub: Subscription, event: MuxStreamEvent) => {
    if (!subscriptions.has(sub)) return;
    if (event.sequence !== undefined) cursors.set(key(sub), Math.max(cursors.get(key(sub)) ?? 0, event.sequence));
    sub.handler(event);
  };
  const attach = (sub: Subscription) => {
    if (!client) return;
    sub.release = client.subscribe(sub.scope, sub.id, (event) => deliver(sub, event), {
      ...sub.options,
      afterSequence: cursors.get(key(sub)) ?? sub.options.afterSequence,
      onDisconnected: (reason) => {
        if (reason === 'disposed') return;
        if (reason?.startsWith('gap:')) cursors.delete(key(sub));
        sub.options.onDisconnected?.(reason);
      },
    });
  };
  const suspend = () => {
    paused = true;
    generation += 1;
    pending = null;
    client?.disposeAll();
    client = null;
    for (const sub of subscriptions) sub.release = undefined;
  };
  return {
    subscribe(scope, id, handler, options = {}) {
      if (disposed) return () => {};
      const sub: Subscription = { scope, id, handler, options };
      subscriptions.add(sub);
      if (options.afterSequence !== undefined && !cursors.has(key(sub))) cursors.set(key(sub), options.afterSequence);
      attach(sub);
      return () => {
        sub.release?.();
        subscriptions.delete(sub);
        if (![...subscriptions].some((other) => key(other) === key(sub))) cursors.delete(key(sub));
      };
    },
    suspend,
    resume() {
      if (disposed) return Promise.resolve();
      if (pending) return pending;
      if (!paused) return Promise.resolve();
      paused = false;
      const current = ++generation;
      const work = async () => {
        // REST drains all missed pages before attaching; the mux's bounded replay
        // alone cannot recover a long turn that continued while backgrounded.
        const scopes = new Map([...subscriptions].filter((sub) => sub.scope !== 'global').map((sub) => [key(sub), sub]));
        for (const [scopeKey, sub] of scopes) {
          let after = cursors.get(scopeKey);
          if (after === undefined) continue;
          while (generation === current && !disposed) {
            const page = await replay(sub.scope, sub.id, after);
            if (generation !== current || disposed) return;
            for (const row of page.rows) {
              for (const target of subscriptions) {
                if (key(target) !== scopeKey) continue;
                if (target.options.filter?.length && !target.options.filter.some((prefix) => row.kind.startsWith(prefix))) continue;
                deliver(target, { kind: row.kind, data: row.payload ?? {}, sequence: row.seq });
              }
            }
            const next = page.nextAfterSeq;
            if (next === undefined || next <= after || page.rows.length === 0) break;
            cursors.set(scopeKey, next);
            after = next;
          }
        }
        if (generation !== current || disposed) return;
        client = create();
        for (const sub of subscriptions) attach(sub);
      };
      pending = work().catch((error: unknown) => {
        if (generation === current) paused = true;
        throw error;
      }).finally(() => { if (generation === current) pending = null; });
      return pending;
    },
    disposeAll() { disposed = true; suspend(); subscriptions.clear(); cursors.clear(); },
    resetRejections() { client?.resetRejections(); },
    rejectedScopes() { return client?.rejectedScopes() ?? []; },
  };
}
