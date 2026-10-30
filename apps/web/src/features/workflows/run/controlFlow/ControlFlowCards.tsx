// ────────────────────────────────────────────────────────────────
// ControlFlowCards — the run page's cards of the P05 5B kinds, on the kit.
//
//   WaitCard            a wait (P05 §4.3): an approval (its prompt and a form
//                       from the wait's JSON Schema → approve / reject), an
//                       event (its key, the callback URL external systems
//                       POST to, and a "Deliver event" form for operators:
//                       the `deliver_event` run command), a timer (a
//                       countdown); once resolved, its outcome.
//   SubworkflowCard     a sub-workflow (P05 §4.2): the child run (a link) and
//                       the child's pending decisions, mirrored here.
//   PendingDecisionCard one pending decision of a (child) run: an approval
//                       wait, a completion review, a parked loop.
//   NeedsDecisionPanel  every decision the run waits on (`GET
//                       /pending-decisions`), mirrored ones with the
//                       sub-workflow they came through.
//   CompensationBadge   a stage that declares compensation actions.
//   CompensationBanner  the finalize `compensate` phase of a failed or cancelled run.
//
// Every button is a run command: a mirrored decision goes to the child run
// that owns it. A refused command is toasted by the page's command hook.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { toStatus, type PendingDecisionView } from '@generatorai/shared';
import type { RunCommand } from '@generatorai/workflow-spec';
import { useWorkflowRun } from '@/hooks/workflowQueries.js';
import { copyTextToClipboard } from '@/utils/copyToClipboard.js';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { GateCardFrame } from '@/ui/patterns/GateCardFrame/GateCardFrame.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { DecisionCard } from './DecisionCard.js';
import { loopDecisionOf } from '../model/loopView.js';
import type { LoopView, StageView, WaitView } from '../model/types.js';
import { formatWhen } from '@/lib/formatWhen.js';

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

/** A settled or informational card (an outcome, a timer, a child run). */
const MUTED_CARD = 'flex flex-col gap-2 rounded-card border border-line-soft bg-sunken p-3 text-small text-fg-2';
const FIELD_LABEL = 'text-small font-medium text-fg-2';

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

type FormValue = { ok: true; data: Record<string, unknown> | undefined } | { ok: false; error: string };

export function SchemaForm({
  schema,
  onChange,
  disabled,
}: {
  schema: Record<string, unknown> | undefined;
  /** The value, or an error message while it is not valid JSON / misses a required field. */
  onChange: (value: FormValue) => void;
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
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL}>Form (JSON)</span>
        <Textarea value={json} onChange={(e) => setJson(e.target.value)} rows={4} textareaClassName="font-mono text-small" disabled={disabled} />
      </label>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {fields.map((f) => {
        const title = f.title ?? f.name;
        const hint = f.description ? <span className="text-small text-fg-3">{f.description}</span> : null;
        if (f.type === 'boolean') {
          return (
            <div key={f.name} className="flex flex-col gap-1">
              <Checkbox
                label={title}
                checked={values[f.name] === true}
                disabled={disabled}
                onCheckedChange={(checked) => setValues((v) => ({ ...v, [f.name]: checked }))}
              />
              {hint}
            </div>
          );
        }
        return (
          <label key={f.name} className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>
              {title}
              {f.required && <span className="text-err"> *</span>}
            </span>
            {f.type === 'enum' ? (
              <Select
                value={String(values[f.name] ?? '')}
                disabled={disabled}
                aria-label={title}
                onValueChange={(value) => setValues((v) => ({ ...v, [f.name]: value || undefined }))}
                items={[{ value: '', label: '—' }, ...f.options!.map((o) => ({ value: o, label: o }))]}
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
            {hint}
          </label>
        );
      })}
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

function FormError({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-1 text-small text-err" role="alert">
      <Icon concept="status-failed" size={12} />
      {children}
    </p>
  );
}

/**
 * An approval wait's decision: the prompt, its form, approve / reject. Titled with the stage's name ("Ship it?"):
 * the prompt's `label` is a key ("ship").
 */
export function WaitApproval({ title, wait, onDecide, busy }: { title: string; wait: WaitView; onDecide: (outcome: 'approved' | 'rejected', data?: Record<string, unknown>) => void; busy?: boolean }) {
  const [form, setForm] = useState<FormValue>({ ok: true, data: undefined });
  return (
    <GateCardFrame
      tone="warn"
      icon="hand"
      title={title}
      explanation={wait.onReject === 'complete' ? 'Reject completes it with outcome rejected' : 'Reject stops the run: no commit, push or PR'}
      aria-live="polite"
      actions={[
        { label: 'Reject', variant: 'secondary', disabled: busy, onClick: () => onDecide('rejected') },
        { label: 'Approve', variant: 'primary', disabled: busy || !form.ok, onClick: () => form.ok && onDecide('approved', form.data) },
      ]}
    >
      {wait.prompt && <p className="whitespace-pre-wrap text-ui text-fg">{wait.prompt}</p>}
      {wait.until !== undefined && (
        <p className="flex items-center gap-1 text-small text-fg-3">
          <Icon concept="clock" size={12} />
          <span>
            Times out in <Countdown until={wait.until} /> ({wait.onTimeout === 'complete' ? 'then completes with outcome timeout' : 'then fails'})
          </span>
        </p>
      )}
      <SchemaForm schema={wait.form} onChange={setForm} {...(busy ? { disabled: true } : {})} />
      {!form.ok && <FormError>{form.error}</FormError>}
    </GateCardFrame>
  );
}

/** Copies the callback URL; the glyph turns into a check for a moment (D-30: no success toast). */
function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <IconButton
      size="sm"
      icon={copied ? 'check' : 'copy'}
      label="Copy the callback URL"
      tooltip={copied ? 'Copied' : true}
      onClick={() =>
        void copyTextToClipboard(url).then(
          () => setCopied(true),
          () => toast.error('Could not copy the callback url'),
        )
      }
    />
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
    <GateCardFrame
      tone="warn"
      icon="webhook"
      title={
        <>
          Waiting for the event <span className="font-mono">{wait.eventKey ?? '…'}</span>
        </>
      }
      actions={[
        {
          label: 'Deliver event',
          variant: 'secondary',
          disabled: busy || !wait.eventKey || !idem.trim() || !parsed.ok,
          onClick: () =>
            parsed.ok &&
            wait.eventKey &&
            onDeliver({ eventKey: wait.eventKey, idempotencyKey: idem.trim(), ...(parsed.value !== undefined ? { data: parsed.value } : {}) }),
        },
      ]}
    >
      {wait.until !== undefined && (
        <p className="flex items-center gap-1 text-small text-fg-3">
          <Icon concept="clock" size={12} />
          <span>
            Times out in <Countdown until={wait.until} />
          </span>
        </p>
      )}
      {wait.callback && (
        <div className="flex flex-col gap-1">
          <p className="text-small text-fg-3">
            External systems deliver it with no credential: <InlineCode dense>POST</InlineCode> <InlineCode dense>{'{data?, idempotencyKey?}'}</InlineCode> to
          </p>
          <div className="flex min-w-0 items-center gap-1.5">
            <InlineCode className="min-w-0 flex-1 truncate" title={wait.callback.url}>
              {wait.callback.url}
            </InlineCode>
            <CopyUrlButton url={wait.callback.url} />
          </div>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Idempotency key</span>
          <Input value={idem} onChange={(e) => setIdem(e.target.value)} placeholder="e.g. build-1234" disabled={busy} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={FIELD_LABEL}>Data (JSON, optional)</span>
          <Textarea value={data} onChange={(e) => setData(e.target.value)} rows={2} textareaClassName="font-mono text-small" disabled={busy} />
        </label>
      </div>
      {!parsed.ok && <FormError>{parsed.error}</FormError>}
    </GateCardFrame>
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
          Outcome <span className="font-semibold text-fg">{wait.outcome.outcome}</span>
          {wait.outcome.by && <span className="text-fg-3"> · by {wait.outcome.by}</span>}
          {wait.outcome.at > 0 && <span className="text-fg-3"> · {formatWhen(wait.outcome.at)}</span>}
        </p>
        {wait.outcome.data !== null && wait.outcome.data !== undefined && (
          <pre className="max-h-40 overflow-auto font-mono text-micro break-all whitespace-pre-wrap text-fg-2">{pretty(wait.outcome.data)}</pre>
        )}
      </div>
    );
  }
  if (stage.rawStatus !== 'waiting') {
    return (
      <p className="text-small text-fg-3">
        {wait.type === 'approval' ? 'Waits for an approval' : wait.type === 'event' ? 'Waits for an event' : 'Waits for a timer'}
        {stage.status === 'failed' && stage.error ? ` — ${stage.error}` : ''}.
      </p>
    );
  }
  if (wait.type === 'approval') {
    return (
      <WaitApproval
        title={stage.name}
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
    <div className={cn(MUTED_CARD, 'flex-row items-center gap-1.5')}>
      <Icon concept="clock" size={14} className="text-fg-3" />
      <span>Timer: continues in {wait.until !== undefined ? <Countdown until={wait.until} /> : 'a moment'}.</span>
    </div>
  );
}

/** The wait row's header badge. */
export function WaitBadge({ wait }: { wait: WaitView }) {
  return (
    <Badge icon={wait.type === 'timer' ? 'clock' : wait.type === 'event' ? 'webhook' : 'hand'}>
      {wait.type}
    </Badge>
  );
}

// ── Decisions (one, mirrored or not) ───────────────────────────

/** One pending decision of a (child) run; its commands go to the run that owns it. */
export function PendingDecisionCard({ decision }: { decision: PendingDecisionView }) {
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
      onReject: d['onReject'] === 'complete' ? 'complete' : 'fail',
      ...(decision.callback ? { callback: decision.callback } : {}),
    };
    return wait.type === 'event' ? (
      <WaitEvent wait={wait} busy={busy} onDeliver={(e) => void send({ command: 'deliver_event', ...e })} />
    ) : (
      <WaitApproval
        title={decision.name}
        wait={wait}
        busy={busy}
        onDecide={(outcome, data) => void send({ command: 'approve', instanceId: decision.instanceId, outcome, ...(data ? { data } : {}) })}
      />
    );
  }
  const loopDecision = loopDecisionOf(decision.interruptData);
  if (loopDecision) {
    const loop: LoopView = {
      k: loopDecision.k,
      max: loopDecision.maxIterations,
      phase: 'parked',
      rules: [],
      exitReason: loopDecision.reason,
      exitAction: loopDecision.action,
      operatorInput: null,
      decision: loopDecision,
    };
    return <DecisionCard loopId={decision.instanceId} loop={loop} decision={loopDecision} version={decision.version} onCommand={(c) => send(c)} />;
  }
  if (decision.kind === 'stage_completion_review') {
    const reason = typeof d['reason'] === 'string' ? d['reason'] : typeof d['prompt'] === 'string' ? d['prompt'] : 'The stage is waiting for your approval.';
    return (
      <GateCardFrame
        tone="warn"
        icon="hand"
        title={`Review ${decision.name}`}
        actions={[
          { label: 'Reject', variant: 'secondary', disabled: busy, onClick: () => void send({ command: 'approve', instanceId: decision.instanceId, outcome: 'rejected' }) },
          { label: 'Approve', variant: 'primary', disabled: busy, onClick: () => void send({ command: 'approve', instanceId: decision.instanceId, outcome: 'approved' }) },
        ]}
      >
        <p className="text-ui text-fg">{reason}</p>
      </GateCardFrame>
    );
  }
  // An in-turn gate (tool permission, question, plan) is answered in the child run's page.
  return (
    <p className={cn(MUTED_CARD, 'flex-row items-center gap-1.5')}>
      <Icon concept="hand" size={12} className="text-warn" />
      <span>
        {decision.name} asks for an answer ({decision.kind.replace(/_/g, ' ')}); answer it in the child run.
      </span>
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
  const childStatus = child ? toStatus('workflowRun', child.status) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className={cn(MUTED_CARD, 'flex-row flex-wrap items-center gap-2')}>
        <Icon concept="workflows" size={14} className="text-fg-3" />
        {childRunId ? (
          <>
            <span>Child run</span>
            {child ? (
              <Link render={<RouterLink to={`/workflows/${child.workflowDefinitionId}/runs/${childRunId}`} />} className="font-medium">
                {child.name}
                <Icon concept="forward" size={12} />
              </Link>
            ) : (
              <span className="font-mono text-micro">{childRunId}</span>
            )}
            {childStatus ? <StatusBadge state={childStatus.state} {...(childStatus.label ? { label: childStatus.label } : {})} /> : null}
          </>
        ) : (
          <span className="text-fg-3">
            {stage.status === 'failed' ? `The child run could not start${stage.error ? `: ${stage.error}` : ''}` : 'Starting the child run…'}
          </span>
        )}
      </div>
      {mirrored.map((d) => (
        <div key={`${d.runId}:${d.instanceId}`} className="flex flex-col gap-1">
          <p className="text-small font-medium text-fg-2">
            {d.name} <span className="font-normal text-fg-3">· via {viaText(d)}</span>
          </p>
          <PendingDecisionCard decision={d} />
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
    <section className="flex flex-col gap-1 rounded-card border border-line bg-warn-bg p-2" aria-label="Needs decision">
      <p className="flex items-center gap-1.5 px-1 text-small font-semibold text-fg">
        <Icon concept="hand" size={14} className="text-warn" />
        Needs decision ({decisions.length})
      </p>
      <ul className="flex flex-col">
        {decisions.map((d) => {
          const target = d.runId === runId ? d.instanceId : (d.via[0]?.instanceId ?? d.instanceId);
          return (
            <li key={`${d.runId}:${d.instanceId}`}>
              <Button variant="ghost" size="sm" fullWidth className="justify-start" onClick={() => onFocus(target)}>
                <span className="font-medium text-fg">{d.name}</span>
                <span className="ml-2 font-normal text-fg-3">
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
    <Badge
      icon="undo"
      className="hidden md:inline-flex"
      title="Declares compensation: when the run fails or is cancelled, its undo actions run (last completed first)"
    >
      compensates
    </Badge>
  );
}

/** The finalize `compensate` phase result of a failed or cancelled run. */
export function CompensationBanner({ compensation, count }: { compensation: { status: 'done' | 'failed'; detail?: string; at: number }; count: number }) {
  return (
    <Callout tone={compensation.status === 'done' ? 'neutral' : 'err'} icon="undo">
      Compensation {compensation.status === 'done' ? 'ran' : 'failed'}
      {count > 0 ? ` for ${count} completed stage${count === 1 ? '' : 's'}` : ''}
      {compensation.detail ? ` — ${compensation.detail}` : ''}
    </Callout>
  );
}
