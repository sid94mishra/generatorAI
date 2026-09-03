// ────────────────────────────────────────────────────────────────
// ByteCapper — W13, per-record byte cap with drop-on-exceed.
//
// ── Why a cap, and why DROP rather than truncate ───────────────────
//
// One tool result can be a 200 MB file read, a `git log` over a monorepo, or a
// screenshot re-encoded as base64. That record travels the whole pipe: into
// the model's context (where it is billed and may not even fit), through the
// single-reader demux in the Agent Host (W12), into the event stream, into
// SQLite. A record big enough to blow any one of those stages takes the
// session with it — and, on a shared runtime, its co-tenants.
//
// The instinct is to TRUNCATE — send the first N bytes. Do not, for a tool
// result: half a JSON object, half a diff, or half a base64 image is not
// smaller data, it is CORRUPT data that the model will confidently parse
// wrong. A `}` that never arrives makes the model re-issue the call; a diff
// cut mid-hunk makes it write a patch against a file state that does not
// exist. Dropping is the honest failure: the record is replaced by a legible
// notice that says what happened, how big it was, and what to do instead —
// which the model can act on, because "too big, narrow your query" is a
// recoverable instruction and "malformed JSON" is not.
//
// The exception, and it is a real one, is plain human-readable TEXT with no
// structure to corrupt (log tails, stdout). `mode: 'head-tail'` keeps the
// first and last slice with an explicit elision marker in between, which is
// still legible. It is opt-in per call site, never the default, because the
// caller is the only one who knows whether the payload has structure.
// ────────────────────────────────────────────────────────────────

/** Default per-record cap. 1 MiB is far above any legitimate tool result. */
export const DEFAULT_RECORD_BYTE_CAP = 1_048_576;

export type ByteCapMode = 'drop' | 'head-tail';

export interface ByteCapOptions {
  /** Max bytes for one record. `<= 0` disables the cap. */
  capBytes?: number;
  /** `drop` (default) replaces the record; `head-tail` elides its middle. */
  mode?: ByteCapMode;
  /** Fired once per capped record. For metrics — capping must be visible. */
  onExceeded?: (info: { label: string; bytes: number; capBytes: number; mode: ByteCapMode }) => void;
}

export interface ByteCapResult {
  /** The value to use. Unchanged when within the cap. */
  readonly value: string;
  /** `true` when the cap fired. */
  readonly capped: boolean;
  /** Size of the ORIGINAL record in bytes. */
  readonly bytes: number;
}

function byteLength(text: string): number {
  // Buffer is available in every runtime this package targets (Node hosts).
  // `TextEncoder` would allocate a copy of the whole string just to measure it.
  return Buffer.byteLength(text, 'utf8');
}

/** Serialise anything into the string form that will actually be sent. */
export function renderRecord(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Cyclic or non-serialisable — `String()` never throws.
    return String(value);
  }
}

export class ByteCapper {
  private readonly capBytes: number;
  private readonly mode: ByteCapMode;
  private readonly onExceeded: ByteCapOptions['onExceeded'];
  private cappedCount = 0;
  private droppedBytes = 0;

  constructor(options: ByteCapOptions = {}) {
    this.capBytes = options.capBytes ?? DEFAULT_RECORD_BYTE_CAP;
    this.mode = options.mode ?? 'drop';
    this.onExceeded = options.onExceeded;
  }

  get stats(): { cappedCount: number; droppedBytes: number } {
    return { cappedCount: this.cappedCount, droppedBytes: this.droppedBytes };
  }

  /**
   * Apply the cap to one record.
   *
   * @param label What the record is, used in the replacement notice so the
   *              model knows WHICH call was too big (e.g. the tool name).
   */
  apply(value: unknown, label = 'record'): ByteCapResult {
    const text = renderRecord(value);
    const bytes = byteLength(text);
    if (this.capBytes <= 0 || bytes <= this.capBytes) {
      return { value: text, capped: false, bytes };
    }

    this.cappedCount += 1;
    this.droppedBytes += bytes - this.capBytes;
    this.onExceeded?.({ label, bytes, capBytes: this.capBytes, mode: this.mode });

    if (this.mode === 'head-tail') {
      // Slice by CODE UNITS after reserving budget in bytes. Multi-byte
      // characters mean the result can be under, never over, the cap — which
      // is the safe direction.
      const half = Math.max(0, Math.floor(this.capBytes / 2) - 64);
      const head = text.slice(0, half);
      const tail = text.slice(Math.max(half, text.length - half));
      return {
        value:
          `${head}\n\n… [${bytes - byteLength(head) - byteLength(tail)} bytes elided: ` +
          `"${label}" produced ${bytes} bytes, over the ${this.capBytes}-byte per-record cap] …\n\n${tail}`,
        capped: true,
        bytes,
      };
    }

    return { value: this.dropNotice(label, bytes), capped: true, bytes };
  }

  /**
   * The replacement text. Written for the MODEL: it states the failure, the
   * numbers, and a next action, because a result the model cannot act on is
   * indistinguishable from a hang.
   */
  private dropNotice(label: string, bytes: number): string {
    return (
      `[result dropped] "${label}" produced ${bytes} bytes, which exceeds the ` +
      `${this.capBytes}-byte per-record limit, so the result was discarded rather than ` +
      `truncated — a partial result would have been silently corrupt. ` +
      `Re-run with a narrower scope (fewer files, a line range, a filter, or pagination).`
    );
  }
}
