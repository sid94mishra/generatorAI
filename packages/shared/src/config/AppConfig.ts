// ────────────────────────────────────────────────────────────────
// AppConfig — Zod schema for application configuration
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const AppConfigSchema = z.object({
  port: z.number().min(1024).max(65535).default(3100),
  dbPath: z.string().default('~/.generatorai/data.db'),
  workspacesDir: z.string().default('~/.generatorai/workspaces'),
  artifactsDir: z.string().default('~/.generatorai/artifacts'),
  templatesDir: z.string().default('~/.generatorai/templates'),
  /** User-scope extensions root. Workspace-scope lives under each
   *  workspace's `.generatorai/extensions/`. System-scope is
   *  `<templatesDir>/system/extensions`. See docs plan §5.1. */
  extensionsDir: z.string().default('~/.generatorai/extensions'),
  maxConcurrentSessions: z.number().min(1).max(50).default(10),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  copilot: z
    .object({
      cliPath: z.string().nullable().default(null),
      defaultModel: z.string().default('claude-sonnet-4.6'),
      useStdio: z.boolean().default(true),
      defaultTimeoutMs: z.number().int().min(1_000).default(300_000),
      autoRestart: z.boolean().default(true),
      /** GitHub personal access token (or `gh auth token` output).
       *  When set, it is passed to the bundled GitHub Copilot CLI via the SDK's
       *  `--auth-token-env` mechanism so the CLI does not need its own
       *  stored credentials.  Reads from COPILOT_GITHUB_TOKEN env-var.
       *  (Copilot-specific: only consulted when harness.type === 'copilot'.) */
      githubToken: z.string().optional(),
      /** GitHub host for Enterprise Cloud with data residency
       *  (e.g. `https://your-tenant.ghe.com/`). Forwarded to the spawned
       *  Copilot CLI as `COPILOT_GH_HOST`. Reads from `COPILOT_GH_HOST` or
       *  `GH_HOST` env-vars when unset. Without this, Enterprise Cloud
       *  accounts get "not authorized to use this Copilot feature" 403s
       *  because the CLI defaults to github.com. */
      githubHost: z.string().optional(),
    })
    .default({}),

  // PRV-01 — harness selector. Default stays `'copilot'` so every
  // existing deployment continues to use the Copilot SDK. Flip to
  // `'claude-agent'` to route through the Claude Agent SDK bridge.
  // Additional provider values will land as their adapter packages ship.
  harness: z
    .object({
      type: z.enum(['copilot', 'claude-agent']).default('copilot'),
      /** Copilot-specific harness options. These supplement the top-level
       *  `copilot` section (which covers CLI transport concerns) with
       *  adapter-level overrides that are SDK-version-specific. */
      copilot: z
        .object({
          defaultModel: z.string().optional(),
          reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
          maxTurns: z.number().int().min(1).optional(),
        })
        .default({}),
      /** Claude Agent SDK-specific harness options.
       *  `harness.type === 'claude-agent'` reads these fields. */
      claudeAgent: z
        .object({
          defaultModel: z.string().optional(),
          effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
          permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']).optional(),
          maxTurns: z.number().int().min(1).optional(),
          maxBudgetUsd: z.number().positive().optional(),
          includePartialMessages: z.boolean().optional(),
          enableFileCheckpointing: z.boolean().optional(),
        })
        .default({}),
    })
    .default({}),

  streaming: z
    .object({
      enabled: z.boolean().default(true),
      heartbeatIntervalMs: z.number().int().min(1_000).default(15_000),
      maxReplayEvents: z.number().int().min(0).default(10_000),
      /**
       * How long (ms) to retain per-run / per-chat SSE ring buffers after a
       * terminal state before deleting them. Late reconnects within this
       * window can still replay via Last-Event-ID; beyond it, clients must
       * fall back to REST event replay endpoints.
       */
      bufferCleanupDelayMs: z.number().int().min(0).default(300_000),
    })
    .default({}),

  security: z
    .object({
      /**
       * Browsers treat `localhost` and `127.0.0.1` as DIFFERENT origins even
       * though they resolve to the same host, so every dev port needs both
       * spellings. Listing only `localhost` meant opening the dev UI at
       * `http://127.0.0.1:5173` — the form Vite prints on some setups, and the
       * one used by tooling that skips the localhost DNS lookup — failed every
       * API call with an opaque CORS error. This schema default is what
       * actually applies in dev (it satisfies the `??` in createCorsMiddleware,
       * so that function's own fallback list is never reached).
       */
      corsOrigins: z
        .array(z.string())
        .default([
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'http://localhost:5174',
          'http://127.0.0.1:5174',
          'http://localhost:5175',
          'http://127.0.0.1:5175',
          'http://localhost:5176',
          'http://127.0.0.1:5176',
          // Expo web preview for the mobile app
          // (`pnpm --filter @generatorai/mobile web`). Metro defaults to 8081
          // and steps to 8082 when that port is taken, so both are listed.
          // The mobile app runs on its own origin and talks to the API
          // cross-origin; without these every request fails with an opaque
          // CORS error that is indistinguishable from "the server is down".
          'http://localhost:8081',
          'http://127.0.0.1:8081',
          'http://localhost:8082',
          'http://127.0.0.1:8082',
        ]),
      allowedCommands: z
        .array(z.string())
        .default(['git', 'gh', 'node', 'npm', 'npx', 'pnpm']),
      maxScriptTimeoutMs: z.number().int().min(1_000).default(300_000),
      maxOutputBufferBytes: z.number().int().min(1_024).default(10 * 1024 * 1024),

      // ── Phase 0/2 — network exposure + authentication policy ──
      /**
       * Interface the HTTP server binds to. Defaults to loopback: exposing the
       * API on `0.0.0.0` must be a deliberate, explicit act.
       */
      bindHost: z.string().default('127.0.0.1'),
      /**
       * Escape hatch for local development ONLY. When true AND the listener is
       * loopback AND NODE_ENV is not production, requests without a credential
       * are accepted as the `local-desktop` principal. Anything else fails
       * closed at startup.
       */
      allowUnauthenticatedLoopback: z.boolean().default(false),
      /**
       * Refuse to start unless the secret store is OS-protected or keyed by an
       * operator-supplied KEK. Forced on for non-loopback / production.
       */
      requireSecureSecretStore: z.boolean().default(false),
      /** Audience claim embedded in access tokens — identifies this server. */
      tokenAudience: z.string().default('generatorai-server'),
      /** Directory holding the secret vault. Defaults to the DB directory. */
      secretsDir: z.string().optional(),
      /** Enable the outbound relay connector. */
      relayEnabled: z.boolean().default(false),
      /** Relay director origin (https). */
      relayDirectorUrl: z.string().optional(),
      /** Days of security audit history to retain. */
      auditRetentionDays: z.number().int().min(1).max(3650).default(365),
      /**
       * How long a paired device may keep resuming before the user must pair
       * again. Sliding: refreshed on every token rotation, so only a device
       * left idle for the whole window expires.
       *
       * Capped at one year — a credential that effectively never expires is a
       * liability, not a convenience.
       */
      sessionTtlHours: z.number().int().min(1).max(8760).default(48),
    })
    .default({}),

  webhooks: z
    .object({
      enabled: z.boolean().default(false),
      githubSecret: z.string().optional(),
      webhookToken: z.string().optional(),
      rateLimitPerMinute: z.number().int().min(1).default(60),
    })
    .default({}),

  sandbox: z
    .object({
      /** Enable sandbox execution mode */
      enabled: z.boolean().default(false),
      /** Sandbox provider: 'docker' for Docker Sandbox, 'host' for fallback */
      provider: z.enum(['docker', 'host', 'auto']).default('auto'),
      /** Docker image for sandbox template */
      image: z.string().default('generatorai/sandbox:latest'),
      /** Port for the harness CLI inside the sandbox */
      cliPort: z.number().int().min(1).max(65535).default(4321),
      /** Max time to wait for sandbox + CLI startup */
      startupTimeoutMs: z.number().int().min(1_000).default(30_000),
      /** Auto-destroy sandbox after run completes */
      autoDestroy: z.boolean().default(true),
    })
    .default({}),

  // DUR-05 — durable step.sleep sweeper. Active whenever at least one
  // stage row is `sleeping`; runs a small poll against the indexed
  // `wake_at` column. Defaults are deliberately modest — bump
  // `sweepIntervalMs` in production once sleep semantics are exercised
  // more aggressively.
  durableSleep: z
    .object({
      /** How often (ms) the sweeper polls for wake-ready rows. */
      sweepIntervalMs: z.number().int().min(100).default(5_000),
      /** Cap per sweep to keep SQLite write windows bounded. */
      maxWakesPerSweep: z.number().int().min(1).max(10_000).default(100),
      /** Disable the sweeper entirely. */
      enabled: z.boolean().default(true),
    })
    .default({}),

  // DB-04 — retention policy for streaming + event logs. The persistent
  // `stream_cursors` log (STR-02) and the legacy `events` table both grow
  // unbounded, and downstream DB-04 payload offload (EVT-04, not yet
  // implemented) will also need cleanup. A single retention service reads
  // these thresholds to prune stale rows on a background cadence.
  retention: z
    .object({
      /** TTL (days) for event payloads (events + stream_cursors). Default 90. */
      eventPayloadTtlDays: z.number().int().min(1).max(3650).default(90),
      /** How often (ms) the retention job sweeps. Default 6 hours. */
      sweepIntervalMs: z.number().int().min(60_000).default(6 * 60 * 60 * 1000),
      /** Safety: max rows deleted per sweep to avoid long locks. Default 50k. */
      maxDeletePerSweep: z.number().int().min(100).max(1_000_000).default(50_000),
      /** Disable the background sweeper entirely (one-off backups, tests, CI). */
      enabled: z.boolean().default(true),
    })
    .default({}),

  otel: z
    .object({
      /** Enable OpenTelemetry instrumentation */
      enabled: z.boolean().default(false),
      /** OTLP exporter endpoint (HTTP/protobuf) */
      endpoint: z.string().default('http://localhost:4318'),
      /** Service name for OTel resource attributes */
      serviceName: z.string().default('generatorai-server'),
      /** Trace sampling rate (0.0–1.0). 1.0 = sample everything */
      sampleRate: z.number().min(0).max(1).default(1.0),
      /** Metrics export interval in milliseconds */
      metricsExportIntervalMs: z.number().int().min(1_000).default(60_000),
    })
    .default({}),

  workspace: z
    .object({
      /** Auto-delete completed workspaces older than N hours (default 7 days) */
      retentionHours: z.number().int().min(1).default(168),
      /** Maximum total disk usage for all workspaces in MB (default 10GB) */
      maxDiskUsageMB: z.number().int().min(1).default(10240),
      /** Enable workspace-level git tracking */
      gitTrackingEnabled: z.boolean().default(true),
      /** Auto-archive workspaces when execution completes */
      autoArchiveOnComplete: z.boolean().default(false),
      /** Create snapshot on workspace completion */
      snapshotOnComplete: z.boolean().default(false),
      /** Interval between cleanup sweeps in minutes */
      cleanupIntervalMinutes: z.number().int().min(1).default(60),
    })
    .default({}),

  /** Project root directory — used as default CWD for data source scripts */
  projectRoot: z.string().optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
