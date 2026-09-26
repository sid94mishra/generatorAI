// ────────────────────────────────────────────────────────────────
// StagePropertiesPanel — right sidebar editing one stage (or one edge)
// of the v2 `WorkflowGraph`. Collapsible accordion sections, a
// Properties / Execution tab bar, validator issues shown next to the
// field they point at. Every v2 field is editable: the engine executes
// all of them (ENGINE_LEVEL v2).
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Settings2, FileText, Layers, Cpu, Zap, Shield, Bot, Server, Wand2, Webhook, Plus, Trash2,
  CheckCircle2, Clock, Braces, UserCheck, GitMerge, AlertCircle, Repeat, Undo2,
} from 'lucide-react';
import {
  ApprovalSpecSchema,
  EDGE_ON_VALUES,
  RepairPolicySchema,
  RetryPolicySchema,
  STAGE_HOOK_PHASES,
  HOOK_PHASE_INFO,
  type AgentStage,
  type EdgeOn,
  type EdgeSpec,
  type HookDefinition,
  type PromptDefinition,
  type ResultValidationRule,
} from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue, type StageUpdate } from '@/stores/workflowBuilderStore.js';
import { PromptEditor } from './PromptEditor.js';
import { SessionSpecEditor, type SessionSpecSection } from '@/components/session/SessionSpecEditor.js';
import { NumberStepper } from './NumberStepper.js';
import { CollapsibleSection } from './CollapsibleSection.js';
import { patchSession } from './sessionPatch.js';
import { EDGE_TYPE_LABELS, EDGE_TYPE_HINTS } from './edgeTypeStyles.js';
import { ExpressionField, FieldIssues, issuesAt } from './engineGate.js';
import { Button, Input, Select, Textarea, ToggleSwitch } from '@/components/ui/index.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';
import { cn } from '@/lib/utils.js';
import { StageKindPanel } from './StageKindPanels.js';
import { ArgsEditor, CompensationEditor, JoinFields, JsonObjectEditor, ParentField, StageKeyField } from './builder/fields.js';

interface StagePropertiesPanelProps {
  onClose: () => void;
}

type PanelTab = 'properties' | 'execution';

/** Props every section receives. */
interface SectionProps {
  stage: AgentStage;
  onUpdate: (updates: Partial<AgentStage>) => void;
  issues: readonly BuilderIssue[];
}

export function StagePropertiesPanel({ onClose }: StagePropertiesPanelProps) {
  const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowBuilderStore((s) => s.selectedEdgeId);
  const stage = useWorkflowBuilderStore((s) => {
    const node = s.nodes.find((n) => n.id === s.selectedNodeId);
    return node?.data?.stage;
  });
  const allIssues = useWorkflowBuilderStore((s) => s.issues);
  const updateStage = useWorkflowBuilderStore((s) => s.updateStage);
  const [activeTab, setActiveTab] = useState<PanelTab>('properties');

  const stageIssues = useMemo(
    () => (stage ? allIssues.filter((i) => i.stageKey === stage.key) : []),
    [allIssues, stage],
  );

  const handleUpdate = useCallback(
    (updates: StageUpdate) => {
      if (!selectedNodeId) return;
      updateStage(selectedNodeId, updates);
    },
    [selectedNodeId, updateStage],
  );

  if (!stage && selectedEdgeId) {
    return <EdgePropertiesPanel edgeId={selectedEdgeId} onClose={onClose} />;
  }

  // Empty state
  if (!stage) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-subtle">
          <FileText className="h-7 w-7 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-foreground">No stage selected</h3>
        <p className="mt-1.5 max-w-[200px] text-xs text-muted-foreground">
          Click a stage on the canvas to view and edit its properties
        </p>
      </div>
    );
  }

  // Every other kind (check, loop, map, sub-workflow, wait) has its own panel (P05).
  if (stage.kind !== 'agent') {
    return <StageKindPanel stage={stage} onUpdate={handleUpdate} issues={stageIssues} onClose={onClose} />;
  }

  const errorCount = stageIssues.filter((i) => i.severity === 'error').length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col border-b border-border">
        {/* Title row */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Settings2 className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-foreground">
                {stage.name || 'Untitled Stage'}
              </h3>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {stage.key}
                {stage.session?.agentRef ? ` · ${stage.session.agentRef}` : ''}
              </p>
            </div>
          </div>
          <Button
            onClick={onClose}
            aria-label="Close properties panel"
            variant="ghost"
            size="icon-sm"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-subtle hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {errorCount > 0 && (
          <p className="mx-4 mb-2 flex items-center gap-1.5 rounded-md bg-danger-muted px-2 py-1 text-[11px] text-danger">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {errorCount} {errorCount === 1 ? 'issue' : 'issues'} in this stage (shown next to each field)
          </p>
        )}

        {/* Tab bar */}
        <div className="flex px-4 gap-1" role="tablist">
          {([
            { key: 'properties' as PanelTab, label: 'Properties' },
            { key: 'execution' as PanelTab, label: 'Execution' },
          ]).map(({ key, label }) => (
            <Button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              aria-controls={`tabpanel-${key}`}
              onClick={() => setActiveTab(key)}
              variant="ghost"
              size="sm"
              className={cn(
                'h-auto px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors',
                activeTab === key
                  ? 'bg-background text-foreground border border-b-0 border-border -mb-px hover:bg-background'
                  : 'bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground',
              )}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Scrollable form body. Keyed by stage so local drafts reset on selection. */}
      <div className="flex-1 overflow-y-auto" role="tabpanel" id={`tabpanel-${activeTab}`} key={stage.key}>
        {activeTab === 'properties' ? (
          <PropertiesTab stage={stage} onUpdate={handleUpdate} issues={stageIssues} />
        ) : (
          <ExecutionTab stage={stage} onUpdate={handleUpdate} issues={stageIssues} />
        )}
      </div>
    </div>
  );
}

// ── Properties Tab ──

type PromptSubTab = 'inline' | 'agent';

function PropertiesTab({ stage, onUpdate, issues }: SectionProps) {
  const [promptSubTab, setPromptSubTab] = useState<PromptSubTab>('inline');
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? undefined);
  const workflowSession = useWorkflowBuilderStore((s) => s.workflow.session);
  // One session editor (P02 WP-2.11), spread over the panel's sections.
  const sessionEditor = (sections: readonly SessionSpecSection[]) => (
    <SessionSpecEditor
      value={stage.session}
      onChange={(updates) => onUpdate(patchSession(stage, updates))}
      scope="stage"
      projectId={projectId}
      inherited={workflowSession}
      sections={sections}
    />
  );

  return (
    <div>
      {/* Basic Info */}
      <CollapsibleSection title="Basic" icon={<Layers className="h-3.5 w-3.5" />} defaultOpen>
        <div>
          <label htmlFor="stage-name" className="mb-1.5 block text-xs font-medium text-foreground">Stage Name</label>
          <Input
            id="stage-name"
            value={stage.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Stage name"
          />
          <FieldIssues issues={issuesAt(issues, '/name')} />
        </div>
        <StageKeyField stage={stage} issues={issuesAt(issues, '/key')} />
        <div>
          <label htmlFor="stage-description" className="mb-1.5 block text-xs font-medium text-foreground">Description</label>
          <Textarea
            id="stage-description"
            value={stage.description ?? ''}
            onChange={(e) => onUpdate({ description: e.target.value || undefined })}
            rows={2}
            className="resize-none"
            placeholder="Optional description"
          />
        </div>
        <ParentField stage={stage} issues={issuesAt(issues, '/parentKey')} />
      </CollapsibleSection>

      {/* Session: the stage session over the workflow session */}
      <CollapsibleSection title="Model" icon={<Cpu className="h-3.5 w-3.5" />} defaultOpen>
        {sessionEditor(['runtime', 'mode', 'warnings'])}
        <FieldIssues issues={issuesAt(issues, '/session')} />
      </CollapsibleSection>

      {/* Prompts & Agent - with sub-tabs */}
      <CollapsibleSection
        title="Prompts & Context"
        icon={<FileText className="h-3.5 w-3.5" />}
        badge={String(stage.prompts.length)}
        defaultOpen
      >
        {/* Sub-tab bar */}
        <div className="flex gap-0.5 rounded-lg bg-subtle/50 p-0.5 mb-3" role="tablist" aria-label="Prompt type">
          {([
            { key: 'inline' as PromptSubTab, label: 'Inline', icon: <FileText className="h-3 w-3" /> },
            { key: 'agent' as PromptSubTab, label: 'Agent', icon: <Bot className="h-3 w-3" /> },
          ]).map(({ key, label, icon }) => (
            <Button
              key={key}
              role="tab"
              aria-selected={promptSubTab === key}
              onClick={() => setPromptSubTab(key)}
              variant="ghost"
              size="sm"
              className={cn(
                'h-auto flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-all',
                promptSubTab === key
                  ? 'bg-background text-foreground shadow-sm hover:bg-background'
                  : 'bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground',
              )}
            >
              {icon}
              {label}
            </Button>
          ))}
        </div>

        {/* Sub-tab content */}
        {promptSubTab === 'inline' && (
          <>
            <PromptEditor
              prompts={stage.prompts}
              onChange={(prompts: PromptDefinition[]) => onUpdate({ prompts })}
              contentLabel="Prompt"
            />
            <FieldIssues issues={issuesAt(issues, '/prompts')} />
          </>
        )}
        {promptSubTab === 'agent' && (
          sessionEditor(['agent'])
        )}
      </CollapsibleSection>

      <LoopIterationSection stage={stage} onUpdate={onUpdate} issues={issues} />

      {/* Skills */}
      <CollapsibleSection title="Skills" icon={<Wand2 className="h-3.5 w-3.5" />} defaultOpen={false}>
        {sessionEditor(['skills'])}
      </CollapsibleSection>

      {/* MCP Servers */}
      <CollapsibleSection title="MCP Servers" icon={<Server className="h-3.5 w-3.5" />} defaultOpen={false}>
        {sessionEditor(['mcp'])}
      </CollapsibleSection>

      {/* Platform tools */}
      <CollapsibleSection title="Platform Tools" icon={<Settings2 className="h-3.5 w-3.5" />} defaultOpen={false}>
        {sessionEditor(['platform'])}
      </CollapsibleSection>
    </div>
  );
}

// ── Loop iterations (P05) ──

/**
 * How a body agent of a loop behaves from one iteration to the next:
 * follow-up prompts (sent instead of `prompts` from the second iteration
 * on), one continuing conversation or a fresh one each time, and
 * compaction of a continuing conversation. Shown for a stage inside a
 * loop, and outside one while any of these is still set (they only warn
 * there), so it can be cleared.
 */
function LoopIterationSection({ stage, onUpdate, issues }: SectionProps) {
  const inLoop = useWorkflowBuilderStore(
    (s) => !!stage.parentKey && s.nodes.find((n) => n.id === stage.parentKey)?.data.stage.kind === 'loop',
  );
  const followUps = stage.followUpPrompts;
  if (!inLoop && stage.sessionReuse === 'fresh' && !followUps && stage.compactAfter === undefined) return null;
  const continues = stage.sessionReuse === 'continue';

  return (
    <CollapsibleSection
      title="Loop iterations"
      icon={<Repeat className="h-3.5 w-3.5" />}
      badge={followUps?.length ? String(followUps.length) : undefined}
      defaultOpen
    >
      {!inLoop && (
        <p className="text-[11px] text-warning">This stage is not in a loop: these settings have no effect.</p>
      )}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground">Conversation</label>
        <Select
          aria-label="Session reuse"
          value={stage.sessionReuse}
          onChange={(v) =>
            // compactAfter only applies to a continuing conversation.
            onUpdate(v === 'continue' ? { sessionReuse: 'continue' } : { sessionReuse: 'fresh', compactAfter: undefined })
          }
          options={[
            { value: 'fresh', label: 'Fresh each iteration', description: 'A new conversation every time' },
            { value: 'continue', label: 'Continue across iterations', description: 'One conversation for the whole loop' },
          ]}
        />
        <FieldIssues issues={issuesAt(issues, '/sessionReuse')} />
      </div>
      <div className={cn(!continues && 'opacity-50')}>
        <NumberStepper
          label="Compact every N iterations (0 = never)"
          value={stage.compactAfter ?? 0}
          onChange={(v) => onUpdate({ compactAfter: continues && v > 0 ? v : undefined })}
          min={0}
          max={continues ? 20 : 0}
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          {continues
            ? 'Replaces the conversation with a fresh one seeded with a digest of the iterations so far (no model call).'
            : 'Only with a continuing conversation.'}
        </p>
        <FieldIssues issues={issuesAt(issues, '/compactAfter')} />
      </div>
      <div>
        <ToggleSwitch
          checked={followUps !== undefined}
          onChange={(checked) => onUpdate({ followUpPrompts: checked ? [] : undefined })}
          label="Different prompts from the second iteration"
          description="Sent instead of the prompts above from iteration 2 on; they can read loop.last, loop.carry and loop.operatorInput."
        />
        {followUps !== undefined && (
          <div className="mt-2">
            <PromptEditor
              prompts={followUps}
              onChange={(prompts: PromptDefinition[]) => onUpdate({ followUpPrompts: prompts })}
              contentLabel="Follow-up"
            />
          </div>
        )}
        <FieldIssues issues={issuesAt(issues, '/followUpPrompts')} />
      </div>
    </CollapsibleSection>
  );
}

// ── Execution Tab ──

function ExecutionTab({ stage, onUpdate, issues }: SectionProps) {
  return (
    <div>
      <CollapsibleSection title="Execution" icon={<Zap className="h-3.5 w-3.5" />} defaultOpen>
        <div>
          <label htmlFor="stage-guard" className="mb-1.5 block text-xs font-medium text-foreground">Guard</label>
          <ExpressionField
            id="stage-guard"
            expect="boolean"
            value={stage.guard ?? ''}
            onChange={(v) => onUpdate({ guard: v.trim() ? v : undefined })}
            // Expression v2: `variables.<path>`, `stages.<key>.status`,
            // `== != < <= > >=`, `in`, `and / or / not`, and functions such
            // as len() and exists(). False skips the stage (guard_false).
            placeholder="e.g. variables.env == 'prod' and stages.review.status == 'completed'"
            issues={issuesAt(issues, '/guard')}
            ariaLabel="Guard expression"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Evaluated once the stage is ready; false skips it. Leave empty to always run.
          </p>
        </div>

        <JoinFields join={stage.join} onChange={(join) => onUpdate({ join })} issues={issues} />

        <ContextEditor stage={stage} onUpdate={onUpdate} issues={issues} />
        <FieldIssues issues={issuesAt(issues, '/sessionGroup')} />
      </CollapsibleSection>

      <CollapsibleSection title="Approval" icon={<UserCheck className="h-3.5 w-3.5" />} defaultOpen={!!stage.approval}>
        <ToggleSwitch
          checked={!!stage.approval}
          onChange={(checked) => onUpdate({ approval: checked ? ApprovalSpecSchema.parse({}) : undefined })}
          label="Approval required"
          description="Pause after this stage completes and wait for a human to approve or request changes before the next stage runs."
        />
        {stage.approval && (
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="stage-approval-prompt" className="mb-1.5 block text-xs font-medium text-foreground">Reviewer prompt</label>
              <Textarea
                id="stage-approval-prompt"
                value={stage.approval.prompt ?? ''}
                onChange={(e) => onUpdate({ approval: { ...stage.approval!, prompt: e.target.value || undefined } })}
                rows={2}
                className="resize-none"
                placeholder="What should the reviewer check?"
              />
            </div>
            <ToggleSwitch
              checked={stage.approval.allowChanges}
              onChange={(checked) => onUpdate({ approval: { ...stage.approval!, allowChanges: checked } })}
              label="Allow change requests"
              description="The reviewer may send feedback, which runs another turn."
            />
            {stage.approval.allowChanges && (
              <NumberStepper
                label="Change-request rounds"
                value={stage.approval.maxRounds}
                onChange={(v) => onUpdate({ approval: { ...stage.approval!, maxRounds: v } })}
                min={1}
                max={10}
                step={1}
              />
            )}
          </div>
        )}
        <FieldIssues issues={issuesAt(issues, '/approval')} />
      </CollapsibleSection>

      <CollapsibleSection title="Timeouts" icon={<Clock className="h-3.5 w-3.5" />} defaultOpen={false}>
        <NumberStepper
          label="Attempt timeout (seconds, 0 = none)"
          value={stage.timeouts?.attemptMs ? stage.timeouts.attemptMs / 1000 : 0}
          onChange={(v) => {
            const rest = { ...(stage.timeouts ?? {}) };
            if (v > 0) rest.attemptMs = v * 1000;
            else delete rest.attemptMs;
            onUpdate({ timeouts: Object.keys(rest).length > 0 ? rest : undefined });
          }}
          min={0}
          max={86_400}
          step={30}
          unit="sec"
        />
        {(['queueMs', 'idleMs', 'totalMs'] as const).map((field) => (
          <NumberStepper
            key={field}
            label={`${field === 'queueMs' ? 'Queue' : field === 'idleMs' ? 'Idle' : 'Total'} timeout (seconds, 0 = default)`}
            value={stage.timeouts?.[field] ? stage.timeouts[field]! / 1000 : 0}
            onChange={(v) => {
              const rest = { ...(stage.timeouts ?? {}) };
              if (v > 0) rest[field] = v * 1000;
              else delete rest[field];
              onUpdate({ timeouts: Object.keys(rest).length > 0 ? rest : undefined });
            }}
            min={0}
            max={field === 'totalMs' ? 604_800 : 86_400}
            step={30}
            unit="sec"
          />
        ))}
        <FieldIssues issues={issuesAt(issues, '/timeouts')} />
      </CollapsibleSection>

      <CollapsibleSection title="Retry Policy" icon={<Shield className="h-3.5 w-3.5" />} defaultOpen={false}>
        <ToggleSwitch
          checked={!!stage.retry}
          onChange={(checked) => onUpdate({ retry: checked ? RetryPolicySchema.parse({}) : undefined })}
          label="Retry on failure"
          description="Automatically retry this stage if an attempt fails"
        />
        {stage.retry && (
          <div className="mt-3 space-y-3">
            <NumberStepper
              label="Max attempts (including the first)"
              value={stage.retry.maxAttempts}
              onChange={(v) => onUpdate({ retry: { ...stage.retry!, maxAttempts: v } })}
              min={1}
              max={10}
              step={1}
            />
            <NumberStepper
              label="Initial delay (ms)"
              value={stage.retry.initialDelayMs}
              onChange={(v) => onUpdate({ retry: { ...stage.retry!, initialDelayMs: v } })}
              min={0}
              max={3_600_000}
              step={500}
              unit="ms"
            />
            <NumberStepper
              label="Backoff multiplier"
              value={stage.retry.backoffMultiplier}
              onChange={(v) => onUpdate({ retry: { ...stage.retry!, backoffMultiplier: v } })}
              min={1}
              max={10}
              step={0.5}
              unit="x"
            />
            <NumberStepper
              label="Max delay (ms)"
              value={stage.retry.maxDelayMs}
              onChange={(v) => onUpdate({ retry: { ...stage.retry!, maxDelayMs: v } })}
              min={0}
              max={3_600_000}
              step={1000}
              unit="ms"
            />
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Jitter</label>
              <Select
                aria-label="Retry jitter"
                value={stage.retry.jitter}
                onChange={(v) => onUpdate({ retry: { ...stage.retry!, jitter: v as 'full' | 'equal' | 'none' } })}
                options={[
                  { value: 'full', label: 'Full', description: 'Random 0..delay' },
                  { value: 'equal', label: 'Equal', description: 'Half the delay plus a random half' },
                  { value: 'none', label: 'None', description: 'Exact delay' },
                ]}
              />
            </div>
          </div>
        )}
        <FieldIssues issues={issuesAt(issues, '/retry')} />

        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium text-foreground">When retries are exhausted</label>
          <Select
            aria-label="When retries are exhausted"
            value={stage.onExhausted ?? ''}
            onChange={(v) => onUpdate({ onExhausted: (v || undefined) as AgentStage['onExhausted'] })}
            options={[
              { value: '', label: 'Engine default' },
              { value: 'fail', label: 'Fail the stage' },
              { value: 'pause', label: 'Pause for an operator' },
            ]}
          />
          <FieldIssues issues={issuesAt(issues, '/onExhausted')} />
        </div>

        <div className="mt-3">
          <ToggleSwitch
            checked={!!stage.repair}
            onChange={(checked) => onUpdate({ repair: checked ? RepairPolicySchema.parse({}) : undefined })}
            label="Repair turns"
            description="Ask the agent to fix output that fails its contract before retrying."
          />
          <FieldIssues issues={issuesAt(issues, '/repair')} />
        </div>
      </CollapsibleSection>

      <OutputSection stage={stage} onUpdate={onUpdate} issues={issues} />

      <CollapsibleSection title="Limits" icon={<GitMerge className="h-3.5 w-3.5" />} defaultOpen={false}>
        <NumberStepper
          label="Budget: max turns (0 = none)"
          value={stage.budget?.maxTurns ?? 0}
          onChange={(v) => {
            const rest = { ...(stage.budget ?? {}) };
            if (v > 0) rest.maxTurns = v;
            else delete rest.maxTurns;
            onUpdate({ budget: Object.keys(rest).length > 0 ? rest : undefined });
          }}
          min={0}
          max={100_000}
        />
        <FieldIssues issues={issuesAt(issues, '/budget')} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Compensation"
        icon={<Undo2 className="h-3.5 w-3.5" />}
        defaultOpen={!!stage.compensate?.length}
        badge={stage.compensate?.length ? String(stage.compensate.length) : undefined}
      >
        <CompensationEditor actions={stage.compensate} onChange={(compensate) => onUpdate({ compensate })} issues={issues} />
      </CollapsibleSection>

      {/* Hooks */}
      <CollapsibleSection title="Hooks" icon={<Webhook className="h-3.5 w-3.5" />} defaultOpen={false}>
        <HookEditor hooks={stage.hooks} onChange={(hooks) => onUpdate({ hooks })} />
        <FieldIssues issues={issuesAt(issues, '/hooks')} />
      </CollapsibleSection>
    </div>
  );
}

// ── Context ──

function ContextEditor({ stage, onUpdate, issues }: SectionProps) {
  const otherStages = useWorkflowBuilderStore(
    (s) => s.nodes,
  ).filter((n) => n.id !== stage.key);
  const from = stage.context.from;
  const explicit = from !== undefined;

  const toggleSource = (key: string) => {
    const current = from ?? [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    onUpdate({ context: { ...stage.context, from: next } });
  };

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground">Context from Predecessors</label>
      <Select
        aria-label="Context mode"
        value={stage.context.mode}
        onChange={(v) => onUpdate({ context: { ...stage.context, mode: v as AgentStage['context']['mode'] } })}
        options={[
          { value: 'summary', label: 'Summary (default)', description: 'Each source stage summary' },
          { value: 'output', label: 'Full output', description: 'The complete output text' },
          { value: 'structured', label: 'Structured', description: 'The JSON output' },
          { value: 'none', label: 'No context', description: 'The stage starts with a clean slate' },
        ]}
      />
      {stage.context.mode !== 'none' && otherStages.length > 0 && (
        <div className="mt-2 space-y-1">
          <ToggleSwitch
            checked={explicit}
            onChange={(checked) => {
              const context = { ...stage.context };
              if (checked) context.from = [];
              else delete context.from;
              onUpdate({ context });
            }}
            label="Choose source stages"
            description="Off: the direct predecessors."
          />
          {explicit && (
            <div className="max-h-40 space-y-1 overflow-y-auto pt-1">
              {otherStages.map((n) => (
                <label key={n.id} className="flex items-center gap-2 text-xs text-foreground">
                  <Checkbox
                    checked={from!.includes(n.id)}
                    onCheckedChange={() => toggleSource(n.id)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate">{n.data.stage.name}</span>
                  <code className="ml-auto shrink-0 text-[10px] text-muted-foreground">{n.id}</code>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <FieldIssues issues={issuesAt(issues, '/context')} />
    </div>
  );
}

// ── Output contract ──

function OutputSection({ stage, onUpdate, issues }: SectionProps) {
  const output = stage.output;
  const setOutput = (updates: Partial<AgentStage['output']>) => {
    const next: Record<string, unknown> = { ...output, ...updates };
    for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
    onUpdate({ output: next as AgentStage['output'] });
  };

  return (
    <CollapsibleSection
      title="Output"
      icon={<CheckCircle2 className="h-3.5 w-3.5" />}
      defaultOpen={false}
      badge={output.rules.length ? String(output.rules.length) : undefined}
    >
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground">Format</label>
        <Select
          aria-label="Output format"
          value={output.format}
          onChange={(v) => setOutput({ format: v as 'text' | 'json' })}
          options={[
            { value: 'text', label: 'Text', description: 'Free text' },
            { value: 'json', label: 'JSON', description: 'A JSON value, validated against the schema' },
          ]}
        />
      </div>
      <label className="mb-1.5 block text-xs font-medium text-foreground">Extraction</label>
      <Select
        aria-label="Output extraction"
        value={output.extraction}
        onChange={(v) => setOutput({ extraction: v as AgentStage['output']['extraction'] })}
        options={[
          { value: 'auto', label: 'Automatic' },
          { value: 'native', label: 'Native' },
          { value: 'tool', label: 'submit_output tool' },
          { value: 'final_json_block', label: 'Final JSON block' },
        ]}
      />
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Braces className="h-3.5 w-3.5" /> JSON Schema
        </label>
        <JsonObjectEditor
          value={output.schema}
          onChange={(schema) => setOutput({ schema })}
          placeholder={'{\n  "type": "object",\n  "properties": { "verdict": { "type": "string" } }\n}'}
          ariaLabel="Output JSON Schema"
        />
        <FieldIssues issues={issuesAt(issues, '/output/schema', '/output/format')} />
      </div>
      <div>
        <label htmlFor="stage-output-instructions" className="mb-1.5 block text-xs font-medium text-foreground">Instructions</label>
        <Textarea
          id="stage-output-instructions"
          value={output.instructions ?? ''}
          onChange={(e) => setOutput({ instructions: e.target.value || undefined })}
          rows={2}
          className="resize-none"
          placeholder="Describe the expected output; appended to the final prompt"
        />
        <FieldIssues issues={issuesAt(issues, '/output/instructions')} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground">Rules</label>
        <ValidationRuleEditor rules={output.rules} onChange={(rules) => setOutput({ rules })} issues={issues} />
      </div>
    </CollapsibleSection>
  );
}

// ── Inline Hook Editor ──

const HOOK_TYPES = [
  { value: 'script', label: 'Script' },
  { value: 'http', label: 'HTTP Webhook' },
  { value: 'function', label: 'Function' },
] as const;

const FAILURE_POLICIES = [
  { value: 'abort', label: 'Abort stage' },
  { value: 'continue', label: 'Continue' },
  { value: 'skip', label: 'Skip hook' },
] as const;

function phaseLabel(phase: string): string {
  return phase.split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

function HookEditor({
  hooks,
  onChange,
}: {
  hooks: HookDefinition[];
  onChange: (hooks: HookDefinition[]) => void;
}) {
  const addHook = () => {
    const newHook: HookDefinition = {
      id: `hook_${Date.now()}`,
      name: `Hook ${hooks.length + 1}`,
      phase: 'pre_run',
      type: 'script',
      priority: 0,
      enabled: true,
      failurePolicy: 'continue',
      timeoutMs: 30000,
      retries: 0,
      config: { type: 'script', command: '' },
    };
    onChange([...hooks, newHook]);
  };

  const removeHook = (idx: number) => {
    onChange(hooks.filter((_, i) => i !== idx));
  };

  const updateHook = (idx: number, updates: Partial<HookDefinition>) => {
    onChange(hooks.map((h, i) => (i === idx ? { ...h, ...updates } : h)));
  };

  if (hooks.length === 0) {
    return (
      <div className="text-center py-3">
        <p className="text-xs text-muted-foreground mb-2">
          No hooks configured. Add pre/post execution hooks.
        </p>
        <Button
          type="button"
          onClick={addHook}
          variant="ghost"
          size="sm"
          className="h-auto bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
        >
          + Add a hook
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Hooks ({hooks.length})</span>
        <Button
          type="button"
          onClick={addHook}
          variant="ghost"
          size="sm"
          className="h-auto gap-1 bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
        >
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {hooks.map((hook, idx) => {
        const cfg = hook.config;
        return (
        <div key={hook.id} className="rounded-lg border border-border p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <Input
              type="text"
              value={hook.name}
              onChange={(e) => updateHook(idx, { name: e.target.value })}
              aria-label={`Hook ${idx + 1} name`}
              className="flex-1 h-auto rounded border-none bg-transparent px-1 py-0.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center gap-1">
              <ToggleSwitch
                checked={hook.enabled}
                onChange={(checked) => updateHook(idx, { enabled: checked })}
                label=""
              />
              <Button
                type="button"
                onClick={() => removeHook(idx)}
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${hook.name || `hook ${idx + 1}`}`}
                className="h-auto w-auto p-0.5 text-muted-foreground hover:bg-transparent hover:text-danger"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={hook.phase}
              onChange={(v) => updateHook(idx, { phase: v as HookDefinition['phase'] })}
              options={STAGE_HOOK_PHASES.map((p) => ({
                value: p,
                label: phaseLabel(p),
                description: HOOK_PHASE_INFO[p].description,
              }))}
            />
            <Select
              value={hook.type}
              onChange={(v) => {
                const type = v as HookDefinition['type'];
                const config: HookDefinition['config'] = type === 'script'
                  ? { type: 'script', command: '' }
                  : type === 'http'
                    ? { type: 'http', url: '', method: 'POST' }
                    : { type: 'function', handlerName: '', args: {} };
                updateHook(idx, { type, config });
              }}
              options={HOOK_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </div>
          {cfg.type === 'script' && (
            <Input
              type="text"
              value={cfg.command}
              onChange={(e) => updateHook(idx, { config: { ...cfg, command: e.target.value } })}
              className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
              placeholder="Command to run (e.g., ./scripts/lint.sh)"
            />
          )}
          {cfg.type === 'http' && (
            <Input
              type="text"
              value={cfg.url}
              onChange={(e) => updateHook(idx, { config: { ...cfg, url: e.target.value } })}
              className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
              placeholder="Webhook URL (e.g., https://hooks.example.com/notify)"
            />
          )}
          {cfg.type === 'function' && (
            <div className="space-y-1.5">
              <Input
                type="text"
                value={cfg.handlerName ?? ''}
                onChange={(e) => updateHook(idx, { config: { ...cfg, handlerName: e.target.value } })}
                className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
                placeholder="Handler name (e.g., enrichContext, injectRequirements)"
              />
              <Input
                type="text"
                value={JSON.stringify(cfg.args ?? {})}
                onChange={(e) => {
                  try {
                    const args = JSON.parse(e.target.value) as Record<string, unknown>;
                    updateHook(idx, { config: { ...cfg, args } });
                  } catch { /* ignore invalid JSON while typing */ }
                }}
                className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
                placeholder='Args JSON (e.g., {"source": "myHook"})'
              />
            </div>
          )}
          <Select
            value={hook.failurePolicy}
            onChange={(v) => updateHook(idx, { failurePolicy: v as HookDefinition['failurePolicy'] })}
            options={FAILURE_POLICIES.map((p) => ({ value: p.value, label: p.label }))}
          />
        </div>
        );
      })}
    </div>
  );
}

// ── Validation Rule Editor ──

const VALIDATION_RULE_TYPES = [
  { value: 'contains', label: 'Contains', description: 'Output must contain this text' },
  { value: 'not_contains', label: 'Not Contains', description: 'Output must not contain this text' },
  { value: 'min_length', label: 'Min Length', description: 'Output must be at least N characters' },
  { value: 'max_length', label: 'Max Length', description: 'Output must be at most N characters' },
  { value: 'regex', label: 'Regex Match', description: 'Output must match this pattern' },
  { value: 'json_schema', label: 'JSON Schema', description: 'Output must be JSON matching this schema' },
  { value: 'custom_script', label: 'Custom Script', description: 'A command validates the output (exit 0 passes)' },
  { value: 'judge', label: 'Judge', description: 'A model scores the output 0-10 against a rubric; below the threshold the stage repairs' },
] as const;

/** A fresh rule of `type`, keeping the failure message. */
function blankRule(type: ResultValidationRule['type'], message?: string): ResultValidationRule {
  const m = message ? { message } : {};
  switch (type) {
    case 'contains':
    case 'not_contains':
      return { type, value: '', ...m };
    case 'min_length':
    case 'max_length':
      return { type, value: 100, ...m };
    case 'regex':
      return { type, pattern: '', ...m };
    case 'json_schema':
      return { type, schema: { type: 'object' }, ...m };
    case 'custom_script':
      return { type, command: '', args: [], timeoutMs: 60_000, ...m };
    case 'judge':
      return { type, rubric: '', threshold: 7, ...m };
  }
}

function ValidationRuleEditor({
  rules,
  onChange,
  issues,
}: {
  rules: ResultValidationRule[];
  onChange: (rules: ResultValidationRule[]) => void;
  issues: readonly BuilderIssue[];
}) {
  const addRule = () => onChange([...rules, blankRule('contains', `Validation rule ${rules.length + 1}`)]);
  const removeRule = (idx: number) => onChange(rules.filter((_, i) => i !== idx));
  const replaceRule = (idx: number, rule: ResultValidationRule) =>
    onChange(rules.map((r, i) => (i === idx ? rule : r)));

  if (rules.length === 0) {
    return (
      <div className="text-center py-3">
        <p className="text-xs text-muted-foreground mb-2">
          No validation rules. Add rules to verify stage output quality.
        </p>
        <Button
          type="button"
          onClick={addRule}
          variant="ghost"
          size="sm"
          className="h-auto bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
        >
          + Add a validation rule
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Rules ({rules.length})</span>
        <Button
          type="button"
          onClick={addRule}
          variant="ghost"
          size="sm"
          className="h-auto gap-1 bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
        >
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {rules.map((rule, idx) => (
        <div key={idx} className="rounded-lg border border-border p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Rule {idx + 1}</span>
            <Button
              type="button"
              onClick={() => removeRule(idx)}
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove rule ${idx + 1}`}
              className="h-auto w-auto p-0.5 text-muted-foreground hover:bg-transparent hover:text-danger"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Select
            value={rule.type}
            onChange={(v) => replaceRule(idx, blankRule(v as ResultValidationRule['type'], rule.message))}
            options={VALIDATION_RULE_TYPES.map((t) => ({ value: t.value, label: t.label, description: t.description }))}
          />
          {(rule.type === 'contains' || rule.type === 'not_contains') && (
            <Input
              type="text"
              value={rule.value}
              onChange={(e) => replaceRule(idx, { ...rule, value: e.target.value })}
              className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
              placeholder="Text to check for..."
            />
          )}
          {rule.type === 'regex' && (
            <div className="grid grid-cols-[1fr_4rem] gap-2">
              <Input
                type="text"
                value={rule.pattern}
                onChange={(e) => replaceRule(idx, { ...rule, pattern: e.target.value })}
                className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
                // No slashes: the pattern is the regex body (D-26).
                placeholder="e.g., export\s+default"
                aria-label={`Rule ${idx + 1} pattern`}
              />
              <Input
                type="text"
                value={rule.flags ?? ''}
                onChange={(e) => replaceRule(idx, { ...rule, flags: e.target.value || undefined })}
                className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
                placeholder="flags"
                aria-label={`Rule ${idx + 1} flags (i, m, s)`}
              />
            </div>
          )}
          {(rule.type === 'min_length' || rule.type === 'max_length') && (
            <Input
              type="number"
              value={rule.value}
              onChange={(e) => replaceRule(idx, { ...rule, value: parseInt(e.target.value) || 0 })}
              className="h-auto rounded-lg px-2 py-1.5 text-xs"
              placeholder="Character count"
              min={0}
            />
          )}
          {rule.type === 'json_schema' && (
            <JsonObjectEditor
              value={rule.schema}
              onChange={(schema) => replaceRule(idx, { ...rule, schema: schema ?? {} })}
              ariaLabel={`Rule ${idx + 1} JSON Schema`}
            />
          )}
          {rule.type === 'custom_script' && (
            <div className="space-y-1.5">
              <Input
                type="text"
                value={rule.command}
                onChange={(e) => replaceRule(idx, { ...rule, command: e.target.value })}
                className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
                placeholder="Executable (e.g., node)"
                aria-label={`Rule ${idx + 1} command`}
              />
              <ArgsEditor args={rule.args} onChange={(args) => replaceRule(idx, { ...rule, args })} />
              <p className="text-[10px] text-muted-foreground">The output arrives in the STAGE_OUTPUT environment variable.</p>
            </div>
          )}
          {rule.type === 'judge' && (
            <div className="space-y-1.5">
              <Textarea
                value={rule.rubric}
                onChange={(e) => replaceRule(idx, { ...rule, rubric: e.target.value })}
                rows={3}
                className="resize-y text-xs"
                placeholder="What a good output is (the judge scores 0-10 against it)"
                aria-label={`Rule ${idx + 1} rubric`}
              />
              <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={rule.threshold}
                  onChange={(e) => replaceRule(idx, { ...rule, threshold: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                  className="h-auto rounded-lg px-2 py-1.5 text-xs"
                  aria-label={`Rule ${idx + 1} threshold`}
                />
                <Input
                  type="text"
                  value={rule.model ?? ''}
                  onChange={(e) => replaceRule(idx, { ...rule, model: e.target.value || undefined })}
                  className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
                  placeholder="Judge model (default: the stage's)"
                  aria-label={`Rule ${idx + 1} judge model`}
                />
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-foreground">
                <Checkbox
                  checked={rule.include?.includes('diff') ?? false}
                  onCheckedChange={(next) => replaceRule(idx, { ...rule, include: next === true ? ['diff'] : undefined })}
                  className="h-3.5 w-3.5"
                />
                Show the judge the working-tree diff
              </label>
            </div>
          )}
          <Input
            type="text"
            value={rule.message ?? ''}
            onChange={(e) => replaceRule(idx, { ...rule, message: e.target.value || undefined })}
            className="h-auto rounded-lg px-2 py-1.5 text-xs"
            placeholder="Failure message shown on validation failure"
          />
          <FieldIssues issues={issuesAt(issues, `/output/rules/${idx}`)} />
        </div>
      ))}
      <p className="text-[10px] text-muted-foreground">
        Rules are evaluated after stage completion. If any fail and retries are configured, the stage will retry with feedback.
      </p>
    </div>
  );
}

// ── Edge editor ──

function EdgePropertiesPanel({ edgeId, onClose }: { edgeId: string; onClose: () => void }) {
  const edge = useWorkflowBuilderStore((s) => s.edges.find((e) => e.id === edgeId)?.data?.edge);
  const names = useWorkflowBuilderStore((s) => s.nodes);
  const allIssues = useWorkflowBuilderStore((s) => s.issues);
  const updateEdge = useWorkflowBuilderStore((s) => s.updateEdge);
  const issues = useMemo(() => allIssues.filter((i) => i.edgeId === edgeId), [allIssues, edgeId]);
  if (!edge) return null;
  const nameOf = (key: string) => names.find((n) => n.id === key)?.data.stage.name ?? key;
  const update = (updates: Partial<EdgeSpec>) => updateEdge(edgeId, updates);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {nameOf(edge.from)} → {nameOf(edge.to)}
          </h3>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{edge.from} → {edge.to}</p>
        </div>
        <Button
          onClick={onClose}
          aria-label="Close properties panel"
          variant="ghost"
          size="icon-sm"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-subtle hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Runs when the source</label>
          <Select
            aria-label="Edge condition"
            value={edge.on}
            onChange={(v) => update({ on: v as EdgeOn })}
            options={EDGE_ON_VALUES.map((on) => ({ value: on, label: EDGE_TYPE_LABELS[on], description: EDGE_TYPE_HINTS[on] }))}
          />
        </div>
        <div>
          <label htmlFor="edge-when" className="mb-1.5 block text-xs font-medium text-foreground">When</label>
          <ExpressionField
            id="edge-when"
            expect="boolean"
            value={edge.when ?? ''}
            onChange={(v) => update({ when: v.trim() ? v : undefined })}
            placeholder="e.g. parent.status == 'completed' and variables.env == 'prod'"
            issues={issuesAt(issues, '/when')}
            ariaLabel="Edge when expression"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">Optional. False makes the edge inactive.</p>
        </div>
        <ToggleSwitch
          checked={edge.handlesFailure === true}
          onChange={(checked) => update({ handlesFailure: checked || undefined })}
          label="Handles failure"
          description="A completion or always edge counts as handling a failure of the source."
        />
        <FieldIssues issues={issues.filter((i) => !(i.field ?? '').startsWith('/when'))} />
      </div>
    </div>
  );
}
