// ────────────────────────────────────────────────────────────────
// Logging.
//
// The one hard rule: log records never go to stdout. stdout is the command's
// RESULT — a `--json` consumer parses it, a `run diff` consumer applies it —
// and a stray log line corrupts both. Records go to a rotating file; only
// `--verbose` mirrors them to stderr, and only outside the TUI, where any
// stray write would tear the frame.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import pc from 'picocolors';
import { getLogsDir, type Logger, type TerminalCapabilities } from '@generatorai/cli-core';

export interface LoggerOptions {
  verbose: boolean;
  capabilities: TerminalCapabilities;
  /** Suppresses the stderr mirror while the TUI owns the screen. */
  silentStderr?: boolean;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(options: LoggerOptions): Logger {
  const threshold = options.verbose ? LEVEL_ORDER.debug : LEVEL_ORDER.warn;
  const stream = openLogFile();

  const emit = (level: Level, message: string, meta?: Record<string, unknown>): void => {
    const record = {
      time: new Date().toISOString(),
      level,
      msg: message,
      ...(meta ?? {}),
    };
    stream?.write(`${JSON.stringify(record)}\n`);

    if (options.silentStderr) return;
    if (LEVEL_ORDER[level] < threshold) return;

    const prefix =
      level === 'error'
        ? pc.red('error')
        : level === 'warn'
          ? pc.yellow('warn ')
          : level === 'debug'
            ? pc.dim('debug')
            : pc.dim('info ');
    const painted = options.capabilities.colorDepth === 'none' ? level.padEnd(5) : prefix;
    process.stderr.write(`${painted} ${message}\n`);
  };

  return {
    debug: (message, meta) => emit('debug', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
  };
}

/**
 * Opens today's log file.
 *
 * Failure is swallowed: a read-only home directory or a full disk must not
 * stop the CLI from doing its job, and there is nowhere useful to report the
 * failure to anyway.
 */
function openLogFile(): fs.WriteStream | null {
  try {
    const dir = getLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `cli-${new Date().toISOString().slice(0, 10)}.log`);
    return fs.createWriteStream(file, { flags: 'a', mode: 0o600 });
  } catch {
    return null;
  }
}

/** Deletes log files older than `days`, best effort. */
export function pruneLogs(days = 14): void {
  try {
    const dir = getLogsDir();
    const cutoff = Date.now() - days * 86_400_000;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    }
  } catch {
    // Nothing to prune, or no permission to. Neither is worth reporting.
  }
}
