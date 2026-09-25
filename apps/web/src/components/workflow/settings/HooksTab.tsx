// ────────────────────────────────────────────────────────────────
// HooksTab — Workflow-level hooks configuration
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { WORKFLOW_HOOK_PHASES, HOOK_PHASE_INFO, type WorkflowHookDefinition } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { cn } from '@/lib/utils.js';
import { Button, Input, Select, ToggleSwitch } from '@/components/ui/index.js';
import { FieldIssues } from '../engineGate.js';

const WORKFLOW_PHASES = WORKFLOW_HOOK_PHASES.map((phase) => ({
  value: phase,
  label: phase.split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' '),
  description: HOOK_PHASE_INFO[phase].description,
}));

const HOOK_TYPES = [
  { value: 'script', label: 'Script' },
  { value: 'http', label: 'HTTP Webhook' },
  { value: 'function', label: 'Function' },
] as const;

const FAILURE_POLICIES = [
  { value: 'abort', label: 'Abort workflow' },
  { value: 'continue', label: 'Continue' },
  { value: 'skip', label: 'Skip hook' },
] as const;

export function HooksTab() {
  const hooks = useWorkflowBuilderStore((s) => s.workflow.hooks);
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const updateWorkflow = useWorkflowBuilderStore((s) => s.updateWorkflow);
  const setHooks = (next: WorkflowHookDefinition[]) => updateWorkflow({ hooks: next });

  const addHook = () => {
    const newHook: WorkflowHookDefinition = {
      id: `wh_${Date.now()}`,
      name: `Workflow Hook ${hooks.length + 1}`,
      phase: 'on_run_start',
      type: 'script',
      priority: hooks.length,
      enabled: true,
      failurePolicy: 'continue',
      timeoutMs: 30000,
      retries: 0,
      config: { type: 'script', command: '' },
    };
    setHooks([...hooks, newHook]);
  };

  const removeHook = (idx: number) => {
    setHooks(hooks.filter((_, i) => i !== idx));
  };

  const updateHook = (idx: number, updates: Partial<WorkflowHookDefinition>) => {
    setHooks(hooks.map((h, i) => (i === idx ? { ...h, ...updates } : h)));
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-4">
          Workflow-level hooks run at key lifecycle points of the entire workflow (before/after git operations, on completion, etc.). They can inject variables, abort the run, or trigger external systems.
        </p>
      </div>

      {hooks.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-border rounded-lg">
          <p className="text-sm text-muted-foreground mb-3">
            No workflow-level hooks configured.
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={addHook}
            leftIcon={<Plus className="h-3 w-3" />}
            className="rounded-lg"
          >
            Add a workflow hook
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              Hooks ({hooks.length})
            </span>
            <Button
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
            <div key={hook.id} className="rounded-lg border border-border p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <Input
                  type="text"
                  value={hook.name}
                  onChange={(e) => updateHook(idx, { name: e.target.value })}
                  aria-label={`Hook ${idx + 1} name`}
                  className="flex-1 h-auto rounded border-none bg-transparent px-1 py-0.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex items-center gap-2">
                  <ToggleSwitch
                    checked={hook.enabled}
                    onChange={(checked) => updateHook(idx, { enabled: checked })}
                    label=""
                  />
                  <Button
                    onClick={() => removeHook(idx)}
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${hook.name || `hook ${idx + 1}`}`}
                    className="h-auto w-auto p-1 text-muted-foreground hover:bg-transparent hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={hook.phase}
                  onChange={(v) => updateHook(idx, { phase: v as WorkflowHookDefinition['phase'] })}
                  options={WORKFLOW_PHASES}
                />
                <Select
                  value={hook.type}
                  onChange={(v) => {
                    const type = v as WorkflowHookDefinition['type'];
                    const config: WorkflowHookDefinition['config'] = type === 'script'
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
                  className="h-auto rounded-lg px-2.5 py-2 text-xs font-mono"
                  placeholder="Command to run (e.g., ./scripts/pre-commit-lint.sh)"
                />
              )}
              {cfg.type === 'http' && (
                <Input
                  type="text"
                  value={cfg.url}
                  onChange={(e) => updateHook(idx, { config: { ...cfg, url: e.target.value } })}
                  className="h-auto rounded-lg px-2.5 py-2 text-xs font-mono"
                  placeholder="Webhook URL (e.g., https://hooks.slack.com/...)"
                />
              )}
              {cfg.type === 'function' && (
                <div className="space-y-1.5">
                  <Input
                    type="text"
                    value={cfg.handlerName ?? ''}
                    onChange={(e) => updateHook(idx, { config: { ...cfg, handlerName: e.target.value } })}
                    className="h-auto rounded-lg px-2.5 py-2 text-xs font-mono"
                    placeholder="Handler name (e.g., injectRequirements, logCompletion)"
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
                    className="h-auto rounded-lg px-2.5 py-2 text-xs font-mono"
                    placeholder='Args JSON (e.g., {"project": "my-api"})'
                  />
                </div>
              )}

              <Select
                value={hook.failurePolicy}
                onChange={(v) => updateHook(idx, { failurePolicy: v as WorkflowHookDefinition['failurePolicy'] })}
                options={FAILURE_POLICIES.map((p) => ({ value: p.value, label: p.label }))}
              />
              <FieldIssues issues={issues.filter((i) => i.path.startsWith(`/workflow/hooks/${idx}/`))} />
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
