// ────────────────────────────────────────────────────────────────
// RunLogger tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventBus } from '../src/events/EventBus.js';
import { RunLogger, RUN_LOG_FILENAME } from '../src/events/StreamLogger.js';
import type { ILogger } from '@generatorai/shared';

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ILogger;
}

function readLines(filePath: string): Record<string, unknown>[] {
  const raw = readFileSync(filePath, 'utf-8').trim();
  return raw.split('\n').map((l) => JSON.parse(l));
}

describe('RunLogger', () => {
  let tempDir: string;
  let eventBus: EventBus;
  let logger: ILogger;
  const RUN_ID = 'run-abc-123';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'runlogger-'));
    eventBus = new EventBus();
    logger = createMockLogger();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create a JSONL log file with a started header', () => {
    const rl = new RunLogger(RUN_ID, tempDir, logger);
    rl.close();

    const lines = readLines(rl.logFilePath);
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatchObject({ kind: '__run_log.started', data: { runId: RUN_ID } });
    expect(lines[1]).toMatchObject({ kind: '__run_log.closed', data: { runId: RUN_ID } });
  });

  it('should have the correct filename', () => {
    const rl = new RunLogger(RUN_ID, tempDir, logger);
    expect(rl.logFilePath).toBe(join(tempDir, RUN_LOG_FILENAME));
    rl.close();
  });

  it('should capture session-scoped events matching the run', async () => {
    const rl = new RunLogger(RUN_ID, tempDir, logger);
    rl.attach(eventBus);

    // Emit a session event with matching workflowRunId
    await eventBus.emit('sess-1', {
      kind: 'harness.token',
      data: { workflowRunId: RUN_ID, token: 'hello' },
    });

    // Emit an event for a different run — should be excluded
    await eventBus.emit('sess-2', {
      kind: 'harness.token',
      data: { workflowRunId: 'other-run', token: 'world' },
    });

    rl.close();

    const lines = readLines(rl.logFilePath);
    const eventLines = lines.filter((l) => l.kind === 'harness.token');
    expect(eventLines.length).toBe(1);
    expect((eventLines[0].data as Record<string, unknown>).token).toBe('hello');
  });

  it('should capture global events matching the run', async () => {
    const rl = new RunLogger(RUN_ID, tempDir, logger);
    rl.attach(eventBus);

    await eventBus.emitGlobal({
      kind: 'workflow_run.running',
      data: { workflowRunId: RUN_ID },
    });

    // Different run's global event
    await eventBus.emitGlobal({
      kind: 'workflow_run.running',
      data: { workflowRunId: 'other-run' },
    });

    rl.close();

    const lines = readLines(rl.logFilePath);
    const running = lines.filter((l) => l.kind === 'workflow_run.running');
    expect(running.length).toBe(1);
  });

  it('should auto-close on workflow_run.completed', async () => {
    const rl = new RunLogger(RUN_ID, tempDir, logger);
    rl.attach(eventBus);

    await eventBus.emitGlobal({
      kind: 'workflow_run.completed',
      data: { workflowRunId: RUN_ID },
    });

    // Should be closed now — further events should be ignored
    await eventBus.emit('sess-1', {
      kind: 'harness.token',
      data: { workflowRunId: RUN_ID, token: 'ignored' },
    });

    const lines = readLines(rl.logFilePath);
    const tokenLines = lines.filter((l) => l.kind === 'harness.token');
    expect(tokenLines.length).toBe(0);
    expect(lines.some((l) => l.kind === 'workflow_run.completed')).toBe(true);
    expect(lines.some((l) => l.kind === '__run_log.closed')).toBe(true);
  });

  it('should auto-close on workflow_run.failed', async () => {
    const rl = new RunLogger(RUN_ID, tempDir, logger);
    rl.attach(eventBus);

    await eventBus.emitGlobal({
      kind: 'workflow_run.failed',
      data: { workflowRunId: RUN_ID, error: 'boom' },
    });

    const lines = readLines(rl.logFilePath);
    expect(lines.some((l) => l.kind === 'workflow_run.failed')).toBe(true);
    expect(lines.some((l) => l.kind === '__run_log.closed')).toBe(true);
  });

  it('should auto-close on workflow_run.cancelled', async () => {
    const rl = new RunLogger(RUN_ID, tempDir, logger);
    rl.attach(eventBus);

    await eventBus.emitGlobal({
      kind: 'workflow_run.cancelled',
      data: { workflowRunId: RUN_ID },
    });

    const lines = readLines(rl.logFilePath);
    expect(lines.some((l) => l.kind === 'workflow_run.cancelled')).toBe(true);
    expect(lines.some((l) => l.kind === '__run_log.closed')).toBe(true);
  });

  it('should be safe to call close() multiple times', () => {
    const rl = new RunLogger(RUN_ID, tempDir, logger);
    rl.close();
    rl.close(); // No throw

    const lines = readLines(rl.logFilePath);
    // Only one closed marker
    const closedLines = lines.filter((l) => l.kind === '__run_log.closed');
    expect(closedLines.length).toBe(1);
  });
});
