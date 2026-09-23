// ────────────────────────────────────────────────────────────────
// StartRunSheet — start a workflow run from the phone.
//
// One field per declared input (see `variableForm.ts` for the rules), an
// optional project, then create → start → open the run.
//
// A collapsed "Advanced" section carries what web's run dialog offers on top:
// per-stage skip toggles and per-stage variables (encoded by the shared
// `encodeStageOverrides`, so orchestrated and plain runs get the shape each
// route reads), and — for orchestrated runs only, where the server has an
// uploads directory — custom prompt/skill/agent files.
//
// Orchestrated workflows start through `/orchestrator/runs`, which creates
// and starts in one call — the same split web makes.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ChevronDown, ChevronRight, FileUp, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  blankStageOverrides,
  encodeStageOverrides,
  queryKeys,
  type StageOverrideDraft,
} from '@generatorai/client-core';

import { useApi } from '../../api/useApi';
import { useAdminApi } from '../../api/useAdminApi';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { IconButton } from '../ui/Button';
import { Touchable } from '../ui/Touchable';
import { useTheme } from '../../theme/ThemeProvider';
import { pickAttachments, readAllAttachmentBytes } from '../chat/composer/attachmentPickers';
import type { ComposerAttachment } from '../chat/composer/types';
import { parseStageVariables } from './stageOverrideForm';
import { Field, Switch } from '../ui/Form';
import { haptics } from '../ui/haptics';
import { useToast } from '../ui/Toast';
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
  orchestratorConfig?: unknown;
  /** Stage names in order, for the Advanced per-stage overrides. */
  stageNames?: string[];
}

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
  const queryClient = useQueryClient();

  const defs = useMemo(() => parseVariables(workflow.variables), [workflow.variables]);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(defs));
  const [showErrors, setShowErrors] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(workflow.projectId ?? null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const stageNames = workflow.stageNames;
  const [overrides, setOverrides] = useState<StageOverrideDraft[]>(() => blankStageOverrides(stageNames ?? []));
  /** Raw key=value text per stage index; parsed on submit. */
  const [stageVarText, setStageVarText] = useState<Record<number, string>>({});
  const [expandedStage, setExpandedStage] = useState<number | null>(null);
  const [uploadCategory, setUploadCategory] = useState<UploadCategory>('prompts');
  const [uploads, setUploads] = useState<Uploads>(NO_UPLOADS);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const opened = useRef(false);
  const { colors } = useTheme();

  // Re-seed each time the sheet opens, so a cancelled draft does not leak
  // into the next run.
  useEffect(() => {
    if (visible && !opened.current) {
      setDraft(initialDraft(defs));
      setShowErrors(false);
      setServerError(null);
      setProjectId(workflow.projectId ?? null);
      setAdvanced(false);
      setOverrides(blankStageOverrides(stageNames ?? []));
      setStageVarText({});
      setExpandedStage(null);
      setUploads(NO_UPLOADS);
      setUploadNotice(null);
    }
    opened.current = visible;
  }, [visible, defs, workflow.projectId, stageNames]);

  const projects = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => api.projects.list(),
    enabled: visible && !workflow.projectId,
    staleTime: 60_000,
  });

  const result = buildVariables(defs, draft);
  const orchestrated = Boolean(workflow.orchestratorConfig);

  // Per-stage variables: parse every stage's text; the first error blocks.
  const stageVarErrors: Record<number, string> = {};
  const effectiveOverrides = overrides.map((o) => {
    const text = stageVarText[o.stageIndex];
    if (!text?.trim()) return { ...o, variables: {} };
    const parsed = parseStageVariables(text);
    if (parsed.error) stageVarErrors[o.stageIndex] = parsed.error;
    return { ...o, variables: parsed.variables };
  });
  const stageErrorCount = Object.keys(stageVarErrors).length;
  const skippedCount = overrides.filter((o) => o.skip).length;
  const uploadCount = uploads.prompts.length + uploads.skills.length + uploads.agents.length;
  const hasStages = (stageNames?.length ?? 0) > 0;
  const hasAdvanced = hasStages || orchestrated;

  const toast = useToast();
  // Archived projects are not somewhere a new run should land.
  const pickableProjects = (projects.data ?? []).filter(
    (p) => (p as { status?: string }).status !== 'archived',
  );

  const uploadAll = async (runId: string): Promise<void> => {
    for (const category of UPLOAD_CATEGORIES) {
      if (uploads[category].length === 0) continue;
      const files = await readAllAttachmentBytes(uploads[category]);
      await admin.orchestrator.uploadRunFiles(runId, category, files);
    }
  };

  const start = useMutation({
    mutationFn: async (): Promise<string> => {
      if (orchestrated) {
        const encoded = encodeStageOverrides(result.variables, effectiveOverrides, { orchestrated: true });
        const context = await admin.orchestrator.startRun({
          workflowDefinitionId: workflow.id,
          variables: encoded.variables,
          ...(encoded.stageOverrides ? { stageOverrides: encoded.stageOverrides } : {}),
          ...(projectId ? { projectId } : {}),
        });
        const runId = (context as { workflowRunId?: unknown }).workflowRunId;
        if (typeof runId !== 'string') throw new Error('The server did not return a run.');
        // The orchestrator scans uploads when it reaches the stage that
        // needs them, so upload straight away — but a failed upload must
        // not hide the run that already exists.
        if (uploadCount > 0) {
          try {
            await uploadAll(runId);
          } catch (err) {
            haptics.error();
            toast({
              message: `Run started but files did not upload: ${err instanceof Error ? err.message : String(err)}`,
              variant: 'danger',
            });
          }
        }
        return runId;
      }
      const run = await admin.runs.create({
        workflowDefinitionId: workflow.id,
        variables: encodeStageOverrides(result.variables, effectiveOverrides, { orchestrated: false }).variables,
        ...(projectId ? { projectId } : {}),
      });
      // Open the run as soon as it exists and start it behind the navigation:
      // the run screen already shows "created → running" live, and a slow
      // network must not leave the user watching a spinner on a closed-off
      // sheet. A failed start is reported where the user now is.
      admin.runs.start(run.id).then(
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.runs() }),
        (err: unknown) => {
          haptics.error();
          toast({
            message: `Run created but did not start: ${err instanceof Error ? err.message : String(err)}`,
            variant: 'danger',
          });
        },
      );
      return run.id;
    },
    onSuccess: (runId) => {
      haptics.success();
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs() });
      onClose();
      router.push(`/runs/${runId}`);
    },
    onError: (err) => {
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

  const toggleSkip = (index: number): void =>
    setOverrides((prev) => prev.map((o) => (o.stageIndex === index ? { ...o, skip: !o.skip } : o)));

  const pickUploads = async (): Promise<void> => {
    setUploadNotice(null);
    const outcome = await pickAttachments('file');
    if (outcome.status === 'picked') {
      setUploads((prev) => ({ ...prev, [uploadCategory]: [...prev[uploadCategory], ...outcome.items].slice(0, 20) }));
    } else if (outcome.status !== 'cancelled') {
      setUploadNotice(outcome.reason);
    }
  };

  const advancedSummary = [
    skippedCount > 0 ? `${skippedCount} skipped` : null,
    Object.values(stageVarText).some((t) => t.trim()) ? 'stage variables' : null,
    uploadCount > 0 ? `${uploadCount} file${uploadCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Sheet visible={visible} onClose={onClose} title={`Run ${workflow.name}`} detents={[0.92]} footer={
        // A refusal from the server is pinned WITH the button. It used to be the
        // last line of the scrolling form, so a long form (or an open keyboard)
        // hid it and the button simply appeared to do nothing.
        <View className="gap-2">
          {serverError ? (
            <Text accessibilityLiveRegion="assertive" numberOfLines={4} className="text-sm leading-snug text-danger">
              {serverError}
            </Text>
          ) : null}
          <Button
            label="Start run"
            size="lg"
            full
            haptic="commit"
            loading={start.isPending}
            disabled={start.isPending}
            onPress={submit}
          />
        </View>
    }>
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

        {hasAdvanced ? (
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

            {advanced && hasStages ? (
              <View className="gap-1">
                <Text className="text-sm font-medium text-foreground">Stages</Text>
                <Text className="text-sm text-muted-foreground">
                  Turn a stage off to skip it for this run, or give it extra variables.
                </Text>
                {overrides.map((o) => {
                  const expanded = expandedStage === o.stageIndex;
                  const error = showErrors ? stageVarErrors[o.stageIndex] : undefined;
                  const hasVars = Boolean(stageVarText[o.stageIndex]?.trim());
                  return (
                    <View key={`${o.stageIndex}:${o.stageName}`} className="gap-2 border-b border-border-muted py-2">
                      <View className="min-h-11 flex-row items-center gap-3">
                        <Touchable
                          accessibilityRole="button"
                          accessibilityLabel={`Variables for ${o.stageName}`}
                          accessibilityState={{ expanded }}
                          haptic="select"
                          scale="none"
                          onPress={() => setExpandedStage(expanded ? null : o.stageIndex)}
                          className="min-h-11 flex-1 justify-center"
                        >
                          <Text
                            numberOfLines={1}
                            className={`text-md ${o.skip ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                          >
                            {o.stageIndex + 1}. {o.stageName}
                          </Text>
                          <Text className={`text-sm ${error ? 'text-danger' : 'text-muted-foreground'}`}>
                            {o.skip ? 'Skipped' : error ? 'Check variables' : hasVars ? 'Has variables' : 'Add variables'}
                          </Text>
                        </Touchable>
                        <Switch
                          value={!o.skip}
                          onValueChange={() => toggleSkip(o.stageIndex)}
                          accessibilityLabel={`Run ${o.stageName}`}
                        />
                      </View>
                      {expanded && !o.skip ? (
                        <Field
                          value={stageVarText[o.stageIndex] ?? ''}
                          onChangeText={(text) => setStageVarText((prev) => ({ ...prev, [o.stageIndex]: text }))}
                          placeholder={'key=value, one per line'}
                          hint="Only this stage sees these."
                          error={error ?? null}
                          multiline
                          autoCapitalize="none"
                          autoCorrect={false}
                          accessibilityLabel={`Variables for ${o.stageName}`}
                          style={{ minHeight: 72, textAlignVertical: 'top', fontFamily: 'JetBrainsMono' }}
                        />
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}

            {advanced && orchestrated ? (
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
        ) : null}

      </View>
    </Sheet>
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
