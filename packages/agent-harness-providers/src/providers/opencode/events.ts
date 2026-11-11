// ────────────────────────────────────────────────────────────────
// OpenCode 2 event stream — `GET /api/event`.
//
// One server-wide `text/event-stream` (server `handlers/event.ts`): the first
// frame is `server.connected`, then `data: <V2Event JSON>\n\n` per event, and
// a `: heartbeat` comment every 15 s. It is live-only — no replay, no resume —
// and a subscriber that falls 4,096 frames behind is disconnected, so the
// subscription names the event types this provider reads.
// ────────────────────────────────────────────────────────────────

/** Every event type the provider consumes (the subscription's `types` filter). */
export const SUBSCRIBED_EVENT_TYPES = [
  'session.created',
  'session.execution.started',
  'session.execution.succeeded',
  'session.execution.failed',
  'session.execution.interrupted',
  'session.step.started',
  'session.step.ended',
  'session.step.failed',
  'session.text.delta',
  'session.text.ended',
  'session.reasoning.delta',
  'session.reasoning.ended',
  'session.tool.input.started',
  'session.tool.called',
  'session.tool.progress',
  'session.tool.success',
  'session.tool.failed',
  'session.retry.scheduled',
  'session.compaction.started',
  'session.compaction.ended',
  'session.compaction.failed',
  'session.usage.updated',
  'permission.asked',
  'form.created',
  'location.shutdown',
] as const;

/** A decoded frame: the V2 envelope, payload under `data`. */
export interface OpenCodeFrame {
  id?: string;
  type: string;
  created?: number;
  data: Record<string, unknown>;
}

export interface EventStreamOptions {
  url: string;
  headers: Record<string, string>;
  /** Aborts the subscription (shutdown). */
  signal: AbortSignal;
  /** Bound on the connect (headers). */
  connectTimeoutMs: number;
  /** No frame and no heartbeat for this long abandons the stream. 0 disables. */
  idleTimeoutMs: number;
  onFrame: (frame: OpenCodeFrame) => void;
}

/**
 * Open the subscription. Resolves once the server sent `server.connected`
 * (events published after that point reach `onFrame`), with `ended` settling
 * when the stream closes: resolved on our own abort, rejected otherwise.
 */
export async function openEventStream(opts: EventStreamOptions): Promise<{ ended: Promise<void> }> {
  const query = SUBSCRIBED_EVENT_TYPES.map((t) => `types=${encodeURIComponent(t)}`).join('&');
  const connectAbort = new AbortController();
  const connectTimer = setTimeout(() => connectAbort.abort(), opts.connectTimeoutMs);
  connectTimer.unref?.();
  let resp: Response;
  try {
    resp = await fetch(`${opts.url}/api/event?${query}`, {
      headers: { ...opts.headers, Accept: 'text/event-stream' },
      signal: AbortSignal.any([opts.signal, connectAbort.signal]),
    });
  } catch (err) {
    throw connectAbort.signal.aborted && !opts.signal.aborted
      ? new Error(`GET /api/event did not answer within ${opts.connectTimeoutMs} ms`)
      : err;
  } finally {
    clearTimeout(connectTimer);
  }
  if (!resp.ok || !resp.body) {
    await resp.body?.cancel().catch(() => undefined);
    throw new Error(`GET /api/event failed with HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let markConnected!: () => void;
  let failConnect!: (err: Error) => void;
  const connected = new Promise<void>((resolve, reject) => { markConnected = resolve; failConnect = reject; });

  const read = async (): Promise<Awaited<ReturnType<typeof reader.read>>> => {
    if (opts.idleTimeoutMs <= 0) return reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`no event or heartbeat for ${opts.idleTimeoutMs} ms — stream abandoned`)),
            opts.idleTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  const ended = (async () => {
    let buffer = '';
    let sawConnected = false;
    try {
      for (;;) {
        const { done, value } = await read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Frames are separated by a blank line; a frame may hold several `data:` lines.
        let sep: number;
        while ((sep = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
          const data = raw
            .split(/\r?\n/)
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''))
            .join('\n');
          if (!data) continue; // a comment (`: heartbeat`) — it reset the idle timer by arriving
          let frame: OpenCodeFrame;
          try { frame = JSON.parse(data) as OpenCodeFrame; } catch { continue; }
          if (!frame || typeof frame.type !== 'string') continue;
          if (frame.type === 'server.connected') {
            if (!sawConnected) { sawConnected = true; markConnected(); }
            continue;
          }
          try { opts.onFrame({ ...frame, data: frame.data ?? {} }); } catch { /* a handler bug must not kill the stream */ }
        }
      }
      if (!opts.signal.aborted) throw new Error('the server closed the event stream');
    } catch (err) {
      if (opts.signal.aborted) return;
      const e = err instanceof Error ? err : new Error(String(err));
      if (!sawConnected) failConnect(e);
      throw e;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  })();
  // Observed here so a failure before anyone awaits `ended` is not an unhandled rejection.
  ended.catch(() => undefined);

  const connectDeadline = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new Error(`GET /api/event sent no server.connected within ${opts.connectTimeoutMs} ms`)), opts.connectTimeoutMs);
    t.unref?.();
    void connected.finally(() => clearTimeout(t)).catch(() => undefined);
  });
  try {
    await Promise.race([connected, connectDeadline]);
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  }
  return { ended };
}
