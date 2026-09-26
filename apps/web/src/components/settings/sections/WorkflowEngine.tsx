// ────────────────────────────────────────────────────────────────
// Settings → Workflow engine (P07 WP-7.2).
//
// The engine admits a stage launch only when every flow key it falls
// under has a free slot: `global`, `provider:<id>` (claude-agent's former
// hidden cap of 4 is this key), `model:<id>`, `check:global`, and the
// read-only `worktree:<mountId>` leases of maps and `run:<id>` limits of a
// run's `maxParallel`. The table shows each key's live load, refreshed
// while the section is open, and edits the configurable limits. Also here:
// the model of `llm` stage summaries and the automation trigger debounce.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, RotateCcw } from 'lucide-react';
import { usePlatform } from '@/providers/PlatformProvider.js';
import {
  Badge,
  Button,
  Input,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/index.js';
import type {
  WorkflowEngineFlow,
  WorkflowEngineSettings,
  WorkflowEngineSettingsUpdate,
} from '@/platform/HttpPlatformClient.js';
import { SectionHeader, SettingsCard } from '../shared.js';

const QUERY_KEY = ['settings', 'workflow-engine'] as const;
const REFRESH_MS = 3000;
const LIMIT_MIN = 1;
const LIMIT_MAX = 64;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/;

type FlowKind = WorkflowEngineFlow['kind'];

function kindOf(flowKey: string): FlowKind {
  const prefix = flowKey.includes(':') ? flowKey.slice(0, flowKey.indexOf(':')) : flowKey;
  return (['global', 'provider', 'model', 'check', 'worktree', 'run'] as const).find((k) => k === prefix) ?? 'global';
}

interface FlowRow {
  flowKey: string;
  kind: FlowKind;
  running: number;
  queued: number;
  /** The configured limit, else the default, else the live one. */
  limit: number | null;
  configured: boolean;
  defaultLimit: number | undefined;
  configurable: boolean;
  detail?: string;
}

/** Every key worth a row: the live flows, the configured limits and the defaults. */
function flowRows(data: WorkflowEngineSettings): FlowRow[] {
  const byKey = new Map<string, FlowRow>();
  const configured = data.settings.flowLimits;
  const defaults = data.defaults.flowLimits;
  const base = (flowKey: string): FlowRow => {
    const kind = kindOf(flowKey);
    return {
      flowKey,
      kind,
      running: 0,
      queued: 0,
      limit: configured[flowKey] ?? defaults[flowKey] ?? null,
      configured: flowKey in configured,
      defaultLimit: defaults[flowKey],
      configurable: kind !== 'worktree' && kind !== 'run',
    };
  };
  for (const f of data.flows) {
    byKey.set(f.flowKey, {
      ...base(f.flowKey),
      kind: f.kind,
      running: f.running,
      queued: f.queued,
      limit: f.limit,
      configurable: f.configurable,
      ...(f.detail ? { detail: f.detail } : {}),
    });
  }
  for (const key of [...Object.keys(configured), ...Object.keys(defaults)]) {
    if (!byKey.has(key)) byKey.set(key, base(key));
  }
  const order: FlowKind[] = ['global', 'provider', 'model', 'check', 'worktree', 'run'];
  return [...byKey.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.flowKey.localeCompare(b.flowKey));
}

function validLimit(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n >= LIMIT_MIN && n <= LIMIT_MAX ? n : null;
}

export function WorkflowEngineSection() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => platform.getWorkflowEngineSettings(),
    // Live running/queued counts while the section is on screen.
    refetchInterval: REFRESH_MS,
  });
  const save = useMutation({
    mutationFn: (update: WorkflowEngineSettingsUpdate) => platform.setWorkflowEngineSettings(update),
    onSuccess: (next) => queryClient.setQueryData(QUERY_KEY, next),
  });

  const rows = useMemo(() => (data ? flowRows(data) : []), [data]);

  /** Write the configured limits (the whole map: a key left out is back on its default). */
  const writeLimits = (flowLimits: Record<string, number>) => save.mutate({ flowLimits });
  const setLimit = (flowKey: string, limit: number) => {
    if (!data) return;
    writeLimits({ ...data.settings.flowLimits, [flowKey]: limit });
  };
  const resetLimit = (flowKey: string) => {
    if (!data) return;
    const next = { ...data.settings.flowLimits };
    delete next[flowKey];
    writeLimits(next);
  };

  return (
    <div>
      <SectionHeader
        title="Workflow engine"
        description="How many workflow stages may run at once, and a few engine-wide defaults."
      />

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> Loading…
        </div>
      )}
      {error && !data && (
        <p className="flex items-start gap-1.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error instanceof Error ? error.message : 'Could not load the engine settings'}
        </p>
      )}

      {data && (
        <div className="space-y-4">
          <SettingsCard
            title="Concurrency limits"
            description="A stage starts only when every key it falls under has a free slot; otherwise it waits in ready. Worktree and run keys are set by the workflows themselves."
          >
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead className="text-right">Running</TableHead>
                  <TableHead className="text-right">Queued</TableHead>
                  <TableHead className="w-40">Limit</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <FlowLimitRow
                    key={row.flowKey}
                    row={row}
                    busy={save.isPending}
                    onSet={(limit) => setLimit(row.flowKey, limit)}
                    onReset={() => resetLimit(row.flowKey)}
                  />
                ))}
              </TableBody>
            </Table>
            <AddFlowKey
              existing={new Set(rows.map((r) => r.flowKey))}
              busy={save.isPending}
              onAdd={(flowKey, limit) => setLimit(flowKey, limit)}
            />
          </SettingsCard>

          <SettingsCard
            title="Summary model"
            description="The model that writes llm stage summaries for successors that read a summary. Empty: the stage's own model."
          >
            <TextSetting
              key={`summary:${data.settings.summaryModel ?? ''}`}
              initial={data.settings.summaryModel ?? ''}
              placeholder="The stage's own model"
              ariaLabel="Summary model"
              busy={save.isPending}
              onCommit={(text) => {
                const next = text.trim() || null;
                if (next !== data.settings.summaryModel) save.mutate({ summaryModel: next });
              }}
            />
          </SettingsCard>

          <SettingsCard
            title="Automation trigger debounce"
            description={`Webhook and cron triggers of one automation arriving within this window start one run. Default ${data.defaults.triggerDebounceMs} ms.`}
          >
            <TextSetting
              key={`debounce:${data.settings.triggerDebounceMs}`}
              initial={String(data.settings.triggerDebounceMs)}
              ariaLabel="Trigger debounce in milliseconds"
              suffix="ms"
              inputMode="numeric"
              busy={save.isPending}
              validate={(text) => (/^\d+$/.test(text.trim()) ? null : 'A whole number of milliseconds')}
              onCommit={(text) => {
                const ms = Number(text.trim());
                if (ms !== data.settings.triggerDebounceMs) save.mutate({ triggerDebounceMs: ms });
              }}
            />
          </SettingsCard>

          {save.error && (
            <p className="flex items-start gap-1.5 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {save.error instanceof Error ? save.error.message : 'Could not save'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FlowLimitRow({
  row,
  busy,
  onSet,
  onReset,
}: {
  row: FlowRow;
  busy: boolean;
  onSet: (limit: number) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (row.limit === null ? '' : String(row.limit));
  const commit = () => {
    if (draft === null) return;
    const n = validLimit(draft);
    setDraft(null);
    if (n !== null && n !== row.limit) onSet(n);
  };
  const atLimit = row.limit !== null && row.running >= row.limit;
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-foreground">{row.flowKey}</span>
          {row.configured && row.defaultLimit !== undefined && (
            <Badge tone="info" size="sm" title={`Default ${row.defaultLimit}`}>set</Badge>
          )}
        </div>
        {row.detail && <p className="text-[11px] text-muted-foreground">{row.detail}</p>}
      </TableCell>
      <TableCell className={atLimit ? 'text-right tabular-nums text-warning' : 'text-right tabular-nums'}>{row.running}</TableCell>
      <TableCell className={row.queued > 0 ? 'text-right tabular-nums text-warning' : 'text-right tabular-nums'}>{row.queued}</TableCell>
      <TableCell>
        {row.configurable ? (
          <div>
            <Input
              type="number"
              min={LIMIT_MIN}
              max={LIMIT_MAX}
              value={shown}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setDraft(null);
              }}
              placeholder="No limit"
              aria-label={`Limit of ${row.flowKey}`}
              className="h-8 w-24 text-sm"
            />
            {draft !== null && draft !== '' && validLimit(draft) === null && (
              <p className="mt-0.5 text-[11px] text-danger">{LIMIT_MIN}–{LIMIT_MAX}</p>
            )}
          </div>
        ) : (
          <span className="text-sm tabular-nums text-muted-foreground" title="Set by the workflow">
            {row.limit ?? '—'}
          </span>
        )}
      </TableCell>
      <TableCell>
        {row.configurable && row.configured && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onReset}
            disabled={busy}
            aria-label={`Reset ${row.flowKey} to its default`}
            title={row.defaultLimit !== undefined ? `Reset to the default (${row.defaultLimit})` : 'Remove this limit'}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function AddFlowKey({
  existing,
  busy,
  onAdd,
}: {
  existing: ReadonlySet<string>;
  busy: boolean;
  onAdd: (flowKey: string, limit: number) => void;
}) {
  const [kind, setKind] = useState<'provider' | 'model'>('provider');
  const [id, setId] = useState('');
  const [limit, setLimit] = useState('4');
  const flowKey = `${kind}:${id.trim()}`;
  const problem = !id.trim()
    ? null
    : !KEY_ID.test(id.trim())
      ? 'Letters, digits and . _ - : / @'
      : existing.has(flowKey)
        ? 'This key is already listed'
        : validLimit(limit) === null
          ? `The limit is ${LIMIT_MIN}–${LIMIT_MAX}`
          : null;
  const add = () => {
    const n = validLimit(limit);
    if (!id.trim() || problem || n === null) return;
    onAdd(flowKey, n);
    setId('');
  };
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-1.5 text-xs font-medium text-foreground">Add a key</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-32">
          <Select
            aria-label="Key kind"
            value={kind}
            onChange={(v) => setKind(v as 'provider' | 'model')}
            options={[
              { value: 'provider', label: 'provider:' },
              { value: 'model', label: 'model:' },
            ]}
          />
        </div>
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder={kind === 'provider' ? 'claude-agent' : 'claude-sonnet-4-5'}
          aria-label="Provider or model id"
          className="h-8 w-48 font-mono text-sm"
        />
        <Input
          type="number"
          min={LIMIT_MIN}
          max={LIMIT_MAX}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          aria-label="Limit of the new key"
          className="h-8 w-20 text-sm"
        />
        <Button size="sm" variant="secondary" onClick={add} disabled={busy || !id.trim() || !!problem} leftIcon={<Plus className="h-3.5 w-3.5" />}>
          Add
        </Button>
      </div>
      {problem && <p className="mt-1 text-[11px] text-danger">{problem}</p>}
    </div>
  );
}

/** A text setting saved when it loses focus or on Enter. */
function TextSetting({
  initial,
  placeholder,
  ariaLabel,
  suffix,
  inputMode,
  busy,
  validate,
  onCommit,
}: {
  initial: string;
  placeholder?: string;
  ariaLabel: string;
  suffix?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  busy: boolean;
  validate?: (text: string) => string | null;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const problem = validate?.(text) ?? null;
  const commit = () => {
    if (problem) {
      setText(initial);
      return;
    }
    onCommit(text);
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          inputMode={inputMode}
          disabled={busy}
          className="h-8 max-w-xs text-sm"
        />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {problem && <p className="mt-1 text-[11px] text-danger">{problem}</p>}
    </div>
  );
}

export default WorkflowEngineSection;
