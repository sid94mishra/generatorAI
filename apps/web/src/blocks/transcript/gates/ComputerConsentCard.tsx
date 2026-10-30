// ────────────────────────────────────────────────────────────────
// B-20 ComputerConsentCard — "Allow Bug Fixer to control this computer?"
// (G-07). One consent prompt from the computer-use desk: what is about to
// happen, the numbered planned actions of a batched request (mono), a Scope
// segment "<App> only / Any app" for the answers that can reach further, and
// Deny / Always allow / Allow for this chat / Allow once. The answer options
// and their reaches come from client-core's `consentAnswerOptions` (a
// synthetic pointer/keyboard prompt can never be answered "Always allow").
//
// Data: `ComputerPendingConsent` from the `computer:<ws>` scope. The prompt is
// not a stream block (05 GAP: a `computer_consent` block would let the
// transcript place and replay it), so the Computer dock (P4-11) hosts this
// card until that block exists.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { consentAnswerOptions } from '@generatorai/client-core';
import type { ComputerConsentDecision, ComputerConsentReach, ComputerPendingConsent } from '@generatorai/shared';
import { COMPUTER_CONSENT_GATE_COPY as COPY } from '@generatorai/shared/ui-contract';
import { GateCardFrame, type GateAction } from '@/ui/patterns/GateCardFrame/GateCardFrame.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { gateKeyChips, gateKeyDown } from './gateKeys.js';

export interface ComputerConsentCardProps {
  prompt: ComputerPendingConsent;
  /** Who asks ("Bug Fixer"). */
  agentName: string;
  /** Answers the prompt. Omitted → read-only. */
  onAnswer?: ((decision: ComputerConsentDecision, scope: ComputerConsentReach) => void) | undefined;
  busy?: boolean;
}

const ACTION_ID: Record<ComputerConsentDecision, keyof typeof COPY.actions> = {
  deny: 'consent_deny',
  always_allow: 'consent_always_allow',
  allow_run: 'consent_allow_run',
  allow_once: 'consent_allow_once',
};

/** Display order: Deny · Always allow · Allow for this chat · Allow once (primary). */
const ORDER: readonly ComputerConsentDecision[] = ['deny', 'always_allow', 'allow_run', 'allow_once'];

export function ComputerConsentCard({ prompt, agentName, onAnswer, busy = false }: ComputerConsentCardProps) {
  const [reach, setReach] = useState<ComputerConsentReach>('app');
  const options = consentAnswerOptions(prompt);
  const scoped = options.some((o) => o.scopes.length > 1);
  const answer = (decision: ComputerConsentDecision) => {
    const option = options.find((o) => o.decision === decision);
    if (!option) return;
    onAnswer?.(decision, option.scopes.includes(reach) ? reach : option.scopes[0]!);
  };

  const actions: GateAction[] = onAnswer
    ? ORDER.filter((d) => options.some((o) => o.decision === d)).map((decision) => ({
        label: COPY.actions[ACTION_ID[decision]],
        variant: decision === 'allow_once' ? ('primary' as const) : ('secondary' as const),
        ...(decision === 'deny' ? { shortcut: gateKeyChips('escape') } : {}),
        ...(decision === 'allow_once' ? { shortcut: gateKeyChips('enter') } : {}),
        onClick: () => answer(decision),
        disabled: busy,
      }))
    : [];

  return (
    <GateCardFrame
      icon="computer"
      title={COPY.title(agentName)}
      meta={prompt.path === 'synthetic' ? COPY.reachSynthetic : COPY.reachAccessibility}
      actions={actions}
      onKeyDown={onAnswer ? gateKeyDown({ escape: () => answer('deny'), enter: () => answer('allow_once') }) : undefined}
      data-testid="computer-consent-card"
      data-gai-block="computer-consent"
    >
      <p className="text-ui text-fg">
        {prompt.summary} <span className="text-fg-3">· {prompt.appLabel}</span>
      </p>
      {prompt.plan && prompt.plan.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-small text-fg-3">{COPY.plannedActions}</span>
          <ol className="flex list-decimal flex-col gap-0.5 pl-5 font-mono text-small text-fg-2">
            {prompt.plan.map((step, i) => (
              <li key={i}>
                {step.action}
                {step.target ? ` ${step.target}` : ''}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {scoped && onAnswer ? (
        <div className="flex items-center gap-2 text-small text-fg-2">
          <span>{COPY.scopeLabel}</span>
          <SegmentedControl<ComputerConsentReach>
            label={COPY.scopeLabel}
            value={reach}
            onValueChange={setReach}
            items={[
              { value: 'app', label: COPY.scopeApp(prompt.appLabel) },
              { value: 'any', label: COPY.scopeAny },
            ]}
          />
        </div>
      ) : null}
    </GateCardFrame>
  );
}
