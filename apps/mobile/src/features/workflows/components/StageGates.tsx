// A stage's in-turn gates and approval waits (M8-03; MRunApproval, MRunStageChat; P03b, P05 §4.3): a tool permission,
// a question or a plan review inside a stage's turn are the chat's GateCards (MB-15), answered through the stage
// conversation API — a risky permission signed with the approval key (MG-05); an approval wait shows its prompt and
// its form (flat string / number / boolean / choice fields; raw JSON otherwise) and answers with the signed
// `approve` command (outcome approved / rejected, the form as `data`).
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { PermissionCard, PlanCard, QuestionCard, permissionRisk, permissionView, toPlanDecision, GateCardFrame, riskyActionState } from '../../../blocks/GateCard';
import { ActionRow } from '../../../ui/layout/ActionRow';
import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { errorText } from '../../../ui/lib/format';
import { Field } from '../../../ui/primitives/Field';
import { Input } from '../../../ui/primitives/Input';
import { Text } from '../../../ui/primitives/Text';
import { Textarea } from '../../../ui/primitives/Textarea';
import { toast } from '../../../ui/primitives/Toast';
import { useStageConversation } from '../queries';
import { useStageDecision } from '../useStageDecision';
import { formFields, type WaitView } from '../model/runStages';
import type { StageGate } from '../model/stageGate';

export function InTurnGateCard({ runId, instanceId, gate, onDone, onOpenStage }: { runId: string; instanceId: string; gate: Exclude<StageGate, { kind: 'review' } | { kind: 'loop' }>; onDone?: () => void; onOpenStage?: () => void }): React.ReactElement {
  const { signer, permission } = useStageDecision(runId, instanceId);
  const conversation = useStageConversation(runId, instanceId);
  const failed = (e: unknown): never => {
    toast({ kind: 'error', message: errorText(e) });
    throw e;
  };
  switch (gate.kind) {
    case 'permission': {
      const risky = permissionRisk(gate.block) === 'risky';
      return (
        <PermissionCard
          block={gate.block}
          onDecide={async (behavior, message) => {
            await permission({ interactionId: gate.interactionId, behavior, risky, summary: permissionView(gate.block).code, ...(message ? { message } : {}) });
            onDone?.();
          }}
          {...(risky ? { approval: { risky: true, readiness: signer.readiness, noun: signer.noun, onRegister: signer.register, registering: signer.registering, error: signer.error } } : {})}
        />
      );
    }
    case 'question':
      return (
        <QuestionCard
          block={gate.block}
          onSubmit={async (answers, freeform) => {
            await conversation.answer.mutateAsync({ interactionId: gate.interactionId, answers, ...(freeform ? { freeformResponse: freeform } : {}) }).catch(failed);
            onDone?.();
          }}
        />
      );
    default:
      return (
        <PlanCard
          plan={{ ...gate.plan, actions: gate.plan.actions ?? [] }}
          {...(onOpenStage ? { onOpenPlan: onOpenStage } : {})}
          onDecide={async (action, feedback) => {
            await conversation.plan.mutateAsync({ interactionId: gate.interactionId, ...toPlanDecision(action, feedback) }).catch(failed);
            onDone?.();
          }}
        />
      );
  }
}

type FormValue = string | boolean;

export function ApprovalWaitCard({ runId, instanceId, name, wait, version, onDone }: { runId: string; instanceId: string; name: string; wait: WaitView; version?: number; onDone?: () => void }): React.ReactElement {
  const { signer, decide } = useStageDecision(runId, instanceId);
  const fields = useMemo(() => formFields(wait.form), [wait.form]);
  const [values, setValues] = useState<Record<string, FormValue>>({});
  const [json, setJson] = useState('{}');
  const [pending, setPending] = useState<'approved' | 'rejected' | null>(null);
  const risk = riskyActionState(signer.readiness, signer.noun);

  const data = (): { ok: true; value?: Record<string, unknown> } | { ok: false; error: string } => {
    if (!wait.form) return { ok: true };
    if (fields === null) {
      try {
        const parsed: unknown = JSON.parse(json || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'The form is a JSON object' };
        return { ok: true, value: parsed as Record<string, unknown> };
      } catch (e) {
        return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
      }
    }
    const missing = fields.find((f) => f.required && (values[f.name] === undefined || values[f.name] === ''));
    if (missing) return { ok: false, error: `${missing.name} is required` };
    const value: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (v === undefined || v === '') continue;
      value[f.name] = f.type === 'number' ? Number(v) : v;
    }
    return { ok: true, value };
  };
  const form = data();
  const send = (outcome: 'approved' | 'rejected'): void => {
    if (outcome === 'approved' && !form.ok) return;
    setPending(outcome);
    void decide({ outcome, name, ...(outcome === 'approved' && form.ok && form.value ? { data: form.value } : {}), ...(version !== undefined ? { expectedVersion: version } : {}) })
      .then(() => onDone?.())
      .catch(() => undefined)
      .finally(() => setPending(null));
  };

  return (
    <GateCardFrame title={name} meta="Approval">
      {wait.prompt ? (
        <Text role="body" selectable>
          {wait.prompt}
        </Text>
      ) : null}
      {wait.form && fields === null ? (
        <Field {...(!form.ok ? { error: form.error } : {})}>
          <Textarea label="Form (JSON)" value={json} onChangeText={setJson} mono minRows={4} testID="wait-form-json" />
        </Field>
      ) : null}
      {fields?.length ? (
        <ListSection>
          {fields.map((f) =>
            f.type === 'boolean' ? (
              <ListRow key={f.name} kind="toggle" title={f.name} switchValue={values[f.name] === true} onValueChange={(v) => setValues({ ...values, [f.name]: v })} />
            ) : f.options ? (
              <ListRow key={f.name} kind="picker" title={f.name} picker={{ value: typeof values[f.name] === 'string' ? (values[f.name] as string) : null, placeholder: 'Choose', options: f.options.map((o) => ({ value: o, label: o })), onValueChange: (v) => setValues({ ...values, [f.name]: v }) }} />
            ) : (
              <Input key={f.name} label={`${f.name}${f.required ? ' · required' : ''}`} value={typeof values[f.name] === 'string' ? (values[f.name] as string) : ''} onChangeText={(v) => setValues({ ...values, [f.name]: v })} kind={f.type === 'number' ? 'number' : 'text'} testID={`wait-form-${f.name}`} />
            ),
          )}
        </ListSection>
      ) : null}
      {fields && !form.ok ? (
        <Text role="footnote" tone="err">
          {form.error}
        </Text>
      ) : null}
      <View>
        <ActionRow
          actions={
            risk.needsRegistration
              ? [{ id: 'register', label: 'Register approval key', role: 'primary', icon: 'key', loading: signer.registering, onPress: signer.register }]
              : [
                  { id: 'reject', label: 'Reject', role: 'danger', loading: pending === 'rejected', disabled: pending !== null || !risk.canAnswer, onPress: () => send('rejected'), testID: 'wait-reject' },
                  { id: 'approve', label: 'Approve', role: 'primary', loading: pending === 'approved', disabled: pending !== null || !risk.canAnswer || !form.ok, onPress: () => send('approved'), testID: 'wait-approve' },
                ]
          }
          note={signer.error ?? risk.note}
        />
      </View>
    </GateCardFrame>
  );
}
