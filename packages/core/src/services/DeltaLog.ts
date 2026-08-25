// ────────────────────────────────────────────────────────────────
// DeltaLog — W07, the durable half of law L1.
//
// L1: "tokens never reach the relational store, and are never written
// synchronously. Deltas go to a rotating append-only file, coalesced, bounded,
// droppable and resumable by sequence."
//
// Before this file existed, EVERY event — delta or item — went through
// `StreamWriteBatcher` into `stream_cursors`. W04 classified deltas correctly
// and W07's batcher gave them a wider commit window, but nothing stopped a
// token from being a SQL row: measured live, 81% of the database was token
// log (`ARCHITECTURE_V2_MASTER_PLAN_FINAL.md` §0.1). This is what actually
// moves deltas off that path.
//
// WHAT THIS IS NOT: a replacement for `stream_cursors` on items, and not (yet)
// the ONLY place deltas are written. Composition wires this as a DUAL-WRITE
// alongside the existing SQL path — see `StreamBroker`'s constructor — so
// replay-after-reconnect keeps working unchanged while this ships. Cutting
// deltas over to read from here (and stop writing them to SQL at all) is a
// durable-shape change gated behind W47's compatibility window, not a
// same-patch decision; see `docs/V2_IMPLEMENTATION_TRACKER.md`.
//
// BOUNDS (L1 — "a bounded on-disk ceiling with enforced rotation"), all three
// declared, not aspirational:
//   - per-scope IN-MEMORY buffer: `maxBufferedBytesPerScope`, oldest line
//     dropped with a marker, same idiom as `RunLogger`.
//   - per-scope FILE, rotated at `maxFileBytes` into `maxGenerations` kept
//     generations (`.jsonl`, `.jsonl.1`, …); beyond that, deleted.
//   - GLOBAL on-disk ceiling: `enforceGlobalCeiling()`, called from the same
//     retention sweep as W02 (`EventRetentionService`), deletes the oldest
//     rotated files first, across every scope, until back under budget.
//
// TORN-TAIL REPAIR: a crash mid-`appendFile` can leave the last line of a
// `.jsonl` file incomplete. `readTail` treats a line that fails `JSON.parse`
// as EOF rather than a fatal error — the file up to that point is still good.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { ILogger } from '@generatorai/shared';

export interface DeltaLogEntry {
  seq: number;
  kind: string;
  payload: unknown;
  ts: number;
}

export interface DeltaLogOptions {
  /** Base directory. One subdirectory per scope kind is created under it. */
  dir: string;
  /** Per-scope on-disk file size before it rotates. Default 2 MiB. */
  maxFileBytes?: number;
  /** Rotated generations kept per scope, beyond the live file. Default 2. */
  maxGenerations?: number;
  /** How often the shared flush loop drains dirty buffers. Default 20 ms. */
  flushIntervalMs?: number;
  /** Per-scope in-memory buffer ceiling before the oldest line is dropped. Default 256 KiB. */
  maxBufferedBytesPerScope?: number;
  /** Global on-disk ceiling across every scope. Default 256 MiB. Enforced by `enforceGlobalCeiling()`. */
  maxTotalBytes?: number;
  logger: ILogger;
}

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_GENERATIONS = 2;
const DEFAULT_FLUSH_INTERVAL_MS = 20;
const DEFAULT_MAX_BUFFERED_BYTES_PER_SCOPE = 256 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

interface ScopeBuffer {
  lines: string[];
  bytes: number;
  droppedLines: number;
  scopeDir: string;
  fileName: string;
}

/** Longest a `sanitize()`d name is allowed to get before falling back to a hash. */
const MAX_SANITIZED_LENGTH = 150;

/**
 * Filesystem-safe AND collision-free.
 *
 * △ Phase 1 review — the previous version mapped every disallowed character to
 * `_`, so two DIFFERENT scope ids differing only in, say, `:` vs `/` sanitized
 * to the IDENTICAL string and silently shared one file, mixing two sessions'
 * delta streams. This is a proper encoding instead: safe characters pass
 * through untouched, everything else (including a literal `~`, the escape
 * character itself) becomes `~XXXX` — a fixed-width, unambiguous hex escape.
 * Because every token is either one untouched safe character or exactly five
 * characters starting with `~`, the encoding is uniquely decodable left to
 * right, which is what makes it injective: two different inputs can never
 * produce the same output. A hash fallback bounds the length for a
 * pathological input (mostly-escaped ids would otherwise expand 5x) — scope
 * ids are capped at 200 chars by `routes/stream.ts`'s `parseSub`, but this
 * function must not assume that cap holds forever.
 */
function sanitize(part: string): string {
  let out = '';
  for (const ch of part) {
    if (/^[a-zA-Z0-9_-]$/.test(ch)) {
      out += ch;
    } else {
      out += '~' + (ch.codePointAt(0) ?? 0).toString(16).padStart(4, '0');
    }
  }
  if (out.length === 0) return '~~empty';
  if (out.length > MAX_SANITIZED_LENGTH) {
    // `~~` cannot appear in the escape output above: every `~` there is
    // immediately followed by exactly 4 hex digits (never another `~`), so a
    // double tilde is a marker no escaped string can ever collide with,
    // rather than merely one that is unlikely to.
    return '~~' + createHash('sha256').update(part, 'utf8').digest('hex').slice(0, 32);
  }
  return out;
}

export class DeltaLog {
  private readonly dir: string;
  private readonly maxFileBytes: number;
  private readonly maxGenerations: number;
  private readonly flushIntervalMs: number;
  private readonly maxBufferedBytesPerScope: number;
  private readonly maxTotalBytes: number;
  private readonly logger: ILogger;

  private buffers = new Map<string, ScopeBuffer>();
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Serialises actual disk writes so two flushes can never interleave a line. */
  private flushChain: Promise<void> = Promise.resolve();
  private writesInFlight = 0;
  private closed = false;
  private writeFailCount = 0;

  constructor(options: DeltaLogOptions) {
    this.dir = options.dir;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxGenerations = options.maxGenerations ?? DEFAULT_MAX_GENERATIONS;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBufferedBytesPerScope =
      options.maxBufferedBytesPerScope ?? DEFAULT_MAX_BUFFERED_BYTES_PER_SCOPE;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.logger = options.logger;
  }

  /**
   * Buffer one delta. Never throws, never blocks — this is the token path.
   * Composition passes the row's own `seq`/`ts` so a replayed line carries the
   * exact identity the live stream did.
   */
  append(scope: string, scopeId: string, entry: DeltaLogEntry): void {
    if (this.closed) return;
    const key = `${scope}:${scopeId}`;
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = {
        lines: [],
        bytes: 0,
        droppedLines: 0,
        scopeDir: join(this.dir, sanitize(scope)),
        fileName: `${sanitize(scopeId)}.jsonl`,
      };
      this.buffers.set(key, buf);
    }

    let line: string;
    try {
      line = JSON.stringify(entry) + '\n';
    } catch {
      // A payload with a cycle or a BigInt must not take the write path down.
      line = JSON.stringify({ seq: entry.seq, kind: entry.kind, ts: entry.ts, payload: '<unserialisable>' }) + '\n';
    }
    const bytes = Buffer.byteLength(line, 'utf8');
    buf.lines.push(line);
    buf.bytes += bytes;

    // Deltas are disposable by design (the completed item supersedes them), so
    // dropping the oldest buffered line for THIS scope is the correct
    // response to a scope that is producing faster than the flush loop can
    // keep up — never grow without bound, and never touch a sibling scope's
    // buffer to pay for it.
    while (buf.bytes > this.maxBufferedBytesPerScope && buf.lines.length > 1) {
      const dropped = buf.lines.shift();
      buf.bytes -= dropped === undefined ? 0 : Buffer.byteLength(dropped, 'utf8');
      buf.droppedLines += 1;
    }

    this.dirty.add(key);
    this.scheduleFlush();
  }

  /** Flush every dirty buffer now and wait for the writes to land. Call on shutdown. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.flushAll();
    // `flushAll` chains onto `flushChain`; wait for that chain to settle too,
    // since `flushAll` itself does not await the writes it schedules.
    await this.flushChain.catch(() => undefined);
  }

  /** Stop accepting new deltas. Idempotent. Callers should `flush()` first. */
  close(): void {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Read back a scope's log, oldest first, across the current file and its
   * kept rotated generations. Best-effort: a torn last line — the signature of
   * a crash mid-`appendFile` — is treated as end of file, not an error.
   */
  async readTail(scope: string, scopeId: string, maxLines = 2000): Promise<DeltaLogEntry[]> {
    const scopeDir = join(this.dir, sanitize(scope));
    const base = `${sanitize(scopeId)}.jsonl`;
    // Oldest generation first: `.jsonl.N` (largest N) down to `.jsonl` itself.
    const candidates: string[] = [];
    for (let gen = this.maxGenerations; gen >= 1; gen -= 1) candidates.push(`${base}.${gen}`);
    candidates.push(base);

    const out: DeltaLogEntry[] = [];
    for (const fileName of candidates) {
      const text = await this.readFileBestEffort(join(scopeDir, fileName));
      if (text === undefined) continue;
      for (const parsed of parseJsonlTolerant(text)) out.push(parsed);
    }
    return out.length > maxLines ? out.slice(out.length - maxLines) : out;
  }

  /** Total bytes on disk across every scope. For the health endpoint and tests. */
  async sizeOnDisk(): Promise<number> {
    let total = 0;
    for (const file of await this.listAllFiles()) {
      try {
        total += (await stat(file)).size;
      } catch {
        /* raced with a rotation or a prune — fine to skip */
      }
    }
    return total;
  }

  /**
   * Delete oldest rotated generations first, across every scope, until back
   * under `maxTotalBytes`. Called from the same sweep as W02's SQL retention
   * so the "bounded on-disk ceiling" in L1 is enforced, not aspirational.
   *
   * △ Phase 1 review — this used to stop at rotated backlog, on the theory
   * that a scope's live file should never be pulled out from under an
   * in-flight append. Deleting it is actually harmless (the next `flushOne`
   * recreates it via `mkdir` + `appendFile`, same as a fresh scope), and
   * without live-file eviction the ceiling was NOT a ceiling: many scopes each
   * individually under `maxFileBytes` and never rotating (a quiet chat that
   * streamed a handful of tokens once) sum to unbounded total disk use with
   * nothing left in `rotated` to reclaim. D15 in the master plan is explicit
   * that the design is "(b) per-session cap + global ceiling with
   * OLDEST-SESSION EVICTION," not (a) per-session cap alone — this is that
   * second phase. It only ever runs after rotated backlog is exhausted, and it
   * evicts entire scopes oldest-mtime-first: a scope that cold is not one
   * anyone is tailing, and dropping its delta history is exactly what
   * "droppable" means for L1 — the completed items superseded it in SQL long
   * ago regardless.
   *
   * `maxDeletions` bounds how much work one call does, matching
   * `EventRetentionService`'s `RetentionSweeper` contract (`limit`) so one
   * sweep tick cannot stall behind an arbitrarily large backlog; unbounded by
   * default for callers (tests, manual maintenance) that want a complete sweep.
   */
  async enforceGlobalCeiling(maxDeletions: number = Number.POSITIVE_INFINITY): Promise<number> {
    const files = await this.listAllFiles();
    const rotated: Array<{ path: string; size: number; mtimeMs: number }> = [];
    const live: Array<{ path: string; size: number; mtimeMs: number }> = [];
    let total = 0;
    for (const path of files) {
      let info: { size: number; mtimeMs: number };
      try {
        info = await stat(path);
      } catch {
        continue;
      }
      total += info.size;
      (/\.jsonl\.\d+$/.test(path) ? rotated : live).push({ path, size: info.size, mtimeMs: info.mtimeMs });
    }
    if (total <= this.maxTotalBytes) return 0;

    // Oldest mtime first — that is the generation furthest from the live edge
    // regardless of which scope it belongs to.
    rotated.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let deleted = 0;
    for (const f of rotated) {
      if (total <= this.maxTotalBytes || deleted >= maxDeletions) break;
      try {
        await rm(f.path, { force: true });
        total -= f.size;
        deleted += 1;
      } catch (err) {
        this.logger.warn?.('[DeltaLog] failed to prune during global ceiling sweep', {
          path: f.path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Phase 2 — D15's oldest-session eviction. Only reached when rotated
    // backlog alone could not bring the total under budget.
    if (total > this.maxTotalBytes && deleted < maxDeletions) {
      live.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const f of live) {
        if (total <= this.maxTotalBytes || deleted >= maxDeletions) break;
        try {
          await rm(f.path, { force: true });
          total -= f.size;
          deleted += 1;
        } catch (err) {
          this.logger.warn?.('[DeltaLog] failed to evict a live scope during global ceiling sweep', {
            path: f.path,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return deleted;
  }

  private async listAllFiles(): Promise<string[]> {
    const out: string[] = [];
    let scopeDirs: string[];
    try {
      scopeDirs = await readdir(this.dir);
    } catch {
      return out;
    }
    for (const scopeDir of scopeDirs) {
      const full = join(this.dir, scopeDir);
      let entries: string[];
      try {
        entries = await readdir(full);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (name.endsWith('.jsonl') || /\.jsonl\.\d+$/.test(name)) out.push(join(full, name));
      }
    }
    return out;
  }

  private async readFileBestEffort(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return undefined;
    }
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flushAll();
    }, this.flushIntervalMs);
    // A background durability log must never be the reason the process
    // cannot exit; shutdown calls `flush()` explicitly.
    this.timer.unref?.();
  }

  private async flushAll(): Promise<void> {
    if (this.dirty.size === 0) return;
    const keys = [...this.dirty];
    this.dirty.clear();

    this.writesInFlight += 1;
    this.flushChain = this.flushChain
      .then(() => Promise.all(keys.map((key) => this.flushOne(key))))
      .then(
        () => undefined,
        () => undefined, // individual failures are logged in `flushOne`; the chain must not poison itself
      )
      .finally(() => {
        this.writesInFlight -= 1;
      });
    await this.flushChain;
  }

  private async flushOne(key: string): Promise<void> {
    const buf = this.buffers.get(key);
    if (!buf || buf.lines.length === 0) return;

    let chunk = buf.lines.join('');
    if (buf.droppedLines > 0) {
      chunk =
        JSON.stringify({ __delta_log_dropped: buf.droppedLines, ts: Date.now() }) + '\n' + chunk;
      buf.droppedLines = 0;
    }
    buf.lines = [];
    buf.bytes = 0;

    const filePath = join(buf.scopeDir, buf.fileName);
    try {
      await mkdir(buf.scopeDir, { recursive: true });
      await this.rotateIfNeeded(buf, filePath);
      await appendFile(filePath, chunk, 'utf-8');
      this.writeFailCount = 0;
    } catch (err) {
      this.writeFailCount += 1;
      if (this.writeFailCount <= 3) {
        this.logger.warn?.('[DeltaLog] write failed', {
          filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      // P1-37 — a scope buffer must not outlive its content. Every chat, run
      // and automation iteration a process ever sees would otherwise leave a
      // permanent Map entry, growing for the life of the server. Safe exactly
      // when nothing arrived DURING this flush's await (an `append()` mid-await
      // re-adds `key` to `dirty` and repopulates `buf.lines`, which this check
      // must see and leave alone for the next flush to pick up).
      if (buf.lines.length === 0 && !this.dirty.has(key)) {
        this.buffers.delete(key);
      }
    }
  }

  /**
   * Rotate BEFORE appending, so the live file never exceeds `maxFileBytes` by
   * more than one chunk. Shifts `.jsonl.(N-1)` → `.jsonl.N` down to
   * `.jsonl` → `.jsonl.1`, dropping whatever was in the last slot.
   */
  private async rotateIfNeeded(buf: ScopeBuffer, filePath: string): Promise<void> {
    let size = 0;
    try {
      size = (await stat(filePath)).size;
    } catch {
      return; // file does not exist yet — nothing to rotate
    }
    if (size < this.maxFileBytes) return;

    for (let gen = this.maxGenerations; gen >= 1; gen -= 1) {
      const from = gen === 1 ? filePath : `${filePath}.${gen - 1}`;
      const to = `${filePath}.${gen}`;
      try {
        await rename(from, to);
      } catch {
        /* the source generation may not exist yet — fine */
      }
    }
  }
}

/**
 * Parse JSONL, treating a line that fails to parse as end-of-file rather than
 * a fatal error — the torn-tail-repair half of W07. A crash mid-`appendFile`
 * can only ever corrupt the LAST line (appends are whole-chunk), so once one
 * fails, every well-formed line before it is still trustworthy.
 */
function parseJsonlTolerant(text: string): DeltaLogEntry[] {
  const out: DeltaLogEntry[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && '__delta_log_dropped' in parsed) continue;
      out.push(parsed as DeltaLogEntry);
    } catch {
      break; // torn tail — stop here, everything before it is good
    }
  }
  return out;
}
