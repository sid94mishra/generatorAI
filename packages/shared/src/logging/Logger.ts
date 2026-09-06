// ────────────────────────────────────────────────────────────────
// PinoLogger — Pino-based ILogger implementation
// ────────────────────────────────────────────────────────────────

import pino from 'pino';
import { trace } from '@opentelemetry/api';
import type { ILogger } from '../types/ILogger.js';

/**
 * Rotating-file sink, opt-in via environment (APPLICATION-REVIEW-2026-09 Phase 4:
 * "no log rotation anywhere"). All three are read here and nowhere else:
 *
 *   GENERATORAI_LOG_FILE       Path of the active log file. Unset → stdout only,
 *                              exactly as before. `pino-roll` appends a rotation
 *                              number: `server.log` → `server.1.log`, `server.2.log`…
 *   GENERATORAI_LOG_MAX_SIZE   Roll when the active file reaches this size.
 *                              `k`/`m`/`g` suffix; a bare number is megabytes.
 *                              Default `20m`.
 *   GENERATORAI_LOG_MAX_FILES  Rotated files to keep besides the active one.
 *                              Default `7` (≈ 160 MB on disk at the default size).
 *
 * stdout keeps receiving every line as well, so container log drivers and
 * `journalctl` are unaffected — the file is an addition, not a redirect.
 *
 * Both sinks run in pino's transport worker thread. `pino-roll` is resolved
 * from this package's own dependencies, so a single-file bundle that inlines
 * `@generatorai/shared` without staging `pino-roll` beside it fails at
 * startup with pino's "unable to determine transport target" — loudly, which is
 * the intended failure mode; the desktop shell does not set this variable.
 */
export interface LogRotationOptions {
  file: string;
  /** pino-roll size string: `20m`, `512k`, `1g`, or megabytes when unitless. */
  maxSize: string;
  /** Rotated files retained in addition to the active file. */
  maxFiles: number;
}

const DEFAULT_LOG_MAX_SIZE = '20m';
const DEFAULT_LOG_MAX_FILES = 7;

export function readLogRotationFromEnv(env: NodeJS.ProcessEnv = process.env): LogRotationOptions | undefined {
  const file = env['GENERATORAI_LOG_FILE'];
  if (!file || file.trim().length === 0) return undefined;
  const maxSizeRaw = env['GENERATORAI_LOG_MAX_SIZE']?.trim();
  const maxSize = maxSizeRaw && /^\d+[kmg]?$/i.test(maxSizeRaw) ? maxSizeRaw : DEFAULT_LOG_MAX_SIZE;
  const maxFilesRaw = Number.parseInt(env['GENERATORAI_LOG_MAX_FILES'] ?? '', 10);
  const maxFiles = Number.isFinite(maxFilesRaw) && maxFilesRaw >= 0 ? maxFilesRaw : DEFAULT_LOG_MAX_FILES;
  return { file: file.trim(), maxSize, maxFiles };
}

/**
 * Build the `transport` option for `pino()`. Exported so the rotation test can
 * assert the exact target configuration without spinning up a worker.
 */
export function buildTransport(
  rotation: LogRotationOptions | undefined,
  level: string,
  env: NodeJS.ProcessEnv = process.env,
): pino.TransportSingleOptions | pino.TransportMultiOptions | undefined {
  const pretty = env['NODE_ENV'] === 'development';
  const stdoutTarget: pino.TransportTargetOptions = pretty
    ? { target: 'pino-pretty', options: { colorize: true } }
    : { target: 'pino/file', options: { destination: 1 } };

  if (!rotation) {
    // Unchanged behaviour when rotation is off: no worker at all in production
    // (pino writes stdout synchronously via sonic-boom), pretty worker in dev.
    return pretty ? stdoutTarget : undefined;
  }

  // Multi-target streams each carry their own threshold and pino's multistream
  // defaults a missing one to `info` — which would silently drop `debug` lines
  // from the file even with LOG_LEVEL=debug. Pin both to the logger's level.
  stdoutTarget.level = level;
  const rollTarget: pino.TransportTargetOptions = {
    target: 'pino-roll',
    level,
    options: {
      file: rotation.file,
      size: rotation.maxSize,
      limit: { count: rotation.maxFiles },
      mkdir: true,
    },
  };
  return { targets: [stdoutTarget, rollTarget] };
}

export function createLogger(config: { level: string; service: string }): ILogger {
  const logger = pino({
    level: config.level,
    transport: buildTransport(readLogRotationFromEnv(), config.level),
    base: { service: config.service },
    serializers: { err: pino.stdSerializers.err },
    // SEC-11 — expanded secret redaction.
    //
    // Pino's `redact` uses path patterns (not regex) and runs on every
    // log record before serialization. Keys listed here are replaced with
    // `[Redacted]` so leaked tokens never hit stdout/transports.
    //
    // Rules:
    //   - Add the bare key (e.g. `apiKey`) AND a `*.apiKey` nested variant.
    //     Pino does not do deep wildcards, so two-level nesting like
    //     `req.body.user.apiKey` would still leak — if you add a new layer
    //     in call-sites, also add the corresponding pattern here.
    //   - Keep this list alphabetised within each section for reviewability.
    //   - When in doubt, add the key. False positives here cost a log line;
    //     false negatives leak secrets.
    //
    // Pattern-based regex redaction (RM §2.9) is deferred — Pino's
    // `censor` callback can support it but requires a custom serializer
    // that traverses the whole object on every log. Current allowlist
    // covers the high-risk keys; revisit when we migrate to it.
    redact: [
      // Single-level generic secrets
      'apiKey',
      'password',
      'secret',
      'token',
      // Single-level OAuth + session
      'accessToken',
      'bearerToken',
      'clientSecret',
      'csrfToken',
      'csrf_token',
      'privateKey',
      'privateKeyPem',
      'private_key_pem',
      'refreshToken',
      // NOTE: `sessionId` is deliberately NOT redacted. It is the primary
      // correlation key across the event log, the stream cursors, the harness
      // and every service log line — scrubbing it made cross-service tracing
      // impossible. It is an opaque internal identifier, not a bearer token:
      // possession of one grants nothing without an authenticated, DPoP-bound
      // request. If a session identifier ever becomes credential-like, it must
      // be renamed rather than redacted.
      // One-level nested (e.g. `{ user: { apiKey: 'x' } }`)
      '*.apiKey',
      '*.password',
      '*.secret',
      '*.token',
      '*.accessToken',
      '*.bearerToken',
      '*.clientSecret',
      '*.csrfToken',
      '*.csrf_token',
      '*.privateKey',
      '*.privateKeyPem',
      '*.private_key_pem',
      '*.refreshToken',
      // HTTP auth surfaces that commonly leak via request-logging middleware
      '*.authorization',
      '*.cookie',
      '*.Cookie',
      '*.set-cookie',
      '*.headers.authorization',
      '*.headers.cookie',
      // Query-param variants (Bearer token passed as `?apiKey=`)
      '*.query.apiKey',
      '*.query.token',
      '*.query.access_token',
      'query.apiKey',
      'query.token',
      // AWS-style credential keys (scoped — avoid false-positives on random
      // fields named `key`. We explicitly list the common variants.)
      '*.awsAccessKeyId',
      '*.awsSecretAccessKey',
      '*.aws_access_key_id',
      '*.aws_secret_access_key',
      'awsAccessKeyId',
      'awsSecretAccessKey',
      'aws_access_key_id',
      'aws_secret_access_key',
      // GitHub / GitLab / Slack-specific (frequent in our integrations)
      '*.githubToken',
      '*.gitlabToken',
      '*.slackToken',
      'githubToken',
      'gitlabToken',
      'slackToken',
    ],
    // Inject OTel trace context into every log record automatically.
    // When the OTel SDK is not initialised the active span is undefined,
    // so no extra fields are added — zero overhead.
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const ctx = span.spanContext();
      return {
        trace_id: ctx.traceId,
        span_id: ctx.spanId,
        trace_flags: ctx.traceFlags,
      };
    },
  });

  return wrapPinoLogger(logger);
}

function wrapPinoLogger(pinoLogger: pino.Logger): ILogger {
  return {
    debug(msg: string, context?: Record<string, unknown>) {
      if (context) pinoLogger.debug(context, msg);
      else pinoLogger.debug(msg);
    },
    info(msg: string, context?: Record<string, unknown>) {
      if (context) pinoLogger.info(context, msg);
      else pinoLogger.info(msg);
    },
    warn(msg: string, context?: Record<string, unknown>) {
      if (context) pinoLogger.warn(context, msg);
      else pinoLogger.warn(msg);
    },
    error(msg: string, context?: Record<string, unknown>) {
      if (context) pinoLogger.error(context, msg);
      else pinoLogger.error(msg);
    },
    child(bindings: Record<string, unknown>): ILogger {
      return wrapPinoLogger(pinoLogger.child(bindings));
    },
  };
}
