// ────────────────────────────────────────────────────────────────
// Run dialog (board WorkflowRunDialog; L-05 ModalWithAside + WF-11;
// 04-screen-map §2.6). Everything a run start takes, then ONE invocation
// (P04): typed variables, per-stage overrides (skip, model, `key=value`
// variables — always shown, D-15), run options (model, effort, permission
// mode — W-65 —, name, a wall-clock budget), the codebases the run mounts
// (defaulting to the workflow's `lifecycle.codebaseAliases`, never "all")
// with branch and worktree/in-place, uploads, and a live plan preview.
// Start sends one `InvocationRequest` with a per-open idempotency key, so a
// double click is one run; a refusal is shown here with the server's issues.
//
// Query-aware (invoke, plan, project codebases, branches), so it lives in
// blocks/: the definition page and the builder both open it.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  REASONING_EFFORTS,
  RUN_PERMISSION_MODES,
  type InvocationPlan,
  type InvocationResult,
  type RunPermissionMode,
  type VariableDefinition,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import { blankStageOverrides, codebaseDrafts, newIdempotencyKey, type CodebaseDraft, type StageOverrideDraft } from '@generatorai/client-core';
import type { ProjectCodebase } from '@generatorai/shared';
import { useInvokeWorkflow, usePlanWorkflowInvocation } from '@/hooks/workflowQueries.js';
import { useCodebaseBranches, useProjectCodebases } from '@/hooks/projectQueries.js';
import { useMediaQuery } from '@/hooks/useMediaQuery.js';
import { ModelPicker } from '@/blocks/model-picker/index.js';
import { Dropzone } from '@/ui/patterns/Dropzone/Dropzone.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Dialog, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { ModalWithAside } from '@/ui/templates/ModalWithAside/ModalWithAside.js';
import { describeWorkflowApiError, formatWorkflowApiIssue } from '../apiErrors.js';
import { KeyChip } from '../chips/WorkflowChips.js';
import { RunPlanPreview } from './RunPlanPreview.js';
import {
  BRANCH_VARIABLE_NAMES,
  EMPTY_RUN_OPTIONS,
  GIT_VARIABLE_NAMES,
  PERMISSION_LABELS,
  buildInvocationRequest,
  convertVariables,
  parseStageVariables,
  seedValues,
  validateVariables,
  withStageVariables,
  type InvocationTarget,
  type RunOptions,
  type StartError,
} from './runDialogModel.js';

interface UploadSet {
  prompts: File[];
  skills: File[];
  agents: File[];
}
type UploadCategory = keyof UploadSet;
const UPLOAD_CATEGORIES: ReadonlyArray<{ value: UploadCategory; label: string; hint: string }> = [
  { value: 'prompts', label: 'Prompts', hint: 'Prompt templates (.md, .txt, .prompt)' },
  { value: 'skills', label: 'Skills', hint: 'Skill definitions (.md)' },
  { value: 'agents', label: 'Agents', hint: 'Agent definitions (.md, .json)' },
];
const UPLOAD_ACCEPT = '.md,.txt,.json,.yaml,.yml,.toml,.ts,.js,.py,.sh,.prompt';
const EMPTY_UPLOADS: UploadSet = { prompts: [], skills: [], agents: [] };
const PLAN_DEBOUNCE_MS = 400;

const effortLabel = (e: string) => e[0]!.toUpperCase() + e.slice(1);

export interface RunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowName: string;
  /** Beside the title: the WF-01 VersionChip of what runs. */
  badge?: ReactNode;
  variables: readonly VariableDefinition[];
  /** Stages (key and display name); overrides match stages by key. */
  stages: ReadonlyArray<{ key: string; name: string }>;
  /** The workflow's project: its codebases are the ones a run can mount. */
  projectId?: string | null;
  /** Pre-selects the codebases (`codebaseAliases`) and their checkout mode (`useWorktree`). */
  lifecycle?: Pick<WorkflowGraph['workflow']['lifecycle'], 'codebaseAliases' | 'useWorktree'>;
  /** What the primary button starts (and the plan previews); undefined while nothing is saved to plan. */
  target: InvocationTarget | undefined;
  /** Primary button label: "Run" for a published workflow, "Test run" for a draft. */
  submitLabel: string;
  /** A second start ("Test run" of the working graph beside "Run" of the published version). */
  testRunTarget?: InvocationTarget;
  /**
   * Runs on Start, before the invocation, and returns the target to start
   * (the builder saves or publishes here first); null stops the start.
   */
  prepareTarget?: (target: InvocationTarget | undefined) => Promise<InvocationTarget | null>;
  /** Footer hint ("Published workflows run v7. Test run is for drafts and unpublished edits."). */
  hint?: ReactNode;
  /** The run started; callers navigate to `result.runId`. */
  onStarted: (result: InvocationResult) => void;
}

export function RunDialog(props: RunDialogProps) {
  const { open, onOpenChange, workflowName, badge } = props;
  const [starting, setStarting] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!starting) onOpenChange(next);
      }}
      size="xl"
      title={`Run ${workflowName}`}
      badge={badge}
      data-testid="run-dialog"
    >
      {/* Mounted per open: every open starts from the definition's defaults and a fresh idempotency key. */}
      {open ? <RunDialogBody {...props} starting={starting} setStarting={setStarting} /> : null}
    </Dialog>
  );
}

function RunDialogBody({
  onOpenChange,
  variables,
  stages,
  projectId,
  lifecycle,
  target,
  submitLabel,
  testRunTarget,
  prepareTarget,
  hint,
  onStarted,
  starting,
  setStarting,
}: RunDialogProps & { starting: boolean; setStarting: (v: boolean) => void }) {
  const invoke = useInvokeWorkflow({ inline: true });
  const planMutation = usePlanWorkflowInvocation();
  const stacked = !useMediaQuery('(min-width: 1000px)');

  // ── Codebases: the project's, pre-selected from the lifecycle ──
  const { data: projectCodebases } = useProjectCodebases(projectId ?? undefined);
  const aliasesKey = (projectCodebases ?? []).map((c) => c.alias).join('\n');
  const [codebases, setCodebases] = useState<CodebaseDraft[]>([]);
  // The project's codebases load after the dialog mounts.
  useEffect(() => {
    setCodebases(codebaseDrafts(aliasesKey ? aliasesKey.split('\n') : [], lifecycle));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only when the codebase set changes
  }, [aliasesKey]);
  const firstMounted = useMemo((): ProjectCodebase | undefined => {
    const alias = codebases.find((c) => c.selected)?.alias;
    return alias ? projectCodebases?.find((c) => c.alias === alias) : undefined;
  }, [codebases, projectCodebases]);

  // Git variables are filled from the first mounted codebase, not typed.
  const displayVariables = useMemo(
    () => variables.filter((v) => !(firstMounted && (GIT_VARIABLE_NAMES.has(v.name) || BRANCH_VARIABLE_NAMES.has(v.name)))),
    [variables, firstMounted],
  );
  const [values, setValues] = useState<Record<string, unknown>>(() => seedValues(variables));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [stageOverrides, setStageOverrides] = useState<StageOverrideDraft[]>(() => blankStageOverrides(stages));
  const [stageVarText, setStageVarText] = useState<Record<string, string>>({});
  const [openStageVars, setOpenStageVars] = useState<Set<string>>(new Set());
  const [options, setOptions] = useState<RunOptions>(EMPTY_RUN_OPTIONS);
  const [uploadCategory, setUploadCategory] = useState<UploadCategory>('prompts');
  const [uploads, setUploads] = useState<UploadSet>(EMPTY_UPLOADS);
  const uploadCount = uploads.prompts.length + uploads.skills.length + uploads.agents.length;

  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<StartError | null>(null);

  const stageVarErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, text] of Object.entries(stageVarText)) {
      const parsed = parseStageVariables(text);
      if (parsed.error) out[key] = parsed.error;
    }
    return out;
  }, [stageVarText]);

  const buildRequest = useCallback(
    (t: InvocationTarget) =>
      buildInvocationRequest({
        target: t,
        variables: convertVariables(variables, values, firstMounted, codebases),
        stageOverrides: withStageVariables(stageOverrides, stageVarText),
        codebases,
        options,
      }),
    [variables, values, firstMounted, codebases, stageOverrides, stageVarText, options],
  );

  // ── Plan preview: re-planned (debounced) whenever the request changes ──
  const requestKey = useMemo(() => (target ? JSON.stringify(buildRequest(target)) : ''), [target, buildRequest]);
  // The server refuses a plan for a form that would not start (a required variable left empty): wait for it.
  const formIncomplete = useMemo(
    () => Object.keys(validateVariables(displayVariables, values)).length > 0 || Object.keys(stageVarErrors).length > 0,
    [displayVariables, values, stageVarErrors],
  );
  const [plan, setPlan] = useState<{ plan: InvocationPlan; key: string } | null>(null);
  const [planError, setPlanError] = useState<StartError | null>(null);
  const latestKey = useRef(requestKey);
  latestKey.current = requestKey;
  const planAsync = planMutation.mutateAsync;
  useEffect(() => {
    if (!target || !requestKey || formIncomplete) return;
    const timer = setTimeout(() => {
      planAsync(JSON.parse(requestKey) as ReturnType<typeof buildRequest>)
        .then((result) => {
          if (latestKey.current !== requestKey) return;
          setPlan({ plan: result, key: requestKey });
          setPlanError(null);
        })
        .catch((err: unknown) => {
          if (latestKey.current !== requestKey) return;
          setPlanError(describeWorkflowApiError(err, 'The plan could not be made'));
        });
    }, PLAN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [target, requestKey, planAsync, formIncomplete]);

  const updateValue = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      const rest = { ...prev };
      delete rest[name];
      return rest;
    });
  };
  const patchStage = (index: number, patch: Partial<StageOverrideDraft>) =>
    setStageOverrides((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  const patchCodebase = (alias: string, patch: Partial<CodebaseDraft>) =>
    setCodebases((prev) => prev.map((c) => (c.alias === alias ? { ...c, ...patch } : c)));
  const setOption = <K extends keyof RunOptions>(key: K, value: RunOptions[K]) => setOptions((prev) => ({ ...prev, [key]: value }));

  const start = async (which: InvocationTarget | undefined) => {
    if (starting) return;
    const fieldErrors = validateVariables(displayVariables, values);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0 || Object.keys(stageVarErrors).length > 0) return;
    setError(null);
    setStarting(true);
    try {
      const t = prepareTarget ? await prepareTarget(which) : which;
      if (!t) return;
      const result = await invoke.mutateAsync({
        request: buildRequest(t),
        idempotencyKey,
        ...(uploadCount > 0 ? { files: uploads } : {}),
      });
      // The next start from this dialog is a new run.
      setIdempotencyKey(newIdempotencyKey());
      onStarted(result);
    } catch (err) {
      setError(describeWorkflowApiError(err, 'The run did not start'));
    } finally {
      setStarting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void start(target);
    }
  };

  const skipped = stageOverrides.filter((o) => o.skip).length;
  const planIsCurrent = !!plan && plan.key === requestKey;

  const main = (
    <>
      <Section title="Variables" meta={variables.length > 0 ? `${displayVariables.length} typed` : undefined}>
        {displayVariables.length === 0 ? (
          <p className="text-small text-fg-3">No input variables are needed.</p>
        ) : (
          <div className={stacked ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-3 gap-3'}>
            {displayVariables.map((v) => (
              <VariableField
                key={v.name}
                wide={!stacked && (v.type === 'text' || v.type === 'list' || v.type === 'json')}
                variable={v}
                value={values[v.name]}
                error={errors[v.name]}
                onChange={(next) => updateValue(v.name, next)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Stages"
        meta={
          stageOverrides.length === 0
            ? undefined
            : skipped > 0
              ? `${skipped} skipped · model and variable overrides by key, for this run only`
              : 'skip, model and variable overrides by key, for this run only'
        }
      >
        {stageOverrides.length === 0 ? (
          <p className="text-small text-fg-3">This workflow has no stages yet.</p>
        ) : (
          <div className="flex flex-col" role="list" aria-label="Stages">
            {stageOverrides.map((o, index) => {
              const varsOpen = openStageVars.has(o.stageKey);
              const varError = stageVarErrors[o.stageKey];
              const varCount = Object.keys(parseStageVariables(stageVarText[o.stageKey] ?? '').variables).length;
              return (
                <div key={o.stageKey} role="listitem" className="flex flex-col gap-2 border-b border-line-soft py-2 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <Switch checked={o.skip} onCheckedChange={(skip) => patchStage(index, { skip })} aria-label={`Skip ${o.stageName}`} />
                    <span className={o.skip ? 'min-w-0 flex-1 truncate text-ui text-fg-3 line-through' : 'min-w-0 flex-1 truncate text-ui text-fg'}>
                      {o.stageName} <KeyChip stageKey={o.stageKey} />
                    </span>
                    <div className="flex w-52 shrink-0 items-center gap-1">
                      <ModelPicker
                        variant="field"
                        value={o.model ?? ''}
                        onChange={(model) => patchStage(index, { model })}
                        placeholder="Stage default"
                        ariaLabel={`${o.stageName} model`}
                        disabled={o.skip}
                      />
                      {o.model ? (
                        <IconButton icon="x" size="sm" label={`Use the stage's own model for ${o.stageName}`} onClick={() => patchStage(index, { model: '' })} />
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={varCount > 0 ? 'variable' : 'plus'}
                      disabled={o.skip}
                      aria-expanded={varsOpen}
                      aria-label={`${o.stageName} variable overrides`}
                      className="w-32 shrink-0 justify-start"
                      onClick={() =>
                        setOpenStageVars((prev) => {
                          const next = new Set(prev);
                          if (next.has(o.stageKey)) next.delete(o.stageKey);
                          else next.add(o.stageKey);
                          return next;
                        })
                      }
                    >
                      {varCount > 0 ? `${varCount} variable${varCount === 1 ? '' : 's'}` : 'Override'}
                    </Button>
                  </div>
                  {varsOpen && !o.skip ? (
                    <Field label={`${o.stageName} variables`} error={varError} hint="key=value, one per line">
                      <Textarea
                        value={stageVarText[o.stageKey] ?? ''}
                        onChange={(e) => setStageVarText((prev) => ({ ...prev, [o.stageKey]: e.target.value }))}
                        rows={3}
                        invalid={!!varError}
                        placeholder="max_major_bumps=2"
                        textareaClassName="font-mono"
                      />
                    </Field>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Run options">
        <div className={stacked ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-3 gap-3'}>
          <Field label="Model">
            <div className="flex items-center gap-1">
              <ModelPicker variant="field" value={options.model} onChange={(m) => setOption('model', m)} placeholder="Workflow default" ariaLabel="Run model" />
              {options.model ? <IconButton icon="x" size="sm" label="Use the workflow's model" onClick={() => setOption('model', '')} /> : null}
            </div>
          </Field>
          <Field label="Effort">
            <Select
              value={options.effort}
              onValueChange={(v) => setOption('effort', v ?? '')}
              items={[{ value: '', label: 'Default' }, ...REASONING_EFFORTS.map((e) => ({ value: e, label: effortLabel(e) }))]}
            />
          </Field>
          <Field
            label="Permission mode"
            hint={planIsCurrent && plan ? `Effective: ${PERMISSION_LABELS[plan.plan.permissionMode]}` : undefined}
          >
            <Select
              value={options.permissionMode}
              onValueChange={(v) => setOption('permissionMode', (v ?? '') as RunPermissionMode | '')}
              items={[
                { value: '', label: 'Deployment default' },
                ...RUN_PERMISSION_MODES.map((m) => ({ value: m, label: PERMISSION_LABELS[m] })),
              ]}
            />
          </Field>
          <Field label="Run name">
            <Input value={options.runName} onChange={(e) => setOption('runName', e.target.value)} placeholder="Generated when empty" />
          </Field>
          <Field label="Stop after" error={options.stopAfterMinutes.trim() && !(Number(options.stopAfterMinutes) > 0) ? 'Minutes above 0' : undefined}>
            <Input
              type="number"
              min={1}
              max={1440}
              value={options.stopAfterMinutes}
              onChange={(e) => setOption('stopAfterMinutes', e.target.value)}
              placeholder="No limit"
              trailing={<span className="text-small text-fg-3">min</span>}
            />
          </Field>
        </div>
      </Section>

      {projectId && codebases.length > 0 ? (
        <Section title="Codebases" meta={`${codebases.filter((c) => c.selected).length} of ${codebases.length} mounted`}>
          <div className="flex flex-col" role="list" aria-label="Codebases">
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
        </Section>
      ) : null}

      <Section title="Uploads" meta="skills, agents or prompt files · uploaded before the run starts">
        <div className="flex items-center gap-3">
          <SegmentedControl<UploadCategory>
            value={uploadCategory}
            onValueChange={setUploadCategory}
            label="Upload category"
            size="sm"
            items={UPLOAD_CATEGORIES.map((c) => ({
              value: c.value,
              label: c.label,
              count: uploads[c.value].length > 0 ? uploads[c.value].length : undefined,
            }))}
          />
          <span className="text-small text-fg-3">{UPLOAD_CATEGORIES.find((c) => c.value === uploadCategory)?.hint}</span>
        </div>
        <Dropzone
          accept={UPLOAD_ACCEPT}
          onFiles={(files) => {
            // FileList is live: the picker's reset clears it before a state updater runs. Snapshot first.
            const picked = Array.from(files);
            setUploads((prev) => ({ ...prev, [uploadCategory]: [...prev[uploadCategory], ...picked] }));
          }}
        />
        {uploadCount > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Uploaded files">
            {UPLOAD_CATEGORIES.flatMap((c) =>
              uploads[c.value].map((file, i) => (
                <Chip
                  key={`${c.value}-${file.name}-${i}`}
                  icon="file-text"
                  mono
                  onRemove={() => setUploads((prev) => ({ ...prev, [c.value]: prev[c.value].filter((_, j) => j !== i) }))}
                  removeLabel={`Remove ${file.name}`}
                >
                  {file.name} <span className="text-fg-3">· {c.label.toLowerCase().replace(/s$/, '')}</span>
                </Chip>
              )),
            )}
          </div>
        ) : null}
      </Section>

      {error ? (
        <Callout tone="err" title={`The run did not start: ${error.message}`} role="alert">
          {error.issues.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {error.issues.map((issue, i) => (
                <li key={i}>{formatWorkflowApiIssue(issue)}</li>
              ))}
            </ul>
          ) : null}
        </Callout>
      ) : null}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <ModalWithAside
        asideLabel="Plan preview"
        asideStacked={stacked}
        main={main}
        aside={
          <RunPlanPreview
            plan={plan?.plan ?? null}
            loading={planMutation.isPending}
            error={planError}
            stale={!!plan && !planIsCurrent}
            unavailable={!target ? 'Save the workflow to preview its run.' : formIncomplete ? 'Fill in the required variables to preview the run.' : undefined}
          />
        }
      />
      <DialogFooter hint={hint}>
        <Button onClick={() => onOpenChange(false)} disabled={starting}>
          Cancel
        </Button>
        {testRunTarget ? (
          <Button icon="view" loading={starting} onClick={() => void start(testRunTarget)}>
            Test run
          </Button>
        ) : null}
        <Button variant="primary" icon="play" shortcut={['Ctrl', '↵']} loading={starting} onClick={() => void start(target)}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </div>
  );
}

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5" aria-label={title}>
      <h3 className="flex items-baseline gap-2 text-title text-fg">
        {title}
        {meta ? <span className="text-small font-normal text-fg-3">{meta}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function VariableField({
  variable: v,
  wide,
  value,
  error,
  onChange,
}: {
  variable: VariableDefinition;
  /** Spans two grid columns (text, list, json). */
  wide: boolean;
  value: unknown;
  error: string | undefined;
  onChange: (next: unknown) => void;
}) {
  const typeWord = v.type[0]!.toUpperCase() + v.type.slice(1);
  const label = (
    <span>
      <span className="font-mono">{v.name}</span>
      <span className="font-normal text-fg-3">
        {' '}
        · {typeWord}
        {v.required ? ' · required' : ''}
      </span>
    </span>
  );
  const multiline = v.type === 'text' || v.type === 'list' || v.type === 'json';
  return (
    <Field label={label} hint={v.description ?? (v.label !== v.name ? v.label : undefined)} error={error} className={wide ? 'col-span-2' : undefined}>
      {v.type === 'boolean' ? (
        <Switch checked={Boolean(value)} onCheckedChange={(next) => onChange(next)} label={Boolean(value) ? 'true' : 'false'} />
      ) : v.type === 'choice' ? (
        <Select
          value={String(value ?? '') || null}
          onValueChange={(next) => onChange(next ?? '')}
          placeholder="Select…"
          invalid={!!error}
          items={(v.options ?? []).map((opt) => ({ value: opt, label: opt }))}
        />
      ) : multiline ? (
        <Textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          invalid={!!error}
          placeholder={v.type === 'list' ? 'One item per line' : v.type === 'json' ? 'A JSON value' : v.label}
          textareaClassName={v.type === 'json' ? 'font-mono' : undefined}
        />
      ) : (
        <Input
          type={v.type === 'number' ? 'number' : 'text'}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          invalid={!!error}
          placeholder={v.label}
        />
      )}
    </Field>
  );
}

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
    <div role="listitem" className="flex items-center gap-3 border-b border-line-soft py-2 last:border-b-0">
      <Checkbox checked={draft.selected} onCheckedChange={(selected) => onChange({ selected })} aria-label={`Mount ${draft.alias}`} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-mono text-ui text-fg">{draft.alias}</span>
        {codebase ? <span className="truncate text-small text-fg-3">{codebase.url ?? codebase.localPath}</span> : null}
      </div>
      <Input
        size="sm"
        leading="branch"
        value={draft.baseRef}
        onChange={(e) => onChange({ baseRef: e.target.value })}
        disabled={!draft.selected}
        placeholder={codebase?.defaultBranch ?? 'default branch'}
        aria-label={`${draft.alias} branch`}
        list={listId}
        className="w-40"
      />
      <datalist id={listId}>
        {(branches ?? []).map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <SegmentedControl<CodebaseDraft['mode']>
        value={draft.mode}
        onValueChange={(mode) => onChange({ mode })}
        label={`${draft.alias} checkout`}
        size="sm"
        items={[
          { value: 'worktree', label: 'Worktree', disabled: !draft.selected },
          { value: 'in_place', label: 'In place', disabled: !draft.selected },
        ]}
      />
    </div>
  );
}
