// ────────────────────────────────────────────────────────────────
// Computer consent card, dock twin (F-dock-05; G-07 as built).
//
// One prompt: "Allow <action> on <app>?", its summary, the numbered plan when
// one request carries several actions (answered once for the batch), the
// Scope segment ("<app> only" / "Any app") for the answers that can reach
// beyond this app, and the answers the server accepts for this prompt
// (`consentAnswerOptions`: a synthetic prompt never offers "Always allow").
// The card disappears when the prompt expires (an unanswered prompt is a
// denial) — the caller filters with `selectPendingConsent`.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { consentAnswerOptions } from '@generatorai/client-core';
import type { ComputerConsentDecision, ComputerConsentReach, ComputerPendingConsent } from '@generatorai/shared';
import { GateCardFrame, type GateAction } from '@/ui/patterns/GateCardFrame/GateCardFrame.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Icon } from '@/ui/icons/Icon.js';
import { useAnswerComputerConsent } from '@/hooks/computerQueries.js';

const DECISION_LABEL: Record<ComputerConsentDecision, string> = {
  deny: 'Deny',
  always_allow: 'Always allow',
  allow_run: 'Allow this run',
  allow_once: 'Allow once',
};

/** Left to right: the least to the most permissive default stays rightmost (primary). */
const ORDER: ComputerConsentDecision[] = ['deny', 'always_allow', 'allow_run', 'allow_once'];

export interface ComputerConsentCardProps {
  workspaceId: string;
  prompt: ComputerPendingConsent;
}

export function ComputerConsentCard({ workspaceId, prompt }: ComputerConsentCardProps) {
  const answer = useAnswerComputerConsent(workspaceId);
  const [reach, setReach] = useState<ComputerConsentReach>('app');
  const options = consentAnswerOptions(prompt);
  const hasScope = options.some((o) => o.scopes.length > 1);
  const synthetic = prompt.path === 'synthetic';

  const actions: GateAction[] = ORDER.flatMap((decision) => {
    const option = options.find((o) => o.decision === decision);
    if (!option) return [];
    return [
      {
        label: DECISION_LABEL[decision],
        variant: decision === 'allow_once' ? 'primary' : 'secondary',
        disabled: answer.isPending,
        'data-testid': `computer-consent-${decision.replace('_', '-')}`,
        onClick: () =>
          answer.mutate({
            requestId: prompt.requestId,
            appIdentity: prompt.appIdentity,
            decision,
            // A reach the answer cannot take falls back to its only one.
            scope: option.scopes.includes(reach) ? reach : option.scopes[0]!,
          }),
      },
    ];
  });

  return (
    <GateCardFrame
      icon="hand"
      title={
        <>
          Allow {prompt.action} on {prompt.appLabel}?
        </>
      }
      meta={synthetic ? 'Keyboard & mouse' : 'Screen'}
      actions={actions}
      data-testid="computer-consent-card"
    >
      {prompt.summary ? <p className="text-ui text-fg-2">{prompt.summary}</p> : null}
      {prompt.plan && prompt.plan.length > 0 ? (
        <ol className="flex flex-col gap-1 rounded-card bg-sunken px-3 py-2 font-mono text-small text-fg">
          {prompt.plan.map((step, i) => (
            <li key={i} className="flex min-w-0 gap-3">
              <span className="w-4 shrink-0 text-right text-fg-3">{i + 1}</span>
              <span className="w-12 shrink-0">{step.action}</span>
              {step.target ? <span className="min-w-0 truncate">{step.target}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {synthetic ? (
        <p className="flex items-center gap-1.5 text-small text-warn">
          <Icon concept="warning" size={12} />
          This takes over your keyboard and mouse.
        </p>
      ) : null}
      {hasScope ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-small text-fg-3">Scope</span>
          <SegmentedControl<ComputerConsentReach>
            label="Scope"
            value={reach}
            onValueChange={setReach}
            items={[
              { value: 'app', label: `${prompt.appLabel || 'This app'} only` },
              { value: 'any', label: 'Any app' },
            ]}
          />
          <span className="min-w-0 text-small text-fg-3">Applies to “Allow this run” and “Always allow”.</span>
        </div>
      ) : null}
    </GateCardFrame>
  );
}
