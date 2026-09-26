// ────────────────────────────────────────────────────────────────
// RunDialog — everything a run start takes, then ONE invocation (P04).
//
// Variables, per-stage overrides (skip, variables, model; always shown,
// D-15), run options (model, effort, permission mode — W-65 — name and a
// wall-clock budget), the codebases the run mounts (defaulting to the
// workflow's `lifecycle.codebaseAliases`, never "all"), uploads, and a plan
// preview of what the server will do. Start sends one `InvocationRequest`
// through `useInvokeWorkflow` with a per-open idempotency key, so a double
// click is one run; a refusal is shown here with the server's issues.
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Play,
  AlertCircle,
  Upload,
  FileText,
  Trash2,
  FolderGit2,
  ChevronDown,
  ChevronRight,
  Settings2,
  Layers,
  SlidersHorizontal,
  Eye,
} from 'lucide-react';
import {
  REASONING_EFFORTS,
  RUN_PERMISSION_MODES,
  type InvocationIssue,
  type InvocationPlan,
  type InvocationRequest,
  type InvocationResult,
  type RunPermissionMode,
  type VariableDefinition,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import {
  activeStageOverrides,
  blankStageOverrides,
  codebaseDrafts,
  newIdempotencyKey,
  selectedCodebases,
  type CodebaseDraft,
  type StageOverrideDraft,
} from '@generatorai/client-core';
import type { InvocationFiles, ProjectCodebase } from '@generatorai/shared';
import { Select, Modal, Button, Input, Textarea, Badge } from '@/components/ui/index.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';
import { ModelPicker } from '@/components/shared/ModelPicker.js';
import { useInvokeWorkflow, usePlanWorkflowInvocation } from '@/hooks/workflowQueries.js';
import { useCodebaseBranches, useProjectCodebases } from '@/hooks/projectQueries.js';
import { ApiError } from '@/platform/apiFetch.js';
import { cn } from '@/lib/utils.js';

type UploadCategory = 'prompts' | 'skills' | 'agents';

export interface UploadedFileSet {
  prompts: File[];
  skills: File[];
  agents: File[];
}

type InvocationTarget = InvocationRequest['target'];

export interface RunDialogProps {
  open: boolean;
  onClose: () => void;
  variables: VariableDefinition[];
  workflowName: string;
  /** Stages (key and display name); overrides match stages by key. */
  stages: ReadonlyArray<{ key: string; name: string }>;
  /** The workflow's project: its codebases are the ones a run can mount. */
  projectId?: string | null;
  /** Pre-selects the codebases (`codebaseAliases`) and their checkout mode (`useWorktree`). */
  lifecycle?: Pick<WorkflowGraph['workflow']['lifecycle'], 'codebaseAliases' | 'useWorktree'>;
  /** What the run starts, for the plan preview; undefined while there is nothing saved to plan. */
  target: InvocationTarget | undefined;
  /**
   * Runs on Start, before the invocation, and returns the target to start
   * (the builder saves or publishes here first); null stops the start.
   */
  prepareTarget?: () => Promise<InvocationTarget | null>;
  /** Label of the submit button (the builder says "Test run" for a draft). */
  submitLabel?: string;
  /** The run started; callers navigate to `result.runId`. */
  onStarted: (result: InvocationResult) => void;
}

/** Variables filled from the first mounted codebase rather than typed. */
const GIT_VARIABLE_NAMES = new Set(['git_url', 'repo_url', 'repository_url', 'repository']);
const BRANCH_VARIABLE_NAMES = new Set(['branch', 'git_branch', 'repo_branch']);

/** The permission modes a start offers; '' omits it (the deployment posture decides). */
const PERMISSION_LABELS: Record<RunPermissionMode, string> = {
  default: 'Ask',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  bypassPermissions: 'Full auto',
};

const EFFORT_LABEL = (e: string) => e[0]!.toUpperCase() + e.slice(1);

/** A refusal as the dialog shows it: the envelope's message and its issues. */
interface StartError {
  message: string;
  issues: InvocationIssue[];
}

function startError(err: unknown): StartError {
  if (err instanceof ApiError) {
    const issues = (err.details as { issues?: unknown } | undefined)?.issues;
    return { message: err.message, issues: Array.isArray(issues) ? (issues as InvocationIssue[]) : [] };
  }
  return { message: err instanceof Error ? err.message : 'The run did not start', issues: [] };
}

// ── Per-stage variables ──
//
// A stage override's `variables` are free-form (there is no per-stage
// declaration to build fields from), so each stage takes one `key=value`
// per line. Values that read as JSON scalars (numbers, true/false, null)
// are sent typed; everything else is a string.

const STAGE_VARIABLE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function coerceStageValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value !== '' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseStageVariables(text: string): { variables: Record<string, unknown>; error: string | null } {
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

export function RunDialog({
  open,
  onClose,
  variables,
  workflowName,
  stages,
  projectId,
  lifecycle,
  target,
  prepareTarget,
  submitLabel = 'Start Run',
  onStarted,
}: RunDialogProps) {
  const invoke = useInvokeWorkflow({ inline: true });
  const planMutation = usePlanWorkflowInvocation();

  // ── Codebases: the project's, pre-selected from the lifecycle ──
  const { data: projectCodebases } = useProjectCodebases(projectId ?? undefined);
  const aliasesKey = (projectCodebases ?? []).map((c) => c.alias).join('\n');
  const lifecycleKey = `${(lifecycle?.codebaseAliases ?? []).join('\n')}|${String(lifecycle?.useWorktree)}`;
  const seedCodebases = useCallback(
    () => codebaseDrafts(aliasesKey ? aliasesKey.split('\n') : [], lifecycle),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aliasesKey, lifecycleKey],
  );
  const [codebases, setCodebases] = useState<CodebaseDraft[]>(seedCodebases);
  // The project's codebases load after the dialog mounts.
  useEffect(() => setCodebases(seedCodebases()), [seedCodebases]);

  const firstMounted = useMemo((): ProjectCodebase | undefined => {
    const alias = codebases.find((c) => c.selected)?.alias;
    return alias ? projectCodebases?.find((c) => c.alias === alias) : undefined;
  }, [codebases, projectCodebases]);

  // Git variables are filled from the first mounted codebase, not typed.
  const isGitVariable = useCallback(
    (name: string) => !!firstMounted && (GIT_VARIABLE_NAMES.has(name) || BRANCH_VARIABLE_NAMES.has(name)),
    [firstMounted],
  );
  const displayVariables = useMemo(() => variables.filter((v) => !isGitVariable(v.name)), [variables, isGitVariable]);

  // Seed one field from its definition. Shared by the initial state and the
  // re-seed on open so both paths apply defaults identically.
  const seedValue = useCallback((v: VariableDefinition): unknown => {
    const def = v.defaultValue ?? (v.type === 'boolean' ? false : '');
    // Coerce boolean defaults so "false" string doesn't render as checked
    if (v.type === 'boolean') return def === true || def === 'true' || def === '1';
    // A list is edited one item per line; a json value as JSON text.
    if (v.type === 'list') return Array.isArray(def) ? def.join('\n') : String(def ?? '');
    if (v.type === 'json') return v.defaultValue === undefined ? '' : JSON.stringify(v.defaultValue, null, 2);
    return def;
  }, []);

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const v of variables) initial[v.name] = seedValue(v);
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Stages
  const [stageOverrides, setStageOverrides] = useState<StageOverrideDraft[]>(() => blankStageOverrides(stages));
  const [stageVarText, setStageVarText] = useState<Record<string, string>>({});
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  // Run options
  const [showRunOptions, setShowRunOptions] = useState(false);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [permissionMode, setPermissionMode] = useState<RunPermissionMode | ''>('');
  const [runName, setRunName] = useState('');
  const [stopAfterMinutes, setStopAfterMinutes] = useState('');

  // Uploads
  const [uploadCategory, setUploadCategory] = useState<UploadCategory>('prompts');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileSet>({ prompts: [], skills: [], agents: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasUploads = uploadedFiles.prompts.length + uploadedFiles.skills.length + uploadedFiles.agents.length > 0;

  // One key per open: a double click (or a retried request) is one run.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<StartError | null>(null);
  const [plan, setPlan] = useState<{ plan: InvocationPlan; forRequest: string } | null>(null);
  const [planError, setPlanError] = useState<StartError | null>(null);

  // Re-seed every time the dialog opens.
  //
  // The dialog is mounted for the whole page lifetime and toggled with `open`,
  // so its useState initialiser ran while `variables` was still the empty
  // array the builder store starts with — every default (including required
  // ones) came up blank, and choice fields read "Select…". Re-seeding on open
  // also discards a half-filled abandoned run, which is the expected
  // behaviour for a dialog that reopens from scratch.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const fresh: Record<string, unknown> = {};
      for (const v of variables) fresh[v.name] = seedValue(v);
      setValues(fresh);
      setErrors({});
      setStageOverrides(blankStageOverrides(stages));
      setStageVarText({});
      setExpandedStage(null);
      setModel('');
      setEffort('');
      setPermissionMode('');
      setRunName('');
      setStopAfterMinutes('');
      setCodebases(seedCodebases());
      setUploadedFiles({ prompts: [], skills: [], agents: [] });
      setIdempotencyKey(newIdempotencyKey());
      setError(null);
      setPlan(null);
      setPlanError(null);
    }
    wasOpen.current = open;
  }, [open, variables, stages, seedValue, seedCodebases]);

  // ── Stage overrides ──

  const stageVarErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, text] of Object.entries(stageVarText)) {
      const parsed = parseStageVariables(text);
      if (parsed.error) out[key] = parsed.error;
    }
    return out;
  }, [stageVarText]);

  const effectiveStageOverrides = useMemo(
    () =>
      stageOverrides.map((o) => {
        const text = stageVarText[o.stageKey];
        return text?.trim() ? { ...o, variables: parseStageVariables(text).variables } : { ...o, variables: {} };
      }),
    [stageOverrides, stageVarText],
  );
  const activeOverrides = activeStageOverrides(effectiveStageOverrides);
  const skippedCount = stageOverrides.filter((o) => o.skip).length;

  const patchStage = useCallback((index: number, patch: Partial<StageOverrideDraft>) => {
    setStageOverrides((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }, []);

  const patchCodebase = useCallback((alias: string, patch: Partial<CodebaseDraft>) => {
    setCodebases((prev) => prev.map((c) => (c.alias === alias ? { ...c, ...patch } : c)));
  }, []);

  // ── Uploads ──

  const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // FileList is live: resetting the picker clears it before React may run
    // the queued state updater. Snapshot it synchronously first.
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadedFiles((prev) => ({
      ...prev,
      [uploadCategory]: [...prev[uploadCategory], ...files],
    }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadCategory]);

  const removeFile = useCallback((category: UploadCategory, index: number) => {
    setUploadedFiles((prev) => ({
      ...prev,
      [category]: prev[category].filter((_, i) => i !== index),
    }));
  }, []);

  // ── Variables ──

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    for (const v of displayVariables) {
      const val = values[v.name];
      if (v.required) {
        if (val === undefined || val === null || val === '') {
          newErrors[v.name] = `${v.label} is required`;
        }
      }
      if (v.type === 'number' && val !== '' && val !== undefined) {
        const num = Number(val);
        if (isNaN(num)) {
          newErrors[v.name] = `${v.label} must be a number`;
        }
      }
      if (v.type === 'json' && typeof val === 'string' && val.trim() !== '') {
        try {
          JSON.parse(val);
        } catch {
          newErrors[v.name] = `${v.label} must be valid JSON`;
        }
      }
      // Bug 7: Validate choice variables against allowed options
      if (v.type === 'choice' && v.options && val !== undefined && val !== '') {
        if (!v.options.includes(String(val))) {
          newErrors[v.name] = `${v.label} must be one of: ${v.options.join(', ')}`;
        }
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [displayVariables, values]);

  /** The typed variable values, git variables filled from the first mounted codebase. */
  const convertedVariables = useCallback((): Record<string, unknown> => {
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

      // Bug 8: Re-apply default value when user clears the field
      if ((val === '' || val === undefined || val === null) && v.defaultValue !== undefined) {
        val = v.defaultValue;
      }

      if (v.type === 'number') {
        // Bug 5: Convert empty/undefined to undefined, otherwise to a proper number
        if (val === '' || val === undefined || val === null) {
          val = undefined;
        } else {
          val = Number(val);
        }
      }
      if (v.type === 'boolean') {
        // Bug 6: Explicit true/false check instead of Boolean() which makes "false" → true
        val = val === true || val === 'true' || val === '1';
      }
      if (v.type === 'list' && typeof val === 'string') {
        val = val.trim() === '' ? undefined : val.split('\n').map((x) => x.trim()).filter(Boolean);
      }
      if (v.type === 'json' && typeof val === 'string') {
        try {
          val = val.trim() === '' ? undefined : JSON.parse(val);
        } catch {
          val = undefined; // refused by validate()
        }
      }
      converted[v.name] = val;
    }
    return converted;
  }, [variables, values, firstMounted, codebases]);

  const updateValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      const { [name]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // ── The request ──

  const buildRequest = useCallback(
    (t: InvocationTarget): InvocationRequest => {
      const overrides: NonNullable<InvocationRequest['overrides']> = {
        ...(model ? { model } : {}),
        ...(effort ? { reasoningEffort: effort as NonNullable<InvocationRequest['overrides']>['reasoningEffort'] } : {}),
        ...(permissionMode ? { permissionMode } : {}),
      };
      const minutes = Number(stopAfterMinutes);
      return {
        target: t,
        variables: convertedVariables(),
        ...(activeOverrides.length > 0 ? { stageOverrides: activeOverrides } : {}),
        // Only when the project's codebases are known: an explicit list,
        // possibly empty (a run never mounts "all codebases").
        ...(codebases.length > 0 ? { codebases: selectedCodebases(codebases) } : {}),
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        ...(runName.trim() ? { name: runName.trim() } : {}),
        ...(stopAfterMinutes.trim() && minutes > 0 ? { budget: { maxDurationMs: Math.round(minutes * 60_000) } } : {}),
        client: 'web',
      };
    },
    [model, effort, permissionMode, stopAfterMinutes, convertedVariables, activeOverrides, codebases, runName],
  );

  // What the preview would plan now; a preview of another form is stale.
  const currentRequestKey = useMemo(
    () => (target ? JSON.stringify(buildRequest(target)) : ''),
    [target, buildRequest],
  );
  const planIsCurrent = !!plan && plan.forRequest === currentRequestKey;

  const handlePreview = useCallback(async () => {
    if (!target) return;
    setPlanError(null);
    const request = buildRequest(target);
    try {
      const result = await planMutation.mutateAsync(request);
      setPlan({ plan: result, forRequest: JSON.stringify(request) });
    } catch (err) {
      setPlan(null);
      setPlanError(startError(err));
    }
  }, [target, buildRequest, planMutation]);

  const handleStart = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (starting) return;
      if (!validate() || Object.keys(stageVarErrors).length > 0) return;
      setError(null);
      setStarting(true);
      try {
        const t = prepareTarget ? await prepareTarget() : target;
        if (!t) return;
        const files: InvocationFiles | undefined = hasUploads ? uploadedFiles : undefined;
        const result = await invoke.mutateAsync({
          request: buildRequest(t),
          idempotencyKey,
          ...(files ? { files } : {}),
        });
        // The next start from this dialog is a new run.
        setIdempotencyKey(newIdempotencyKey());
        onStarted(result);
      } catch (err) {
        setError(startError(err));
      } finally {
        setStarting(false);
      }
    },
    [starting, validate, stageVarErrors, prepareTarget, target, hasUploads, uploadedFiles, invoke, buildRequest, idempotencyKey, onStarted],
  );

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start Workflow Run"
      description={workflowName}
      size="lg"
      dismissible={!starting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={starting}>Cancel</Button>
          <Button
            variant="secondary"
            leftIcon={<Eye className="h-4 w-4" />}
            loading={planMutation.isPending}
            disabled={!target || starting}
            title={target ? 'Show what this run will do' : 'Save the workflow to preview its run'}
            onClick={() => void handlePreview()}
          >
            Preview
          </Button>
          <Button
            variant="primary"
            leftIcon={<Play className="h-4 w-4" />}
            loading={starting}
            onClick={() => void handleStart()}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void handleStart(e)} className="space-y-4">
        {displayVariables.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Start a new run of "{workflowName}"? No input variables are required.
          </p>
        )}

        {displayVariables.map((v) => (
          <div key={v.name}>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {v.label}
              {v.required && <span className="text-danger ml-0.5">*</span>}
            </label>
            {v.description && (
              <p className="mb-1.5 text-xs text-muted-foreground">
                {v.description}
              </p>
            )}

            {/* String input */}
            {v.type === 'string' && (
              <Input
                type="text"
                value={String(values[v.name] ?? '')}
                onChange={(e) => updateValue(v.name, e.target.value)}
                invalid={!!errors[v.name]}
                placeholder={v.label}
              />
            )}

            {/* Number input */}
            {v.type === 'number' && (
              <Input
                type="number"
                value={String(values[v.name] ?? '')}
                onChange={(e) => updateValue(v.name, e.target.value)}
                invalid={!!errors[v.name]}
                placeholder={v.label}
              />
            )}

            {/* Boolean checkbox */}
            {v.type === 'boolean' && (
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={Boolean(values[v.name])}
                  onCheckedChange={(next) => updateValue(v.name, next === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-foreground">
                  {v.label}
                </span>
              </label>
            )}

            {/* Choice dropdown */}
            {v.type === 'choice' && (
              <Select
                value={String(values[v.name] ?? '')}
                onChange={(val) => updateValue(v.name, val)}
                options={(v.options ?? []).map((opt) => ({ value: opt, label: opt }))}
                placeholder="Select…"
              />
            )}

            {/* List (one item per line) and JSON */}
            {(v.type === 'list' || v.type === 'json') && (
              <Textarea
                value={String(values[v.name] ?? '')}
                onChange={(e) => updateValue(v.name, e.target.value)}
                rows={4}
                invalid={!!errors[v.name]}
                className={v.type === 'json' ? 'font-mono text-xs' : undefined}
                placeholder={v.type === 'list' ? 'One item per line' : 'A JSON value'}
              />
            )}

            {/* Text (multiline) */}
            {v.type === 'text' && (
              <Textarea
                value={String(values[v.name] ?? '')}
                onChange={(e) => updateValue(v.name, e.target.value)}
                rows={4}
                invalid={!!errors[v.name]}
                placeholder={v.label}
              />
            )}

            {/* Error message */}
            {errors[v.name] && (
              <div className="mt-1 flex items-center gap-1 text-xs text-danger">
                <AlertCircle className="h-3 w-3" />
                {errors[v.name]}
              </div>
            )}
          </div>
        ))}

        {/* Stages — always shown, whatever the variables (D-15) */}
        <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Settings2 className="h-4 w-4 text-primary" />
            Stages
            {skippedCount > 0 && (
              <Badge tone="warning" size="sm">{skippedCount} skipped</Badge>
            )}
            {activeOverrides.length > skippedCount && (
              <Badge tone="info" size="sm">{activeOverrides.length} changed</Badge>
            )}
          </div>
          {stageOverrides.length === 0 ? (
            <p className="text-xs text-muted-foreground">This workflow has no stages yet.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Untick a stage to skip it for this run, or give it extra variables or another model.
            </p>
          )}
          {stageOverrides.map((override, index) => {
            const expanded = expandedStage === override.stageKey;
            const varError = stageVarErrors[override.stageKey];
            return (
              <div
                key={override.stageKey}
                className={cn(
                  'rounded-md border text-sm',
                  override.skip ? 'border-warning/40 bg-warning-muted' : 'border-border bg-background',
                )}
              >
                <div className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    checked={!override.skip}
                    aria-label={`Run stage ${index + 1}: ${override.stageName}`}
                    onCheckedChange={() => patchStage(index, { skip: !override.skip })}
                    className="h-4 w-4"
                    title={override.skip ? 'Enable this stage' : 'Skip this stage'}
                  />
                  <span className={cn(
                    'flex-1 truncate text-sm',
                    override.skip ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}>
                    {index + 1}. {override.stageName}
                  </span>
                  {override.skip && (
                    <span className="text-[10px] font-medium text-warning">SKIP</span>
                  )}
                  {varError && <AlertCircle className="h-3.5 w-3.5 text-danger" aria-label="Check variables" />}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={override.skip}
                    aria-expanded={expanded}
                    onClick={() => setExpandedStage(expanded ? null : override.stageKey)}
                    className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground"
                  >
                    {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Options
                  </Button>
                </div>
                {expanded && !override.skip && (
                  <div className="space-y-3 border-t border-border px-3 py-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-foreground">Model</label>
                      <ModelPicker
                        value={override.model ?? ''}
                        onChange={(m) => patchStage(index, { model: m })}
                        allowEmpty
                        emptyLabel="Stage default"
                        emptyDescription="The stage's own model, or the run's"
                        ariaLabel={`${override.stageName} model`}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-foreground">Variables</label>
                      <Textarea
                        value={stageVarText[override.stageKey] ?? ''}
                        onChange={(e) => setStageVarText((prev) => ({ ...prev, [override.stageKey]: e.target.value }))}
                        rows={3}
                        invalid={!!varError}
                        placeholder={'key=value, one per line'}
                        aria-label={`${override.stageName} variables`}
                        className="font-mono text-xs"
                      />
                      {varError && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-danger">
                          <AlertCircle className="h-3 w-3" />
                          {varError}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Codebases — the project's, pre-selected from the workflow's lifecycle */}
        {codebases.length > 0 && projectId && (
          <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FolderGit2 className="h-4 w-4 text-primary" />
              Codebases
              <Badge tone="neutral" size="sm">{codebases.filter((c) => c.selected).length} mounted</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Each ticked codebase is mounted for this run
              {codebases[0]?.mode === 'in_place' ? ' in place.' : ' as a worktree cut from the branch you give (its default branch when empty).'}
            </p>
            {codebases.map((draft) => (
              <CodebaseRow
                key={draft.alias}
                projectId={projectId}
                draft={draft}
                codebase={projectCodebases?.find((c) => c.alias === draft.alias)}
                onChange={(patch) => patchCodebase(draft.alias, patch)}
              />
            ))}
          </div>
        )}

        {/* Run options */}
        <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
          <Button
            type="button"
            onClick={() => setShowRunOptions(!showRunOptions)}
            variant="ghost"
            size="sm"
            aria-expanded={showRunOptions}
            className="h-auto flex w-full items-center gap-2 bg-transparent p-0 text-sm font-medium text-foreground hover:bg-transparent"
          >
            {showRunOptions ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            Run options
          </Button>
          {showRunOptions && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">Model</label>
                <ModelPicker
                  value={model}
                  onChange={setModel}
                  allowEmpty
                  emptyLabel="Workflow default"
                  emptyDescription="Each stage's own model, else the workflow's"
                  ariaLabel="Run model"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">Reasoning effort</label>
                  <Select
                    aria-label="Run reasoning effort"
                    value={effort}
                    onChange={setEffort}
                    options={[
                      { value: '', label: 'Workflow default' },
                      ...REASONING_EFFORTS.map((e) => ({ value: e, label: EFFORT_LABEL(e) })),
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">Permissions</label>
                  <Select
                    aria-label="Run permission mode"
                    value={permissionMode}
                    onChange={(v) => setPermissionMode(v as RunPermissionMode | '')}
                    options={[
                      { value: '', label: 'Deployment default' },
                      ...RUN_PERMISSION_MODES.map((m) => ({ value: m, label: PERMISSION_LABELS[m] })),
                    ]}
                  />
                  {planIsCurrent && plan && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Effective: {PERMISSION_LABELS[plan.plan.permissionMode]}
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">Run name</label>
                  <Input
                    type="text"
                    value={runName}
                    onChange={(e) => setRunName(e.target.value)}
                    placeholder="Generated when empty"
                    aria-label="Run name"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">Stop after (minutes)</label>
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={stopAfterMinutes}
                    onChange={(e) => setStopAfterMinutes(e.target.value)}
                    placeholder="No limit"
                    aria-label="Stop after minutes"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <UploadSection
          uploadCategory={uploadCategory}
          setUploadCategory={setUploadCategory}
          uploadedFiles={uploadedFiles}
          fileInputRef={fileInputRef}
          handleFilesSelected={handleFilesSelected}
          removeFile={removeFile}
        />

        {planError && <ErrorPanel title="Preview failed" error={planError} />}
        {plan && <PlanPreview plan={plan.plan} stale={!planIsCurrent} />}

        {error && <ErrorPanel title="The run did not start" error={error} />}
      </form>
    </Modal>
  );
}

// ── Codebase row: mount checkbox + branch/ref ──

function CodebaseRow({
  projectId,
  draft,
  codebase,
  onChange,
}: {
  projectId: string;
  draft: CodebaseDraft;
  codebase: ProjectCodebase | undefined;
  onChange: (patch: Partial<CodebaseDraft>) => void;
}) {
  // Branches are listed only for a codebase that is mounted.
  const { data: branches } = useCodebaseBranches(projectId, draft.selected ? codebase?.id : undefined);
  const listId = `run-branches-${draft.alias}`;
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
      <Checkbox
        checked={draft.selected}
        aria-label={`Mount ${draft.alias}`}
        onCheckedChange={(next) => onChange({ selected: next === true })}
        className="h-4 w-4"
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{draft.alias}</div>
        {codebase && (
          <div className="truncate text-[11px] text-muted-foreground">{codebase.url ?? codebase.localPath}</div>
        )}
      </div>
      <Input
        type="text"
        value={draft.baseRef}
        onChange={(e) => onChange({ baseRef: e.target.value })}
        disabled={!draft.selected}
        placeholder={codebase?.defaultBranch ?? 'default branch'}
        aria-label={`${draft.alias} branch`}
        list={listId}
        className="h-8 w-40 text-xs"
      />
      <datalist id={listId}>
        {(branches ?? []).map((b) => <option key={b} value={b} />)}
      </datalist>
    </div>
  );
}

// ── Plan preview ──

function PlanPreview({ plan, stale }: { plan: InvocationPlan; stale: boolean }) {
  const layers = useMemo(() => {
    const byLayer = new Map<number, InvocationPlan['stages']>();
    for (const s of plan.stages) byLayer.set(s.layer, [...(byLayer.get(s.layer) ?? []), s]);
    return [...byLayer.entries()].sort(([a], [b]) => a - b);
  }, [plan.stages]);

  return (
    <div className={cn('rounded-lg border border-border bg-subtle/50 p-3 space-y-3 text-xs', stale && 'opacity-60')}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Layers className="h-4 w-4 text-primary" />
        Plan
        <Badge tone="neutral" size="sm">{PERMISSION_LABELS[plan.permissionMode]}</Badge>
        {stale && <span className="text-[11px] font-normal text-muted-foreground">The form changed — preview again</span>}
      </div>

      <div className="space-y-1">
        {layers.map(([layer, stages]) => (
          <div key={layer} className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-muted-foreground">Layer {layer + 1}</span>
            {stages.map((s) => (
              <span
                key={s.key}
                className={cn(
                  'rounded px-1.5 py-0.5',
                  s.skipped ? 'bg-warning-muted text-muted-foreground line-through' : 'bg-background text-foreground',
                )}
                title={[
                  s.skipped ? `Skipped (${s.skipReason === 'guard_false' ? 'guard is false' : 'override'})` : null,
                  s.model ? `Model: ${s.model}` : null,
                  s.approvalRequired ? 'Waits for approval' : null,
                ].filter(Boolean).join(' · ') || undefined}
              >
                {s.name}
                {s.model && !s.skipped && <span className="ml-1 text-muted-foreground">({s.model})</span>}
                {s.approvalRequired && !s.skipped && <span className="ml-1 text-warning">⏸</span>}
              </span>
            ))}
          </div>
        ))}
      </div>

      <PlanRow label="Codebases">
        {plan.codebases.length === 0
          ? 'None'
          : plan.codebases.map((c) => `${c.alias}${c.baseRef ? ` @ ${c.baseRef}` : ''}${c.mode === 'in_place' ? ' (in place)' : ''}`).join(', ')}
      </PlanRow>
      {plan.prepare.length > 0 && <PlanRow label="Prepare">{plan.prepare.join(' → ')}</PlanRow>}
      {plan.preprocessing.length > 0 && <PlanRow label="Before">{plan.preprocessing.join(', ')}</PlanRow>}
      <PlanRow label="After">{plan.postProcessing.length > 0 ? plan.postProcessing.join(', ') : 'Nothing'}</PlanRow>
      {plan.risks.map((r) => (
        <p key={r.code} className="flex items-start gap-1 rounded-md bg-warning/10 px-2 py-1 text-warning">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{r.message}</span>
        </p>
      ))}

      {plan.warnings.length > 0 && (
        <ul className="space-y-0.5 text-warning">
          {plan.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-foreground">{children}</span>
    </div>
  );
}

function ErrorPanel({ title, error }: { title: string; error: StartError }) {
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger-muted p-3 text-xs text-danger space-y-1">
      <div className="flex items-center gap-1.5 font-medium">
        <AlertCircle className="h-3.5 w-3.5" />
        {title}: {error.message}
      </div>
      {error.issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5">
          {error.issues.map((issue, i) => (
            <li key={i}>
              {issue.path.length > 0 && <span className="font-mono">{issue.path.join('.')}: </span>}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Upload Section Component ──
const CATEGORY_LABELS: Record<UploadCategory, string> = {
  prompts: 'Prompt templates (.md, .txt, .prompt)',
  skills: 'Skill definitions (.md)',
  agents: 'Agent definitions (.md, .json)',
};

function UploadSection({
  uploadCategory,
  setUploadCategory,
  uploadedFiles,
  fileInputRef,
  handleFilesSelected,
  removeFile,
}: {
  uploadCategory: UploadCategory;
  setUploadCategory: (c: UploadCategory) => void;
  uploadedFiles: UploadedFileSet;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFilesSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  removeFile: (category: UploadCategory, index: number) => void;
}) {
  const totalFiles = uploadedFiles.prompts.length + uploadedFiles.skills.length + uploadedFiles.agents.length;

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Upload className="h-4 w-4 text-done" />
        Custom Content
        {totalFiles > 0 && (
          <Badge tone="done" size="sm">
            {totalFiles}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Optionally upload prompts, skills, or agent definitions for this run.
      </p>

      {/* Category tabs */}
      <div className="flex gap-1">
        {(['prompts', 'skills', 'agents'] as UploadCategory[]).map((cat) => (
          <Button
            key={cat}
            type="button"
            onClick={() => setUploadCategory(cat)}
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
              uploadCategory === cat
                ? 'bg-primary text-primary-foreground hover:bg-primary'
                : 'bg-subtle text-muted-foreground hover:bg-subtle',
            )}
          >
            {cat}
            {uploadedFiles[cat].length > 0 && ` (${uploadedFiles[cat].length})`}
          </Button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {CATEGORY_LABELS[uploadCategory]}
      </p>

      {/* File picker */}
      <div>
        <Input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.txt,.json,.yaml,.yml,.toml,.ts,.js,.py,.sh,.prompt"
          onChange={handleFilesSelected}
          className="hidden"
        />
        <Button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          variant="ghost"
          size="sm"
          className="h-auto flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-subtle"
        >
          <Upload className="h-3.5 w-3.5" />
          Add {uploadCategory} files
        </Button>
      </div>

      {/* File list for selected category */}
      {uploadedFiles[uploadCategory].length > 0 && (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {uploadedFiles[uploadCategory].map((file, i) => (
            <li key={`${file.name}-${i}`} className="flex items-center gap-2 rounded px-2 py-1 text-xs bg-subtle">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 truncate text-foreground">{file.name}</span>
              <Button type="button" onClick={() => removeFile(uploadCategory, i)} variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} className="h-auto w-auto p-0 text-muted-foreground hover:bg-transparent hover:text-danger">
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
