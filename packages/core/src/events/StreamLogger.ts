// ────────────────────────────────────────────────────────────────
// RunLogger — per-workflow-run event logger
//
// Creates a JSONL log file in the run's artifacts directory that
// captures every event for that run: Copilot streaming tokens,
// messages, tool calls, reasoning, stage lifecycle, workflow
// orchestration events, etc. Auto-closes when the run reaches
// a terminal state.
//
// Works for both direct workflow runs and automation-spawned runs.
// The log file automatically appears in the UI's Files & Uploads
// panel because it lives in the artifacts directory.
// ────────────────────────────────────────────────────────────────

import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PersistedEvent, ILogger } from '@generatorai/shared';
import type { EventBus } from './EventBus.js';

const LOG_FILENAME = 'stream-log.jsonl';
const TERMINAL_KINDS = new Set([
  'workflow_run.completed',
  'workflow_run.failed',
  'workflow_run.cancelled',
]);

export { LOG_FILENAME as RUN_LOG_FILENAME };

export class RunLogger {
  private unsubSession?: () => void;
  private unsubGlobal?: () => void;
  private closed = false;
  readonly logFilePath: string;

  constructor(
    private readonly runId: string,
    artifactsDir: string,
    private readonly logger: ILogger,
  ) {
    mkdirSync(artifactsDir, { recursive: true });
    this.logFilePath = join(artifactsDir, LOG_FILENAME);

    // Truncate existing file and write header
    writeFileSync(this.logFilePath, JSON.stringify({
      timestamp: new Date().toISOString(),
      kind: '__run_log.started',
      data: { runId, logFile: this.logFilePath },
    }) + '\n', 'utf-8');

    this.logger.info(`[RunLogger] Logging run ${runId} to ${this.logFilePath}`);
  }

  /**
   * Attach to EventBus. Captures:
   * - Session-scoped events whose data.workflowRunId matches this run
   * - Global events whose data.workflowRunId matches this run
   * Auto-closes when a terminal workflow_run event is received.
   */
  attach(eventBus: EventBus): void {
    // Session-scoped events (copilot tokens, stage events, etc.)
    this.unsubSession = eventBus.subscribeAll((event) => {
      if (this.matchesRun(event)) {
        this.writeEvent(event);
      }
    });

    // Global events (orchestration, workflow_run lifecycle)
    this.unsubGlobal = eventBus.subscribeGlobal((event) => {
      if (this.matchesRun(event)) {
        this.writeEvent(event);

        // Auto-close on terminal state
        if (TERMINAL_KINDS.has(event.kind)) {
          this.close();
        }
      }
    });
  }

  /**
   * Flush and close the log file. Safe to call multiple times.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    this.writeLine({
      timestamp: new Date().toISOString(),
      kind: '__run_log.closed',
      data: { runId: this.runId },
    });

    this.unsubSession?.();
    this.unsubGlobal?.();
    this.logger.info(`[RunLogger] Closed log for run ${this.runId}`);
  }

  private matchesRun(event: PersistedEvent): boolean {
    const data = event.data as Record<string, unknown> | null;
    return !!(data && data['workflowRunId'] === this.runId);
  }

  private writeEvent(event: PersistedEvent): void {
    if (this.closed) return;
    this.writeLine({
      timestamp: new Date(event.timestamp).toISOString(),
      sessionId: event.sessionId,
      sequenceId: event.sequenceId,
      kind: event.kind,
      data: event.data,
    });
  }

  private writeFailCount = 0;

  private writeLine(record: Record<string, unknown>): void {
    if (this.closed && record['kind'] !== '__run_log.closed') return;
    try {
      appendFileSync(this.logFilePath, JSON.stringify(record) + '\n', 'utf-8');
      this.writeFailCount = 0;
    } catch (err) {
      // Non-fatal — don't crash the workflow if logging fails.
      // Rate-limit warnings to avoid log spam on repeated disk failures.
      this.writeFailCount++;
      if (this.writeFailCount <= 3) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[RunLogger] Failed to write event (attempt ${this.writeFailCount})`, {
          runId: this.runId,
          kind: record['kind'],
          error: msg,
        });
      }
    }
  }
}
