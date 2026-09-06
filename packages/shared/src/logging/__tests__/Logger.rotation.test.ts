// APPLICATION-REVIEW-2026-09 Phase 4 — "no log rotation anywhere". Pins that
// GENERATORAI_LOG_FILE turns on a size-rotated file sink beside stdout, and
// that leaving it unset changes nothing.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildTransport, createLogger, readLogRotationFromEnv } from '../Logger.js';

let dir: string;
const saved: Record<string, string | undefined> = {};
const VARS = ['GENERATORAI_LOG_FILE', 'GENERATORAI_LOG_MAX_SIZE', 'GENERATORAI_LOG_MAX_FILES', 'NODE_ENV'];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-logrot-'));
  for (const v of VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
});

afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met within timeout');
}

describe('readLogRotationFromEnv', () => {
  it('is off when GENERATORAI_LOG_FILE is unset or blank', () => {
    expect(readLogRotationFromEnv({})).toBeUndefined();
    expect(readLogRotationFromEnv({ GENERATORAI_LOG_FILE: '   ' })).toBeUndefined();
  });

  it('defaults to 20m × 7 files', () => {
    expect(readLogRotationFromEnv({ GENERATORAI_LOG_FILE: '/var/log/g/server.log' })).toEqual({
      file: '/var/log/g/server.log',
      maxSize: '20m',
      maxFiles: 7,
    });
  });

  it('honours overrides and falls back on garbage', () => {
    expect(
      readLogRotationFromEnv({
        GENERATORAI_LOG_FILE: 'x.log',
        GENERATORAI_LOG_MAX_SIZE: '512k',
        GENERATORAI_LOG_MAX_FILES: '3',
      }),
    ).toEqual({ file: 'x.log', maxSize: '512k', maxFiles: 3 });
    expect(
      readLogRotationFromEnv({
        GENERATORAI_LOG_FILE: 'x.log',
        GENERATORAI_LOG_MAX_SIZE: 'lots',
        GENERATORAI_LOG_MAX_FILES: '-2',
      }),
    ).toEqual({ file: 'x.log', maxSize: '20m', maxFiles: 7 });
  });
});

describe('buildTransport', () => {
  it('is unchanged when rotation is off: no transport in production, pretty in dev', () => {
    expect(buildTransport(undefined, 'info', {})).toBeUndefined();
    expect(buildTransport(undefined, 'info', { NODE_ENV: 'development' })).toEqual({
      target: 'pino-pretty',
      options: { colorize: true },
    });
  });

  it('adds a pino-roll target beside stdout, both at the logger level', () => {
    const t = buildTransport({ file: 'x.log', maxSize: '20m', maxFiles: 7 }, 'debug', {});
    expect(t).toEqual({
      targets: [
        { target: 'pino/file', level: 'debug', options: { destination: 1 } },
        {
          target: 'pino-roll',
          level: 'debug',
          options: { file: 'x.log', size: '20m', limit: { count: 7 }, mkdir: true },
        },
      ],
    });
  });
});

describe('createLogger with GENERATORAI_LOG_FILE', () => {
  it('writes log lines to the rotating file (creating the directory)', async () => {
    const file = path.join(dir, 'logs', 'server.log');
    process.env['GENERATORAI_LOG_FILE'] = file;
    process.env['GENERATORAI_LOG_MAX_SIZE'] = '1m';
    process.env['GENERATORAI_LOG_MAX_FILES'] = '2';

    const logger = createLogger({ level: 'info', service: 'rotation-test' });
    logger.info('rotation smoke line', { marker: 'abc123' });

    // pino transports run in a worker thread; the write is asynchronous.
    const logsDir = path.dirname(file);
    await waitFor(() => {
      if (!fs.existsSync(logsDir)) return false;
      return fs
        .readdirSync(logsDir)
        .some((f) => f.startsWith('server') && fs.readFileSync(path.join(logsDir, f), 'utf8').includes('abc123'));
    });

    const written = fs.readdirSync(logsDir).filter((f) => f.startsWith('server'));
    expect(written.length).toBeGreaterThan(0);
    const content = fs.readFileSync(path.join(logsDir, written[0]!), 'utf8');
    expect(content).toContain('"service":"rotation-test"');
    expect(content).toContain('rotation smoke line');
  });
});
