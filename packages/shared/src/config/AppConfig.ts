// ────────────────────────────────────────────────────────────────
// AppConfig — Zod schema for application configuration
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

// Single source of truth for the consent TTL — the zod default is derived from
// it below rather than repeating `120` in a second unit.
import { COMPUTER_USE_CONSENT_TTL_MS } from '../constants/index.js';

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
      /**
       * `auto` — let the provider choose — rather than a pinned model name.
       *
       * The default used to be a specific version, `claude-sonnet-4.6`. Model
       * catalogues move: on an account whose catalogue had advanced, EVERY new
       * chat failed at creation with `Model "claude-sonnet-4.6" is not
       * available`, surfaced as a 502. "New Chat" was broken out of the box and
       * only an explicit per-chat override worked around it. `auto` is offered
       * by the provider at all times, so the shipped default cannot go stale
       * the same way; a user or agent can still pin any model explicitly.
       */
      defaultModel: z.string().default('auto'),
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

  // WS-D1 — workflow stage liveness. `stageTimeoutMs` is the default stage
  // timeout when a stage definition sets none (the documented 300 s);
  // `maxStageTimeoutMs` caps any explicit value. The heartbeat is written by
  // the executor every `heartbeatIntervalMs` while a stage is queued/running
  // and the run reconciler fails a stage whose last beat is older than
  // `heartbeatIntervalMs * heartbeatStaleMultiplier`.
  workflow: z
    .object({
      stageTimeoutMs: z.number().int().min(1_000).max(24 * 60 * 60 * 1000).default(300_000),
      maxStageTimeoutMs: z.number().int().min(1_000).max(7 * 24 * 60 * 60 * 1000).default(4 * 60 * 60 * 1000),
      heartbeatIntervalMs: z.number().int().min(1_000).max(10 * 60 * 1000).default(10_000),
      heartbeatStaleMultiplier: z.number().min(2).max(100).default(3),
    })
    .default({}),

  // PRV-01 — harness selector. Default stays `'copilot'` so every
  // existing deployment continues to use the Copilot SDK. Flip to
  // `'claude-agent'` to route through the Claude Agent SDK bridge.
  // Additional provider values will land as their adapter packages ship.
  harness: z
    .object({
      type: z.enum(['copilot', 'claude-agent', 'codex']).default('copilot'),
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
      /** Codex (`codex app-server`) options. Codex runs alongside the other
       *  providers whenever its CLI is found — these only tune it. Codex's own
       *  `~/.codex/config.toml` and sign-in stay in effect underneath. */
      codex: z
        .object({
          /** Explicit CLI path. Unset → `CODEX_CLI_PATH`, then PATH, then the
           *  CLI bundled with the ChatGPT desktop app. */
          binaryPath: z.string().optional(),
          /** Model for new threads. Unset → the account's Codex default. */
          defaultModel: z.string().optional(),
          /** When Codex asks before running a command. `on-request` routes
           *  its approvals to the chat's approval UI. */
          approvalPolicy: z.enum(['untrusted', 'on-request', 'never']).optional(),
          sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
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

  /**
   * Model-authorable code execution knobs. Both default to the locked-down
   * position; an operator widens them deliberately, per deployment.
   */
  scripts: z
    .object({
      /**
       * Whether `.workflow.mjs` scripts may be loaded AT ALL — the boot-time
       * templates scan, reload/validate routes and upload all go through the
       * same loader gate. Scripts run in-process with the server's full
       * privileges. Env: `GENERATORAI_ALLOW_WORKFLOW_SCRIPTS=true` (also
       * implied by the legacy `GENERATORAI_ALLOW_SCRIPT_UPLOAD=true`).
       */
      workflowScriptsEnabled: z.boolean().default(false),
      /**
       * Bare command names added to the script runner's default allow-list.
       * `sh bash curl wget rm chmod mv cp find sed awk tar zip unzip` are
       * refused unless listed here. Env: `GENERATORAI_SCRIPT_EXTRA_ALLOWLIST`
       * (comma-separated).
       */
      extraAllowlist: z.array(z.string().min(1).max(64)).max(64).default([]),
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
      /**
       * TTL (days) for event payloads (events + stream_cursors).
       *
       * W02 — was 90, which exceeded the age of the oldest row in a database
       * that had been running for 85 days, so the sweeper had literally never
       * deleted anything and the token log had grown to 81% of a 1.76 GB file.
       *
       * 30 rather than the 14 the plan proposed: `stream_cursors` is now the
       * only durable event log, so this TTL also bounds how far back SDK replay
       * can reach. Chat transcripts, tool calls and artifacts live in their own
       * tables and are untouched — but a run's *event* history is not. Phase 1
       * splits deltas from items (W04/W07), at which point deltas can drop to
       * days and items can keep a much longer TTL of their own; until then a
       * single number has to serve both and 30 is the conservative side of it.
       *
       * This is the ttl for `item`-class rows: the durable record of what was
       * said and done. Token and reasoning DELTAS, which a finished turn has
       * already superseded, use the much shorter `deltaPayloadTtlDays`, and a
       * turn that never finished outlives both (see below) so crash recovery
       * still has something to replay.
       */
      eventPayloadTtlDays: z.number().int().min(1).max(3650).default(30),
      /**
       * TTL (days) for `delta`-class stream rows. These are the token and
       * reasoning fragments that a completed turn replaces with a single
       * item, and they are the bulk of `stream_cursors`. The default of 1 day
       * is orders of magnitude longer than any turn, so nothing in flight is
       * ever at risk, and it is capped at `eventPayloadTtlDays` in the sweep.
       */
      deltaPayloadTtlDays: z.number().int().min(1).max(3650).default(1),
      /**
       * How many multiples of `eventPayloadTtlDays` the rows of an UNFINISHED
       * turn survive. Below that age they are exempt from both TTLs, because
       * a turn with no terminal event crashed and its stream rows are the only
       * record of it. Past it they are pruned anyway, so the table stays
       * bounded rather than accumulating every crash forever.
       */
      unfinishedTtlMultiplier: z.number().int().min(1).max(24).default(2),
      /** How often (ms) the retention job sweeps. Default 15 minutes. */
      sweepIntervalMs: z.number().int().min(60_000).default(15 * 60 * 1000),
      /**
       * Max rows deleted per sweep.
       *
       * This is a SYNCHRONOUS `better-sqlite3` DELETE on the server's only
       * thread, so the batch size is directly how long every request, SSE
       * write and harness read is stalled. At the old default of 50,000 that
       * was a measurable freeze once an hour (review 6.6 / item 45). 2,000
       * keeps each stall short; the sweep runs four times as often to remove
       * the same volume over time.
       */
      maxDeletePerSweep: z.number().int().min(100).max(1_000_000).default(2_000),
      /**
       * W02 — SQLite never returns freed pages to the filesystem without an
       * explicit VACUUM, so a bounded delete sweep shrinks the row count and
       * nothing else. When enabled, the service runs `PRAGMA incremental_vacuum`
       * after a sweep that actually deleted rows.
       *
       * This requires `auto_vacuum=INCREMENTAL`, which no existing database
       * has, and which can only be changed by a full VACUUM — see
       * `scripts/db-reclaim.ts` (`pnpm db:reclaim`). The service probes the
       * pragma at startup and logs whether reclaim is active or inert, because
       * `incremental_vacuum` on a NONE database succeeds while doing nothing.
       */
      incrementalVacuum: z.boolean().default(true),
      /**
       * Pages reclaimed per incremental vacuum step. 2000 pages ≈ 8 MB at the
       * default 4 KB page size. Kept small deliberately: better-sqlite3 is
       * synchronous, so this runs on the server's only thread.
       */
      vacuumPagesPerSweep: z.number().int().min(1).max(1_000_000).default(2_000),
      /**
       * Refresh query-planner statistics every N sweeps via `PRAGMA optimize`
       * (not `ANALYZE` — see EventRetentionService for why). 0 disables.
       */
      analyzeEverySweeps: z.number().int().min(0).max(1000).default(24),
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

  // Computer Use — driving native desktop apps on the user's machine. OFF by
  // default and gated again by the `GENERATORAI_COMPUTER_USE=disabled` env
  // kill switch, which beats every other source so an enterprise can turn the
  // feature off without touching per-workspace config.
  computerUse: z
    .object({
      enabled: z.boolean().default(false),
      /**
       * The physical desktop is a singleton resource — two agents typing into
       * the same machine interleave keystrokes. Capped low on purpose.
       */
      maxConcurrentSessions: z.number().int().min(1).max(4).default(1),
      /**
       * Allow Tier 3 (synthetic OS input). This TAKES OVER the user's pointer
       * and keyboard and can never be verified, so it is opt-in and always
       * re-prompts for consent.
       */
      allowSyntheticFallback: z.boolean().default(false),
      /**
       * P1-30 — capturing a full-screen PNG after every action cost 1–3 MB of
       * disk, one artifact row and one audit row per click, for a frame the
       * model usually did not ask for. Off by default; a tool call that needs
       * to see the result asks for it explicitly via `includeScreenshot`.
       */
      screenshotEveryAction: z.boolean().default(false),
      /** Caps on the a11y tree returned to the model, to bound token cost. */
      maxSnapshotElements: z.number().int().min(50).max(10_000).default(1_200),
      maxSnapshotDepth: z.number().int().min(4).max(256).default(64),
      /** Screenshots above this are downscaled, then dropped if still over. */
      screenshotMaxBytes: z.number().int().min(50_000).max(20_000_000).default(900_000),
      screenshotMaxEdge: z.number().int().min(320).max(4096).default(1280),
      /**
       * X-14 — the wire format for captured frames. The driver always writes
       * PNG; this is what we re-encode to before the artifact is stored, so it
       * governs both disk and the base64 that reaches the model.
       *
       * WebP at 75 measures 3-5x smaller than the equivalent PNG with no
       * observable loss on UI text. `png` disables re-encoding and is only for
       * diagnosing a suspected transcode artifact. Every provider we ship
       * accepts all three.
       */
      screenshotFormat: z.enum(['png', 'jpeg', 'webp']).default('webp'),
      screenshotQuality: z.number().int().min(1).max(100).default(75),
      actionTimeoutMs: z.number().int().min(1_000).max(300_000).default(30_000),
      /** Seconds a `computer.consent_required` prompt stays answerable. */
      consentTtlSeconds: z
        .number()
        .int()
        .min(10)
        .max(600)
        .default(COMPUTER_USE_CONSENT_TTL_MS / 1000),
      /** Idle sessions are torn down after this long with no activity. */
      idleTimeoutMs: z.number().int().min(30_000).max(24 * 60 * 60 * 1000).default(15 * 60 * 1000),
      /**
       * Blocklist ADDITIONS. Named `extra*` and defaulted to `[]` on purpose:
       * a field that defaulted to the built-in list would let any config writer
       * (settings UI, extension, hook, or the agent itself via a file write)
       * delete every built-in entry by supplying `[]`. The built-ins are
       * unioned in by `buildBlocklist()` and are not expressible as "removed".
       */
      extraBlockedBundleIds: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
      extraBlockedNameFragments: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
      extraBlockedExecutables: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
      /**
       * Escape hatch, matched by exact bundle id / AUMID only. Names and window
       * titles are spoofable, so allowing them here would be the bypass. Cannot
       * un-block our own app, and never suppresses the window-title scan.
       */
      alwaysAllowedApps: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    })
    .default({}),

  /** Project root directory — used as default CWD for data source scripts */
  projectRoot: z.string().optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
