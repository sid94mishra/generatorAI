// ────────────────────────────────────────────────────────────────
// Settings → Workflow engine (P07 WP-7.2), on the D-32 settings recipe.
//
// The engine admits a stage launch only when every flow key it falls
// under has a free slot: `global`, `provider:<id>` (claude-agent's former
// hidden cap of 4 is this key), `model:<id>`, `check:global`, and the
// read-only `worktree:<mountId>` leases of maps and `run:<id>` limits of a
// run's `maxParallel`. The table shows each key's live load, refreshed
// while the section is open (useWorkflowEngineSettings, 3s), and edits the
// configurable limits. Also here: the model of `llm` stage summaries and
// the automation trigger debounce.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState, type HTMLAttributes } from 'react';
import {
  useUpdateWorkflowEngineSettings,
  useWorkflowEngineSettings,
  type WorkflowEngineFlow,
  type WorkflowEngineSettings,
} from '@/hooks/workflowQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import {
  SettingRow,
  SettingsSection,
  SettingsTable,
  type SettingsTableColumn,
} from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { ModelPicker } from '@/blocks/model-picker/index.js';
import { ProviderSelect } from '@/blocks/provider-select/index.js';

const LIMIT_MIN = 1;
const LIMIT_MAX = 64;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/;

type FlowKind = WorkflowEngineFlow['kind'];
const KIND_ORDER: readonly FlowKind[] = ['global', 'provider', 'model', 'check', 'worktree', 'run'];

function kindOf(flowKey: string): FlowKind {
  const prefix = flowKey.includes(':') ? flowKey.slice(0, flowKey.indexOf(':')) : flowKey;
  return KIND_ORDER.find((k) => k === prefix) ?? 'global';
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
  return [...byKey.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.flowKey.localeCompare(b.flowKey),
  );
}

function validLimit(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n >= LIMIT_MIN && n <= LIMIT_MAX ? n : null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function WorkflowEngineSection() {
  const { data, isLoading, error } = useWorkflowEngineSettings();
  const save = useUpdateWorkflowEngineSettings();

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

  const columns: SettingsTableColumn<FlowRow>[] = [
    { id: 'key', header: 'Key', width: 'minmax(0,1fr)', cell: (row) => <FlowKeyCell row={row} /> },
    {
      id: 'running',
      header: 'Running',
      width: 72,
      align: 'end',
      mono: true,
      cell: (row) => <span className={row.limit !== null && row.running >= row.limit ? 'text-warn' : undefined}>{row.running}</span>,
    },
    {
      id: 'queued',
      header: 'Queued',
      width: 72,
      align: 'end',
      mono: true,
      cell: (row) => <span className={row.queued > 0 ? 'text-warn' : undefined}>{row.queued}</span>,
    },
    {
      id: 'limit',
      header: 'Limit',
      width: 160,
      cell: (row) => <FlowLimitCell key={row.flowKey} row={row} busy={save.isPending} onSet={(limit) => setLimit(row.flowKey, limit)} />,
    },
  ];

  return (
    <SettingsSection
      title="Workflow engine"
      description="How many workflow stages may run at once, and a few engine-wide defaults."
      data-testid="workflow-engine-section"
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading…
        </div>
      ) : null}
      {error && !data ? <Callout tone="err">{errorText(error, 'Could not load the engine settings')}</Callout> : null}

      {data ? (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <SectionHeader title="Concurrency limits" level={3} />
            <p className="text-small text-fg-3">
              A stage starts only when every key it falls under has a free slot; otherwise it waits in ready. Worktree and run keys are
              set by the workflows themselves.
            </p>
            <SettingsTable
              label="Concurrency limits"
              columns={columns}
              rows={rows}
              getRowId={(row) => row.flowKey}
              actionsWidth={40}
              data-testid="workflow-engine-flows"
              rowActions={(row) =>
                row.configurable && row.configured ? (
                  <IconButton
                    icon="undo"
                    size="sm"
                    label={`Reset ${row.flowKey} to its default`}
                    tooltip={row.defaultLimit !== undefined ? `Reset to the default (${row.defaultLimit})` : 'Remove this limit'}
                    disabled={save.isPending}
                    onClick={() => resetLimit(row.flowKey)}
                  />
                ) : null
              }
            />
            <AddFlowKey
              existing={new Set(rows.map((r) => r.flowKey))}
              busy={save.isPending}
              onAdd={(flowKey, limit) => setLimit(flowKey, limit)}
            />
          </section>

          <div className="flex flex-col">
            <SettingRow
              label="Summary model"
              hint="The model that writes llm stage summaries for successors that read a summary. Empty: the stage's own model."
              control={
                <div className="flex w-72 min-w-0 items-center gap-1">
                  <div className="min-w-0 flex-1">
                    <ModelPicker
                      variant="field"
                      value={data.settings.summaryModel ?? ''}
                      placeholder="The stage's own model"
                      ariaLabel="Summary model"
                      disabled={save.isPending}
                      onChange={(m) => {
                        const next = m || null;
                        if (next !== data.settings.summaryModel) save.mutate({ summaryModel: next });
                      }}
                    />
                  </div>
                  {data.settings.summaryModel ? (
                    <IconButton icon="x" size="sm" label="Use the stage's own model" onClick={() => save.mutate({ summaryModel: null })} />
                  ) : null}
                </div>
              }
            />
            <SettingRow
              label="Automation trigger debounce"
              hint={`Webhook and cron triggers of one automation arriving within this window start one run. Default ${data.defaults.triggerDebounceMs} ms.`}
              control={
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
              }
            />
          </div>

          {save.error ? <Callout tone="err">{errorText(save.error, 'Could not save')}</Callout> : null}
        </div>
      ) : null}
    </SettingsSection>
  );
}

function FlowKeyCell({ row }: { row: FlowRow }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-small text-fg">{row.flowKey}</span>
        {row.configured && row.defaultLimit !== undefined ? (
          <Badge tone="run" title={`Default ${row.defaultLimit}`}>
            set
          </Badge>
        ) : null}
      </div>
      {row.detail ? <span className="truncate text-micro text-fg-3">{row.detail}</span> : null}
    </div>
  );
}

/** The editable limit of a configurable key (saved on blur or Enter; Escape reverts), else the read-only one. */
function FlowLimitCell({ row, busy, onSet }: { row: FlowRow; busy: boolean; onSet: (limit: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!row.configurable) {
    return (
      <span className="font-mono text-small text-fg-3" title="Set by the workflow">
        {row.limit ?? '—'}
      </span>
    );
  }
  const shown = draft ?? (row.limit === null ? '' : String(row.limit));
  const invalid = draft !== null && draft !== '' && validLimit(draft) === null;
  const commit = () => {
    if (draft === null) return;
    const n = validLimit(draft);
    setDraft(null);
    if (n !== null && n !== row.limit) onSet(n);
  };
  return (
    <Input
      size="sm"
      type="number"
      min={LIMIT_MIN}
      max={LIMIT_MAX}
      value={shown}
      disabled={busy}
      invalid={invalid}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(null);
      }}
      placeholder="No limit"
      aria-label={`Limit of ${row.flowKey}`}
      trailing={invalid ? <span className="shrink-0 text-micro text-err">{LIMIT_MIN}–{LIMIT_MAX}</span> : undefined}
      className="w-32"
    />
  );
}

type NewKeyKind = 'provider' | 'model';
const NEW_KEY_KINDS = [
  { value: 'provider', label: 'provider:' },
  { value: 'model', label: 'model:' },
] as const;

function AddFlowKey({
  existing,
  busy,
  onAdd,
}: {
  existing: ReadonlySet<string>;
  busy: boolean;
  onAdd: (flowKey: string, limit: number) => void;
}) {
  const [kind, setKind] = useState<NewKeyKind>('provider');
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
    <div className="flex flex-col gap-1.5 pt-2">
      <span className="text-small font-medium text-fg">Add a key</span>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          size="sm"
          aria-label="Key kind"
          value={kind}
          onValueChange={(v) => {
            if (v === 'provider' || v === 'model') {
              setKind(v);
              setId('');
            }
          }}
          items={NEW_KEY_KINDS}
          className="w-32"
        />
        {kind === 'provider' ? (
          <ProviderSelect size="sm" aria-label="Provider of the new key" emptyLabel="Choose a provider" value={id} onChange={setId} className="w-48" />
        ) : (
          <div className="w-56 min-w-0">
            <ModelPicker variant="field" value={id} onChange={setId} placeholder="Choose a model…" ariaLabel="Model of the new key" />
          </div>
        )}
        <Input
          size="sm"
          type="number"
          min={LIMIT_MIN}
          max={LIMIT_MAX}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          aria-label="Limit of the new key"
          className="w-20"
        />
        <Button size="sm" icon="plus" onClick={add} disabled={busy || !id.trim() || !!problem}>
          Add
        </Button>
      </div>
      {problem ? <p className="text-micro text-err">{problem}</p> : null}
    </div>
  );
}

/** A text setting saved when it loses focus or on Enter; an invalid value reverts on commit. */
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
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
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
    <div className="flex flex-col items-end gap-1">
      <Input
        size="sm"
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
        invalid={problem !== null}
        trailing={suffix ? <span className="shrink-0 text-micro text-fg-3">{suffix}</span> : undefined}
        className="w-64"
      />
      {problem ? <p className="text-micro text-err">{problem}</p> : null}
    </div>
  );
}
