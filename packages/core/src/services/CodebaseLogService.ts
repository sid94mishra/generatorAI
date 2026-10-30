// ────────────────────────────────────────────────────────────────
// CodebaseLogService — live clone/fetch logs + job tracking (G-16)
// ────────────────────────────────────────────────────────────────
//
// One in-memory ring buffer (last MAX_LINES lines) and one job record per
// codebase, process-lifetime only. Deliberately NOT persisted: the codebase
// row's `lastError` already persists the terminal outcome (CodebaseService),
// and a restarted server has no job to resume anyway — a fresh `POST fetch`
// starts a new one. Cross-platform by construction: it holds strings, no
// filesystem or shell access.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { CodebaseJob, CodebaseJobKind, CodebaseJobStatus, CodebaseLogLine, CodebaseLogsResponse } from '@generatorai/shared';

const MAX_LINES = 500;
const DEFAULT_LIMIT = 200;

export class CodebaseLogService {
  private readonly buffers = new Map<string, CodebaseLogLine[]>();
  private readonly jobs = new Map<string, CodebaseJob>();

  /** Starts a new job for this codebase, replacing whatever job (if any) preceded it. */
  startJob(codebaseId: string, kind: CodebaseJobKind): CodebaseJob {
    const job: CodebaseJob = {
      id: randomUUID(),
      kind,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    this.jobs.set(codebaseId, job);
    return job;
  }

  /** Appends one line to the ring buffer, dropping the oldest once it exceeds `MAX_LINES`. */
  appendLine(codebaseId: string, stream: 'stdout' | 'stderr', text: string): void {
    if (!text) return;
    const buf = this.buffers.get(codebaseId) ?? [];
    buf.push({ ts: new Date().toISOString(), stream, text });
    while (buf.length > MAX_LINES) buf.shift();
    this.buffers.set(codebaseId, buf);
  }

  /** Marks the codebase's current job finished. A no-op if no job is tracked (e.g. a fresh boot). */
  finishJob(codebaseId: string, outcome: Exclude<CodebaseJobStatus, 'running'>, error?: string): void {
    const job = this.jobs.get(codebaseId);
    if (!job) return;
    job.status = outcome;
    job.endedAt = new Date().toISOString();
    if (error) job.error = error;
  }

  /** The last `limit` lines (default 200) plus the current/last job, for `GET .../logs`. */
  getLogs(codebaseId: string, limit = DEFAULT_LIMIT): CodebaseLogsResponse {
    const buf = this.buffers.get(codebaseId) ?? [];
    const bounded = Math.max(1, Math.min(limit, MAX_LINES));
    const lines = buf.slice(-bounded);
    const job = this.jobs.get(codebaseId);
    return job ? { lines, job } : { lines };
  }
}
