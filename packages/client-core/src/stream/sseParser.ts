// ────────────────────────────────────────────────────────────────
// Server-Sent Events parser.
//
// React Native has no `EventSource`, so the wire format is parsed here and
// fed from a streaming fetch body. Isolated from the transport because the
// parser is where the subtle bugs live and it is trivially testable, while
// the socket plumbing is neither.
//
// Format (WHATWG): lines of `field: value`, records separated by a blank
// line. Fields we honour: `event`, `data` (repeatable), `id`, `retry`.
// A line starting with `:` is a comment — the server sends these as
// keep-alives and they MUST NOT be treated as data.
// ────────────────────────────────────────────────────────────────

export interface SseMessage {
  /** `event:` field, defaulting to `message` per the spec. */
  event: string;
  /** Joined `data:` lines. */
  data: string;
  /** `id:` field, used as `Last-Event-ID` on reconnect. */
  id?: string;
  /** `retry:` field in ms, a server-suggested reconnect delay. */
  retry?: number;
}

/**
 * Incremental parser.
 *
 * `push()` accepts an arbitrary chunk — chunk boundaries have no relationship
 * to record boundaries, so a naive `split('\n\n')` per chunk drops any record
 * that straddles two reads. That failure is invisible on a fast local socket
 * and constant over a relay.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private dataLines: string[] = [];
  private lastId: string | undefined;
  private retry: number | undefined;

  /** Feed bytes; returns whatever complete records they produced. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];

    // Normalize line endings first: the spec allows CRLF, LF and bare CR,
    // and a proxy may rewrite them.
    this.buffer = this.buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line === '') {
        const message = this.flush();
        if (message) out.push(message);
        continue;
      }
      this.consumeLine(line);
    }

    return out;
  }

  private consumeLine(line: string): void {
    // Comment / keep-alive. Discarding these is what stops a heartbeat from
    // being delivered as an empty event.
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // Exactly one leading space after the colon is part of the framing.
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        this.event = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        // The spec forbids NUL in an id; ignore rather than corrupt resume.
        if (!value.includes('\0')) this.lastId = value;
        break;
      case 'retry': {
        const ms = Number.parseInt(value, 10);
        if (Number.isFinite(ms) && ms >= 0) this.retry = ms;
        break;
      }
      default:
        // Unknown field: ignore, per spec.
        break;
    }
  }

  private flush(): SseMessage | null {
    // A record with no data is a no-op dispatch, not an empty message.
    if (this.dataLines.length === 0) {
      this.event = '';
      return null;
    }
    const message: SseMessage = {
      event: this.event || 'message',
      data: this.dataLines.join('\n'),
      ...(this.lastId !== undefined ? { id: this.lastId } : {}),
      ...(this.retry !== undefined ? { retry: this.retry } : {}),
    };
    this.event = '';
    this.dataLines = [];
    return message;
  }

  /** Most recent `id:`, for `Last-Event-ID` on reconnect. */
  get lastEventId(): string | undefined {
    return this.lastId;
  }

  /** Server-suggested reconnect delay, if one was sent. */
  get retryHint(): number | undefined {
    return this.retry;
  }

  /**
   * Discard partial state.
   *
   * `lastId` is deliberately KEPT: it is the resume cursor, and forgetting it
   * on reconnect would replay the entire stream from the beginning.
   */
  reset(): void {
    this.buffer = '';
    this.event = '';
    this.dataLines = [];
  }
}

/** Parse a `data:` payload as JSON, returning null instead of throwing. */
export function parseSseJson<T>(message: SseMessage): T | null {
  try {
    return JSON.parse(message.data) as T;
  } catch {
    // A malformed frame must not kill the stream; the next one may be fine.
    return null;
  }
}
