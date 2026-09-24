// ────────────────────────────────────────────────────────────────
// StagePropertiesPanel — Modern right sidebar for editing a stage
// Collapsible accordion sections, sub-tabs for prompts/files/agent,
// MCP server selector, tabbed header
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import { X, Settings2, FileText, Layers, Cpu, Zap, Variable, Shield, Bot, Server, Wand2, Webhook, Link2, Plus, Trash2, Brain, CheckCircle2 } from 'lucide-react';
import type {
  StageDefinition,
  StageCondition,
  PromptDefinition,
  HarnessConfig,
  ContextFilter,
  HookDefinition,
  ResultValidationRule,
} from '@generatorai/shared';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { PromptEditor } from './PromptEditor.js';
import { McpServerSelector } from './McpServerSelector.js';
import { SkillSelector } from './SkillSelector.js';
import { AgentBindingSection } from './AgentBindingSection.js';
import { NumberStepper } from './NumberStepper.js';
import { CollapsibleSection } from './CollapsibleSection.js';
import { Button, Input, Select, Textarea, ToggleSwitch } from '@/components/ui/index.js';
import { useTemplates } from '@/hooks/queries.js';
import { ModelPicker } from '@/components/shared/ModelPicker.js';
import { cn } from '@/lib/utils.js';

interface StagePropertiesPanelProps {
  onClose: () => void;
}

type PanelTab = 'properties' | 'execution';

export function StagePropertiesPanel({ onClose }: StagePropertiesPanelProps) {
  const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId);
  const stage = useWorkflowBuilderStore((s) => {
    const node = s.nodes.find((n) => n.id === s.selectedNodeId);
    return node?.data?.stage as StageDefinition | undefined;
  });
  const updateStage = useWorkflowBuilderStore((s) => s.updateStage);
  const [activeTab, setActiveTab] = useState<PanelTab>('properties');

  const { data: templates } = useTemplates();

  const handleUpdate = useCallback(
    (updates: Partial<StageDefinition>) => {
      if (!selectedNodeId) return;
      updateStage(selectedNodeId, updates);
    },
    [selectedNodeId, updateStage],
  );

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

  // Build select options
  const templateOptions = [
    { value: '', label: 'No template', description: 'Use custom prompts' },
    ...(templates?.map((t) => ({ value: t.id, label: t.name, description: t.description })) ?? []),
  ];

  const conditionOptions = [
    { value: 'always', label: 'Always run' },
    { value: 'on_success', label: 'On upstream success' },
    { value: 'on_failure', label: 'On upstream failure' },
    { value: 'expression', label: 'Custom expression' },
  ];

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
              <p className="truncate text-[11px] text-muted-foreground">
                {stage.templateId ?? 'Custom stage'}
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

      {/* Scrollable form body */}
      <div className="flex-1 overflow-y-auto" role="tabpanel" id={`tabpanel-${activeTab}`}>
        {activeTab === 'properties' ? (
          <PropertiesTab stage={stage} onUpdate={handleUpdate} templateOptions={templateOptions} />
        ) : (
          <ExecutionTab stage={stage} onUpdate={handleUpdate} conditionOptions={conditionOptions} />
        )}
      </div>
    </div>
  );
}

// ── Prompt/Context sub-tab type ──
type PromptSubTab = 'inline' | 'agent';

function PropertiesTab({
  stage,
  onUpdate,
  templateOptions,
}: {
  stage: StageDefinition;
  onUpdate: (updates: Partial<StageDefinition>) => void;
  templateOptions: { value: string; label: string; description?: string }[];
}) {
  const [promptSubTab, setPromptSubTab] = useState<PromptSubTab>('inline');

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
        </div>
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
      </CollapsibleSection>

      {/* Template & Model */}
      <CollapsibleSection title="Model & Template" icon={<Cpu className="h-3.5 w-3.5" />} defaultOpen>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Template</label>
          <Select
            aria-label="Template"
            value={stage.templateId ?? ''}
            onChange={(v) => onUpdate({ templateId: v || undefined })}
            options={templateOptions}
            placeholder="Select a template..."
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Model Override</label>
          <ModelPicker
            value={stage.harnessConfigOverrides?.model ?? ''}
            onChange={(v) => {
              const model = v || undefined;
              onUpdate({
                harnessConfigOverrides: model
                  ? { ...stage.harnessConfigOverrides, model }
                  : stage.harnessConfigOverrides
                    ? (() => {
                        const { model: _m, ...rest } = stage.harnessConfigOverrides as HarnessConfig;
                        return Object.keys(rest).length ? rest : undefined;
                      })()
                    : undefined,
              });
            }}
            allowEmpty
            emptyLabel="Workflow default"
            emptyDescription="Inherit from workflow settings"
            placeholder="Select a model…"
            ariaLabel="Stage model override"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Reasoning Effort</label>
          <Select
            aria-label="Reasoning Effort"
            value={stage.harnessConfigOverrides?.reasoningEffort ?? ''}
            onChange={(v) => {
              const effort = v || undefined;
              onUpdate({
                harnessConfigOverrides: {
                  ...stage.harnessConfigOverrides,
                  reasoningEffort: effort as HarnessConfig['reasoningEffort'],
                },
              });
            }}
            options={[
              { value: '', label: 'Default' },
              { value: 'low', label: 'Low', description: 'Faster, less thorough' },
              { value: 'medium', label: 'Medium', description: 'Balanced' },
              { value: 'high', label: 'High', description: 'More thorough reasoning' },
              { value: 'xhigh', label: 'Extra High', description: 'Maximum reasoning depth' },
            ]}
            placeholder="Default"
          />
        </div>
      </CollapsibleSection>

      {/* Prompts & Context - with sub-tabs */}
      <CollapsibleSection
        title="Prompts & Context"
        icon={<FileText className="h-3.5 w-3.5" />}
        badge={String(stage.prompts?.length ?? 0)}
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
          <PromptEditor
            prompts={stage.prompts ?? []}
            onChange={(prompts: PromptDefinition[]) => onUpdate({ prompts })}
            contentLabel="Prompt"
          />
        )}
        {promptSubTab === 'agent' && (
          <AgentBindingSection stage={stage} onUpdate={onUpdate} />
        )}
      </CollapsibleSection>

      {/* Skills */}
      <CollapsibleSection title="Skills" icon={<Wand2 className="h-3.5 w-3.5" />} defaultOpen={false}>
        <SkillSelector stage={stage} onUpdate={onUpdate} />
      </CollapsibleSection>

      {/* MCP Servers */}
      <CollapsibleSection title="MCP Servers" icon={<Server className="h-3.5 w-3.5" />} defaultOpen={false}>
        <McpServerSelector stage={stage} onUpdate={onUpdate} />
      </CollapsibleSection>

      {/* Variables */}
      <CollapsibleSection title="Variables" icon={<Variable className="h-3.5 w-3.5" />} defaultOpen={false}>
        <VariableEditor
          variables={stage.variables ?? {}}
          onChange={(variables) => onUpdate({ variables })}
        />
      </CollapsibleSection>
    </div>
  );
}

// ── Execution Tab ──

function ExecutionTab({
  stage,
  onUpdate,
  conditionOptions,
}: {
  stage: StageDefinition;
  onUpdate: (updates: Partial<StageDefinition>) => void;
  conditionOptions: { value: string; label: string }[];
}) {
  return (
    <div>
      <CollapsibleSection title="Execution" icon={<Zap className="h-3.5 w-3.5" />} defaultOpen>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Run Condition</label>
          <Select
            aria-label="Run Condition"
            value={stage.condition?.type ?? 'always'}
            onChange={(v) => {
              const type = v as StageCondition['type'];
              onUpdate({
                condition: type === 'expression'
                  ? { type, expression: stage.condition?.expression ?? '' }
                  : { type },
              });
            }}
            options={conditionOptions}
          />
          {stage.condition?.type === 'expression' && (
            <Input
              value={stage.condition.expression ?? ''}
              onChange={(e) =>
                onUpdate({ condition: { type: 'expression', expression: e.target.value } })
              }
              className="mt-2 font-mono"
              // The evaluator understands `status`/`parentStatus`,
              // `variables.<path>`, `== != < <= > >=` and AND/OR/NOT — it has
              // no `stages.` scope and no `===`. An unparseable expression
              // fails safe to false, so advertising unsupported syntax here
              // produced stages that silently never ran.
              placeholder="e.g. status == 'completed' AND variables.env == 'prod'"
            />
          )}
        </div>
        <NumberStepper
          label="Timeout (seconds)"
          value={stage.timeoutMs ? stage.timeoutMs / 1000 : 0}
          onChange={(v) => onUpdate({ timeoutMs: v > 0 ? v * 1000 : undefined })}
          min={0}
          max={3600}
          step={30}
          unit="sec"
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Context from Predecessors</label>
          <Select
            aria-label="Context from Predecessors"
            value={stage.contextFilter ?? 'summary-only'}
            onChange={(v) => onUpdate({ contextFilter: (v || 'summary-only') as ContextFilter })}
            options={[
              { value: 'summary-only', label: 'Summary only (default)', description: 'Inject predecessor summaries as context' },
              { value: 'full', label: 'Full context', description: 'Send complete predecessor output' },
              { value: 'none', label: 'No context', description: 'Stage starts with a clean slate' },
            ]}
          />
        </div>
        <div className="pt-1">
          <ToggleSwitch
            checked={stage.approvalRequired === true}
            onChange={(checked) => onUpdate({ approvalRequired: checked })}
            label="Approval required"
            description="Pause after this stage completes and wait for a human to approve or send feedback before the next stage runs."
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Retry Policy" icon={<Shield className="h-3.5 w-3.5" />} defaultOpen={false}>
        <ToggleSwitch
          checked={!!stage.retryPolicy}
          onChange={(checked) =>
            onUpdate({
              retryPolicy: checked
                ? { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 }
                : undefined,
            })
          }
          label="Retry on failure"
          description="Automatically retry this stage if it fails"
        />
        {stage.retryPolicy && (
          <div className="mt-3 space-y-3">
            <NumberStepper
              label="Max Retries"
              value={stage.retryPolicy.maxRetries}
              onChange={(v) =>
                onUpdate({ retryPolicy: { ...stage.retryPolicy!, maxRetries: v } })
              }
              min={1}
              max={10}
              step={1}
            />
            <NumberStepper
              label="Backoff (ms)"
              value={stage.retryPolicy.backoffMs}
              onChange={(v) =>
                onUpdate({ retryPolicy: { ...stage.retryPolicy!, backoffMs: v } })
              }
              min={100}
              max={60000}
              step={100}
              unit="ms"
            />
            <NumberStepper
              label="Multiplier"
              value={stage.retryPolicy.backoffMultiplier}
              onChange={(v) =>
                onUpdate({ retryPolicy: { ...stage.retryPolicy!, backoffMultiplier: v } })
              }
              min={1}
              max={10}
              step={0.5}
              unit="x"
            />
          </div>
        )}
      </CollapsibleSection>

      {/* Result Validation */}
      <CollapsibleSection title="Result Validation" icon={<CheckCircle2 className="h-3.5 w-3.5" />} defaultOpen={false} badge={stage.resultValidation?.length ? String(stage.resultValidation.length) : undefined}>
        <ValidationRuleEditor
          rules={stage.resultValidation ?? []}
          onChange={(rules) => onUpdate({ resultValidation: rules.length > 0 ? rules : undefined })}
        />
      </CollapsibleSection>

      {/* Hooks */}
      <CollapsibleSection title="Hooks" icon={<Webhook className="h-3.5 w-3.5" />} defaultOpen={false}>
        <HookEditor hooks={stage.hooks ?? []} onChange={(hooks) => onUpdate({ hooks })} />
      </CollapsibleSection>
    </div>
  );
}

// ── Inline Hook Editor ──

const AVAILABLE_PHASES = [
  { value: 'pre_run', label: 'Pre Run', description: 'Before stage execution' },
  { value: 'post_run', label: 'Post Run', description: 'After stage execution' },
  { value: 'on_error', label: 'On Error', description: 'When stage fails' },
  { value: 'on_cancel', label: 'On Cancel', description: 'When stage is cancelled' },
  { value: 'pre_prompt', label: 'Pre Prompt', description: 'Before each prompt turn' },
  { value: 'post_prompt', label: 'Post Prompt', description: 'After each prompt turn' },
] as const;

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
      {hooks.map((hook, idx) => (
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
              options={AVAILABLE_PHASES.map((p) => ({ value: p.value, label: p.label }))}
            />
            <Select
              value={hook.type}
              onChange={(v) => {
                const type = v as 'script' | 'http' | 'function';
                const config = type === 'script'
                  ? { type: 'script' as const, command: '' }
                  : type === 'http'
                    ? { type: 'http' as const, url: '', method: 'POST' as const }
                    : { type: 'function' as const, handlerName: '', args: {} };
                updateHook(idx, { type, config });
              }}
              options={HOOK_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </div>
          {hook.config.type === 'script' && (
            <Input
              type="text"
              value={(hook.config as { command: string }).command}
              onChange={(e) => updateHook(idx, { config: { type: 'script', command: e.target.value } })}
              className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
              placeholder="Command to run (e.g., ./scripts/lint.sh)"
            />
          )}
          {hook.config.type === 'http' && (
            <Input
              type="text"
              value={(hook.config as { url: string }).url}
              onChange={(e) => updateHook(idx, { config: { type: 'http', url: e.target.value, method: 'POST' } })}
              className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
              placeholder="Webhook URL (e.g., https://hooks.example.com/notify)"
            />
          )}
          {hook.config.type === 'function' && (
            <div className="space-y-1.5">
              <Input
                type="text"
                value={(hook.config as { handlerName?: string }).handlerName ?? ''}
                onChange={(e) => updateHook(idx, { config: { type: 'function', handlerName: e.target.value, args: (hook.config as { args?: Record<string, unknown> }).args } })}
                className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
                placeholder="Handler name (e.g., enrichContext, injectRequirements)"
              />
              <Input
                type="text"
                value={JSON.stringify((hook.config as { args?: Record<string, unknown> }).args ?? {})}
                onChange={(e) => {
                  try {
                    const args = JSON.parse(e.target.value);
                    updateHook(idx, { config: { type: 'function', handlerName: (hook.config as { handlerName?: string }).handlerName, args } });
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
      ))}
    </div>
  );
}

// ── Validation Rule Editor ──

const VALIDATION_RULE_TYPES = [
  { value: 'contains', label: 'Contains', description: 'Output must contain this text' },
  { value: 'not_contains', label: 'Not Contains', description: 'Output must not contain this text' },
  { value: 'min_length', label: 'Min Length', description: 'Output must be at least N characters' },
  { value: 'max_length', label: 'Max Length', description: 'Output must be at most N characters' },
  { value: 'regex', label: 'Regex Match', description: 'Output must match this regex pattern' },
  { value: 'custom_script', label: 'Custom Script', description: 'Run a script to validate output' },
] as const;

function ValidationRuleEditor({
  rules,
  onChange,
}: {
  rules: ResultValidationRule[];
  onChange: (rules: ResultValidationRule[]) => void;
}) {
  const addRule = () => {
    const newRule: ResultValidationRule = {
      type: 'contains',
      value: '',
      message: `Validation rule ${rules.length + 1}`,
    };
    onChange([...rules, newRule]);
  };

  const removeRule = (idx: number) => {
    onChange(rules.filter((_, i) => i !== idx));
  };

  const updateRule = (idx: number, updates: Partial<ResultValidationRule>) => {
    onChange(rules.map((r, i) => (i === idx ? { ...r, ...updates } : r)));
  };

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
            onChange={(v) => {
              const type = v as ResultValidationRule['type'];
              // Reset value for different types
              const defaultValue = type === 'min_length' || type === 'max_length' ? 100 : '';
              updateRule(idx, { type, value: defaultValue });
            }}
            options={VALIDATION_RULE_TYPES.map((t) => ({ value: t.value, label: t.label, description: t.description }))}
          />
          {(rule.type === 'contains' || rule.type === 'not_contains' || rule.type === 'regex') && (
            <Input
              type="text"
              value={String(rule.value ?? '')}
              onChange={(e) => updateRule(idx, { value: e.target.value })}
              className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
              placeholder={rule.type === 'regex' ? 'e.g., /export\\s+default/' : 'Text to check for...'}
            />
          )}
          {(rule.type === 'min_length' || rule.type === 'max_length') && (
            <Input
              type="number"
              value={Number(rule.value ?? 0)}
              onChange={(e) => updateRule(idx, { value: parseInt(e.target.value) || 0 })}
              className="h-auto rounded-lg px-2 py-1.5 text-xs"
              placeholder="Character count"
              min={0}
            />
          )}
          {rule.type === 'custom_script' && (
            <Input
              type="text"
              value={String(rule.value ?? '')}
              onChange={(e) => updateRule(idx, { value: e.target.value })}
              className="h-auto rounded-lg px-2 py-1.5 text-xs font-mono"
              placeholder="Command to run (e.g., npm test, node validate.js)"
            />
          )}
          <Input
            type="text"
            value={rule.message}
            onChange={(e) => updateRule(idx, { message: e.target.value })}
            className="h-auto rounded-lg px-2 py-1.5 text-xs"
            placeholder="Failure message shown on validation failure"
          />
        </div>
      ))}
      <p className="text-[10px] text-muted-foreground">
        Rules are evaluated after stage completion. If any fail and retries are configured, the stage will retry with feedback.
      </p>
    </div>
  );
}

// ── Inline Variable Editor ──

/**
 * One `key = value` row.
 *
 * The name is edited against a local draft rather than straight into the
 * variables map: a half-typed name is not a valid identifier, and committing
 * only valid ones meant the field silently refused every intermediate state.
 * The draft shows what was typed, the map only ever receives a usable name,
 * and an abandoned invalid draft snaps back on blur.
 */
function VariableRow({
  name,
  value,
  isTaken,
  onRename,
  onValueChange,
  onRemove,
}: {
  name: string;
  value: string;
  isTaken: (candidate: string) => boolean;
  onRename: (next: string) => void;
  onValueChange: (next: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(name);
  // Follow renames that came from anywhere else (undo, a loaded definition).
  useEffect(() => setDraft(name), [name]);

  const valid = VARIABLE_NAME.test(draft) && !isTaken(draft);

  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (VARIABLE_NAME.test(next) && !isTaken(next)) onRename(next);
        }}
        onBlur={() => setDraft(name)}
        aria-invalid={!valid || undefined}
        title={
          valid
            ? undefined
            : isTaken(draft)
              ? 'Another variable already uses this name'
              : 'Letters, digits and underscores; cannot start with a digit'
        }
        className={cn(
          'w-1/3 h-auto rounded-lg px-2 py-1.5 text-xs font-mono',
          !valid && 'border-danger text-danger',
        )}
        placeholder="Key"
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="flex-1 h-auto rounded-lg px-2 py-1.5 text-xs"
        placeholder="Value"
      />
      <Button
        type="button"
        onClick={onRemove}
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove variable ${name}`}
        className="rounded-lg p-1 text-muted-foreground hover:bg-danger-muted hover:text-danger transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** A usable `{{placeholder}}` name: an identifier, as the interpolator reads it. */
const VARIABLE_NAME = /^[a-zA-Z_]\w*$/;

function VariableEditor({
  variables,
  onChange,
}: {
  variables: Record<string, unknown>;
  onChange: (vars: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(variables);

  const addVariable = () => {
    const key = `var${entries.length + 1}`;
    onChange({ ...variables, [key]: '' });
  };

  const updateKey = (oldKey: string, newKey: string) => {
    if (newKey === oldKey) return;
    if (!VARIABLE_NAME.test(newKey)) return;
    if (newKey in variables && newKey !== oldKey) return;
    const newVars: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(variables)) {
      newVars[k === oldKey ? newKey : k] = v;
    }
    onChange(newVars);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...variables, [key]: value });
  };

  const removeVariable = (key: string) => {
    const { [key]: _, ...rest } = variables;
    onChange(rest);
  };

  return (
    <div className="space-y-2">
      {entries.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No variables defined</p>
      )}
      {entries.map(([key, value], index) => (
        <VariableRow
          // Position, not the name. Keying by the name made React throw the
          // row away and build a new one on every keystroke of a rename, so
          // the field lost focus after a single character and the name could
          // not be typed at all.
          key={index}
          name={key}
          value={String(value ?? '')}
          isTaken={(candidate) => candidate !== key && candidate in variables}
          onRename={(next) => updateKey(key, next)}
          onValueChange={(next) => updateValue(key, next)}
          onRemove={() => removeVariable(key)}
        />
      ))}
      <Button
        type="button"
        onClick={addVariable}
        variant="ghost"
        size="sm"
        className="h-auto gap-1 bg-transparent p-0 text-xs font-medium text-primary hover:bg-transparent hover:underline"
      >
        + Add variable
      </Button>
    </div>
  );
}
