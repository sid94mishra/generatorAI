// ────────────────────────────────────────────────────────────────
// RunProfile — Reusable run configuration for workflow execution
//
// A RunProfile captures all the inputs, overrides, and settings
// needed for a specific workflow run. It can be saved as a JSON
// file and referenced from CLI (`--profile <path>`) or Web UI.
//
// This is the single source of truth for what can be overridden
// per-run — both CLI and Web must support the same fields.
// ────────────────────────────────────────────────────────────────

import type { WorkflowRunPermissionMode } from './WorkflowRun.js';
import type { BrowserConfig } from './BrowserSession.js';

/**
 * Per-stage overrides that can be applied at run time.
 * These are "bare minimum" — not the core stage config (prompts, hooks, etc.)
 * but operational parameters that vary per-run.
 */
export interface StageRunOverride {
  /** Stage name or index to target. Name is preferred; index is fallback. */
  stageName?: string;
  stageIndex?: number;
  /** Additional variables scoped to this stage only */
  variables?: Record<string, unknown>;
  /** Whether to skip this stage entirely */
  skip?: boolean;
}

/**
 * RunProfile — a saved configuration for running a specific workflow.
 *
 * Users create these as JSON files in `.generatorai/run-profiles/` or
 * anywhere on disk and reference them with `--profile <path>`.
 */
export interface RunProfile {
  /** Schema version for forward compatibility */
  version: 1;
  /** Human-readable name for this profile */
  name: string;
  /** Optional description */
  description?: string;
  /** The workflow definition ID this profile targets */
  workflowDefinitionId: string;
  /** Run name override (if not set, server generates one) */
  runName?: string;
  /** Variable values — must satisfy the workflow's VariableDefinitions */
  variables: Record<string, unknown>;
  /** HITL permission mode override */
  permissionMode?: WorkflowRunPermissionMode;
  /** Session mode override (single, per-stage, auto) */
  sessionMode?: 'single' | 'per-stage' | 'auto';
  /** Project ID to associate with this run */
  projectId?: string;
  /** Selected codebase aliases from the linked project */
  selectedCodebases?: string[];
  /** Per-stage overrides */
  stageOverrides?: StageRunOverride[];
  /** Paths to custom prompt files to upload */
  promptFiles?: string[];
  /** Paths to custom skill files to upload */
  skillFiles?: string[];
  /** Paths to custom agent files to upload */
  agentFiles?: string[];
  /**
   * Integrated Browser configuration override (deep-merged on top of the
   * workflow's `browserConfig`). Use this to enable/disable the browser or
   * flip settings (allowedHosts, dialogPolicy, ...) per run.
   */
  browserConfig?: BrowserConfig;
}
