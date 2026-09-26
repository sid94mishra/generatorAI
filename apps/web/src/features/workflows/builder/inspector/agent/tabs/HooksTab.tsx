// ────────────────────────────────────────────────────────────────
// Hooks tab (WorkflowStageHooks board): the stage's lifecycle hooks —
// enabled, name, phase, type (script · HTTP · function) with its target,
// failure policy — and the workflow's own hooks, read-only here with a link
// to the workflow settings where they are edited.
// ────────────────────────────────────────────────────────────────

import { HOOK_PHASE_INFO, STAGE_HOOK_PHASES, type HookDefinition } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { FieldIssues, issuesAt } from '../../../fields/FieldIssues.js';
import { InspectorNote, InspectorSection } from '../../../fields/InspectorLayout.js';
import { ArgsEditor, JsonObjectEditor } from '../../../fields/stageFields.js';
import { useBuilderInspector } from '../../InspectorShell.js';
import { Row } from '../Row.js';
import type { AgentTabProps } from './tabProps.js';

type HookType = HookDefinition['type'];

const HOOK_TYPES: { value: HookType; label: string }[] = [
  { value: 'script', label: 'Script' },
  { value: 'http', label: 'HTTP' },
  { value: 'function', label: 'Function' },
];

const FAILURE_POLICIES: { value: HookDefinition['failurePolicy']; label: string }[] = [
  { value: 'abort', label: 'Abort stage' },
  { value: 'continue', label: 'Continue' },
  { value: 'skip', label: 'Skip hook' },
];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function phaseLabel(phase: string): string {
  return phase
    .split('_')
    .map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function blankConfig(type: HookType): HookDefinition['config'] {
  return type === 'script'
    ? { type: 'script', command: '' }
    : type === 'http'
      ? { type: 'http', url: '', method: 'POST' }
      : { type: 'function', handlerName: '', args: {} };
}

function HookCard({
  hook,
  n,
  onChange,
  onRemove,
  issues,
}: {
  hook: HookDefinition;
  n: number;
  onChange: (patch: Partial<HookDefinition>) => void;
  onRemove: () => void;
  issues: AgentTabProps['issues'];
}) {
  const cfg = hook.config;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line-soft p-2.5" data-testid="stage-hook">
      <div className="flex items-center gap-2">
        <Switch aria-label={`Hook ${n} enabled`} checked={hook.enabled} onCheckedChange={(enabled) => onChange({ enabled })} />
        <Input size="sm" className="min-w-0 flex-1" value={hook.name} onChange={(e) => onChange({ name: e.target.value })} aria-label={`Hook ${n} name`} />
        <IconButton icon="trash" size="sm" label={`Remove ${hook.name || `hook ${n}`}`} onClick={onRemove} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Phase" stacked>
          <Select
            size="sm"
            aria-label={`Hook ${n} phase`}
            value={hook.phase}
            onValueChange={(v) => v && onChange({ phase: v as HookDefinition['phase'] })}
            items={STAGE_HOOK_PHASES.map((p) => ({ value: p, label: phaseLabel(p) }))}
          />
        </Row>
        <Row label="Type" stacked>
          <SegmentedControl
            label={`Hook ${n} type`}
            value={hook.type}
            onValueChange={(type) => onChange({ type, config: blankConfig(type) })}
            items={HOOK_TYPES}
          />
        </Row>
      </div>
      <InspectorNote>{HOOK_PHASE_INFO[hook.phase].description}.</InspectorNote>
      {cfg.type === 'script' ? (
        <>
          <Input
            mono
            size="sm"
            value={cfg.command}
            onChange={(e) => onChange({ config: { ...cfg, command: e.target.value } })}
            placeholder="Command to run (e.g. ./scripts/lint.sh)"
            aria-label={`Hook ${n} command`}
            spellCheck={false}
          />
          <ArgsEditor
            args={cfg.args ?? []}
            onChange={(args) => onChange({ config: { ...cfg, args: args.length > 0 ? args : undefined } })}
            ariaLabel={`Hook ${n} arguments`}
          />
          <InspectorNote>Command and arguments are literal; templated values go through the environment.</InspectorNote>
        </>
      ) : null}
      {cfg.type === 'http' ? (
        <div className="flex items-center gap-1.5">
          <Select
            size="sm"
            className="w-24"
            aria-label={`Hook ${n} method`}
            value={cfg.method}
            onValueChange={(v) => v && onChange({ config: { ...cfg, method: v as typeof cfg.method } })}
            items={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
          />
          <Input
            mono
            size="sm"
            className="min-w-0 flex-1"
            value={cfg.url}
            onChange={(e) => onChange({ config: { ...cfg, url: e.target.value } })}
            placeholder="Webhook URL (e.g. https://hooks.example.com/notify)"
            aria-label={`Hook ${n} URL`}
            spellCheck={false}
          />
        </div>
      ) : null}
      {cfg.type === 'function' ? (
        <>
          <Input
            mono
            size="sm"
            value={cfg.handlerName ?? ''}
            onChange={(e) => onChange({ config: { ...cfg, handlerName: e.target.value } })}
            placeholder="Handler name (e.g. enrichContext)"
            aria-label={`Hook ${n} handler`}
            spellCheck={false}
          />
          <JsonObjectEditor
            value={cfg.args}
            onChange={(args) => onChange({ config: { ...cfg, args: args ?? {} } })}
            ariaLabel={`Hook ${n} arguments (JSON)`}
            placeholder={'{ "source": "myHook" }'}
            rows={2}
          />
        </>
      ) : null}
      <Row label="On failure">
        <Select
          size="sm"
          aria-label={`Hook ${n} failure policy`}
          value={hook.failurePolicy}
          onValueChange={(v) => v && onChange({ failurePolicy: v as HookDefinition['failurePolicy'] })}
          items={FAILURE_POLICIES}
        />
      </Row>
      <FieldIssues issues={issuesAt(issues, `/hooks/${n - 1}`)} />
    </div>
  );
}

/** The workflow's own hooks (edited in the workflow settings). */
function WorkflowHooksSection() {
  const { openSettings } = useBuilderInspector();
  const hooks = useWorkflowBuilderStore((s) => s.workflow.hooks);
  return (
    <InspectorSection
      title="Workflow hooks"
      count={hooks.length || undefined}
      action={
        <Button variant="ghost" size="sm" trailingIcon="chevron-right" aria-label="Edit workflow hooks" onClick={() => openSettings('hooks')}>
          Workflow settings
        </Button>
      }
      data-testid="workflow-hooks-link"
    >
      {hooks.length === 0 ? (
        <InspectorNote>No workflow hooks. They run for the whole run and are edited in the workflow settings.</InspectorNote>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft rounded-card border border-line-soft">
          {hooks.map((h) => (
            <li key={h.id} className="flex items-center gap-2 px-2.5 py-1.5 text-small">
              <span className="shrink-0 font-mono text-fg">{h.phase}</span>
              <span className="min-w-0 flex-1 truncate text-fg-2">{h.name}</span>
              <span className="shrink-0 text-fg-3">{HOOK_TYPES.find((t) => t.value === h.type)?.label}</span>
            </li>
          ))}
        </ul>
      )}
    </InspectorSection>
  );
}

export function HooksTab({ stage, onUpdate, issues }: AgentTabProps) {
  const hooks = stage.hooks;
  const set = (next: HookDefinition[]) => onUpdate({ hooks: next });
  const add = () =>
    set([
      ...hooks,
      {
        id: `hook_${Date.now()}`,
        name: `Hook ${hooks.length + 1}`,
        phase: 'pre_run',
        type: 'script',
        priority: 0,
        enabled: true,
        failurePolicy: 'continue',
        timeoutMs: 30_000,
        retries: 0,
        config: { type: 'script', command: '' },
      },
    ]);
  return (
    <>
      <InspectorSection
        title="Stage hooks"
        count={hooks.length || undefined}
        action={
          <Button variant="ghost" size="sm" icon="plus" onClick={add}>
            Add hook
          </Button>
        }
        data-testid="stage-hooks"
      >
        <InspectorNote>Script hooks run commands, so they are admin only.</InspectorNote>
        {hooks.length === 0 ? <InspectorNote>No hooks configured. Add pre/post execution hooks.</InspectorNote> : null}
        {hooks.map((hook, idx) => (
          <HookCard
            key={hook.id}
            hook={hook}
            n={idx + 1}
            onChange={(patch) => set(hooks.map((h, i) => (i === idx ? { ...h, ...patch } : h)))}
            onRemove={() => set(hooks.filter((_, i) => i !== idx))}
            issues={issues}
          />
        ))}
        <FieldIssues issues={issues.filter((i) => i.field === '/hooks')} />
      </InspectorSection>
      <WorkflowHooksSection />
    </>
  );
}
