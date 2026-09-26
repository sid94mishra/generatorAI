// ────────────────────────────────────────────────────────────────
// Settings routes read by authoring surfaces and the settings page.
//
//   GET /settings/script-allowlist — the commands a `check` stage (and any
//   script hook) may run: the defaults plus the operator's extras
//   (`scripts.extraAllowlist`). The builder's command picker reads it; the
//   server validates checks against the same list (P05 §1.2).
//
//   GET /settings/workflow-engine — the engine settings (flow key limits,
//   the workflow summary model, the trigger debounce), their defaults and
//   every flow key live: the admission controller's keys (`global`,
//   `provider:<id>`, `model:<id>`, `check:global`), the `worktree:<mountId>`
//   leases of running maps and each live run's `run:<id>` (`maxParallel`).
//   PUT /settings/workflow-engine (admin:settings) — applied at once
//   (P07 WP-7.2).
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_COMMAND_ALLOWLIST } from '@generatorai/workflow-spec';
import { MAX_FLOW_LIMIT } from '@generatorai/core';
import type { Container } from '../composition-root.js';
import { CONFIGURABLE_FLOW_KEY, DEFAULT_TRIGGER_DEBOUNCE_MS, MAX_TRIGGER_DEBOUNCE_MS } from '../settings/workflowEngine.js';

type FlowKind = 'global' | 'provider' | 'model' | 'check' | 'worktree' | 'run';

interface FlowRow {
  flowKey: string;
  kind: FlowKind;
  running: number;
  queued: number;
  limit: number | null;
  configurable: boolean;
  detail?: string;
}

function kindOf(flowKey: string): FlowKind {
  if (flowKey === 'global') return 'global';
  if (flowKey === 'check:global') return 'check';
  const prefix = flowKey.slice(0, flowKey.indexOf(':'));
  return prefix === 'provider' || prefix === 'model' || prefix === 'worktree' || prefix === 'run' ? prefix : 'global';
}

const WorkflowEngineSettingsBody = z
  .object({
    flowLimits: z
      .record(z.number().int().min(1).max(MAX_FLOW_LIMIT))
      .optional()
      .refine((r) => !r || Object.keys(r).every((k) => CONFIGURABLE_FLOW_KEY.test(k)), {
        message: 'Flow keys are global, check:global, provider:<id> or model:<id>',
      })
      .describe('The operator limits over the defaults (the whole set: a key left out goes back to its default)'),
    summaryModel: z.string().max(200).nullable().optional().describe('The model of llm summaries; null uses the stage model'),
    triggerDebounceMs: z.number().int().min(0).max(MAX_TRIGGER_DEBOUNCE_MS).optional().describe('Automation webhook and cron trigger debounce'),
  })
  .strict();

export function createSettingsRoutes(container: Container): Router {
  const router = Router();

  router.get('/script-allowlist', (_req, res) => {
    const commands = container.scriptRunner.getAllowlist();
    const defaults = new Set(DEFAULT_COMMAND_ALLOWLIST);
    res.json({
      commands,
      defaults: [...DEFAULT_COMMAND_ALLOWLIST].sort(),
      extras: commands.filter((c) => !defaults.has(c)),
    });
  });

  const engineView = () => {
    const admission = container.admissionController;
    const configured = container.workflowEngineSettings.get();
    const flows: FlowRow[] = admission.flowSnapshot().map((f) => ({
      flowKey: f.flowKey,
      kind: kindOf(f.flowKey),
      running: f.running,
      queued: f.queued,
      limit: f.limit ?? null,
      configurable: true,
    }));
    for (const l of container.engine.leases.snapshot()) {
      flows.push({
        flowKey: l.key,
        kind: 'worktree',
        running: l.holders.length,
        queued: l.waiting,
        limit: null,
        configurable: false,
        detail: l.holders.map((h) => h.mode).join(', ') || 'free',
      });
    }
    for (const r of container.engine.runFlows()) {
      flows.push({ ...r, kind: 'run', configurable: false, detail: 'maxParallel of the run' });
    }
    return {
      settings: configured,
      defaults: { flowLimits: admission.defaultFlowLimits(), triggerDebounceMs: DEFAULT_TRIGGER_DEBOUNCE_MS },
      flows,
    };
  };

  router.get('/workflow-engine', (_req, res) => {
    res.json(engineView());
  });

  router.put('/workflow-engine', async (req, res, next) => {
    const parsed = WorkflowEngineSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    try {
      const { flowLimits, summaryModel, triggerDebounceMs } = parsed.data;
      await container.workflowEngineSettings.update({
        ...(flowLimits !== undefined ? { flowLimits } : {}),
        ...(summaryModel !== undefined ? { summaryModel } : {}),
        ...(triggerDebounceMs !== undefined ? { triggerDebounceMs } : {}),
      });
      res.json(engineView());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
