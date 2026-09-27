// ────────────────────────────────────────────────────────────────
// Hooks tab: workflow-level hooks (`workflow.hooks`) — each runs at a phase
// of the run lifecycle (run start, before/after git operations, completion
// …) as a script, an HTTP webhook or a registered function, with a failure
// policy. They can inject variables, abort the run or notify other systems.
// ────────────────────────────────────────────────────────────────

import { WORKFLOW_HOOK_PHASES, HOOK_PHASE_INFO, type WorkflowHookDefinition } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { FieldIssues } from '../fields/FieldIssues.js';
import { InspectorNote, InspectorRow, InspectorSection } from '../fields/InspectorLayout.js';
import { JsonObjectEditor } from '../fields/stageFields.js';

const PHASE_ITEMS = WORKFLOW_HOOK_PHASES.map((phase) => ({
  value: phase,
  label: phase
    .split('_')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' '),
  meta: HOOK_PHASE_INFO[phase].description,
}));

const TYPE_ITEMS = [
  { value: 'script', label: 'Script' },
  { value: 'http', label: 'HTTP webhook' },
  { value: 'function', label: 'Function' },
];

const FAILURE_ITEMS = [
  { value: 'abort', label: 'Abort workflow' },
  { value: 'continue', label: 'Continue' },
  { value: 'skip', label: 'Skip hook' },
];

function blankConfig(type: WorkflowHookDefinition['type']): WorkflowHookDefinition['config'] {
  if (type === 'script') return { type: 'script', command: '' };
  if (type === 'http') return { type: 'http', url: '', method: 'POST' };
  return { type: 'function', handlerName: '', args: {} };
}

export function HooksTab() {
  const hooks = useWorkflowBuilderStore((s) => s.workflow.hooks);
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const updateWorkflow = useWorkflowBuilderStore((s) => s.updateWorkflow);
  const setHooks = (next: WorkflowHookDefinition[]) => updateWorkflow({ hooks: next });

  const addHook = () =>
    setHooks([
      ...hooks,
      {
        id: `wh_${Date.now()}`,
        name: `Workflow hook ${hooks.length + 1}`,
        phase: 'on_run_start',
        type: 'script',
        priority: hooks.length,
        enabled: true,
        failurePolicy: 'continue',
        timeoutMs: 30000,
        retries: 0,
        config: { type: 'script', command: '' },
      },
    ]);
  const removeHook = (idx: number) => setHooks(hooks.filter((_, i) => i !== idx));
  const updateHook = (idx: number, updates: Partial<WorkflowHookDefinition>) =>
    setHooks(hooks.map((h, i) => (i === idx ? { ...h, ...updates } : h)));

  return (
    <InspectorSection
      title="Workflow hooks"
      count={hooks.length || undefined}
      action={
        hooks.length > 0 ? (
          <Button size="sm" icon="plus" onClick={addHook}>
            Add hook
          </Button>
        ) : undefined
      }
    >
      <InspectorNote>
        Workflow-level hooks run at key points of the whole run (before and after git operations, on completion …). They can
        inject variables, abort the run or trigger external systems.
      </InspectorNote>

      {hooks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line px-4 py-5 text-center">
          <p className="text-small text-fg-3">No workflow-level hooks configured.</p>
          <Button size="sm" variant="primary" icon="plus" onClick={addHook}>
            Add a workflow hook
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {hooks.map((hook, idx) => {
            const cfg = hook.config;
            const title = hook.name || `hook ${idx + 1}`;
            return (
              <li key={hook.id} className="flex flex-col gap-2 rounded-card border border-line-soft p-2.5" data-testid="workflow-hook">
                <div className="flex items-center gap-1.5">
                  <Input
                    size="sm"
                    value={hook.name}
                    onChange={(e) => updateHook(idx, { name: e.target.value })}
                    aria-label={`Hook ${idx + 1} name`}
                    className="flex-1"
                  />
                  <Switch checked={hook.enabled} onCheckedChange={(enabled) => updateHook(idx, { enabled })} aria-label={`Enable ${title}`} />
                  <IconButton icon="trash" size="sm" label={`Remove ${title}`} onClick={() => removeHook(idx)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    size="sm"
                    aria-label={`${title} phase`}
                    value={hook.phase}
                    onValueChange={(v) => v && updateHook(idx, { phase: v as WorkflowHookDefinition['phase'] })}
                    items={PHASE_ITEMS}
                  />
                  <Select
                    size="sm"
                    aria-label={`${title} type`}
                    value={hook.type}
                    onValueChange={(v) => {
                      if (!v) return;
                      const type = v as WorkflowHookDefinition['type'];
                      updateHook(idx, { type, config: blankConfig(type) });
                    }}
                    items={TYPE_ITEMS}
                  />
                </div>
                {cfg.type === 'script' ? (
                  <Input
                    size="sm"
                    mono
                    value={cfg.command}
                    onChange={(e) => updateHook(idx, { config: { ...cfg, command: e.target.value } })}
                    placeholder="Command to run (e.g. ./scripts/pre-commit-lint.sh)"
                    aria-label={`${title} command`}
                  />
                ) : null}
                {cfg.type === 'http' ? (
                  <Input
                    size="sm"
                    mono
                    value={cfg.url}
                    onChange={(e) => updateHook(idx, { config: { ...cfg, url: e.target.value } })}
                    placeholder="Webhook URL (e.g. https://hooks.slack.com/…)"
                    aria-label={`${title} URL`}
                  />
                ) : null}
                {cfg.type === 'function' ? (
                  <>
                    <Input
                      size="sm"
                      mono
                      value={cfg.handlerName ?? ''}
                      onChange={(e) => updateHook(idx, { config: { ...cfg, handlerName: e.target.value } })}
                      placeholder="Handler name (e.g. injectRequirements, logCompletion)"
                      aria-label={`${title} handler`}
                    />
                    <JsonObjectEditor
                      value={cfg.args}
                      onChange={(args) => updateHook(idx, { config: { ...cfg, args: args ?? {} } })}
                      placeholder={'Args JSON, e.g. {"project": "my-api"}'}
                      ariaLabel={`${title} args`}
                      rows={3}
                    />
                  </>
                ) : null}
                <InspectorRow label="On failure">
                  <Select
                    size="sm"
                    aria-label={`${title} failure policy`}
                    value={hook.failurePolicy}
                    onValueChange={(v) => v && updateHook(idx, { failurePolicy: v as WorkflowHookDefinition['failurePolicy'] })}
                    items={FAILURE_ITEMS}
                  />
                </InspectorRow>
                <FieldIssues issues={issues.filter((i) => i.path.startsWith(`/workflow/hooks/${idx}/`))} />
              </li>
            );
          })}
        </ul>
      )}
    </InspectorSection>
  );
}
