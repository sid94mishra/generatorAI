// ────────────────────────────────────────────────────────────────
// Minimal main-process logger — mirrors to console and to a rolling file in
// userData/logs so packaged installs produce diagnosable logs.
// ────────────────────────────────────────────────────────────────

import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

let logFilePath: string | null = null;
let stream: fs.WriteStream | null = null;

function ensureStream(): fs.WriteStream | null {
  if (stream) return stream;
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, 'main.log');
    stream = fs.createWriteStream(logFilePath, { flags: 'a' });
  } catch {
    // If we can't open the log file we still log to console.
    stream = null;
  }
  return stream;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, msg: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const metaStr = meta === undefined ? '' : ' ' + safeStringify(meta);
  const line = `${ts} [${level.toUpperCase()}] ${msg}${metaStr}`;
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  try {
    ensureStream()?.write(line + '\n');
  } catch {
    /* ignore */
  }
}

function safeStringify(v: unknown): string {
  try {
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  debug: (msg: string, meta?: unknown) => write('debug', msg, meta),
  info: (msg: string, meta?: unknown) => write('info', msg, meta),
  warn: (msg: string, meta?: unknown) => write('warn', msg, meta),
  error: (msg: string, meta?: unknown) => write('error', msg, meta),
  getLogFilePath: () => logFilePath,
};
