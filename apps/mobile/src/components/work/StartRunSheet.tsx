// ────────────────────────────────────────────────────────────────
// StartRunSheet — start a workflow run from the phone.
//
// One field per declared input (see `variableForm.ts` for the rules), an
// optional project, then ONE invocation (`workflows.invoke`, target
// `definition`) → open the run. The server creates, prepares and starts the
// run in that call, whatever the workflow's lifecycle.
//
// A collapsed "Advanced" section carries the same options as web's run
// dialog: run name, model, effort and permission mode; the project's
// codebases to mount (checkbox + branch each, pre-selected from the
// workflow's `lifecycle.codebaseAliases`); per-stage skip, variables and
// model; and custom prompt/skill/agent files. Files are staged FIRST
// (`POST /workflow-invocations/uploads`) and their ids go into the
// invocation, so the run starts with them.
//
// Each opening carries one idempotency key, so a double tap or a network
// retry replays the run instead of starting a second one. A draft
// definition has no published version, so it can only start a TEST run
// (`testRun: true`): the button says "Test run".
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ChevronDown, ChevronLeft, ChevronRight, Cpu, FileUp, ShieldCheck, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activeStageOverrides,
  blankStageOverrides,
  codebaseDrafts,
  queryKeys,
  selectedCodebases,
  type CodebaseDraft,
  type CodebaseSummary,
  type StageOverrideDraft,
} from '@generatorai/client-core';
import type { InvocationRequest, WorkflowGraph } from '@generatorai/workflow-spec';

import { useApi } from '../../api/useApi';
import { useAdminApi } from '../../api/useAdminApi';
import { useIdempotencyKey } from '../../api/useIdempotencyKey';
import { findModel, reasoningEfforts, useModelGroups, useModels } from '../../api/useModels';
import { stageRunUploads, type RunUpload, type StagedUpload } from '../../api/stageRunUploads';
import { useAuth } from '../../auth/AuthProvider';
import { Sheet, SheetRow, SheetSection } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { IconButton } from '../ui/Button';
import { Touchable } from '../ui/Touchable';
import { useTheme } from '../../theme/ThemeProvider';
import { pickAttachments, readAllAttachmentBytes } from '../chat/composer/attachmentPickers';
import type { ComposerAttachment } from '../chat/composer/types';
import { PickerRow } from '../chat/NewChatSheet';
import { PermissionModeOptions } from '../runs/PermissionModeSheet';
import { RUN_PERMISSION_MODE_LABEL, type RunPermissionMode } from '../runs/permissionMode';
import { parseStageVariables } from './stageOverrideForm';
import { Field, Switch } from '../ui/Form';
import { haptics } from '../ui/haptics';
import {
  buildVariables,
  initialDraft,
  parseVariables,
  type Draft,
  type VariableDefinition,
} from './variableForm';

export interface StartRunWorkflow {
  id: string;
  name: string;
  projectId?: string | null;
  variables?: unknown;
  /** A draft definition: only a test run of the working graph can start. */
  draft: boolean;
  /** Stages in order (by key), for the Advanced per-stage overrides. */
  stages?: ReadonlyArray<{ key: string; name: string }>;
  /** Which codebases a run mounts by default, and how. */
  lifecycle?: Pick<WorkflowGraph['workflow']['lifecycle'], 'codebaseAliases' | 'useWorktree'>;
}

type RunOverrides = NonNullable<InvocationRequest['overrides']>;
type Effort = NonNullable<RunOverrides['reasoningEffort']>;
type Harness = NonNullable<RunOverrides['harnessType']>;
// Mirrors `REASONING_EFFORTS` / `HARNESS_PROVIDER_IDS` (workflow-spec); typed
// against them, kept local so the bundle does not pull the spec's schemas.
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const HARNESSES: readonly Harness[] = ['copilot', 'claude-agent', 'codex', 'opencode', 'acp'];
const isHarness = (v: unknown): v is Harness => (HARNESSES as readonly unknown[]).includes(v);

type UploadCategory = 'prompts' | 'skills' | 'agents';
const UPLOAD_CATEGORIES: readonly UploadCategory[] = ['prompts', 'skills', 'agents'];
const UPLOAD_LABEL: Record<UploadCategory, string> = { prompts: 'Prompts', skills: 'Skills', agents: 'Agents' };
const UPLOAD_HINT: Record<UploadCategory, string> = {
  prompts: 'Prompt templates (.md, .txt, .prompt)',
  skills: 'Skill definitions (.md)',
  agents: 'Agent definitions (.md, .json)',
};
type Uploads = Record<UploadCategory, ComposerAttachment[]>;
const NO_UPLOADS: Uploads = { prompts: [], skills: [], agents: [] };

/** The sheet's pages: the form, and the two pickers it opens in place. */
type Page = { kind: 'main' } | { kind: 'model'; stageKey: string | null } | { kind: 'permission' };
const MAIN: Page = { kind: 'main' };

export function StartRunSheet({
  visible,
  onClose,
  workflow,
}: {
  visible: boolean;
  onClose: () => void;
  workflow: StartRunWorkflow;
}): React.ReactElement {
  const api = useApi();
  const admin = useAdminApi();
  const { fetch } = useAuth();
  const queryClient = useQueryClient();
  const idempotencyKey = useIdempotencyKey();

  const defs = useMemo(() => parseVariables(workflow.variables), [workflow.variables]);
  const [page, setPage] = useState<Page>(MAIN);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(defs));
  const [showErrors, setShowErrors] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(workflow.projectId ?? null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const stages = workflow.stages;
  const [overrides, setOverrides] = useState<StageOverrideDraft[]>(() => blankStageOverrides(stages ?? []));
  /** Raw key=value text per stage key; parsed on submit. */
  const [stageVarText, setStageVarText] = useState<Record<string, string>>({});
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [uploadCategory, setUploadCategory] = useState<UploadCategory>('prompts');
  const [uploads, setUploads] = useState<Uploads>(NO_UPLOADS);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [runName, setRunName] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<Effort | null>(null);
  /** null = the server's default (the deployment posture). */
  const [permissionMode, setPermissionMode] = useState<RunPermissionMode | null>(null);
  const [codebases, setCodebases] = useState<CodebaseDraft[]>([]);
  /** Files already staged for the current selection, reused by a retry so its body matches. */
  const staged = useRef<StagedUpload[] | null>(null);
  const opened = useRef(false);
  const { colors } = useTheme();

  // Re-seed each time the sheet opens, so a cancelled draft does not leak
  // into the next run.
  useEffect(() => {
    if (visible && !opened.current) {
      setPage(MAIN);
      setDraft(initialDraft(defs));
      setShowErrors(false);
      setServerError(null);
      setProjectId(workflow.projectId ?? null);
      setAdvanced(false);
      setOverrides(blankStageOverrides(stages ?? []));
      setStageVarText({});
      setExpandedStage(null);
      setUploads(NO_UPLOADS);
      setUploadNotice(null);
      setRunName('');
      setModel(null);
      setEffort(null);
      setPermissionMode(null);
      staged.current = null;
      idempotencyKey.rotate();
    }
    opened.current = visible;
  }, [visible, defs, workflow.projectId, stages, idempotencyKey]);

  // A changed file selection has to be staged again.
  useEffect(() => {
    staged.current = null;
  }, [uploads]);

  const projects = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => api.projects.list(),
    enabled: visible && !workflow.projectId,
    staleTime: 60_000,
  });

  const projectCodebases = useQuery({
    queryKey: queryKeys.codebases(projectId ?? ''),
    queryFn: () => api.projects.codebases(projectId ?? ''),
    enabled: visible && projectId !== null,
    staleTime: 60_000,
  });
  const codebaseData = projectId ? projectCodebases.data : undefined;
  const codebaseList: CodebaseSummary[] = codebaseData ?? [];

  // One draft per project codebase, pre-selected from the lifecycle. Seeded
  // on open and whenever the project (or its codebase list) changes.
  useEffect(() => {
    if (!visible) return;
    setCodebases(codebaseDrafts((codebaseData ?? []).map((c) => c.alias), workflow.lifecycle));
  }, [visible, codebaseData, workflow.lifecycle]);

  // Only once the run options are open: listing models can probe provider CLIs.
  const models = useModels({ enabled: visible && advanced });
  const groups = useModelGroups(models.data);
  const selectedModel = findModel(models.data, model);
  // Efforts the chosen model accepts; every level when the stages' own models apply.
  const effortOptions: readonly Effort[] = model
    ? reasoningEfforts(selectedModel).filter((e): e is Effort => (EFFORTS as readonly string[]).includes(e))
    : EFFORTS;

  const result = buildVariables(defs, draft);
  const { draft: testRun } = workflow;

  // Per-stage variables: parse every stage's text; the first error blocks.
  const stageVarErrors: Record<string, string> = {};
  const effectiveOverrides = overrides.map((o) => {
    const text = stageVarText[o.stageKey];
    if (!text?.trim()) return { ...o, variables: {} };
    const parsed = parseStageVariables(text);
    if (parsed.error) stageVarErrors[o.stageKey] = parsed.error;
    return { ...o, variables: parsed.variables };
  });
  const stageErrorCount = Object.keys(stageVarErrors).length;
  const skippedCount = overrides.filter((o) => o.skip).length;
  const stageModelCount = overrides.filter((o) => o.model?.trim()).length;
  const uploadCount = uploads.prompts.length + uploads.skills.length + uploads.agents.length;
  const mountedCount = codebases.filter((c) => c.selected).length;
  const hasStages = (stages?.length ?? 0) > 0;

  // Archived projects are not somewhere a new run should land.
  const pickableProjects = (projects.data ?? []).filter(
    (p) => (p as { status?: string }).status !== 'archived',
  );

  const stageFiles = async (): Promise<StagedUpload[]> => {
    if (staged.current) return staged.current;
    const files: RunUpload[] = [];
    for (const category of UPLOAD_CATEGORIES) {
      for (const file of await readAllAttachmentBytes(uploads[category])) files.push({ category, ...file });
    }
    staged.current = await stageRunUploads(fetch, files);
    return staged.current;
  };

  const start = useMutation({
    mutationFn: async (): Promise<string> => {
      // Files first: the run starts with them, not after them.
      const files = await stageFiles();
      const harnessType = selectedModel?.provider;
      const runOverrides: RunOverrides = {
        ...(model ? { model } : {}),
        ...(model && isHarness(harnessType) ? { harnessType } : {}),
        ...(effort ? { reasoningEffort: effort } : {}),
        ...(permissionMode ? { permissionMode } : {}),
      };
      const stageOverrides = activeStageOverrides(effectiveOverrides);
      const request: InvocationRequest = {
        target: { kind: 'definition', workflowDefinitionId: workflow.id, ...(testRun ? { testRun: true } : {}) },
        variables: result.variables,
        ...(projectId ? { projectId } : {}),
        // Sent whenever the project's codebases are known, so unticking every
        // box mounts none (omitting it would mount the lifecycle's defaults).
        ...(projectId && codebaseData ? { codebases: selectedCodebases(codebases) } : {}),
        ...(stageOverrides.length > 0 ? { stageOverrides } : {}),
        ...(Object.keys(runOverrides).length > 0 ? { overrides: runOverrides } : {}),
        ...(files.length > 0 ? { uploads: files.map((f) => ({ uploadId: f.uploadId, category: f.category })) } : {}),
        ...(runName.trim() ? { name: runName.trim() } : {}),
        client: 'mobile',
      };
      const invocation = await admin.workflows.invoke(request, { idempotencyKey: idempotencyKey.get() });
      return invocation.runId;
    },
    onSuccess: (runId) => {
      idempotencyKey.settle();
      haptics.success();
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs() });
      onClose();
      router.push(`/runs/${runId}`);
    },
    onError: (err) => {
      idempotencyKey.settle(err);
      haptics.error();
      setServerError(err instanceof Error ? err.message : String(err));
    },
  });

  const submit = (): void => {
    setServerError(null);
    if (!result.valid || stageErrorCount > 0) {
      setShowErrors(true);
      if (stageErrorCount > 0) setAdvanced(true);
      haptics.warn();
      return;
    }
    start.mutate();
  };

  const set = (name: string, value: string | boolean): void =>
    setDraft((prev) => ({ ...prev, [name]: value }));

  const patchStage = (key: string, patch: Partial<StageOverrideDraft>): void =>
    setOverrides((prev) => prev.map((o) => (o.stageKey === key ? { ...o, ...patch } : o)));

  const patchCodebase = (alias: string, patch: Partial<CodebaseDraft>): void =>
    setCodebases((prev) => prev.map((c) => (c.alias === alias ? { ...c, ...patch } : c)));

  const chooseModel = (stageKey: string | null, id: string | null): void => {
    if (stageKey) {
      patchStage(stageKey, { model: id ?? '' });
    } else {
      setModel(id);
      // An effort the new model does not accept would be refused.
      const next = id ? reasoningEfforts(findModel(models.data, id)) : EFFORTS;
      if (effort && !next.includes(effort)) setEffort(null);
    }
    setPage(MAIN);
  };

  const pickUploads = async (): Promise<void> => {
    setUploadNotice(null);
    const outcome = await pickAttachments('file');
    if (outcome.status === 'picked') {
      setUploads((prev) => ({ ...prev, [uploadCategory]: [...prev[uploadCategory], ...outcome.items].slice(0, 20) }));
    } else if (outcome.status !== 'cancelled') {
      setUploadNotice(outcome.reason);
    }
  };

  const modelName = (id: string | null | undefined): string | null =>
    id ? (findModel(models.data, id)?.name ?? id) : null;

  const advancedSummary = [
    runName.trim() ? 'named' : null,
    model ? modelName(model) : null,
    effort ? `${effort} effort` : null,
    permissionMode ? RUN_PERMISSION_MODE_LABEL[permissionMode] : null,
    mountedCount > 0 ? `${mountedCount} codebase${mountedCount === 1 ? '' : 's'}` : null,
    skippedCount > 0 ? `${skippedCount} skipped` : null,
    stageModelCount > 0 ? 'stage models' : null,
    Object.values(stageVarText).some((t) => t.trim()) ? 'stage variables' : null,
    uploadCount > 0 ? `${uploadCount} file${uploadCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const title =
    page.kind === 'model'
      ? page.stageKey
        ? `Model · ${overrides.find((o) => o.stageKey === page.stageKey)?.stageName ?? page.stageKey}`
        : 'Model'
      : page.kind === 'permission'
        ? 'Permissions'
        : `${testRun ? 'Test run' : 'Run'} ${workflow.name}`;

  const footer =
    page.kind === 'main' ? (
      // A refusal from the server is pinned WITH the button. It used to be the
      // last line of the scrolling form, so a long form (or an open keyboard)
      // hid it and the button simply appeared to do nothing.
      <View className="gap-2">
        {serverError ? (
          <Text accessibilityLiveRegion="assertive" numberOfLines={4} className="text-sm leading-snug text-danger">
            {serverError}
          </Text>
        ) : null}
        {testRun ? (
          <Text className="text-sm text-muted-foreground">
            This workflow is a draft: the run tests its current graph. Publish it on desktop or web for regular runs.
          </Text>
        ) : null}
        <Button
          label={testRun ? 'Start test run' : 'Start run'}
          size="lg"
          full
          haptic="commit"
          loading={start.isPending}
          disabled={start.isPending}
          onPress={submit}
        />
      </View>
    ) : undefined;

  const currentStageModel =
    page.kind === 'model' && page.stageKey
      ? overrides.find((o) => o.stageKey === page.stageKey)?.model || null
      : model;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      detents={[0.92]}
      footer={footer}
      leading={
        page.kind === 'main' ? undefined : (
          <IconButton
            accessibilityLabel="Back"
            icon={<ChevronLeft size={22} color={colors.foreground} />}
            onPress={() => setPage(MAIN)}
          />
        )
      }
    >
      {page.kind === 'model' ? (
        <View className="pb-6">
          <SheetRow
            title={page.stageKey ? 'Stage default' : 'Workflow default'}
            subtitle={page.stageKey ? "The stage's own model, or the run's." : "Each stage's own model."}
            selected={!currentStageModel}
            onPress={() => chooseModel(page.stageKey, null)}
          />
          {groups.map((group) => (
            <View key={group.provider}>
              <SheetSection title={group.label} />
              {group.models.map((entry) => (
                <SheetRow
                  key={entry.id}
                  title={entry.name}
                  subtitle={entry.description ?? null}
                  selected={entry.id === currentStageModel}
                  onPress={() => chooseModel(page.stageKey, entry.id)}
                />
              ))}
            </View>
          ))}
        </View>
      ) : page.kind === 'permission' ? (
        <View className="pb-6">
          <Text className="px-4 pb-2 text-sm text-muted-foreground">
            How this run's agents ask before using tools. You can change it while the run is going.
          </Text>
          <SheetRow
            title="Server default"
            subtitle="The mode this server starts runs in."
            selected={permissionMode === null}
            onPress={() => {
              setPermissionMode(null);
              setPage(MAIN);
            }}
          />
          <PermissionModeOptions
            current={permissionMode}
            onChoose={(mode) => {
              setPermissionMode(mode);
              setPage(MAIN);
            }}
          />
        </View>
      ) : (
        <View className="gap-4 px-4 pb-6 pt-2">
          {defs.length === 0 ? (
            <Text className="text-sm text-muted-foreground">This workflow takes no inputs.</Text>
          ) : (
            defs.map((def) => (
              <VariableField
                key={def.name}
                def={def}
                value={draft[def.name]}
                error={showErrors ? result.errors[def.name] : undefined}
                onChange={(value) => set(def.name, value)}
              />
            ))
          )}

          {!workflow.projectId && pickableProjects.length > 0 ? (
            <View className="gap-2">
              <Text className="text-sm font-medium text-foreground">Project</Text>
              <View className="flex-row flex-wrap gap-2">
                <Chip label="None" selected={projectId === null} onPress={() => setProjectId(null)} />
                {pickableProjects.map((p) => (
                  <Chip
                    key={p.id}
                    label={p.name}
                    selected={projectId === p.id}
                    tone="accent"
                    onPress={() => setProjectId(p.id)}
                    maxWidth={220}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View className="gap-3">
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Advanced options"
              accessibilityState={{ expanded: advanced }}
              haptic="select"
              scale="none"
              onPress={() => setAdvanced((v) => !v)}
              className="min-h-11 flex-row items-center gap-2"
            >
              {advanced ? (
                <ChevronDown size={18} color={colors['muted-foreground']} />
              ) : (
                <ChevronRight size={18} color={colors['muted-foreground']} />
              )}
              <Text className="text-sm font-medium text-foreground">Advanced</Text>
              {advancedSummary ? (
                <Text numberOfLines={1} className="flex-1 text-sm text-muted-foreground">
                  {advancedSummary}
                </Text>
              ) : null}
            </Touchable>

            {advanced ? (
              <View className="gap-2">
                <Field
                  label="Run name (optional)"
                  value={runName}
                  onChangeText={setRunName}
                  placeholder={workflow.name}
                  maxLength={200}
                  accessibilityLabel="Run name, optional"
                />
                <View className="overflow-hidden rounded-3xl border border-border bg-card">
                  <PickerRow
                    icon={<Cpu size={18} color={colors['muted-foreground']} />}
                    label="Model"
                    value={modelName(model) ?? 'Workflow default'}
                    onPress={() => setPage({ kind: 'model', stageKey: null })}
                  />
                  <View className="ml-[46px] h-px bg-border-muted" />
                  <PickerRow
                    icon={<ShieldCheck size={18} color={colors['muted-foreground']} />}
                    label="Permissions"
                    value={permissionMode ? RUN_PERMISSION_MODE_LABEL[permissionMode] : 'Server default'}
                    onPress={() => setPage({ kind: 'permission' })}
                  />
                </View>
                {effortOptions.length > 0 ? (
                  <View className="gap-2">
                    <Text className="text-sm font-medium text-foreground">Effort</Text>
                    <View className="flex-row flex-wrap gap-2">
                      <Chip label="Default" selected={effort === null} onPress={() => setEffort(null)} />
                      {effortOptions.map((e) => (
                        <Chip key={e} label={e} tone="accent" selected={effort === e} onPress={() => setEffort(e)} />
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {advanced && codebaseList.length > 0 ? (
              <View className="gap-1">
                <Text className="text-sm font-medium text-foreground">Codebases</Text>
                <Text className="text-sm text-muted-foreground">
                  The project codebases this run checks out, and the branch each starts from.
                </Text>
                {codebaseList.map((codebase) => {
                  const entry = codebases.find((c) => c.alias === codebase.alias);
                  return entry && projectId ? (
                    <CodebaseRow
                      key={codebase.id}
                      projectId={projectId}
                      codebase={codebase}
                      draft={entry}
                      onChange={(patch) => patchCodebase(codebase.alias, patch)}
                    />
                  ) : null;
                })}
              </View>
            ) : null}

            {advanced && hasStages ? (
              <View className="gap-1">
                <Text className="text-sm font-medium text-foreground">Stages</Text>
                <Text className="text-sm text-muted-foreground">
                  Turn a stage off to skip it for this run, or give it extra variables or its own model.
                </Text>
                {overrides.map((o, index) => {
                  const expanded = expandedStage === o.stageKey;
                  const error = showErrors ? stageVarErrors[o.stageKey] : undefined;
                  const hasVars = Boolean(stageVarText[o.stageKey]?.trim());
                  const stageModel = modelName(o.model?.trim() || null);
                  const status = o.skip
                    ? 'Skipped'
                    : error
                      ? 'Check variables'
                      : [stageModel, hasVars ? 'has variables' : null].filter(Boolean).join(' · ') || 'Customize';
                  return (
                    <View key={o.stageKey} className="gap-2 border-b border-border-muted py-2">
                      <View className="min-h-11 flex-row items-center gap-3">
                        <Touchable
                          accessibilityRole="button"
                          accessibilityLabel={`Options for ${o.stageName}`}
                          accessibilityState={{ expanded }}
                          haptic="select"
                          scale="none"
                          onPress={() => setExpandedStage(expanded ? null : o.stageKey)}
                          className="min-h-11 flex-1 justify-center"
                        >
                          <Text
                            numberOfLines={1}
                            className={`text-md ${o.skip ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                          >
                            {index + 1}. {o.stageName}
                          </Text>
                          <Text numberOfLines={1} className={`text-sm ${error ? 'text-danger' : 'text-muted-foreground'}`}>
                            {status}
                          </Text>
                        </Touchable>
                        <Switch
                          value={!o.skip}
                          onValueChange={() => patchStage(o.stageKey, { skip: !o.skip })}
                          accessibilityLabel={`Run ${o.stageName}`}
                        />
                      </View>
                      {expanded && !o.skip ? (
                        <>
                          <View className="overflow-hidden rounded-3xl border border-border bg-card">
                            <PickerRow
                              icon={<Cpu size={18} color={colors['muted-foreground']} />}
                              label="Model"
                              value={stageModel ?? 'Stage default'}
                              onPress={() => setPage({ kind: 'model', stageKey: o.stageKey })}
                            />
                          </View>
                          <Field
                            value={stageVarText[o.stageKey] ?? ''}
                            onChangeText={(text) => setStageVarText((prev) => ({ ...prev, [o.stageKey]: text }))}
                            placeholder={'key=value, one per line'}
                            hint="Only this stage sees these."
                            error={error ?? null}
                            multiline
                            autoCapitalize="none"
                            autoCorrect={false}
                            accessibilityLabel={`Variables for ${o.stageName}`}
                            style={{ minHeight: 72, textAlignVertical: 'top', fontFamily: 'JetBrainsMono' }}
                          />
                        </>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}

            {advanced ? (
              <View className="gap-2">
                <Text className="text-sm font-medium text-foreground">Files for this run</Text>
                <View className="flex-row flex-wrap gap-2">
                  {UPLOAD_CATEGORIES.map((c) => (
                    <Chip
                      key={c}
                      label={uploads[c].length > 0 ? `${UPLOAD_LABEL[c]} (${uploads[c].length})` : UPLOAD_LABEL[c]}
                      selected={uploadCategory === c}
                      tone="accent"
                      onPress={() => setUploadCategory(c)}
                    />
                  ))}
                </View>
                <Text className="text-sm text-muted-foreground">{UPLOAD_HINT[uploadCategory]}</Text>
                {uploads[uploadCategory].map((file) => (
                  <View key={file.id} className="min-h-11 flex-row items-center gap-2">
                    <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
                      {file.name}
                    </Text>
                    <IconButton
                      icon={<X size={16} color={colors['muted-foreground']} />}
                      accessibilityLabel={`Remove ${file.name}`}
                      onPress={() =>
                        setUploads((prev) => ({
                          ...prev,
                          [uploadCategory]: prev[uploadCategory].filter((f) => f.id !== file.id),
                        }))
                      }
                    />
                  </View>
                ))}
                <Button
                  label={`Add ${UPLOAD_LABEL[uploadCategory].toLowerCase()}`}
                  variant="secondary"
                  size="sm"
                  haptic="tap"
                  icon={<FileUp size={16} color={colors.foreground} />}
                  onPress={() => void pickUploads()}
                />
                {uploadNotice ? <Text className="text-sm text-muted-foreground">{uploadNotice}</Text> : null}
              </View>
            ) : null}
          </View>
        </View>
      )}
    </Sheet>
  );
}

/** One project codebase: mount it or not, and the branch its checkout starts from. */
function CodebaseRow({
  projectId,
  codebase,
  draft,
  onChange,
}: {
  projectId: string;
  codebase: CodebaseSummary;
  draft: CodebaseDraft;
  onChange: (patch: Partial<CodebaseDraft>) => void;
}): React.ReactElement {
  const admin = useAdminApi();
  const branches = useQuery({
    queryKey: queryKeys.codebaseBranches(projectId, codebase.id),
    queryFn: () => admin.projects.codebases.branches(projectId, codebase.id),
    enabled: draft.selected,
    staleTime: 60_000,
  });
  const suggestions = (branches.data ?? []).filter((b) => b !== draft.baseRef.trim()).slice(0, 6);
  const branch = draft.baseRef.trim() || codebase.defaultBranch || 'default branch';

  return (
    <View className="gap-2 border-b border-border-muted py-2">
      <View className="min-h-11 flex-row items-center gap-3">
        <View className="flex-1 justify-center">
          <Text numberOfLines={1} className="text-md text-foreground">
            {codebase.alias}
          </Text>
          <Text numberOfLines={1} className="text-sm text-muted-foreground">
            {draft.selected ? `${draft.mode === 'in_place' ? 'In place' : 'Worktree'} · ${branch}` : 'Not mounted'}
          </Text>
        </View>
        <Switch
          value={draft.selected}
          onValueChange={(selected) => onChange({ selected })}
          accessibilityLabel={`Mount ${codebase.alias}`}
        />
      </View>
      {draft.selected ? (
        <>
          <Field
            value={draft.baseRef}
            onChangeText={(baseRef) => onChange({ baseRef })}
            placeholder={codebase.defaultBranch ?? 'Default branch'}
            hint="The branch this run's checkout starts from."
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={200}
            accessibilityLabel={`Branch for ${codebase.alias}`}
          />
          {suggestions.length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {suggestions.map((b) => (
                <Chip key={b} label={b} size="sm" tone="accent" maxWidth={200} onPress={() => onChange({ baseRef: b })} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export function VariableField({
  def,
  value,
  error,
  onChange,
}: {
  def: VariableDefinition;
  value: string | boolean | undefined;
  error: string | undefined;
  onChange: (value: string | boolean) => void;
}): React.ReactElement {
  const label = def.required ? `${def.label} *` : def.label;

  if (def.type === 'boolean') {
    return (
      <View className="min-h-11 flex-row items-center gap-3">
        <View className="flex-1 gap-0.5">
          <Text className="text-sm font-medium text-foreground">{def.label}</Text>
          {def.description ? (
            <Text className="text-sm text-muted-foreground">{def.description}</Text>
          ) : null}
        </View>
        <Switch value={value === true} onValueChange={onChange} accessibilityLabel={def.label} />
      </View>
    );
  }

  if (def.type === 'choice' && def.options && def.options.length > 0) {
    return (
      <View className="gap-2">
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        {def.description ? <Text className="text-sm text-muted-foreground">{def.description}</Text> : null}
        <View className="flex-row flex-wrap gap-2">
          {def.options.map((option) => (
            <Chip
              key={option}
              label={option}
              tone="accent"
              selected={value === option}
              onPress={() => onChange(value === option && !def.required ? '' : option)}
            />
          ))}
        </View>
        {error ? <Text className="text-sm text-danger">{error}</Text> : null}
      </View>
    );
  }

  return (
    <Field
      label={label}
      value={typeof value === 'string' ? value : ''}
      onChangeText={onChange}
      error={error ?? null}
      {...(def.description ? { hint: def.description } : {})}
      keyboardType={def.type === 'number' ? 'decimal-pad' : 'default'}
      multiline={def.type === 'text'}
      autoCapitalize="none"
      autoCorrect={def.type === 'text'}
      {...(def.type === 'text' ? { style: { minHeight: 88, textAlignVertical: 'top' as const } } : {})}
    />
  );
}
