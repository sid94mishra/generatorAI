// ────────────────────────────────────────────────────────────────
// Health Routes — health check and public config
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { DiagLogLevel, diag } from '@opentelemetry/api';
import { getConfigCorrections, fallbackReport } from '@generatorai/shared';
import type { Container } from '../composition-root.js';
import { getSlowStatementStats } from '@generatorai/db';

export function createHealthRoutes(container: Container): Router {
  const router = Router();
  const { harness, config, templateRegistry, logger } = container;
  const startTime = Date.now();

  // GET /health — Health check with component status
  router.get('/', async (_req, res) => {
    let harnessAlive = false;
    let dbOk = true; // If we got this far, DB is serving requests

    try {
      harnessAlive = await harness.ping();
    } catch {
      harnessAlive = false;
    }

    // v2: Gather workflow run and chat counts
    let activeChatCount = 0;
    let activeRunCount = 0;
    // COUNT(*) — this used to load and map every active chat row and every
    // active run row just to read `.length`, on an endpoint polled by health
    // checks and the dashboard.
    try {
      activeChatCount = await container.chatEntityRepo.countByStatus('active');
    } catch {
      // DB issue — already covered by dbOk
    }
    try {
      activeRunCount = await container.workflowRunRepo.countByStatus(['running', 'starting', 'paused']);
    } catch {
      // DB issue
    }

    // Chats with an in-flight turn (currently streaming) — in-memory registry,
    // so this reflects the true "running now" set the dashboard needs.
    let runningChatIds: string[] = [];
    try {
      runningChatIds = container.chatManagementService.getStreamingChatIds();
    } catch {
      runningChatIds = [];
    }

    const status = harnessAlive && dbOk ? 'ok' : 'degraded';
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    res.json({
      status,
      copilot: harnessAlive,
      harness: {
        type: container.harnessRegistry.primary,
        healthy: harnessAlive,
        // What the harness is holding: live provider sessions are child
        // processes (~230 MB each on Claude), so this is the number that
        // explains a large RSS on the machine, not `memory` below.
        runtime: harness.runtimeDiagnostics?.() ?? null,
      },
      db: dbOk,
      uptime,
      timestamp: new Date().toISOString(),
      // v2 metrics
      activeChats: activeChatCount,
      activeWorkflowRuns: activeRunCount,
      runningChatIds,
      // §1.Q — this process's own memory footprint, in bytes. Reading it
      // over HTTP is the only cross-platform way for an external load test
      // (or a real ops dashboard) to sample RSS without OS-specific PID
      // introspection (Windows/Linux/macOS all need different tools for
      // that from outside the process). Cheap: `process.memoryUsage()` is
      // a synchronous, allocation-free syscall.
      memory: process.memoryUsage(),
      // Slowest SQL statements since boot when `GENERATORAI_SQL_SLOW_MS` is
      // set; empty otherwise. This is the answer to "why is the event loop
      // stalling" that the RSS number above cannot give.
      slowStatements: getSlowStatementStats(),
      // W18 — "Publish depth in the health endpoint: makes throttling visible
      // instead of mysterious." Each lane reports its cap alongside running,
      // queued and parked counts. `parked` is the load-bearing one: work
      // waiting on a human approval has given its permit back, so a lane
      // showing `parked: 8, running: 0` is idle and healthy, whereas the same
      // number under `running` would mean genuinely saturated.
      admission: container.admissionController?.snapshot() ?? [],
      // W18 — anything the numeric-config loader had to clamp or reject at
      // boot. Empty in a correctly configured process; non-empty means an env
      // var is being ignored or capped, which is otherwise invisible.
      configCorrections: getConfigCorrections(),
      // §11.1 — expensive fallbacks that have actually fired. Empty is the
      // healthy state; an entry means the system is silently paying for a
      // degraded path (HTTP-polled screencast, a TTY-less terminal, dropped
      // broadcasts) while still returning 200s to everyone.
      fallbacks: fallbackReport(),
      // OTel status
      otel: {
        enabled: config.otel.enabled,
        endpoint: config.otel.endpoint,
        serviceName: config.otel.serviceName,
      },
    });
  });

  // GET /loop-turn — W21 event-loop liveness probe.
  //
  // Responds immediately with the current timestamp. Clients (monitoring,
  // WedgeDetector's external-probe mode, integration tests) measure how long
  // the request takes to resolve: a slow response indicates the event loop is
  // under load or wedged. This endpoint is deliberately as cheap as possible
  // (no DB, no I/O) so the response latency reflects only the event loop.
  //
  // Mounted under /api/health/loop-turn; the WedgeDetector uses worker_threads
  // internally and does NOT call this endpoint — it is purely for external
  // observers that cannot use the in-process worker approach.
  router.get('/loop-turn', (_req, res) => {
    const respondedAt = Date.now();
    res.json({ ok: true, respondedAt, uptimeMs: respondedAt - startTime });
  });

  // GET /config — Public (non-sensitive) configuration
  router.get('/config', (_req, res) => {
    res.json({
      port: config.port,
      maxConcurrentSessions: config.maxConcurrentSessions,
      logLevel: config.logLevel,
      templatesCount: templateRegistry.getTemplateCount(),
      harness: {
        type: container.harnessRegistry.primary,
      },
      streaming: {
        heartbeatIntervalMs: config.streaming.heartbeatIntervalMs,
        maxReplayEvents: config.streaming.maxReplayEvents,
      },
      copilot: {
        defaultModel: config.copilot.defaultModel,
        useStdio: config.copilot.useStdio,
        autoRestart: config.copilot.autoRestart,
      },
      sandbox: {
        enabled: config.sandbox.enabled,
        provider: config.sandbox.provider,
        image: config.sandbox.image,
        autoDestroy: config.sandbox.autoDestroy,
      },
    });
  });

  return router;
}
