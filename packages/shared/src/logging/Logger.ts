// ────────────────────────────────────────────────────────────────
// PinoLogger — Pino-based ILogger implementation
// ────────────────────────────────────────────────────────────────

import pino from 'pino';
import { trace } from '@opentelemetry/api';
import type { ILogger } from '../types/ILogger.js';

export function createLogger(config: { level: string; service: string }): ILogger {
  const logger = pino({
    level: config.level,
    transport:
      process.env['NODE_ENV'] === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
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
      'sessionId',
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
