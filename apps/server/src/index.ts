// ────────────────────────────────────────────────────────────────
// Server Entry Point — startup, graceful shutdown
// ────────────────────────────────────────────────────────────────

import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { resolve, dirname } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── Load .env file (if present) before reading process.env ──────────────────
// Supports KEY=VALUE lines; ignores comments (#) and blank lines.
// Env vars already set in the process take precedence (no override).
{
  const __envDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const envFile = resolve(__envDir, '.env');
  if (existsSync(envFile)) {
    for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 1) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  }
}
import express from 'express';
import { createServer } from 'node:http';
import { AppConfigSchema, readBoundedInt } from '@generatorai/shared';
import { StartupSecurityError } from './composition/security.js';
import { ensureBootstrapPairing } from './composition/bootstrapPairing.js';
import { RelayStreamBridge } from './relay/RelayStreamBridge.js';
import { createContainer } from './composition-root.js';
import type { Container } from './composition-root.js';
import type { WedgeDetector, LoopTurnProber } from '@generatorai/core';
import { createApp } from './app.js';
import { createWidgetAssetRoutes } from './routes/extensions.js';
import { attachBrowserWebSocket } from './browser-ws.js';
import { attachTerminalWebSocket } from './terminal-ws.js';
import { attachSttWebSocket } from './stt-ws.js';
import { attachTtsWebSocket } from './tts-ws.js';
import { resolveAdvertisedEndpoints } from './network/advertisedEndpoints.js';
import { readExposureMode, resolveBindHost } from './network/exposure.js';
import { readComputerUsePreferences } from './settings/computerUse.js';
import { publishLocalAdminToken, removeLocalAdminToken } from './composition/localAdminToken.js';
import { exitAfterBoundedFlush } from './boundedFlush.js';
import {
  killOwnDescendants,
  reapOrphanedHarnessChildren,
  startChildReaperHeartbeat,
  stopChildReaperHeartbeat,
} from '@generatorai/agent-harness-providers';

// ── Process-level failure policy (P0-40) ────────────────────────────────────
//
// Node defaults to `--unhandled-rejections=throw`, so a single rejected promise
// anywhere — including from a vendored JSON-RPC writer's background task that
// we cannot attach a handler to — took down a server that had otherwise started
// cleanly. One failing session must not be able to kill every other session.
//
// The opposite failure is worse though: swallowing everything leaves the
// process running in an unknown state. So the policy is explicit rather than
// blanket. A fault is FATAL only when the process itself, not one request, has
// lost the ability to function:
//
//   - ERR_WORKER_OUT_OF_MEMORY: a worker died on allocation; the heap ceiling
//     applies to us too and the next allocation is a coin flip.
//   - ERR_DLOPEN_FAILED: a native module could not be loaded. Whatever depends
//     on it is permanently broken, and it is always something structural
//     (better-sqlite3, node-pty) because those are the only native deps.
//
// Notably NOT fatal, though an earlier draft listed them:
//   - ERR_MODULE_NOT_FOUND — the harness providers are loaded through a
//     deliberate optional-dependency dynamic import. A missing provider is
//     supposed to mark that harness unavailable and degrade, which is the
//     opposite of exiting.
//   - ERR_ASSERTION — thrown by `node:assert` inside third-party libraries on
//     conditions that are usually local to one connection. We cannot tell our
//     own invariants from `ws`'s.
//   - V8 heap exhaustion is not represented here because it is not catchable:
//     it aborts the process before any handler runs.
//
// Registered at module scope on purpose: container initialization is where
// these fire, and a handler installed after `await container.initialize()` is
// installed too late to ever see them.
const DEAD_PIPE_CODES = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END']);

const FATAL_ERROR_CODES = new Set(['ERR_WORKER_OUT_OF_MEMORY', 'ERR_DLOPEN_FAILED']);

function errorCode(value: unknown): string | undefined {
  const code = (value as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function isDeadPipeError(value: unknown): boolean {
  const code = errorCode(value);
  return code !== undefined && DEAD_PIPE_CODES.has(code);
}

function isFatalFault(value: unknown): boolean {
  const code = errorCode(value);
  return code !== undefined && FATAL_ERROR_CODES.has(code);
}

function describeFault(value: unknown): { message: string; stack?: string; code?: string } {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack, code: errorCode(value) };
  }
  return { message: String(value), code: errorCode(value) };
}

/**
 * Set by `startServer` once a graceful shutdown path exists. A fatal fault
 * routes through it rather than calling `process.exit` directly — exiting here
 * would skip `container.shutdown()` and `killOwnDescendants()`, i.e. it would
 * CREATE the orphan class this same phase exists to delete.
 */
let requestShutdown: ((reason: string) => void) | undefined;

/**
 * Set as soon as the container exists. The three `handleFault` paths that
 * cannot run a graceful shutdown (fault during shutdown, fault before listen,
 * fault storm with no handler) race THIS against a 2 s deadline before they
 * exit, so the EventBus persist queue and the StreamBroker write batcher get
 * one bounded chance to commit instead of being discarded — see
 * `boundedFlush.ts`. Undefined before the container exists: nothing to flush.
 */
let faultFlush: (() => Promise<unknown>) | undefined;

/**
 * True once shutdown has begun. Faults raised DURING shutdown must not be
 * swallowed: the whole point of continuing after a fault is that the process is
 * still serving requests, and once it is not, "log and carry on" leaves it
 * wedged half-torn-down with its listeners closed and its children alive. From
 * this point a fault is always terminal.
 */
let shuttingDown = false;

/** Single funnel so both handlers report identically and the counter is one place. */
let faultCount = 0;
function reportFault(kind: 'unhandledRejection' | 'uncaughtException', value: unknown): void {
  faultCount += 1;
  const { message, stack, code } = describeFault(value);
  console.error(
    `[Server] ${kind} #${faultCount}${code ? ` (${code})` : ''}: ${message}\n${stack ?? ''}`,
  );
}

/**
 * Faults per window before the process is considered to be looping. A handler
 * that itself throws — a broken logger, an exhausted heap — otherwise produces
 * an unbounded stream of them and the process spins doing nothing useful.
 */
const FAULT_STORM_LIMIT = 50;
const FAULT_STORM_WINDOW_MS = 10_000;
let faultWindowStart = 0;
let faultsInWindow = 0;

function isFaultStorm(now: number): boolean {
  if (now - faultWindowStart > FAULT_STORM_WINDOW_MS) {
    faultWindowStart = now;
    faultsInWindow = 0;
  }
  faultsInWindow += 1;
  return faultsInWindow > FAULT_STORM_LIMIT;
}

function handleFault(kind: 'unhandledRejection' | 'uncaughtException', value: unknown): void {
  if (isDeadPipeError(value)) {
    console.warn('[Server] ignored write to a closed child process stream');
    return;
  }
  reportFault(kind, value);

  if (shuttingDown) {
    console.error('[Server] fault during shutdown — exiting after a bounded flush');
    void exitAfterBoundedFlush(1, { flush: faultFlush });
    return;
  }
  if (isFaultStorm(Date.now())) {
    console.error(
      `[Server] more than ${FAULT_STORM_LIMIT} faults in ${FAULT_STORM_WINDOW_MS}ms — ` +
        'the process is not making progress; shutting down',
    );
    if (requestShutdown) requestShutdown('fault-storm');
    else void exitAfterBoundedFlush(1, { flush: faultFlush });
    return;
  }
  if (!isFatalFault(value)) return;

  console.error('[Server] fault class is unrecoverable — shutting down');
  if (requestShutdown) {
    requestShutdown(kind);
  } else {
    // Faulted before the server was listening; there is no listener to
    // drain, but the container (if it exists) may already hold queued writes.
    void exitAfterBoundedFlush(1, { flush: faultFlush });
  }
}

process.on('unhandledRejection', (reason) => handleFault('unhandledRejection', reason));
process.on('uncaughtException', (err) => handleFault('uncaughtException', err));

/** Expand leading ~ to the user's home directory and resolve to absolute path. */
function expandPath(p: string): string {
  if (p.startsWith('~')) {
    return resolve(homedir(), p.slice(2)); // skip "~/" or "~\\"
  }
  return resolve(p);
}

/** Resolve the default DB path to packages/db/data/ within the project */
function getDefaultDbPath(): string {
  // Navigate from apps/server/src/ up to project root, then into packages/db/data/
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = resolve(__dirname, '..', '..', '..');
  return resolve(projectRoot, 'packages', 'db', 'data', 'generatorai.db');
}

/** Resolve the default templates directory to templates/ within the project root */
function getDefaultTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = resolve(__dirname, '..', '..', '..');
  return resolve(projectRoot, 'templates');
}

async function startServer(): Promise<void> {
  // 1. Load and validate configuration
  const dbPath = expandPath(process.env['DB_PATH'] ?? getDefaultDbPath());
  const workspacesDir = expandPath(process.env['WORKSPACES_DIR'] ?? '~/.generatorai/workspaces');
  const artifactsDir = expandPath(process.env['ARTIFACTS_DIR'] ?? '~/.generatorai/artifacts');
  const templatesDir = expandPath(process.env['TEMPLATES_DIR'] ?? getDefaultTemplatesDir());
  const extensionsDir = expandPath(
    process.env['GENERATORAI_EXTENSIONS_DIR'] ?? process.env['EXTENSIONS_DIR'] ?? '~/.generatorai/extensions',
  );

  // Ensure directories exist (mkdirSync is safe with { recursive: true })
  for (const dir of [workspacesDir, artifactsDir, extensionsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  // Ensure the parent directory of the DB file exists
  const dbDataDir = resolve(dbPath, '..');
  mkdirSync(dbDataDir, { recursive: true });

  // W20 / X-18 — server.lock: identity file written on startup and removed on
  // clean shutdown. If a lock from a previous process (different PID) exists we
  // log a warning — the previous server may not have exited cleanly (e.g. SIGKILL).
  // We do NOT refuse to start; the workflow engine's recovery handles in-flight runs.
  const lockPath = resolve(dbDataDir, 'server.lock');
  const instanceId = randomUUID();
  const lockPort = parseInt(process.env['PORT'] ?? '3100', 10);
  const lockPayload = JSON.stringify({ instanceId, pid: process.pid, port: lockPort, startedAt: new Date().toISOString() });
  try {
    if (existsSync(lockPath)) {
      const prev = JSON.parse(readFileSync(lockPath, 'utf8')) as {
        instanceId?: string; pid?: number; port?: number; startedAt?: string;
      };
      if (prev.pid && prev.pid !== process.pid) {
        console.warn(
          `[Server] server.lock (pid=${prev.pid}, id=${prev.instanceId ?? '?'}) found from a prior instance — ` +
          'it may not have exited cleanly. Proceeding; the workflow engine will recover in-flight runs.',
        );
      }
    }
    writeFileSync(lockPath, lockPayload, 'utf8');
  } catch (err) {
    // Lock file is advisory only — a failure here must not block startup.
    console.warn('[Server] Could not write server.lock:', err instanceof Error ? err.message : String(err));
  }

  const rawConfig = {
    port: parseInt(process.env['PORT'] ?? '3100', 10),
    dbPath,
    workspacesDir,
    artifactsDir,
    templatesDir,
    extensionsDir,
    // Bounded: this feeds a concurrency cap, and `NaN` from a typo makes
    // every `>=` check against it false — removing the bound silently.
    maxConcurrentSessions: readBoundedInt('MAX_CONCURRENT_SESSIONS', {
      defaultValue: 10,
      min: 1,
      max: 500,
    }),
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
    copilot: {
      // `auto` — the provider chooses — rather than a pinned version.
      // A hardcoded model name goes stale: on an account whose catalogue had
      // moved on, EVERY new chat failed at creation with `Model
      // "claude-sonnet-4.6" is not available`, so "New Chat" was simply broken
      // until the user set COPILOT_MODEL by hand. `auto` is always offered.
      defaultModel: process.env['COPILOT_MODEL'] ?? 'auto',
      useStdio: process.env['COPILOT_USE_STDIO'] !== 'false',
      autoRestart: process.env['COPILOT_AUTO_RESTART'] !== 'false',
      // Only read ambient tokens when no GHEC host is configured — VS Code's
      // Copilot extension injects COPILOT_GITHUB_TOKEN for github.com which
      // would fail validation against a GHEC tenant.
      githubToken:
        (process.env['COPILOT_GH_HOST'] ?? process.env['GH_HOST'])
          ? undefined
          : (process.env['COPILOT_GITHUB_TOKEN'] ??
             process.env['GITHUB_TOKEN'] ??
             process.env['GH_TOKEN']),
      githubHost:
        process.env['COPILOT_GH_HOST'] ??
        process.env['GH_HOST'],
    },
    streaming: {
      heartbeatIntervalMs: parseInt(process.env['SSE_HEARTBEAT_MS'] ?? '15000', 10),
      maxReplayEvents: parseInt(process.env['SSE_MAX_REPLAY'] ?? '10000', 10),
      bufferCleanupDelayMs: parseInt(process.env['SSE_BUFFER_CLEANUP_DELAY_MS'] ?? '300000', 10),
    },
    security: {
      corsOrigins: process.env['CORS_ORIGINS']
        ? process.env['CORS_ORIGINS'].split(',').map((s) => s.trim())
        : undefined,
      // Loopback unless the user has explicitly opted this server into being
      // reachable from the network (Settings → Security, persisted next to the
      // database). `GENERATORAI_BIND_HOST` still overrides both.
      bindHost: resolveBindHost({
        envBindHost: process.env['GENERATORAI_BIND_HOST'],
        mode: readExposureMode(dirname(resolve(dbPath))),
      }),
      allowUnauthenticatedLoopback:
        process.env['GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK'] === '1',
      requireSecureSecretStore: process.env['GENERATORAI_REQUIRE_SECURE_SECRETS'] === '1',
      ...(process.env['GENERATORAI_TOKEN_AUDIENCE']
        ? { tokenAudience: process.env['GENERATORAI_TOKEN_AUDIENCE'] }
        : {}),
      ...(process.env['GENERATORAI_SECRETS_DIR']
        ? { secretsDir: expandPath(process.env['GENERATORAI_SECRETS_DIR']) }
        : {}),
      relayEnabled: process.env['GENERATORAI_RELAY_ENABLED'] === '1',
      ...(process.env['GENERATORAI_RELAY_DIRECTOR_URL']
        ? { relayDirectorUrl: process.env['GENERATORAI_RELAY_DIRECTOR_URL'] }
        : {}),
      ...(process.env['GENERATORAI_AUDIT_RETENTION_DAYS']
        ? {
            auditRetentionDays: parseInt(process.env['GENERATORAI_AUDIT_RETENTION_DAYS'], 10),
          }
        : {}),
      // How long a paired device may keep resuming before pairing again.
      // Left unset, the schema default (48h) applies. NaN is deliberately not
      // filtered here: the Zod schema rejects it loudly at startup rather than
      // silently minting credentials that expire immediately.
      ...(process.env['GENERATORAI_SESSION_TTL_HOURS']
        ? {
            sessionTtlHours: parseInt(process.env['GENERATORAI_SESSION_TTL_HOURS'], 10),
          }
        : {}),
    },
    // Computer Use. Off unless the user has turned it on in Settings (persisted
    // next to the database). The env vars only supply the default before the
    // setting has ever been written; a `GENERATORAI_COMPUTER_USE` disable token
    // still wins over everything inside ComputerService.
    computerUse: (() => {
      const prefs = readComputerUsePreferences(dirname(resolve(dbPath)), {
        enabled: process.env['GENERATORAI_COMPUTER_USE'] === '1',
        allowSynthetic: process.env['GENERATORAI_COMPUTER_USE_SYNTHETIC'] === '1',
      });
      return { enabled: prefs.enabled, allowSyntheticFallback: prefs.allowSynthetic };
    })(),
    sandbox: {
      enabled: process.env['SANDBOX_ENABLED'] === 'true',      ...(process.env['SANDBOX_PROVIDER'] ? { provider: process.env['SANDBOX_PROVIDER'] } : {}),
      ...(process.env['SANDBOX_IMAGE'] ? { image: process.env['SANDBOX_IMAGE'] } : {}),
      ...(process.env['SANDBOX_CLI_PORT'] ? { cliPort: parseInt(process.env['SANDBOX_CLI_PORT'], 10) } : {}),
      ...(process.env['SANDBOX_STARTUP_TIMEOUT_MS'] ? { startupTimeoutMs: parseInt(process.env['SANDBOX_STARTUP_TIMEOUT_MS'], 10) } : {}),
      ...(process.env['SANDBOX_AUTO_DESTROY'] != null ? { autoDestroy: process.env['SANDBOX_AUTO_DESTROY'] !== 'false' } : {}),
    },
    scripts: {
      workflowScriptsEnabled:
        process.env['GENERATORAI_ALLOW_WORKFLOW_SCRIPTS'] === 'true' ||
        process.env['GENERATORAI_ALLOW_SCRIPT_UPLOAD'] === 'true',
      extraAllowlist: (process.env['GENERATORAI_SCRIPT_EXTRA_ALLOWLIST'] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    otel: {
      enabled: process.env['OTEL_ENABLED'] === 'true',
      ...(process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ? { endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] } : {}),
      ...(process.env['OTEL_SERVICE_NAME'] ? { serviceName: process.env['OTEL_SERVICE_NAME'] } : {}),
      ...(process.env['OTEL_SAMPLE_RATE'] ? { sampleRate: parseFloat(process.env['OTEL_SAMPLE_RATE']) } : {}),
      ...(process.env['OTEL_METRICS_EXPORT_INTERVAL_MS'] ? { metricsExportIntervalMs: parseInt(process.env['OTEL_METRICS_EXPORT_INTERVAL_MS'], 10) } : {}),
    },
    // PRV-01 — harness provider selection. HARNESS_TYPE selects the default
    // provider; every other available provider still runs alongside it.
    harness: {
      // Codex options apply whichever provider is the default. Its CLI path is
      // not mapped here: `CODEX_CLI_PATH` is read by Codex discovery itself.
      codex: {
        ...(process.env['CODEX_MODEL'] ? { defaultModel: process.env['CODEX_MODEL'] } : {}),
        ...(process.env['CODEX_APPROVAL_POLICY'] ? { approvalPolicy: process.env['CODEX_APPROVAL_POLICY'] } : {}),
        ...(process.env['CODEX_SANDBOX_MODE'] ? { sandboxMode: process.env['CODEX_SANDBOX_MODE'] } : {}),
      },
      ...(process.env['HARNESS_TYPE'] ? {
        type: process.env['HARNESS_TYPE'],
        ...(process.env['HARNESS_TYPE'] === 'claude-agent' ? {
          claudeAgent: {
            ...(process.env['CLAUDE_AGENT_MODEL'] ? { defaultModel: process.env['CLAUDE_AGENT_MODEL'] } : {}),
            ...(process.env['CLAUDE_AGENT_EFFORT'] ? { effort: process.env['CLAUDE_AGENT_EFFORT'] } : {}),
            ...(process.env['CLAUDE_AGENT_PERMISSION_MODE'] ? { permissionMode: process.env['CLAUDE_AGENT_PERMISSION_MODE'] } : {}),
            ...(process.env['CLAUDE_AGENT_MAX_TURNS'] && !Number.isNaN(parseInt(process.env['CLAUDE_AGENT_MAX_TURNS'], 10)) ? { maxTurns: parseInt(process.env['CLAUDE_AGENT_MAX_TURNS'], 10) } : {}),
          },
        } : {}),
        ...(process.env['HARNESS_TYPE'] === 'anthropic' ? {
          anthropic: {
            ...(process.env['ANTHROPIC_API_KEY'] ? { apiKey: process.env['ANTHROPIC_API_KEY'] } : {}),
            ...(process.env['ANTHROPIC_MODEL'] ? { defaultModel: process.env['ANTHROPIC_MODEL'] } : {}),
          },
        } : {}),
      } : {}),
    },
  };

  const config = AppConfigSchema.parse(rawConfig);

  // 2. Create DI container
  const container: Container = await createContainer(config);
  // From here on a fault exit gets one bounded chance to commit queued writes.
  faultFlush = () => Promise.all([container.eventBus.flush(), container.streamBroker.flushWrites()]);

  // P0-14 / X-22 — before anything spawns a provider CLI, clean up after a
  // previous server that died without running its shutdown path, and start
  // publishing the liveness record the NEXT boot will use to do the same for
  // us. Both are best-effort: a failure here must never block startup.
  try {
    await reapOrphanedHarnessChildren(container.logger);
  } catch (err) {
    container.logger.warn('[Server] orphan reap failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  startChildReaperHeartbeat();

  // W21 — Start the event-loop wedge detector (L6: runs in a worker_thread
  // that is NOT downstream of a frozen main loop). Alert threshold is tunable
  // via env; defaults are conservative (5s alert, 1s tick) to tolerate
  // normal GC pauses without false positives.
  //
  // Imported here to keep the feature behind a single env flag that lets
  // operators disable it if the worker_threads overhead is undesirable.
  let wedgeDetector: WedgeDetector | undefined;
  // W21 — the loop-turn prober is created after `listen` (it needs the bound
  // port), but the detector references it now so a diagnostic report written
  // on trip carries the probe's state: "the HTTP probe had already been
  // failing for 12 s" is what separates a wedged loop from a merely slow one.
  let loopTurnProber: LoopTurnProber | undefined;
  if (process.env['GENERATORAI_WEDGE_DETECT'] !== '0') {
    const { WedgeDetector } = await import('@generatorai/core');
    const alertThresholdMs = parseInt(process.env['GENERATORAI_WEDGE_ALERT_MS'] ?? '5000', 10);
    const tickIntervalMs = parseInt(process.env['GENERATORAI_WEDGE_TICK_MS'] ?? '1000', 10);
    const killOnWedge = process.env['GENERATORAI_WEDGE_KILL'] === '1';
    wedgeDetector = new WedgeDetector({
      alertThresholdMs,
      tickIntervalMs,
      killOnWedge,
      // W21 — write a diagnostic on trip and replay it on the NEXT boot. A
      // wedge that ends in SIGKILL leaves nothing in the logs of the process
      // that died, so the evidence has to outlive it. Kept beside the DB,
      // which is the one directory we already own and know is writable.
      diagnosticsDir: dirname(resolve(config.dbPath)),
      probe: { snapshot: () => loopTurnProber?.snapshot() ?? { consecutiveFailures: 0 } },
      logger: {
        info: (m) => container.logger.info(m),
        warn: (m) => container.logger.warn(m),
        error: (m) => container.logger.error(m),
      },
      onPriorWedge: (report) => {
        container.logger.error(
          `[Server] PREVIOUS RUN WEDGED at ${report.at} — the event loop had not ticked for ` +
          `~${report.overdueMsApprox}ms (threshold ${report.alertThresholdMs}ms)`,
          {
            wedgeReport: report,
          },
        );
      },
      onWedge: (overdueMsApprox) => {
        console.error(
          `[Server] EVENT LOOP WEDGE DETECTED — main loop has not ticked for ~${overdueMsApprox}ms ` +
          `(threshold: ${alertThresholdMs}ms). The process may be unresponsive.`,
        );
        // Tearing the server down is GATED ON `killOnWedge`, because reaching
        // this callback at all proves the loop is alive: it is invoked from
        // the main thread's message-port handler, so a truly frozen loop would
        // never run it (that case is the worker's SIGTERM, which `killOnWedge`
        // also gates). What lands here is therefore a loop that was merely
        // SLOW — and `alertThresholdMs` defaults to 5s, which this workload
        // crosses routinely: synchronous better-sqlite3 queries over a
        // multi-hundred-MB database, listing hundreds of workflows, spawning
        // agent subprocesses.
        //
        // Shutting down unconditionally made an ALERT threshold behave as a
        // kill switch. Observed: a 5,295ms stall (295ms over) terminated the
        // server mid-run and the child reaper took five descendants with it —
        // three of them live `claude.exe` agent processes — losing the
        // in-flight workflow. `GENERATORAI_WEDGE_KILL` is documented as
        // opt-in; honouring it here makes the default alert-only, which is
        // what `GENERATORAI_WEDGE_ALERT_MS` has always claimed to be.
        if (killOnWedge && requestShutdown) requestShutdown('wedge-detected');
      },
    });
    wedgeDetector.start();
  }

  // 3. Initialize services (load templates, start Copilot, recover sessions)
  await container.initialize();

  // 4. Create Express app
  const app = createApp(container);

  // 5. Start listening.
  //
  // The bind host matters as much as the port: `createSecurityContext` has
  // already refused to build a container that would expose an unauthenticated
  // API here, so by the time we listen the posture is known-good.
  const bindHost = config.security.bindHost;

  // W20 — identity-checked port acquisition with a fallback ladder.
  //
  // `app.listen` on a taken port emits an unhandled 'error' and kills the
  // process with a bare EADDRINUSE. Two different situations hide behind that
  // one error, and they need opposite responses:
  //
  //   another GeneratorAI server  → laddering onto port+1 would leave two
  //                                 servers fighting over one SQLite file and
  //                                 one admin-token file, and the CLI would
  //                                 talk to whichever won. Refuse, loudly.
  //   anything else               → the port is simply occupied; step to the
  //                                 next one and carry on.
  //
  // The identity check is `/api/health/loop-turn` — public (see
  // packages/auth routePolicy) and shaped distinctively enough that a foreign
  // listener will not accidentally match.
  const probeHost =
    bindHost === '0.0.0.0' || bindHost === '::' || bindHost === '' ? '127.0.0.1' : bindHost;
  const probeAuthority = (port: number): string =>
    probeHost.includes(':') ? `[${probeHost}]:${port}` : `${probeHost}:${port}`;

  const occupantIsGeneratorAI = async (port: number): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    try {
      const res = await fetch(`http://${probeAuthority(port)}/api/health/loop-turn`, {
        signal: controller.signal,
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: unknown; respondedAt?: unknown; uptimeMs?: unknown };
      return body?.ok === true && typeof body.respondedAt === 'number' && typeof body.uptimeMs === 'number';
    } catch {
      // No answer, wrong shape, not HTTP — whatever holds the port, it is not us.
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const listenOn = (port: number): Promise<Server> =>
    new Promise<Server>((resolvePort, rejectPort) => {
      const candidate = app.listen(port, bindHost);
      const onError = (err: Error): void => {
        candidate.removeListener('listening', onListening);
        rejectPort(err);
      };
      const onListening = (): void => {
        candidate.removeListener('error', onError);
        resolvePort(candidate);
      };
      candidate.once('error', onError);
      candidate.once('listening', onListening);
    });

  const maxPortAttempts = Math.max(1, parseInt(process.env['GENERATORAI_PORT_MAX_ATTEMPTS'] ?? '10', 10) || 10);
  let server: Server | undefined;
  let listenPort = config.port;

  for (let attempt = 0; attempt < maxPortAttempts; attempt++) {
    const candidatePort = config.port + attempt;
    try {
      server = await listenOn(candidatePort);
      listenPort = candidatePort;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') throw err;
      if (await occupantIsGeneratorAI(candidatePort)) {
        throw new Error(
          `[Server] Port ${candidatePort} is already served by another GeneratorAI server. ` +
          'Refusing to start a second instance against the same data directory — stop the running ' +
          'server, or point this one at a different DB_PATH and PORT.',
        );
      }
      container.logger.warn(
        `[Server] Port ${candidatePort} is in use by another process — trying ${candidatePort + 1}`,
        { attempt: attempt + 1, maxPortAttempts },
      );
    }
  }

  if (!server) {
    throw new Error(
      `[Server] Could not acquire a port: ${config.port}–${config.port + maxPortAttempts - 1} are all in use.`,
    );
  }

  {
    // Only now is this process the one a local CLI should be able to talk to.
    if (container.localAdminToken) {
      publishLocalAdminToken(dirname(resolve(config.dbPath)), container.localAdminToken);
    } else {
      removeLocalAdminToken(dirname(resolve(config.dbPath)));
    }
    container.logger.info(
      `[Server] GeneratorAI server listening on ${bindHost}:${listenPort}`,
      {
        port: listenPort,
        bindHost,
        environment: process.env['NODE_ENV'] ?? 'development',
        dbPath: config.dbPath,
        authenticationRequired: container.security.posture.authenticationRequired,
        secretBackend: container.security.posture.secretBackend.kind,
        streaming: {
          enabled: config.streaming.enabled,
          heartbeatMs: config.streaming.heartbeatIntervalMs,
        },
        copilot: {
          model: config.copilot.defaultModel,
          stdio: config.copilot.useStdio,
        },
      },
    );
  }

  // 5a-2. W21 — start the loop-turn prober now that the bound port is known.
  //       It probes an endpoint answered FROM the event loop, so a slow or
  //       absent response is direct evidence the loop is not turning — unlike
  //       a socket check, which the kernel answers while the loop is frozen.
  //       Disabled with GENERATORAI_LOOP_PROBE=0.
  if (process.env['GENERATORAI_LOOP_PROBE'] !== '0') {
    const { LoopTurnProber } = await import('@generatorai/core');
    loopTurnProber = new LoopTurnProber({
      url: `http://${probeAuthority(listenPort)}/api/health/loop-turn`,
      intervalMs: parseInt(process.env['GENERATORAI_LOOP_PROBE_INTERVAL_MS'] ?? '10000', 10),
      timeoutMs: parseInt(process.env['GENERATORAI_LOOP_PROBE_TIMEOUT_MS'] ?? '5000', 10),
      logger: {
        info: (m) => container.logger.info(m),
        warn: (m) => container.logger.warn(m),
        error: (m) => container.logger.error(m),
      },
      onUnresponsive: ({ consecutiveFailures, lastError }) => {
        container.logger.error(
          `[Server] Loop-turn endpoint unresponsive after ${consecutiveFailures} consecutive probes`,
          { lastError },
        );
      },
      onRecovered: ({ downForMs }) => {
        container.logger.info(`[Server] Loop-turn endpoint recovered after ${downForMs}ms`);
      },
    });
    loopTurnProber.start();
  }

  // 5b. Attach Integrated Browser WebSocket (`/api/workspaces/:id/browser/stream`)
  //     for high-fps live-view streaming + input dispatch. Bypasses the
  //     Vite dev proxy's multipart/x-mixed-replace buffering.
  attachBrowserWebSocket(server, container);

  // 5c. Attach Integrated Terminal WebSocket
  //     (`/api/workspaces/:id/terminals/:sid/stream`) for live PTY IO.
  //     Same noServer upgrade pattern as the browser WS.
  attachTerminalWebSocket(server, container);

  // 5d. Attach Speech-to-Text WebSocket (`/api/stt/stream`) for voice
  //     input. Runs Whisper (base.en) locally on CPU — no cloud, no key,
  //     no cost. Same noServer upgrade + auth/origin pattern.
  attachSttWebSocket(server, container);

  // 5d-2. Attach Text-to-Speech WebSocket (`/api/tts/stream`) for voice
  //       output (Phase 3 — "read this message aloud"). Runs Kokoro
  //       locally on CPU. Same noServer upgrade + auth/origin pattern.
  attachTtsWebSocket(server, container);

  // 5e. Dedicated widget-asset origin — serves ONLY `/api/widget-assets/*`
  //     on a separate loopback port so widget iframes live on a distinct
  //     origin from the host SPA/API. This is the MCP-Apps "sandbox proxy"
  //     origin split: it lets widgets use a real origin (fetch, storage,
  //     multi-file bundles) while `allow-same-origin` stays scoped to this
  //     isolated origin — never the host. NO auth/cookies/SPA here.
  const widgetPort = parseInt(process.env['WIDGET_PORT'] ?? '3101', 10);
  const widgetApp = express();
  widgetApp.use('/api/widget-assets', createWidgetAssetRoutes(container));
  const widgetServer = createServer(widgetApp);
  widgetServer.listen(widgetPort, '127.0.0.1', () => {
    container.logger.info(
      `[Server] Widget asset origin listening on http://127.0.0.1:${widgetPort}`,
      { widgetPort },
    );
  });

  // 5f. Relay data plane. The broker was wired during container creation, but
  //     the bridge needs the bound loopback port, so it is attached here.
  if (container.relayHostBroker?.isEnabled()) {
    container.relayHostBroker.setStreamBridge(
      new RelayStreamBridge({
        logger: container.logger,
        localPort: listenPort,
      }),
    );
  }

  // 5g. First-run bootstrap. Only mints anything when the server is still
  //     unclaimed (no device, no service account), so a normal restart is a
  //     no-op. Deliberately AFTER `listen` because the pairing offer has to
  //     advertise a reachable endpoint.
  const bootstrapEndpoints = resolveAdvertisedEndpoints({
    port: listenPort,
    bindHost,
    configuredOrigins: [
      ...(process.env['GENERATORAI_ADVERTISED_URLS']?.split(',') ?? []),
      ...(process.env['GENERATORAI_ADVERTISED_URL'] ? [process.env['GENERATORAI_ADVERTISED_URL']] : []),
    ],
    networkInterfaces: networkInterfaces(),
  });
  const advertisedEndpoint = bootstrapEndpoints[0]?.origin ?? `http://127.0.0.1:${listenPort}`;
  try {
    await ensureBootstrapPairing({
      security: container.security,
      logger: container.logger,
      dataDir: dirname(resolve(config.dbPath)),
      endpoint: advertisedEndpoint,
      endpoints: bootstrapEndpoints.map((endpoint, priority) => ({
        origin: endpoint.origin,
        reachability: endpoint.reachability,
        priority,
      })),
      serverName: process.env['GENERATORAI_SERVER_NAME'] ?? `GeneratorAI (${hostname()})`,
    });
  } catch (err) {
    // A bootstrap failure must not take the server down — an operator can
    // still pair using `GENERATORAI_API_KEY` or the CLI.
    container.logger.warn('[Auth] Bootstrap pairing could not be prepared', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 6. SEC-09 — Graceful shutdown handlers
  //
  // Sequence on SIGTERM/SIGINT:
  //   1. Set a "shuttingDown" flag (idempotent — repeated signals are ignored).
  //   2. Stop accepting new HTTP requests (server.close()).
  //   3. Request-timeout SSE connections via server's `closeAllConnections`
  //      so the HTTP server can finish waiting for in-flight handlers.
  //      (Previously called `streamManager.shutdown()` — removed in CLN-12.)
  //   4. Wait for server.close callback (in-flight non-SSE requests finish).
  //   5. Shutdown services in reverse order (EventBus queue flush, DB close,
  //      Copilot CLI stop, sandbox teardown).
  //   6. Log a structured summary (`[Server] shutdown complete`) with per-phase
  //      timings so ops can tell whether the drain was the bottleneck.
  //   7. If the whole process takes longer than `shutdownTimeoutMs`, force
  //      exit 1 — tune via `GENERATORAI_SHUTDOWN_TIMEOUT_MS`. K8s/systemd
  //      stop-grace-period MUST be >= this value + a safety buffer (~10s)
  //      or the orchestrator will SIGKILL us mid-drain.
  const shutdownTimeoutMs = parseInt(process.env['GENERATORAI_SHUTDOWN_TIMEOUT_MS'] ?? '60000', 10);
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      container.logger.warn(`[Server] ${signal} received again while shutting down — ignoring`);
      return;
    }
    // Module-scoped on purpose: `handleFault` reads it, so that a throw raised
    // while we are tearing down cannot be swallowed and leave the process
    // wedged with its listeners closed and its children still running.
    shuttingDown = true;

    const shutdownStart = Date.now();
    const timings: Record<string, number> = {};
    container.logger.info(`[Server] ${signal} received; graceful shutdown initiated`, {
      timeoutMs: shutdownTimeoutMs,
    });

    // CLN-12 — DurableStreamManager is gone. Force-close all keep-alive
    // connections (including SSE) so server.close() can resolve.
    const drainStart = Date.now();
    if (typeof (server as unknown as { closeAllConnections?: () => void }).closeAllConnections === 'function') {
      (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
    }
    // Tear down the widget-asset listener too.
    try {
      (widgetServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      widgetServer.close();
    } catch {
      // Non-fatal.
    }
    timings.sseDrainMs = Date.now() - drainStart;

    // Force exit on total shutdown timeout — this is the hard ceiling.
    const forceExit = setTimeout(() => {
      container.logger.warn('[Server] shutdown forced — timeout', {
        timeoutMs: shutdownTimeoutMs,
        elapsedMs: Date.now() - shutdownStart,
        timings,
      });
      process.exit(1);
    }, shutdownTimeoutMs);
    // Don't keep the event loop alive just for this timer.
    forceExit.unref?.();

    server.close(async () => {
      timings.httpCloseMs = Date.now() - shutdownStart;

      try {
        const servicesStart = Date.now();
        await container.shutdown();
        timings.servicesShutdownMs = Date.now() - servicesStart;

        // P0-14 — the last thing before exit. Services get first refusal on
        // stopping their own children gracefully; anything still standing
        // after that would become an orphan the moment we exit, so it is
        // terminated here rather than left for the next boot's reaper.
        //
        // The liveness record is dropped only AFTER the kill returns. Dropping
        // it first would mean that a shutdown interrupted mid-kill (SIGKILL,
        // the shutdown timeout below, the desktop's taskkill window) leaves the
        // survivors with nothing for the next boot to match them against —
        // disabling recovery in exactly the case it exists for.
        const reapStart = Date.now();
        const killed = await killOwnDescendants(container.logger);
        stopChildReaperHeartbeat();
        timings.descendantReapMs = Date.now() - reapStart;
        timings.descendantsKilled = killed;

        timings.totalMs = Date.now() - shutdownStart;

        // W20 — remove the server.lock so the next boot knows this one
        // exited cleanly (no stale-lock warning on restart).
        try { unlinkSync(lockPath); } catch { /* non-fatal */ }

        // W21 — stop the wedge detector worker so it doesn't fire after
        // we've already begun shutting down.
        try { wedgeDetector?.stop(); } catch { /* non-fatal */ }
        try { loopTurnProber?.stop(); } catch { /* non-fatal */ }

        // SEC-09 — single structured summary for ops dashboards.
        container.logger.info('[Server] shutdown complete', { signal, timings });
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        timings.totalMs = Date.now() - shutdownStart;
        // W20 — best-effort remove lock even on failed shutdown.
        try { unlinkSync(lockPath); } catch { /* non-fatal */ }
        container.logger.error('[Server] shutdown failed', { signal, error: msg, timings });
        clearTimeout(forceExit);
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  // The desktop app spawns this process with an IPC channel because Windows
  // has no way to deliver SIGTERM — Node maps `kill('SIGTERM')` there to
  // TerminateProcess, which no handler can observe. Without this the graceful
  // path never ran on the primary distribution's primary platform.
  process.on('message', (msg: unknown) => {
    if (msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'shutdown') {
      void shutdown('ipc');
    }
  });

  // The same channel closes when the desktop process dies without asking —
  // a crash, a force-quit, a SIGKILL. Nothing else tells us: we are reparented
  // and would keep running, holding the database and every agent CLI (and
  // their MCP servers) we spawned. Only a process started with an IPC channel
  // ever sees this event, so a standalone server is unaffected.
  process.on('disconnect', () => { void shutdown('parent-disconnect'); });

  // A fatal fault now unwinds through the same path as a signal, so it closes
  // the DB, flushes the event queues and reaps child processes instead of
  // leaving them behind. `shutdown` is idempotent via its own `shuttingDown`
  // guard, and its force-exit timer is the hard ceiling if unwinding hangs.
  requestShutdown = (reason: string) => { void shutdown(`fatal:${reason}`); };
}

startServer().catch((err: unknown) => {
  // A StartupSecurityError means the process refused to expose an unsafe API.
  // Print it on its own so it is not mistaken for a generic crash.
  if (err instanceof StartupSecurityError) {
    console.error('\n╔══════════════════════════════════════════════════════════════╗');
    console.error('║  GeneratorAI refused to start for security reasons           ║');
    console.error('╚══════════════════════════════════════════════════════════════╝\n');
    console.error(err.message);
    console.error('');
    process.exit(2);
  }
  console.error('Fatal: Failed to start server:', err);
  process.exit(1);
});
