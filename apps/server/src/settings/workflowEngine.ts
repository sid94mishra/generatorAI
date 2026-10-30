// ────────────────────────────────────────────────────────────────
// Workflow engine settings (P07 WP-7.1, WP-7.2): the operator's flow key
// limits, the workflow summary model, the trigger debounce and the commands
// an administrator allowed in the app (D-174).
//
// Persisted next to the database (`<dataDir>/workflow-engine.json`) and
// applied live: the admission controller takes new limits at once, the
// summary model is read per summary, the debounce per trigger. Every
// concurrency cap the engine and the providers use is here — there is no
// hidden one (O-2: the claude-agent turn cap is `provider:claude-agent`).
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomicRestricted } from '@generatorai/shared/node';
import { MAX_FLOW_LIMIT } from '@generatorai/core';
import { BARE_COMMAND_PATTERN } from '@generatorai/workflow-spec';

const STATE_FILE = 'workflow-engine.json';

/** Automation webhook and cron triggers of one automation within this window start one execution. */
export const DEFAULT_TRIGGER_DEBOUNCE_MS = 2_000;
export const MAX_TRIGGER_DEBOUNCE_MS = 10 * 60_000;

/** A flow key an operator may set: `global`, `check:global`, `provider:<id>`, `model:<id>`. */
export const CONFIGURABLE_FLOW_KEY = /^(global|check:global|provider:[A-Za-z0-9._-]{1,64}|model:[A-Za-z0-9._:/@-]{1,128})$/;

export interface WorkflowEngineSettings {
  /** Operator limits over the defaults (`AdmissionController.defaultFlowLimits`). */
  flowLimits: Record<string, number>;
  /** The model of `llm` summaries; null uses the stage's own model. */
  summaryModel: string | null;
  /** Trigger debounce of automation webhooks and cron (ms; 0 = off). */
  triggerDebounceMs: number;
  /** Commands an administrator allowed in the app, on top of the defaults and `scripts.extraAllowlist` (D-174). */
  allowedCommands: string[];
}

/** How many commands the app may add to the allow-list. */
export const MAX_ALLOWED_COMMANDS = 64;

export const WORKFLOW_ENGINE_DEFAULTS: WorkflowEngineSettings = {
  flowLimits: {},
  summaryModel: null,
  triggerDebounceMs: DEFAULT_TRIGGER_DEBOUNCE_MS,
  allowedCommands: [],
};

/** Keep what is well formed: configurable keys with a limit in 1..MAX_FLOW_LIMIT. */
export function normalizeWorkflowEngineSettings(raw: Partial<WorkflowEngineSettings> | null | undefined): WorkflowEngineSettings {
  const flowLimits: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw?.flowLimits ?? {})) {
    if (!CONFIGURABLE_FLOW_KEY.test(k) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    flowLimits[k] = Math.min(MAX_FLOW_LIMIT, Math.max(1, Math.floor(v)));
  }
  const summaryModel = typeof raw?.summaryModel === 'string' && raw.summaryModel.trim() ? raw.summaryModel.trim() : null;
  const d = raw?.triggerDebounceMs;
  const triggerDebounceMs =
    typeof d === 'number' && Number.isFinite(d) ? Math.min(MAX_TRIGGER_DEBOUNCE_MS, Math.max(0, Math.floor(d))) : DEFAULT_TRIGGER_DEBOUNCE_MS;
  const allowedCommands = [
    ...new Set(
      (Array.isArray(raw?.allowedCommands) ? raw.allowedCommands : [])
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim().toLowerCase())
        .filter((c) => BARE_COMMAND_PATTERN.test(c)),
    ),
  ]
    .sort()
    .slice(0, MAX_ALLOWED_COMMANDS);
  return { flowLimits, summaryModel, triggerDebounceMs, allowedCommands };
}

/** Read the settings; anything unreadable is the defaults. */
export async function readWorkflowEngineSettings(dataDir: string): Promise<WorkflowEngineSettings> {
  try {
    const raw = await fs.readFile(path.join(dataDir, STATE_FILE), 'utf8');
    return normalizeWorkflowEngineSettings(JSON.parse(raw) as Partial<WorkflowEngineSettings>);
  } catch {
    return { ...WORKFLOW_ENGINE_DEFAULTS, flowLimits: {}, allowedCommands: [] };
  }
}

/** Persist the settings (normalized) and return what was written. */
export async function writeWorkflowEngineSettings(dataDir: string, settings: Partial<WorkflowEngineSettings>): Promise<WorkflowEngineSettings> {
  const normalized = normalizeWorkflowEngineSettings(settings);
  await fs.mkdir(dataDir, { recursive: true });
  writeFileAtomicRestricted(path.join(dataDir, STATE_FILE), `${JSON.stringify({ ...normalized, updatedAt: Date.now() }, null, 2)}\n`);
  return normalized;
}

/** The settings the running server holds (read at boot, replaced by the PUT route). */
export class WorkflowEngineSettingsStore {
  private current: WorkflowEngineSettings;

  constructor(
    private readonly dataDir: string,
    initial: WorkflowEngineSettings,
    private readonly onChange: (settings: WorkflowEngineSettings) => void,
  ) {
    this.current = initial;
    onChange(initial);
  }

  static async load(dataDir: string, onChange: (settings: WorkflowEngineSettings) => void): Promise<WorkflowEngineSettingsStore> {
    return new WorkflowEngineSettingsStore(dataDir, await readWorkflowEngineSettings(dataDir), onChange);
  }

  get(): WorkflowEngineSettings {
    return this.current;
  }

  async update(patch: Partial<WorkflowEngineSettings>): Promise<WorkflowEngineSettings> {
    const next = await writeWorkflowEngineSettings(this.dataDir, { ...this.current, ...patch });
    this.current = next;
    this.onChange(next);
    return next;
  }
}
