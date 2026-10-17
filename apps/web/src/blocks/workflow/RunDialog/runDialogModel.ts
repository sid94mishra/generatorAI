// ────────────────────────────────────────────────────────────────
// Run dialog model (P04 invocation; ported from the Overhaul's
// components/workflow/RunDialog.tsx): React-free helpers that turn the
// form's state into ONE InvocationRequest — variable seeding, validation and
// typing, per-stage `key=value` variables, git variables filled from the
// first mounted codebase, run options and the wall-clock budget.
// ────────────────────────────────────────────────────────────────

import type { InvocationRequest, RunPermissionMode, VariableDefinition } from '@generatorai/workflow-spec';
import { activeStageOverrides, selectedCodebases, type CodebaseDraft, type StageOverrideDraft } from '@generatorai/client-core';
import type { WorkflowApiError } from '../apiErrors.js';
import { APPROVAL_MODE_LABELS } from '@generatorai/shared/ui-contract';

export type InvocationTarget = InvocationRequest['target'];

/** Variables filled from the first mounted codebase rather than typed. */
export const GIT_VARIABLE_NAMES = new Set(['git_url', 'repo_url', 'repository_url', 'repository']);
export const BRANCH_VARIABLE_NAMES = new Set(['branch', 'git_branch', 'repo_branch']);

/** The permission modes a start offers; '' omits it (the deployment posture decides). */
export const PERMISSION_LABELS: Record<RunPermissionMode, string> = {
  default: APPROVAL_MODE_LABELS.default.word,
  acceptEdits: APPROVAL_MODE_LABELS.acceptEdits.word,
  plan: APPROVAL_MODE_LABELS.plan.word,
  bypassPermissions: APPROVAL_MODE_LABELS.bypassPermissions.word,
};

/** A refusal as the dialog shows it: the envelope's message and its issues. */
export type StartError = WorkflowApiError;

// ── Variables ─────────────────────────────────────────────────

/** A field's initial form value from its definition (list: one item per line; json: JSON text). */
export function seedValue(v: VariableDefinition): unknown {
  const def = v.defaultValue ?? (v.type === 'boolean' ? false : '');
  if (v.type === 'boolean') return def === true || def === 'true' || def === '1';
  if (v.type === 'list') return Array.isArray(def) ? def.join('\n') : String(def ?? '');
  if (v.type === 'json') return v.defaultValue === undefined ? '' : JSON.stringify(v.defaultValue, null, 2);
  return def;
}

export function seedValues(variables: readonly VariableDefinition[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of variables) out[v.name] = seedValue(v);
  return out;
}

/** Field errors by variable name (required, number, JSON, choice membership). */
export function validateVariables(variables: readonly VariableDefinition[], values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const v of variables) {
    const val = values[v.name];
    if (v.required && (val === undefined || val === null || val === '')) errors[v.name] = `${v.label} is required`;
    if (v.type === 'number' && val !== '' && val !== undefined && Number.isNaN(Number(val))) {
      errors[v.name] = `${v.label} must be a number`;
    }
    if (v.type === 'json' && typeof val === 'string' && val.trim() !== '') {
      try {
        JSON.parse(val);
      } catch {
        errors[v.name] = `${v.label} must be valid JSON`;
      }
    }
    if (v.type === 'choice' && v.options && val !== undefined && val !== '' && !v.options.includes(String(val))) {
      errors[v.name] = `${v.label} must be one of: ${v.options.join(', ')}`;
    }
  }
  return errors;
}

export interface MountedCodebase {
  alias: string;
  url?: string | null;
  localPath?: string | null;
  defaultBranch?: string | null;
}

/** The typed variable values; git variables come from the first mounted codebase. */
export function convertVariables(
  variables: readonly VariableDefinition[],
  values: Record<string, unknown>,
  firstMounted: MountedCodebase | undefined,
  codebases: readonly CodebaseDraft[],
): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  for (const v of variables) {
    if (firstMounted && GIT_VARIABLE_NAMES.has(v.name)) {
      converted[v.name] = firstMounted.url ?? firstMounted.localPath ?? '';
      continue;
    }
    if (firstMounted && BRANCH_VARIABLE_NAMES.has(v.name)) {
      const draft = codebases.find((c) => c.alias === firstMounted.alias);
      converted[v.name] = draft?.baseRef.trim() || firstMounted.defaultBranch || 'main';
      continue;
    }
    let val = values[v.name];
    // A cleared field falls back to its default.
    if ((val === '' || val === undefined || val === null) && v.defaultValue !== undefined) val = v.defaultValue;
    if (v.type === 'number') val = val === '' || val === undefined || val === null ? undefined : Number(val);
    if (v.type === 'boolean') val = val === true || val === 'true' || val === '1';
    if (v.type === 'list' && typeof val === 'string') {
      val = val.trim() === '' ? undefined : val.split('\n').map((x) => x.trim()).filter(Boolean);
    }
    if (v.type === 'json' && typeof val === 'string') {
      try {
        val = val.trim() === '' ? undefined : JSON.parse(val);
      } catch {
        val = undefined; // refused by validateVariables
      }
    }
    converted[v.name] = val;
  }
  return converted;
}

// ── Per-stage variables ───────────────────────────────────────
//
// A stage override's `variables` are free-form (no per-stage declaration to
// build fields from): one `key=value` per line. Values that read as JSON
// scalars (numbers, true/false, null) are sent typed; the rest are strings.

const STAGE_VARIABLE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function coerceStageValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value !== '' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseStageVariables(text: string): { variables: Record<string, unknown>; error: string | null } {
  const variables: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) return { variables, error: `Line ${i + 1}: use key=value.` };
    const key = line.slice(0, eq).trim();
    if (!STAGE_VARIABLE_KEY.test(key)) return { variables, error: `Line ${i + 1}: "${key}" is not a valid variable name.` };
    if (key.startsWith('__')) return { variables, error: `Line ${i + 1}: names starting with __ are reserved.` };
    variables[key] = coerceStageValue(line.slice(eq + 1).trim());
  }
  return { variables, error: null };
}

/** The stage drafts with their `key=value` text parsed in (a stage with an invalid text sends none). */
export function withStageVariables(drafts: readonly StageOverrideDraft[], text: Record<string, string>): StageOverrideDraft[] {
  return drafts.map((o) => {
    const t = text[o.stageKey];
    return t?.trim() ? { ...o, variables: parseStageVariables(t).variables } : { ...o, variables: {} };
  });
}

// ── The request ───────────────────────────────────────────────

export interface RunOptions {
  model: string;
  effort: string;
  permissionMode: RunPermissionMode | '';
  runName: string;
  /** Minutes as typed; '' or ≤ 0 = no limit. */
  stopAfterMinutes: string;
}

export const EMPTY_RUN_OPTIONS: RunOptions = { model: '', effort: '', permissionMode: '', runName: '', stopAfterMinutes: '' };

export function buildInvocationRequest(input: {
  target: InvocationTarget;
  variables: Record<string, unknown>;
  stageOverrides: readonly StageOverrideDraft[];
  codebases: readonly CodebaseDraft[];
  options: RunOptions;
}): InvocationRequest {
  const { target, variables, stageOverrides, codebases, options } = input;
  const overrides: NonNullable<InvocationRequest['overrides']> = {
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort
      ? { reasoningEffort: options.effort as NonNullable<InvocationRequest['overrides']>['reasoningEffort'] }
      : {}),
    ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
  };
  const active = activeStageOverrides(stageOverrides);
  const minutes = Number(options.stopAfterMinutes);
  return {
    target,
    variables,
    ...(active.length > 0 ? { stageOverrides: active } : {}),
    // Only when the project's codebases are known: an explicit list, possibly
    // empty (a run never mounts "all codebases").
    ...(codebases.length > 0 ? { codebases: selectedCodebases(codebases) } : {}),
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    ...(options.runName.trim() ? { name: options.runName.trim() } : {}),
    ...(options.stopAfterMinutes.trim() && minutes > 0 ? { budget: { maxDurationMs: Math.round(minutes * 60_000) } } : {}),
    client: 'web',
  };
}
