// ────────────────────────────────────────────────────────────────
// Health Routes — health check and public config
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { DiagLogLevel, diag } from '@opentelemetry/api';
import type { Container } from '../composition-root.js';

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
    try {
      const activeChats = await container.chatEntityRepo.getByStatus('active');
      activeChatCount = activeChats.length;
    } catch {
      // DB issue — already covered by dbOk
    }
    try {
      const activeRuns = await container.workflowRunRepo.getByStatus(['running', 'starting', 'paused']);
      activeRunCount = activeRuns.length;
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
      harness: { type: container.harnessRegistry.primary, healthy: harnessAlive },
      db: dbOk,
      uptime,
      timestamp: new Date().toISOString(),
      // v2 metrics
      activeChats: activeChatCount,
      activeWorkflowRuns: activeRunCount,
      runningChatIds,
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
