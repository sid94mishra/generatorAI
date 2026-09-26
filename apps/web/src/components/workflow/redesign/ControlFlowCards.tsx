// ────────────────────────────────────────────────────────────────
// ControlFlowCards — the run page's cards of the P05 5B kinds.
//
//   WaitCard           a wait (P05 §4.3): an approval (its prompt and a form
//                      from the wait's JSON Schema → approve / reject), an
//                      event (its key, the callback URL external systems
//                      POST to, and a "Deliver event" form for operators:
//                      the `deliver_event` run command), a timer (a
//                      countdown); once resolved, its outcome.
//   SubworkflowCard    a sub-workflow (P05 §4.2): the child run (a link) and
//                      the child's pending decisions, mirrored here.
//   DecisionCard       one pending decision of a (child) run: an approval
//                      wait, a completion review, a parked loop.
//   NeedsDecisionPanel every decision the run waits on (`GET
//                      /pending-decisions`), mirrored ones with the
//                      sub-workflow they came through.
//   CompensationBadge  a stage that declares compensation actions.
//
// Every button is a run command: a mirrored decision goes to the child run
// that owns it. A refused command is toasted by `useRunCommand`.
// ────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Hand, Clock, Radio, Copy, Send, Workflow, Undo2, ArrowRight } from 'lucide-react';
import type { PendingDecisionView } from '@generatorai/shared';
import type { RunCommand } from '@generatorai/workflow-spec';
import { cn } from '@/lib/utils.js';
import { Button, Input, Select, Textarea } from '@/components/ui/index.js';
import { toast } from '@/components/Toast.js';
import { useWorkflowRun } from '@/hooks/workflowQueries.js';
import { LoopDecisionCard } from './LoopDecisionCard.js';
import { loopDecisionOf } from './loopView.js';
import type { StageView, WaitView } from './types.js';

// ── Context: the run's pending decisions and a command to any run of its tree ──

export interface RunDecisionsValue {
  runId: string;
  decisions: PendingDecisionView[];
  /** A run command on `runId` (a child run for a mirrored decision); resolves once it settled. */
  commandTo: (runId: string, command: RunCommand) => Promise<void>;
}

export const RunDecisionsContext = createContext<RunDecisionsValue | null>(null);

export function useRunDecisions(): RunDecisionsValue | null {
  return useContext(RunDecisionsContext);
}

const CARD = 'rounded-lg border-l-2 border-[var(--color-warning)] bg-[var(--color-warning)]/[0.06] p-3 space-y-2.5';
const MUTED_CARD = 'rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-subtle)]/30 p-3 space-y-2 text-[12px]';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pretty(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function copy(text: string, what: string): void {
  void navigator.clipboard.writeText(text).then(
    () => toast({ variant: 'success', title: `${what} copied` }),
    () => toast({ variant: 'error', title: `Could not copy the ${what.toLowerCase()}` }),
  );
}

// ── A form from a JSON Schema (simple fields; a JSON text area otherwise) ──

type FieldSpec = { name: string; type: 'string' | 'number' | 'boolean' | 'enum'; options?: string[]; required: boolean; title?: string; description?: string };

/** The flat fields of an object schema, or null when the form needs the JSON fallback. */
function formFields(schema: Record<string, unknown> | undefined): FieldSpec[] | null {
  if (!schema) return [];
  const props = schema['properties'];
  if (schema['type'] !== undefined && schema['type'] !== 'object') return null;
  if (!isRecord(props)) return null;
  const required = new Set(Array.isArray(schema['required']) ? (schema['required'] as unknown[]).map(String) : []);
  const out: FieldSpec[] = [];
  for (const [name, raw] of Object.entries(props)) {
    if (!isRecord(raw)) return null;
    const base = {
      name,
      required: required.has(name),
      ...(typeof raw['title'] === 'string' ? { title: raw['title'] } : {}),
      ...(typeof raw['description'] === 'string' ? { description: raw['description'] } : {}),
    };
    if (Array.isArray(raw['enum']) && raw['enum'].every((x) => typeof x === 'string')) out.push({ ...base, type: 'enum', options: raw['enum'] as string[] });
    else if (raw['type'] === 'string') out.push({ ...base, type: 'string' });
    else if (raw['type'] === 'number' || raw['type'] === 'integer') out.push({ ...base, type: 'number' });
    else if (raw['type'] === 'boolean') out.push({ ...base, type: 'boolean' });
    else return null;
  }
  return out;
}

export function SchemaForm({
  schema,
  onChange,
  disabled,
}: {
  schema: Record<string, unknown> | undefined;
  /** The value, or an error message while it is not valid JSON / misses a required field. */
  onChange: (value: { ok: true; data: Record<string, unknown> | undefined } | { ok: false; error: string }) => void;
  disabled?: boolean;
}) {
  const fields = useMemo(() => formFields(schema), [schema]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [json, setJson] = useState('{}');

  useEffect(() => {
    if (!schema) return onChange({ ok: true, data: undefined });
    if (fields === null) {
      try {
        const parsed: unknown = JSON.parse(json || '{}');
        if (!isRecord(parsed)) return onChange({ ok: false, error: 'The form value is a JSON object' });
        return onChange({ ok: true, data: parsed });
      } catch (err) {
        return onChange({ ok: false, error: `Not valid JSON: ${(err as Error).message}` });
      }
    }
    const missing = fields.find((f) => f.required && (values[f.name] === undefined || values[f.name] === ''));
    if (missing) return onChange({ ok: false, error: `${missing.title ?? missing.name} is required` });
    const data: Record<string, unknown> = {};
    for (const f of fields) if (values[f.name] !== undefined && values[f.name] !== '') data[f.name] = values[f.name];
    onChange({ ok: true, data });
    // `onChange` is a stable setter of the parent's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, fields, values, json]);

  if (!schema) return null;
  if (fields === null) {
    return (
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-[var(--color-muted-foreground)]">Form (JSON)</span>
        <Textarea value={json} onChange={(e) => setJson(e.target.value)} rows={4} className="font-mono text-[11.5px]" disabled={disabled} />
      </label>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {fields.map((f) => (
        <label key={f.name} className="block space-y-1">
          <span className="text-[11px] font-medium text-[var(--color-muted-foreground)]">
            {f.title ?? f.name}
            {f.required && <span className="text-[var(--color-danger)]"> *</span>}
          </span>
          {f.type === 'enum' ? (
            <Select
              value={String(values[f.name] ?? '')}
              {...(disabled ? { disabled: true } : {})}
              aria-label={f.title ?? f.name}
              onChange={(value) => setValues((v) => ({ ...v, [f.name]: value || undefined }))}
              options={[{ value: '', label: '—' }, ...f.options!.map((o) => ({ value: o, label: o }))]}
            />
          ) : f.type === 'boolean' ? (
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={values[f.name] === true}
              disabled={disabled}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))}
            />
          ) : (
            <Input
              type={f.type === 'number' ? 'number' : 'text'}
              value={values[f.name] === undefined ? '' : String(values[f.name])}
              disabled={disabled}
              onChange={(e) => {
                const raw = e.target.value;
                setValues((v) => ({ ...v, [f.name]: f.type === 'number' ? (raw === '' ? undefined : Number(raw)) : raw }));
              }}
            />
          )}
          {f.description && <span className="block text-[10.5px] text-[var(--color-muted-foreground)]">{f.description}</span>}
        </label>
      ))}
    </div>
  );
}

// ── Wait ────────────────────────────────────────────────────────

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, until - now);
  const s = Math.round(left / 1000);
  const text = s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  return <span className="tabular-nums">{left === 0 ? 'any moment now' : text}</span>;
}

/** An approval wait's decision: the prompt, its form, approve / reject. */
export function WaitApproval({ wait, onDecide, busy }: { wait: WaitView; onDecide: (outcome: 'approved' | 'rejected', data?: Record<string, unknown>) => void; busy?: boolean }) {
  const [form, setForm] = useState<{ ok: true; data: Record<string, unknown> | undefined } | { ok: false; error: string }>({ ok: true, data: undefined });
  return (
    <section className={CARD} role="alert" aria-live="polite">
      <div className="flex items-start gap-2">
        <Hand className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)] animate-status-breathe" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[12.5px] font-semibold text-[var(--color-foreground)]">{wait.label ?? 'Approval'}</p>
          {wait.prompt && <p className="whitespace-pre-wrap text-[12px] text-[var(--color-foreground)]/85">{wait.prompt}</p>}
          {wait.until !== undefined && (
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              <Clock className="mr-1 inline h-3 w-3" />
              Times out in <Countdown until={wait.until} /> ({wait.onTimeout === 'complete' ? 'then completes with outcome timeout' : 'then fails'})
            </p>
          )}
        </div>
      </div>
      <SchemaForm schema={wait.form} onChange={setForm} {...(busy ? { disabled: true } : {})} />
      {!form.ok && <p className="text-[11px] text-[var(--color-danger)]">{form.error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || !form.ok}
          onClick={() => form.ok && onDecide('approved', form.data)}
          leftIcon={<Check className="h-3.5 w-3.5" />}
        >
          Approve
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onDecide('rejected')} leftIcon={<X className="h-3.5 w-3.5" />}>
          Reject
        </Button>
      </div>
    </section>
  );
}

/** An event wait: its key, its callback, and the operator's "Deliver event" form. */
export function WaitEvent({ wait, onDeliver, busy }: { wait: WaitView; onDeliver: (e: { eventKey: string; idempotencyKey: string; data?: unknown }) => void; busy?: boolean }) {
  const [idem, setIdem] = useState('');
  const [data, setData] = useState('');
  let parsed: { ok: true; value: unknown } | { ok: false; error: string } = { ok: true, value: undefined };
  if (data.trim()) {
    try {
      parsed = { ok: true, value: JSON.parse(data) as unknown };
    } catch (err) {
      parsed = { ok: false, error: `Not valid JSON: ${(err as Error).message}` };
    }
  }
  return (
    <section className={CARD}>
      <div className="flex items-start gap-2">
        <Radio className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)] animate-status-breathe" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[12.5px] font-semibold text-[var(--color-foreground)]">
            Waiting for the event <span className="font-mono">{wait.eventKey ?? '…'}</span>
          </p>
          {wait.until !== undefined && (
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              <Clock className="mr-1 inline h-3 w-3" />
              Times out in <Countdown until={wait.until} />
            </p>
          )}
        </div>
      </div>
      {wait.callback && (
        <div className="space-y-1">
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            External systems deliver it with no credential: <span className="font-mono">POST</span> <span className="font-mono">{'{data?, idempotencyKey?}'}</span> to
          </p>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded bg-[var(--color-background)] px-2 py-1 font-mono text-[11px]" title={wait.callback.url}>
              {wait.callback.url}
            </code>
            <Button variant="ghost" size="icon-sm" title="Copy the callback URL" aria-label="Copy the callback URL" onClick={() => copy(wait.callback!.url, 'Callback URL')}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-[var(--color-muted-foreground)]">Idempotency key</span>
          <Input value={idem} onChange={(e) => setIdem(e.target.value)} placeholder="e.g. build-1234" disabled={busy} />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-[var(--color-muted-foreground)]">Data (JSON, optional)</span>
          <Textarea value={data} onChange={(e) => setData(e.target.value)} rows={2} className="font-mono text-[11.5px]" disabled={busy} />
        </label>
      </div>
      {!parsed.ok && <p className="text-[11px] text-[var(--color-danger)]">{parsed.error}</p>}
      <Button
        variant="secondary"
        size="sm"
        disabled={busy || !wait.eventKey || !idem.trim() || !parsed.ok}
        onClick={() => parsed.ok && wait.eventKey && onDeliver({ eventKey: wait.eventKey, idempotencyKey: idem.trim(), ...(parsed.value !== undefined ? { data: parsed.value } : {}) })}
        leftIcon={<Send className="h-3 w-3" />}
      >
        Deliver event
      </Button>
    </section>
  );
}

/** A wait instance's body: its card while it waits, its outcome once resolved. */
export function WaitCard({ stage, runId, onCommand }: { stage: StageView; runId: string; onCommand: (runId: string, command: RunCommand) => Promise<void> }) {
  const wait = stage.wait!;
  const [busy, setBusy] = useState(false);
  const run = (command: RunCommand) => {
    setBusy(true);
    void onCommand(runId, command).finally(() => setBusy(false));
  };
  if (wait.outcome) {
    return (
      <div className={MUTED_CARD}>
        <p>
          Outcome <span className="font-semibold text-[var(--color-foreground)]">{wait.outcome.outcome}</span>
          {wait.outcome.by && <span className="text-[var(--color-muted-foreground)]"> · by {wait.outcome.by}</span>}
          {wait.outcome.at > 0 && <span className="text-[var(--color-muted-foreground)]"> · {new Date(wait.outcome.at).toLocaleString()}</span>}
        </p>
        {wait.outcome.data !== null && wait.outcome.data !== undefined && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--color-foreground)]/80">{pretty(wait.outcome.data)}</pre>
        )}
      </div>
    );
  }
  if (stage.rawStatus !== 'waiting') {
    return (
      <p className="text-[11.5px] text-[var(--color-muted-foreground)]">
        {wait.type === 'approval' ? 'Waits for an approval' : wait.type === 'event' ? 'Waits for an event' : 'Waits for a timer'}
        {stage.status === 'failed' && stage.error ? ` — ${stage.error}` : ''}.
      </p>
    );
  }
  if (wait.type === 'approval') {
    return (
      <WaitApproval
        wait={wait}
        busy={busy}
        onDecide={(outcome, data) => run({ command: 'approve', instanceId: stage.id, outcome, ...(data ? { data } : {}) })}
      />
    );
  }
  if (wait.type === 'event') {
    return <WaitEvent wait={wait} busy={busy} onDeliver={(e) => run({ command: 'deliver_event', ...e })} />;
  }
  return (
    <div className={MUTED_CARD}>
      <Clock className="mr-1 inline h-3.5 w-3.5" />
      Timer: continues in {wait.until !== undefined ? <Countdown until={wait.until} /> : 'a moment'}.
    </div>
  );
}

/** The wait row's header badge. */
export function WaitBadge({ wait }: { wait: WaitView }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-muted-foreground)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)]">
      {wait.type === 'timer' ? <Clock className="h-2.5 w-2.5" /> : wait.type === 'event' ? <Radio className="h-2.5 w-2.5" /> : <Hand className="h-2.5 w-2.5" />}
      {wait.type}
    </span>
  );
}

// ── Decisions (one, mirrored or not) ───────────────────────────

/** One pending decision of a (child) run; its commands go to the run that owns it. */
export function DecisionCard({ decision }: { decision: PendingDecisionView }) {
  const ctx = useRunDecisions();
  const [busy, setBusy] = useState(false);
  if (!ctx) return null;
  const send = (command: RunCommand) => {
    setBusy(true);
    return ctx.commandTo(decision.runId, command).finally(() => setBusy(false));
  };
  const d = isRecord(decision.interruptData) ? decision.interruptData : {};
  if (decision.kind === 'wait') {
    const wait: WaitView = {
      type: decision.waitType ?? 'approval',
      ...(typeof d['label'] === 'string' ? { label: d['label'] } : {}),
      ...(typeof d['prompt'] === 'string' ? { prompt: d['prompt'] } : {}),
      ...(isRecord(d['form']) ? { form: d['form'] } : {}),
      ...(typeof d['eventKey'] === 'string' ? { eventKey: d['eventKey'] } : {}),
      ...(typeof d['until'] === 'number' ? { until: d['until'] } : {}),
      ...(typeof d['onTimeout'] === 'string' ? { onTimeout: d['onTimeout'] } : {}),
      ...(decision.callback ? { callback: decision.callback } : {}),
    };
    return wait.type === 'event' ? (
      <WaitEvent wait={wait} busy={busy} onDeliver={(e) => void send({ command: 'deliver_event', ...e })} />
    ) : (
      <WaitApproval
        wait={wait}
        busy={busy}
        onDecide={(outcome, data) => void send({ command: 'approve', instanceId: decision.instanceId, outcome, ...(data ? { data } : {}) })}
      />
    );
  }
  const loopDecision = loopDecisionOf(decision.interruptData);
  if (loopDecision) {
    const loop = {
      k: loopDecision.k,
      max: loopDecision.maxIterations,
      phase: 'parked',
      rules: [],
      exitReason: loopDecision.reason,
      exitAction: loopDecision.action,
      operatorInput: null,
      decision: loopDecision,
    };
    return <LoopDecisionCard loopId={decision.instanceId} loop={loop} decision={loopDecision} version={decision.version} onCommand={(c) => send(c)} />;
  }
  if (decision.kind === 'stage_completion_review') {
    const reason = typeof d['reason'] === 'string' ? d['reason'] : typeof d['prompt'] === 'string' ? d['prompt'] : 'The stage is waiting for your approval.';
    return (
      <section className={CARD}>
        <p className="text-[12px] text-[var(--color-foreground)]/85">{reason}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void send({ command: 'approve', instanceId: decision.instanceId, outcome: 'approved' })} leftIcon={<Check className="h-3.5 w-3.5" />}>
            Approve
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void send({ command: 'approve', instanceId: decision.instanceId, outcome: 'rejected' })} leftIcon={<X className="h-3.5 w-3.5" />}>
            Reject
          </Button>
        </div>
      </section>
    );
  }
  // An in-turn gate (tool permission, question, plan) is answered in the child run's page.
  return (
    <p className={MUTED_CARD}>
      <Hand className="mr-1 inline h-3 w-3" />
      {decision.name} asks for an answer ({decision.kind.replace(/_/g, ' ')}); answer it in the child run.
    </p>
  );
}

/** "via release › security" for a mirrored decision. */
export function viaText(d: PendingDecisionView): string {
  return d.via.map((v) => v.name).join(' › ');
}

// ── Sub-workflow ────────────────────────────────────────────────

/** A sub-workflow instance's body: its child run and the child's decisions. */
export function SubworkflowCard({ stage }: { stage: StageView }) {
  const ctx = useRunDecisions();
  const childRunId = stage.subworkflow?.childRunId ?? null;
  const { data: child } = useWorkflowRun(childRunId ?? undefined);
  const mirrored = (ctx?.decisions ?? []).filter((d) => d.via.some((v) => v.instanceId === stage.id));
  return (
    <div className="space-y-2">
      <div className={MUTED_CARD}>
        <p className="flex flex-wrap items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
          {childRunId ? (
            <>
              <span>Child run</span>
              {child ? (
                <Link to={`/workflows/${child.workflowDefinitionId}/runs/${childRunId}`} className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline">
                  {child.name}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ) : (
                <span className="font-mono text-[11px]">{childRunId}</span>
              )}
              {child && <span className="text-[var(--color-muted-foreground)]">· {child.status}</span>}
            </>
          ) : (
            <span className="text-[var(--color-muted-foreground)]">
              {stage.status === 'failed' ? `The child run could not start${stage.error ? `: ${stage.error}` : ''}` : 'Starting the child run…'}
            </span>
          )}
        </p>
      </div>
      {mirrored.map((d) => (
        <div key={`${d.runId}:${d.instanceId}`} className="space-y-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {d.name} <span className="font-normal normal-case tracking-normal">· via {viaText(d)}</span>
          </p>
          <DecisionCard decision={d} />
        </div>
      ))}
    </div>
  );
}

// ── The run's pending decisions ─────────────────────────────────

/** Every decision the run waits on; a click focuses the instance (or, for a mirrored one, its sub-workflow). */
export function NeedsDecisionPanel({ decisions, runId, onFocus }: { decisions: PendingDecisionView[]; runId: string; onFocus: (instanceId: string) => void }) {
  if (decisions.length === 0) return null;
  return (
    <section className="mb-4 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/[0.05] p-3" aria-label="Needs decision">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-warning)]">
        <Hand className="h-3 w-3" />
        Needs decision ({decisions.length})
      </p>
      <ul className="space-y-1">
        {decisions.map((d) => {
          const target = d.runId === runId ? d.instanceId : (d.via[0]?.instanceId ?? d.instanceId);
          return (
            <li key={`${d.runId}:${d.instanceId}`}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-2 rounded px-1.5 py-1 text-left text-[12px] font-normal"
                onClick={() => onFocus(target)}
              >
                <span className="font-medium text-[var(--color-foreground)]">{d.name}</span>
                <span className="text-[11px] text-[var(--color-muted-foreground)]">
                  {d.kind === 'wait' ? `${d.waitType ?? 'approval'} wait` : d.kind.replace(/_/g, ' ')}
                  {d.via.length > 0 ? ` · via ${viaText(d)}` : ''}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Compensation ────────────────────────────────────────────────

export function CompensationBadge() {
  return (
    <span
      className="hidden shrink-0 items-center gap-1 rounded-full bg-[var(--color-muted-foreground)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)] md:inline-flex"
      title="Declares compensation: when the run fails or is cancelled, its undo actions run (last completed first)"
    >
      <Undo2 className="h-2.5 w-2.5" />
      compensates
    </span>
  );
}

/** The finalize `compensate` phase result of a failed or cancelled run. */
export function CompensationBanner({ compensation, count }: { compensation: { status: 'done' | 'failed'; detail?: string; at: number }; count: number }) {
  return (
    <div
      className={cn(
        'border-b px-4 py-2 text-[12px]',
        compensation.status === 'done'
          ? 'border-[var(--color-border)] bg-[var(--color-subtle)]/40 text-[var(--color-foreground)]/85'
          : 'border-[var(--color-danger)]/30 bg-[var(--color-danger)]/[0.06] text-[var(--color-danger)]',
      )}
    >
      <Undo2 className="mr-1.5 inline h-3.5 w-3.5" />
      Compensation {compensation.status === 'done' ? 'ran' : 'failed'}
      {count > 0 ? ` for ${count} completed stage${count === 1 ? '' : 's'}` : ''}
      {compensation.detail ? ` — ${compensation.detail}` : ''}
    </div>
  );
}
