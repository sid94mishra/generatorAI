// ────────────────────────────────────────────────────────────────
// CreateAutomationPage — Form to configure a new automation
// ────────────────────────────────────────────────────────────────

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateAutomation } from '@/hooks/automationQueries.js';
import { useWorkflowDefinitions } from '@/hooks/workflowQueries.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { ArrowLeft, Plus, X, Clock, Webhook, Hand, AlertCircle, FolderGit2 } from 'lucide-react';
import { Select, Button, Input, Textarea, Spinner, PageHeader } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';
import { cn } from '@/lib/utils.js';
import type { CreateAutomationParams, AutomationTriggerType } from '@generatorai/shared';
import { WebhookCredentialsDialog, type WebhookCredentials } from '@/components/automation/WebhookCredentialsDialog.js';

export function CreateAutomationPage() {
  const navigate = useNavigate();
  const createMutation = useCreateAutomation();
  const { data: workflows, isLoading: workflowsLoading } = useWorkflowDefinitions();
  const { data: projects } = useProjects();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('manual');
  const [cronExpression, setCronExpression] = useState('0 9 * * *');
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([]);
  const [variablesText, setVariablesText] = useState('{}');
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [onError, setOnError] = useState<'continue' | 'stop'>('continue');
  const [error, setError] = useState<string | null>(null);
  // Item A5 — one-time reveal of the webhook token + signing secret after
  // a webhook automation is created. Navigation to the detail page is held
  // until the dialog is dismissed, since this is the only moment either
  // value is ever visible again.
  const [webhookCredentials, setWebhookCredentials] = useState<WebhookCredentials | null>(null);
  const [createdAutomationId, setCreatedAutomationId] = useState<string | null>(null);
  // ── Track C — schema-driven pipeline (optional, advanced) ──
  const [schemaEnabled, setSchemaEnabled] = useState(false);
  const [dataSchemaText, setDataSchemaText] = useState(
    JSON.stringify(
      {
        version: 1,
        format: 'json_array',
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'priority', type: 'string' },
        ],
      },
      null,
      2,
    ),
  );
  const [iterationModeKind, setIterationModeKind] = useState<'each_row' | 'group_by' | 'single'>('each_row');
  const [groupByFieldsText, setGroupByFieldsText] = useState('');
  const [groupVariable, setGroupVariable] = useState('items');
  const [defaultDatasetFormat, setDefaultDatasetFormat] = useState<'json_array' | 'csv' | 'jsonl'>('json_array');
  const [defaultDatasetText, setDefaultDatasetText] = useState('');
  // ── Track A — retry policy (optional) ──
  const [retryEnabled, setRetryEnabled] = useState(false);
  const [retryMaxAttempts, setRetryMaxAttempts] = useState(3);
  const [retryInitialBackoffMs, setRetryInitialBackoffMs] = useState(1000);
  const [retryBackoffMultiplier, setRetryBackoffMultiplier] = useState(2);
  const [retryMaxBackoffMs, setRetryMaxBackoffMs] = useState(60_000);
  const [retryOnFailed, setRetryOnFailed] = useState(true);
  const [retryOnTimeout, setRetryOnTimeout] = useState(true);
  const [retryOnNetwork, setRetryOnNetwork] = useState(true);

  // Filter workflows by selected project (if any)
  const filteredWorkflows = useMemo(() => {
    if (!workflows) return [];
    if (!selectedProjectId) return workflows;
    return workflows.filter((w) => w.projectId === selectedProjectId || !w.projectId);
  }, [workflows, selectedProjectId]);

  const handleAddWorkflow = (id: string) => {
    if (!selectedWorkflowIds.includes(id)) {
      setSelectedWorkflowIds([...selectedWorkflowIds, id]);
    }
  };

  const handleRemoveWorkflow = (id: string) => {
    setSelectedWorkflowIds(selectedWorkflowIds.filter((wid) => wid !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) { setError('Name is required'); return; }
    if (selectedWorkflowIds.length === 0) { setError('Select at least one workflow'); return; }
    if (triggerType === 'schedule' && !cronExpression.trim()) { setError('Cron expression is required for schedule triggers'); return; }

    let variables: Record<string, unknown> = {};
    try {
      variables = JSON.parse(variablesText);
    } catch {
      setError('Variables must be valid JSON');
      return;
    }

    const params: CreateAutomationParams = {
      name: name.trim(),
      description: description.trim() || undefined,
      triggerType,
      cronExpression: triggerType === 'schedule' ? cronExpression.trim() : undefined,
      workflowIds: selectedWorkflowIds,
      variables,
      maxConcurrency,
      onError,
      projectId: selectedProjectId || undefined,
    };

    // ── Track C — schema-driven pipeline ──
    if (schemaEnabled) {
      try {
        params.dataSchema = JSON.parse(dataSchemaText);
      } catch (err) {
        setError(`Invalid data schema JSON: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (iterationModeKind === 'each_row') {
        params.iterationMode = { kind: 'each_row' };
      } else if (iterationModeKind === 'group_by') {
        const fields = groupByFieldsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (fields.length === 0) {
          setError('group_by mode requires at least one field');
          return;
        }
        params.iterationMode = {
          kind: 'group_by',
          fields,
          groupVariable: groupVariable.trim() || undefined,
        };
      } else {
        params.iterationMode = {
          kind: 'single',
          datasetVariable: groupVariable.trim() || undefined,
        };
      }
      if (defaultDatasetText.trim()) {
        params.defaultDataset = {
          format: defaultDatasetFormat,
          data: defaultDatasetText,
        };
      }
    }

    // ── Track A — retry policy ──
    if (retryEnabled && retryMaxAttempts > 1) {
      const retryOn: Array<'timeout' | 'network' | 'workflow_failed'> = [];
      if (retryOnFailed) retryOn.push('workflow_failed');
      if (retryOnTimeout) retryOn.push('timeout');
      if (retryOnNetwork) retryOn.push('network');
      if (retryOn.length > 0) {
        params.retryPolicy = {
          maxAttempts: retryMaxAttempts,
          initialBackoffMs: Math.max(100, retryInitialBackoffMs),
          backoffMultiplier: Math.max(1, retryBackoffMultiplier),
          maxBackoffMs: Math.max(1000, retryMaxBackoffMs),
          retryOn,
        };
      } else {
        setError('Retry policy must have at least one error class selected');
        return;
      }
    } else if (retryEnabled && retryMaxAttempts <= 1) {
      setError('Retry policy requires maxAttempts ≥ 2 (leave it off if you don\'t want retries)');
      return;
    }

    try {
      const automation = await createMutation.mutateAsync(params);
      // The server shows the raw webhook token + signing secret ONLY in this
      // create response — never again on any GET/list/update. If we don't
      // capture it here, the user can never see it (short of rotating).
      const created = automation as typeof automation & { webhookSigningSecret?: string };
      if (created.triggerType === 'webhook' && created.webhookToken) {
        setWebhookCredentials({
          webhookUrl: `${window.location.origin}/api/automations/webhooks/${created.webhookToken}`,
          token: created.webhookToken,
          signingSecret: created.webhookSigningSecret,
        });
        setCreatedAutomationId(automation.id);
        return;
      }
      navigate(`/automations/${automation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <PageContainer variant="narrow" className="max-w-3xl">
      {/* Same primitive and styling as the other create pages' back link. */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => navigate('/automations')}
        className="mb-6 flex h-auto items-center gap-1.5 rounded-none px-0 py-0.5 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Automations
      </Button>

      <PageHeader className="mb-8" title="Create Automation" />

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-danger-muted p-4 text-sm text-danger">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Name & Description */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Basic Info</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="automation-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">Name *</label>
              <Input id="automation-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Automation"
              />
            </div>
            <div>
              <label htmlFor="automation-description" className="mb-1.5 block text-xs font-medium text-muted-foreground">Description</label>
              <Textarea id="automation-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional description..."
              />
            </div>
          </div>
        </div>

        {/* Trigger Type */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Trigger</h2>
          <div className="grid grid-cols-3 gap-3">
            {([
              { type: 'manual' as const, icon: Hand, label: 'Manual', desc: 'Trigger by clicking Run' },
              { type: 'schedule' as const, icon: Clock, label: 'Schedule', desc: 'Run on a cron schedule' },
              { type: 'webhook' as const, icon: Webhook, label: 'Webhook', desc: 'Trigger via HTTP POST' },
            ]).map(({ type, icon: Icon, label, desc }) => (
              <Button variant="ghost"
                key={type}
                type="button"
                onClick={() => setTriggerType(type)}
                // Selection cards: without this they all announce identically
                // and nothing says which one is chosen.
                aria-pressed={triggerType === type}
                className={cn(
                  'h-auto whitespace-normal flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
                  triggerType === type
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground',
                )}
              >
                <Icon className={cn('h-5 w-5', triggerType === type ? 'text-primary' : 'text-muted-foreground')} />
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="text-[11px] text-muted-foreground">{desc}</span>
              </Button>
            ))}
          </div>

          {triggerType === 'schedule' && (
            <div className="mt-4">
              <label htmlFor="automation-cron-expression" className="mb-1.5 block text-xs font-medium text-muted-foreground">Cron Expression *</label>
              <Input id="automation-cron-expression"
                type="text"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                className="font-mono"
                placeholder="0 9 * * *"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Format: minute hour day month weekday. Example: "0 9 * * *" = daily at 9 AM
              </p>
            </div>
          )}
        </div>

        {/* Project Scope */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground flex items-center gap-2">
            <FolderGit2 className="h-4 w-4 text-primary" />
            Project Scope
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Select a project to scope the automation. Only workflows from this project will be available.
          </p>
          <Select
            aria-label="Project scope"
            value={selectedProjectId}
            onChange={(v) => {
              setSelectedProjectId(v);
              setSelectedWorkflowIds([]);
            }}
            options={[
              { value: '', label: 'All Projects (Global)' },
              ...(projects ?? []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>

        {/* Workflow Selection */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Workflows *</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Select one or more workflows. Multiple workflows run sequentially in order.
          </p>

          {/* Selected workflows */}
          {selectedWorkflowIds.length > 0 && (
            <div className="mb-4 space-y-2">
              {selectedWorkflowIds.map((wid, i) => {
                const wf = filteredWorkflows?.find((w) => w.id === wid) ?? workflows?.find((w) => w.id === wid);
                return (
                  <div key={wid} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">{i + 1}.</span>
                    <span className="flex-1 text-sm text-foreground">{wf?.name ?? wid.slice(0, 8)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRemoveWorkflow(wid)}
                      aria-label={`Remove ${wf?.name ?? 'workflow'} from this automation`}
                      className="h-6 w-6 text-muted-foreground hover:bg-danger-muted hover:text-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add workflow dropdown */}
          {workflowsLoading ? (
            <Spinner size="md" className="text-muted-foreground" />
          ) : (
            <Select
              value=""
              onChange={(v) => { if (v) handleAddWorkflow(v); }}
              aria-label="Add a workflow"
              placeholder="+ Add a workflow…"
              options={(filteredWorkflows ?? [])
                .filter((w) => !selectedWorkflowIds.includes(w.id))
                .map((w) => ({ value: w.id, label: `${w.name}${w.projectId ? '' : ' (global)'}` }))}
            />
          )}
        </div>

        {/* Concurrency & Error Policy */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Iterations</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Without a data schema an automation runs its workflows once with the base variables.
            With one, every iteration the dataset produces runs them.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="automation-max-concurrency" className="mb-1.5 block text-xs font-medium text-muted-foreground">Max Concurrency</label>
              <Input id="automation-max-concurrency"
                type="number"
                min={1}
                max={10}
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="automation-on-error" className="mb-1.5 block text-xs font-medium text-muted-foreground">On Error</label>
              <Select id="automation-on-error"
                value={onError}
                onChange={(v) => setOnError(v as 'continue' | 'stop')}
                options={[
                  { value: 'continue', label: 'Continue on error' },
                  { value: 'stop', label: 'Stop on error' },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Base Variables */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Base Variables</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            JSON object of variables merged into every workflow run
          </p>
          <Textarea
            aria-label="Base variables (JSON)"
            value={variablesText}
            onChange={(e) => setVariablesText(e.target.value)}
            rows={4}
            className="font-mono"
            placeholder='{ "key": "value" }'
          />
        </div>

        {/* Track C — Schema-driven data (advanced) */}
        <div className="rounded-lg border border-border bg-card p-6">
          <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Checkbox
              checked={schemaEnabled}
              onCheckedChange={(checked) => setSchemaEnabled(checked === true)}
            />
            Schema-driven data (advanced)
          </label>
          <p className="mb-3 text-xs text-muted-foreground">
            Declare the shape of one iteration row and how rows group into iterations. Data
            for each run is supplied at trigger time (manual/webhook) or as a default dataset
            for schedule triggers.
          </p>
          {schemaEnabled && (
            <div className="space-y-4">
              <div>
                <label htmlFor="automation-data-schema-json" className="mb-1.5 block text-xs font-medium text-muted-foreground">Data schema (JSON)</label>
                <Textarea id="automation-data-schema-json"
                  value={dataSchemaText}
                  onChange={(e) => setDataSchemaText(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Iteration mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['each_row', 'group_by', 'single'] as const).map((mode) => (
                    <Button variant="ghost"
                      type="button"
                      key={mode}
                      aria-pressed={iterationModeKind === mode}
                      onClick={() => setIterationModeKind(mode)}
                      className={cn(
                        'h-auto whitespace-normal rounded-md border px-3 py-2 text-xs',
                        iterationModeKind === mode ? 'border-primary bg-primary/10' : 'border-border',
                      )}
                    >
                      {mode.replace('_', ' ')}
                    </Button>
                  ))}
                </div>
              </div>
              {iterationModeKind === 'group_by' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="automation-fields-comma-separated" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Fields (comma-separated)
                    </label>
                    <Input id="automation-fields-comma-separated"
                      value={groupByFieldsText}
                      onChange={(e) => setGroupByFieldsText(e.target.value)}
                      placeholder="priority,team"
                    />
                  </div>
                  <div>
                    <label htmlFor="automation-group-variable" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Group variable
                    </label>
                    <Input id="automation-group-variable"
                      value={groupVariable}
                      onChange={(e) => setGroupVariable(e.target.value)}
                      placeholder="items"
                    />
                  </div>
                </div>
              )}
              {iterationModeKind === 'single' && (
                <div>
                  <label htmlFor="automation-dataset-variable" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Dataset variable
                  </label>
                  <Input id="automation-dataset-variable"
                    value={groupVariable}
                    onChange={(e) => setGroupVariable(e.target.value)}
                    placeholder="items"
                  />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Default dataset {triggerType === 'schedule' && <span className="text-danger">(required for schedule)</span>}
                </label>
                <div className="mb-1 flex gap-2 text-xs">
                  {(['json_array', 'csv', 'jsonl'] as const).map((f) => (
                    <Button variant="ghost"
                      type="button"
                      key={f}
                      aria-pressed={defaultDatasetFormat === f}
                      onClick={() => setDefaultDatasetFormat(f)}
                      className={cn(
                        'rounded-md border px-2 py-0.5',
                        defaultDatasetFormat === f ? 'border-primary bg-primary/10' : 'border-border',
                      )}
                    >
                      {f}
                    </Button>
                  ))}
                </div>
                <Textarea
                  aria-label="Default dataset"
                  value={defaultDatasetText}
                  onChange={(e) => setDefaultDatasetText(e.target.value)}
                  rows={6}
                  className="font-mono text-xs"
                  placeholder="Paste dataset text here (leave blank if manual-only)"
                />
              </div>
            </div>
          )}
        </div>

        {/* Track A — Retry policy (advanced) */}
        <div className="rounded-lg border border-border bg-card p-6">
          <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Checkbox
              checked={retryEnabled}
              onCheckedChange={(checked) => setRetryEnabled(checked === true)}
            />
            Retry policy (advanced)
          </label>
          <p className="mb-3 text-xs text-muted-foreground">
            Re-run a failing iteration up to N times with exponential backoff. Only errors
            in the classes below trigger a retry.
          </p>
          {retryEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="automation-max-attempts" className="mb-1.5 block text-xs font-medium text-muted-foreground">Max attempts</label>
                <Input id="automation-max-attempts"
                  type="number"
                  min={2}
                  max={10}
                  value={retryMaxAttempts}
                  onChange={(e) => setRetryMaxAttempts(Number(e.target.value))}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">Must be ≥2. Retry only applies when enabled.</p>
              </div>
              <div>
                <label htmlFor="automation-initial-backoff-ms" className="mb-1.5 block text-xs font-medium text-muted-foreground">Initial backoff (ms)</label>
                <Input id="automation-initial-backoff-ms"
                  type="number"
                  min={100}
                  value={retryInitialBackoffMs}
                  onChange={(e) => setRetryInitialBackoffMs(Number(e.target.value))}
                />
              </div>
              <div>
                <label htmlFor="automation-backoff-multiplier" className="mb-1.5 block text-xs font-medium text-muted-foreground">Backoff multiplier</label>
                <Input id="automation-backoff-multiplier"
                  type="number"
                  min={1}
                  step={0.5}
                  value={retryBackoffMultiplier}
                  onChange={(e) => setRetryBackoffMultiplier(Number(e.target.value))}
                />
              </div>
              <div>
                <label htmlFor="automation-max-backoff-ms" className="mb-1.5 block text-xs font-medium text-muted-foreground">Max backoff (ms)</label>
                <Input id="automation-max-backoff-ms"
                  type="number"
                  min={1000}
                  value={retryMaxBackoffMs}
                  onChange={(e) => setRetryMaxBackoffMs(Number(e.target.value))}
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Retry on</label>
                <div className="flex gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    <Checkbox
                      checked={retryOnFailed}
                      onCheckedChange={(checked) => setRetryOnFailed(checked === true)}
                    /> workflow_failed
                  </label>
                  <label className="flex items-center gap-1">
                    <Checkbox
                      checked={retryOnTimeout}
                      onCheckedChange={(checked) => setRetryOnTimeout(checked === true)}
                    /> timeout
                  </label>
                  <label className="flex items-center gap-1">
                    <Checkbox
                      checked={retryOnNetwork}
                      onCheckedChange={(checked) => setRetryOnNetwork(checked === true)}
                    /> network
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/automations')}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={createMutation.isPending}
            loading={createMutation.isPending}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Create Automation
          </Button>
        </div>
      </form>
      <WebhookCredentialsDialog
        open={webhookCredentials !== null}
        credentials={webhookCredentials}
        onClose={() => {
          setWebhookCredentials(null);
          if (createdAutomationId) navigate(`/automations/${createdAutomationId}`);
        }}
      />
    </PageContainer>
  );
}
