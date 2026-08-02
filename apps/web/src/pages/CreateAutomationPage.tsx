// ────────────────────────────────────────────────────────────────
// CreateAutomationPage — Form to configure a new automation
// ────────────────────────────────────────────────────────────────

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateAutomation } from '@/hooks/automationQueries.js';
import { useWorkflowDefinitions } from '@/hooks/workflowQueries.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { ArrowLeft, Plus, X, Clock, Webhook, Hand, Repeat, AlertCircle, Table2, FileSpreadsheet, Terminal, Play, FolderGit2 } from 'lucide-react';
import { Select, Button, Input, Textarea, Spinner, PageHeader } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { cn } from '@/lib/utils.js';
import type { CreateAutomationParams, AutomationTriggerType, AutomationInputMode, BatchDataFormat, DataSourceConfig, DataSourceOutputFormat } from '@generatorai/shared';
import { parseBatchData } from '@generatorai/shared';

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
  const [inputMode, setInputMode] = useState<AutomationInputMode>('single');
  const [loopVariable, setLoopVariable] = useState('');
  const [loopItemsText, setLoopItemsText] = useState('');
  // Batch mode state
  const [batchDataFormat, setBatchDataFormat] = useState<BatchDataFormat>('csv');
  const [batchDataText, setBatchDataText] = useState('');
  const [batchColumnMapping, setBatchColumnMapping] = useState<Record<string, string>>({});
  // Script data source state (E1)
  const [scriptCommand, setScriptCommand] = useState('');
  const [scriptOutputFormat, setScriptOutputFormat] = useState<DataSourceOutputFormat>('json_array');
  const [scriptTimeout, setScriptTimeout] = useState(60000);
  const [scriptEnvText, setScriptEnvText] = useState('{}');
  const [scriptTestResult, setScriptTestResult] = useState<{ success: boolean; preview?: unknown; totalCount?: number; error?: string } | null>(null);
  const [scriptTesting, setScriptTesting] = useState(false);
  const [variablesText, setVariablesText] = useState('{}');
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [onError, setOnError] = useState<'continue' | 'stop'>('continue');
  const [error, setError] = useState<string | null>(null);
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

  // Clear mode-specific fields when switching input modes
  const handleInputModeChange = (mode: AutomationInputMode) => {
    setInputMode(mode);
    setError(null);
    if (mode !== 'loop') {
      setLoopVariable('');
      setLoopItemsText('');
    }
    if (mode !== 'batch') {
      setBatchDataText('');
      setBatchColumnMapping({});
    }
    if (mode !== 'script' as string) {
      setScriptCommand('');
      setScriptTestResult(null);
    }
  };

  // Parse batch data for preview (single parse for both result and error)
  const { parsedBatch, batchParseError } = useMemo(() => {
    if (inputMode !== 'batch' || !batchDataText.trim()) return { parsedBatch: null, batchParseError: null };
    try {
      return { parsedBatch: parseBatchData(batchDataFormat, batchDataText), batchParseError: null };
    } catch (e) {
      return { parsedBatch: null, batchParseError: e instanceof Error ? e.message : String(e) };
    }
  }, [inputMode, batchDataFormat, batchDataText]);

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
    if (inputMode === 'loop' && !loopVariable.trim()) { setError('Loop variable name is required for loop mode'); return; }
    if (inputMode === 'batch' && !batchDataText.trim()) { setError('Batch data is required for batch mode'); return; }
    if (inputMode === 'batch' && batchParseError) { setError(`Batch data error: ${batchParseError}`); return; }
    if ((inputMode as string) === 'script' && !scriptCommand.trim()) { setError('Script command is required for script data source mode'); return; }

    let variables: Record<string, unknown> = {};
    try {
      variables = JSON.parse(variablesText);
    } catch {
      setError('Variables must be valid JSON');
      return;
    }

    let loopItems: unknown[] | undefined;
    if (inputMode === 'loop' && loopItemsText.trim()) {
      try {
        loopItems = JSON.parse(loopItemsText);
        if (!Array.isArray(loopItems)) { setError('Loop items must be a JSON array'); return; }
      } catch {
        setError('Loop items must be valid JSON array');
        return;
      }
    }

    // Build data source config for script mode (E1)
    let dataSourceConfig: DataSourceConfig | undefined;
    if (inputMode === 'script') {
      let scriptEnv: Record<string, string> | undefined;
      try {
        const parsed = JSON.parse(scriptEnvText);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          scriptEnv = parsed;
        }
      } catch { /* ignore invalid env JSON */ }

      dataSourceConfig = {
        type: 'script',
        command: scriptCommand.trim(),
        timeout: scriptTimeout,
        outputFormat: scriptOutputFormat,
        env: scriptEnv,
      };
    }

    const params: CreateAutomationParams = {
      name: name.trim(),
      description: description.trim() || undefined,
      triggerType,
      cronExpression: triggerType === 'schedule' ? cronExpression.trim() : undefined,
      workflowIds: selectedWorkflowIds,
      inputMode: inputMode,
      loopVariable: inputMode === 'loop' ? loopVariable.trim() : undefined,
      loopItems: inputMode === 'loop' ? loopItems : undefined,
      batchDataFormat: inputMode === 'batch' ? batchDataFormat : undefined,
      batchData: inputMode === 'batch' ? batchDataText : undefined,
      batchColumns: inputMode === 'batch' && parsedBatch ? parsedBatch.columns : undefined,
      batchColumnMapping: inputMode === 'batch' && Object.keys(batchColumnMapping).length > 0 ? batchColumnMapping : undefined,
      dataSourceConfig,
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
      navigate(`/automations/${automation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <PageContainer variant="narrow" className="max-w-3xl">
      <button
        onClick={() => navigate('/automations')}
        className="mb-6 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Automations
      </button>

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
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Automation"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Description</label>
              <Textarea
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
              <button
                key={type}
                type="button"
                onClick={() => setTriggerType(type)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
                  triggerType === type
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground',
                )}
              >
                <Icon className={cn('h-5 w-5', triggerType === type ? 'text-primary' : 'text-muted-foreground')} />
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="text-[11px] text-muted-foreground">{desc}</span>
              </button>
            ))}
          </div>

          {triggerType === 'schedule' && (
            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Cron Expression *</label>
              <Input
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
                    <button type="button" onClick={() => handleRemoveWorkflow(wid)} className="text-muted-foreground hover:text-danger">
                      <X className="h-3.5 w-3.5" />
                    </button>
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
              placeholder="+ Add a workflow…"
              options={(filteredWorkflows ?? [])
                .filter((w) => !selectedWorkflowIds.includes(w.id))
                .map((w) => ({ value: w.id, label: `${w.name}${w.projectId ? '' : ' (global)'}` }))}
            />
          )}
        </div>

        {/* Input Mode */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Input Mode</h2>
          <div className="grid grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => handleInputModeChange('single')}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
                inputMode === 'single'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground',
              )}
            >
              <Hand className={cn('h-5 w-5', inputMode === 'single' ? 'text-primary' : 'text-muted-foreground')} />
              <span className="text-sm font-medium text-foreground">Single</span>
              <span className="text-[11px] text-muted-foreground">Run once with base variables</span>
            </button>
            <button
              type="button"
              onClick={() => handleInputModeChange('loop')}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
                inputMode === 'loop'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground',
              )}
            >
              <Repeat className={cn('h-5 w-5', inputMode === 'loop' ? 'text-primary' : 'text-muted-foreground')} />
              <span className="text-sm font-medium text-foreground">Loop</span>
              <span className="text-[11px] text-muted-foreground">Iterate with single variable</span>
            </button>
            <button
              type="button"
              onClick={() => handleInputModeChange('batch')}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
                inputMode === 'batch'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground',
              )}
            >
              <FileSpreadsheet className={cn('h-5 w-5', inputMode === 'batch' ? 'text-primary' : 'text-muted-foreground')} />
              <span className="text-sm font-medium text-foreground">Batch</span>
              <span className="text-[11px] text-muted-foreground">Spreadsheet of tasks, multi-var</span>
            </button>
            <button
              type="button"
              onClick={() => handleInputModeChange('script')}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
                inputMode === 'script'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground',
              )}
            >
              <Terminal className={cn('h-5 w-5', (inputMode as string) === 'script' ? 'text-primary' : 'text-muted-foreground')} />
              <span className="text-sm font-medium text-foreground">Script</span>
              <span className="text-[11px] text-muted-foreground">Dynamic data from script</span>
            </button>
          </div>

          {inputMode === 'loop' && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Loop Variable Name *</label>
                <Input
                  type="text"
                  value={loopVariable}
                  onChange={(e) => setLoopVariable(e.target.value)}
                  placeholder="e.g. projectName"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  This variable will be set to a different value for each iteration
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Loop Items (JSON Array)</label>
                <Textarea
                  value={loopItemsText}
                  onChange={(e) => setLoopItemsText(e.target.value)}
                  rows={4}
                  className="font-mono"
                  placeholder='["item1", "item2", "item3"]'
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Max Concurrency</label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={maxConcurrency}
                    onChange={(e) => setMaxConcurrency(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">On Error</label>
                  <Select
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
          )}

          {inputMode === 'batch' && (
            <div className="mt-4 space-y-4">
              {/* Format selector */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Data Format *</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { fmt: 'csv' as const, label: 'CSV', desc: 'Comma-separated with headers' },
                    { fmt: 'json' as const, label: 'JSON Array', desc: 'Array of objects' },
                    { fmt: 'jsonl' as const, label: 'JSONL', desc: 'One JSON object per line' },
                  ]).map(({ fmt, label, desc }) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setBatchDataFormat(fmt)}
                      className={cn(
                        'rounded-lg border p-2.5 text-left transition-colors',
                        batchDataFormat === fmt
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground',
                      )}
                    >
                      <span className="block text-xs font-medium text-foreground">{label}</span>
                      <span className="block text-[10px] text-muted-foreground">{desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Batch data input */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Batch Data *</label>
                <Textarea
                  value={batchDataText}
                  onChange={(e) => setBatchDataText(e.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                  placeholder={
                    batchDataFormat === 'csv'
                      ? 'apiName,endpoint,method\nusers,/api/users,GET\norders,/api/orders,POST'
                      : batchDataFormat === 'json'
                      ? '[{"apiName": "users", "endpoint": "/api/users"}, {"apiName": "orders", "endpoint": "/api/orders"}]'
                      : '{"apiName": "users", "endpoint": "/api/users"}\n{"apiName": "orders", "endpoint": "/api/orders"}'
                  }
                />
                {batchParseError && (
                  <p className="mt-1 text-xs text-danger">{batchParseError}</p>
                )}
                {parsedBatch && (
                  <p className="mt-1 text-xs text-success">
                    {parsedBatch.rowCount} rows, {parsedBatch.columns.length} columns detected: {parsedBatch.columns.join(', ')}
                  </p>
                )}
              </div>

              {/* Table Preview */}
              {parsedBatch && parsedBatch.rowCount > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    <Table2 className="mr-1 inline h-3.5 w-3.5" />
                    Data Preview ({parsedBatch.rowCount} rows)
                  </label>
                  <div className="max-h-36 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
                          {parsedBatch.columns.map((col) => (
                            <th key={col} className="px-2 py-1.5 text-left font-medium text-muted-foreground">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedBatch.rows.slice(0, 20).map((row, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                            {parsedBatch.columns.map((col) => (
                              <td key={col} className="max-w-[200px] truncate px-2 py-1 text-foreground">
                                {String(row[col] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {parsedBatch.rowCount > 20 && (
                          <tr className="border-t border-border">
                            <td colSpan={parsedBatch.columns.length + 1} className="px-2 py-1.5 text-center text-muted-foreground">
                              ... and {parsedBatch.rowCount - 20} more rows
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Column Mapping */}
              {parsedBatch && parsedBatch.columns.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Column → Variable Mapping (optional)
                  </label>
                  <p className="mb-2 text-[10px] text-muted-foreground">
                    Map data columns to workflow variable names. Leave empty to use column names as-is.
                  </p>
                  <div className="space-y-2">
                    {parsedBatch.columns.map((col) => (
                      <div key={col} className="flex items-center gap-2">
                        <span className="w-32 text-xs font-mono text-foreground truncate">{col}</span>
                        <span className="text-xs text-muted-foreground">→</span>
                        <Input
                          type="text"
                          value={batchColumnMapping[col] ?? ''}
                          onChange={(e) => {
                            const newMapping = { ...batchColumnMapping };
                            if (e.target.value.trim()) {
                              newMapping[col] = e.target.value.trim();
                            } else {
                              delete newMapping[col];
                            }
                            setBatchColumnMapping(newMapping);
                          }}
                          className="flex-1 font-mono text-xs"
                          placeholder={col}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Concurrency & Error Policy */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Max Concurrency</label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={maxConcurrency}
                    onChange={(e) => setMaxConcurrency(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">On Error</label>
                  <Select
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
          )}

          {(inputMode as string) === 'script' && (
            <div className="mt-4 space-y-4">
              {/* Script Command */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Script Command *</label>
                <Textarea
                  value={scriptCommand}
                  onChange={(e) => { setScriptCommand(e.target.value); setScriptTestResult(null); }}
                  rows={3}
                  className="font-mono"
                  placeholder='python fetch_jira_issues.py&#10;# or: gh pr list --repo owner/repo --json number,title,url'
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Shell command that outputs a JSON array to stdout. Use env vars for secrets.
                </p>
              </div>

              {/* Output Format & Timeout */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Output Format</label>
                  <Select
                    value={scriptOutputFormat}
                    onChange={(v) => setScriptOutputFormat(v as DataSourceOutputFormat)}
                    options={[
                      { value: 'json_array', label: 'JSON Array' },
                      { value: 'csv', label: 'CSV' },
                      { value: 'jsonl', label: 'JSONL' },
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Timeout (ms)</label>
                  <Input
                    type="number"
                    min={1000}
                    max={300000}
                    step={1000}
                    value={scriptTimeout}
                    onChange={(e) => setScriptTimeout(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Environment Variables */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Environment Variables (JSON)</label>
                <Textarea
                  value={scriptEnvText}
                  onChange={(e) => setScriptEnvText(e.target.value)}
                  rows={3}
                  className="font-mono text-xs"
                  placeholder='{ "JIRA_URL": "https://...", "JIRA_TOKEN": "xxx", "JIRA_PROJECT": "PROJ" }'
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Key/value pairs passed as environment variables to the script
                </p>
              </div>

              {/* Test Button */}
              <div>
                <Button
                  type="button"
                  disabled={!scriptCommand.trim() || scriptTesting}
                  onClick={async () => {
                    setScriptTesting(true);
                    setScriptTestResult(null);
                    try {
                      let scriptEnv: Record<string, string> | undefined;
                      try { scriptEnv = JSON.parse(scriptEnvText); } catch { /* ignore */ }

                      const response = await fetch('/api/automations/test-data-source', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: 'script',
                          command: scriptCommand.trim(),
                          timeout: scriptTimeout,
                          outputFormat: scriptOutputFormat,
                          env: scriptEnv,
                        }),
                      });
                      const result = await response.json();
                      setScriptTestResult(result);
                    } catch (err) {
                      setScriptTestResult({ success: false, error: err instanceof Error ? err.message : String(err) });
                    } finally {
                      setScriptTesting(false);
                    }
                  }}
                  variant="secondary"
                  loading={scriptTesting}
                  leftIcon={<Play className="h-4 w-4" />}
                >
                  Test Data Source
                </Button>
              </div>

              {/* Test Results */}
              {scriptTestResult && (
                <div className={cn(
                  'rounded-lg border p-3',
                  scriptTestResult.success
                    ? 'border-success/30 bg-success-muted'
                    : 'border-danger/30 bg-danger-muted',
                )}>
                  {scriptTestResult.success ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-success">
                        ✓ Script returned {scriptTestResult.totalCount} items
                      </p>
                      {scriptTestResult.preview != null && (
                        <pre className="max-h-32 overflow-auto text-[10px] text-success">
                          {JSON.stringify(scriptTestResult.preview, null, 2)}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-danger">
                      ✗ {scriptTestResult.error}
                    </p>
                  )}
                </div>
              )}

              {/* Concurrency & Error Policy */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Max Concurrency</label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={maxConcurrency}
                    onChange={(e) => setMaxConcurrency(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">On Error</label>
                  <Select
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
          )}
        </div>

        {/* Base Variables */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Base Variables</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            JSON object of variables merged into every workflow run
          </p>
          <Textarea
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
            <input
              type="checkbox"
              checked={schemaEnabled}
              onChange={(e) => setSchemaEnabled(e.target.checked)}
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
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Data schema (JSON)</label>
                <Textarea
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
                    <button
                      type="button"
                      key={mode}
                      onClick={() => setIterationModeKind(mode)}
                      className={cn(
                        'rounded-md border px-3 py-2 text-xs',
                        iterationModeKind === mode ? 'border-primary bg-primary/10' : 'border-border',
                      )}
                    >
                      {mode.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
              {iterationModeKind === 'group_by' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Fields (comma-separated)
                    </label>
                    <Input
                      value={groupByFieldsText}
                      onChange={(e) => setGroupByFieldsText(e.target.value)}
                      placeholder="priority,team"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Group variable
                    </label>
                    <Input
                      value={groupVariable}
                      onChange={(e) => setGroupVariable(e.target.value)}
                      placeholder="items"
                    />
                  </div>
                </div>
              )}
              {iterationModeKind === 'single' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Dataset variable
                  </label>
                  <Input
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
                    <button
                      type="button"
                      key={f}
                      onClick={() => setDefaultDatasetFormat(f)}
                      className={cn(
                        'rounded-md border px-2 py-0.5',
                        defaultDatasetFormat === f ? 'border-primary bg-primary/10' : 'border-border',
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <Textarea
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
            <input
              type="checkbox"
              checked={retryEnabled}
              onChange={(e) => setRetryEnabled(e.target.checked)}
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
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Max attempts</label>
                <Input
                  type="number"
                  min={2}
                  max={10}
                  value={retryMaxAttempts}
                  onChange={(e) => setRetryMaxAttempts(Number(e.target.value))}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">Must be ≥2. Retry only applies when enabled.</p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Initial backoff (ms)</label>
                <Input
                  type="number"
                  min={100}
                  value={retryInitialBackoffMs}
                  onChange={(e) => setRetryInitialBackoffMs(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Backoff multiplier</label>
                <Input
                  type="number"
                  min={1}
                  step={0.5}
                  value={retryBackoffMultiplier}
                  onChange={(e) => setRetryBackoffMultiplier(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Max backoff (ms)</label>
                <Input
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
                    <input
                      type="checkbox"
                      checked={retryOnFailed}
                      onChange={(e) => setRetryOnFailed(e.target.checked)}
                    /> workflow_failed
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={retryOnTimeout}
                      onChange={(e) => setRetryOnTimeout(e.target.checked)}
                    /> timeout
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={retryOnNetwork}
                      onChange={(e) => setRetryOnNetwork(e.target.checked)}
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
    </PageContainer>
  );
}
