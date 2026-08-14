// ────────────────────────────────────────────────────────────────
// Server Entry Point — startup, graceful shutdown
// ────────────────────────────────────────────────────────────────

import type { Server } from 'node:http';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { resolve, dirname } from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
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
import { AppConfigSchema } from '@generatorai/shared';
import { StartupSecurityError } from './composition/security.js';
import { ensureBootstrapPairing } from './composition/bootstrapPairing.js';
import { RelayStreamBridge } from './relay/RelayStreamBridge.js';
import { createContainer } from './composition-root.js';
import type { Container } from './composition-root.js';
import { createApp } from './app.js';
import { createWidgetAssetRoutes } from './routes/extensions.js';
import { attachBrowserWebSocket } from './browser-ws.js';
import { attachTerminalWebSocket } from './terminal-ws.js';
import { attachSttWebSocket } from './stt-ws.js';
import { resolveAdvertisedEndpoints } from './network/advertisedEndpoints.js';
import { readExposureMode, resolveBindHost } from './network/exposure.js';
import { readComputerUsePreferences } from './settings/computerUse.js';
import { publishLocalAdminToken, removeLocalAdminToken } from './composition/localAdminToken.js';

// Killing the process on a failed write to an already-exited child is the
// wrong trade. The agent CLIs are optional: when one is absent its harness is
// marked unavailable and the server degrades correctly, but the vendored
// JSON-RPC writers issue their final writes from background tasks we cannot
// attach a handler to, so the resulting rejection reaches the process. Node
// defaults to `--unhandled-rejections=throw`, so that alone was enough to take
// down a server that had otherwise started cleanly.
//
// Registered at module scope on purpose: container initialization is where
// these fire, and a handler installed after `await container.initialize()`
// is installed too late to ever see them.
const DEAD_PIPE_CODES = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END']);

function isDeadPipeError(value: unknown): boolean {
  const code = (value as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === 'string' && DEAD_PIPE_CODES.has(code);
}

process.on('unhandledRejection', (reason) => {
  if (isDeadPipeError(reason)) {
    console.warn('[Server] ignored write to a closed child process stream');
    return;
  }
  throw reason;
});

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

  // Compute the monorepo project root (three levels up from apps/server/src/)
  const __filename_idx = fileURLToPath(import.meta.url);
  const __dirname_idx = dirname(__filename_idx);
  const projectRoot = resolve(__dirname_idx, '..', '..', '..');

  // Ensure directories exist (mkdirSync is safe with { recursive: true })
  for (const dir of [workspacesDir, artifactsDir, extensionsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  // Ensure the parent directory of the DB file exists
  mkdirSync(resolve(dbPath, '..'), { recursive: true });

  const rawConfig = {
    port: parseInt(process.env['PORT'] ?? '3100', 10),
    dbPath,
    workspacesDir,
    artifactsDir,
    templatesDir,
    extensionsDir,
    projectRoot,
    maxConcurrentSessions: parseInt(process.env['MAX_CONCURRENT_SESSIONS'] ?? '10', 10),
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
    copilot: {
      defaultModel: process.env['COPILOT_MODEL'] ?? 'claude-sonnet-4.6',
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
    webhooks: {
      enabled: process.env['WEBHOOKS_ENABLED'] === 'true',
      githubSecret: process.env['GITHUB_WEBHOOK_SECRET'],
      webhookToken: process.env['WEBHOOK_TOKEN'],
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
    otel: {
      enabled: process.env['OTEL_ENABLED'] === 'true',
      ...(process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ? { endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] } : {}),
      ...(process.env['OTEL_SERVICE_NAME'] ? { serviceName: process.env['OTEL_SERVICE_NAME'] } : {}),
      ...(process.env['OTEL_SAMPLE_RATE'] ? { sampleRate: parseFloat(process.env['OTEL_SAMPLE_RATE']) } : {}),
      ...(process.env['OTEL_METRICS_EXPORT_INTERVAL_MS'] ? { metricsExportIntervalMs: parseInt(process.env['OTEL_METRICS_EXPORT_INTERVAL_MS'], 10) } : {}),
    },
    // PRV-01 — harness provider selection. HARNESS_TYPE selects the LLM adapter.
    ...(process.env['HARNESS_TYPE'] ? {
      harness: {
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
      },
    } : {}),
  };

  const config = AppConfigSchema.parse(rawConfig);

  // 2. Create DI container
  const container: Container = await createContainer(config);

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
  const server: Server = app.listen(config.port, bindHost, () => {
    // Only now is this process the one a local CLI should be able to talk to.
    if (container.localAdminToken) {
      publishLocalAdminToken(dirname(resolve(config.dbPath)), container.localAdminToken);
    } else {
      removeLocalAdminToken(dirname(resolve(config.dbPath)));
    }
    container.logger.info(
      `[Server] GeneratorAI server listening on ${bindHost}:${config.port}`,
      {
        port: config.port,
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
  });

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
        localPort: config.port,
      }),
    );
  }

  // 5g. First-run bootstrap. Only mints anything when the server is still
  //     unclaimed (no device, no service account), so a normal restart is a
  //     no-op. Deliberately AFTER `listen` because the pairing offer has to
  //     advertise a reachable endpoint.
  const bootstrapEndpoints = resolveAdvertisedEndpoints({
    port: config.port,
    bindHost,
    configuredOrigins: [
      ...(process.env['GENERATORAI_ADVERTISED_URLS']?.split(',') ?? []),
      ...(process.env['GENERATORAI_ADVERTISED_URL'] ? [process.env['GENERATORAI_ADVERTISED_URL']] : []),
    ],
    networkInterfaces: networkInterfaces(),
  });
  const advertisedEndpoint = bootstrapEndpoints[0]?.origin ?? `http://127.0.0.1:${config.port}`;
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
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      container.logger.warn(`[Server] ${signal} received again while shutting down — ignoring`);
      return;
    }
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
        timings.totalMs = Date.now() - shutdownStart;

        // SEC-09 — single structured summary for ops dashboards.
        container.logger.info('[Server] shutdown complete', { signal, timings });
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        timings.totalMs = Date.now() - shutdownStart;
        container.logger.error('[Server] shutdown failed', { signal, error: msg, timings });
        clearTimeout(forceExit);
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
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
