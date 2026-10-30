// ────────────────────────────────────────────────────────────────
// B-20 PlanReadyCard — the plan-review gate (PLN-01), where the agent produced
// the plan: "Plan ready for review · Revision 3". The plan document opens in
// the Plan dock tab; the card is the fast path for a straightforward
// Approve / Request changes. "Approve & run autonomously" is offered only when
// the server's `actions` include `implement_autopilot`.
//
// History has no live gate: a replayed card is read-only (its title still
// opens the plan when the surface can).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { PlanBlock } from '@generatorai/client-core';
import type { StatusState } from '@generatorai/shared';
import { PLAN_GATE_COPY as COPY } from '@generatorai/shared/ui-contract';
import { GateCardFrame, type GateAction, type GateTone } from '@/ui/patterns/GateCardFrame/GateCardFrame.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from '@/ui/primitives/Menu/Menu.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import type { PlanApproval } from '../transcriptContext.js';
import { gateKeyChips, gateKeyDown } from './gateKeys.js';

export interface PlanReadyCardProps {
  plan: PlanBlock;
  /** Opens the plan in the Plan dock tab. */
  onOpen?: ((planId: string) => void) | undefined;
  onApprove?: ((planId: string, action: PlanApproval) => void) | undefined;
  onRequestChanges?: ((planId: string, feedback: string) => void) | undefined;
  busy?: boolean;
}

/** Model titles and summaries arrive as markdown; the card shows them as plain text. */
export function toPlainText(value: string): string {
  return value
    .replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|>\s*)/gm, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STATUS_STATE: Record<PlanBlock['status'], StatusState> = {
  drafting: 'running',
  recorded: 'skipped',
  awaiting_review: 'needs_you',
  changes_requested: 'waiting',
  approved: 'succeeded',
  rejected: 'skipped',
  superseded: 'skipped',
  expired: 'skipped',
};

export function PlanReadyCard({ plan, onOpen, onApprove, onRequestChanges, busy = false }: PlanReadyCardProps) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const pending = plan.status === 'awaiting_review';
  const actionable = pending && (!!onApprove || !!onRequestChanges);
  const canAutopilot = plan.actions.includes('implement_autopilot');
  const title = toPlainText(plan.title);
  const summary = plan.summary ? toPlainText(plan.summary) : '';

  const approve = (action: PlanApproval) => onApprove?.(plan.planId, action);
  const sendFeedback = () => {
    const text = feedback.trim();
    if (!text) return;
    onRequestChanges?.(plan.planId, text);
    setFeedbackOpen(false);
    setFeedback('');
  };
  const cancelFeedback = () => {
    setFeedbackOpen(false);
    setFeedback('');
  };

  let actions: GateAction[] = [];
  if (actionable && !feedbackOpen) {
    actions = [
      ...(onOpen ? [{ label: COPY.actions.open_plan, variant: 'ghost' as const, onClick: () => onOpen(plan.planId) }] : []),
      ...(onRequestChanges ? [{ label: COPY.actions.request_changes, onClick: () => setFeedbackOpen(true), disabled: busy }] : []),
      ...(onApprove
        ? [
            {
              label: COPY.actions.approve,
              variant: 'primary' as const,
              shortcut: gateKeyChips('mod_enter'),
              onClick: () => approve('implement_interactive'),
              loading: busy,
              disabled: busy,
            },
          ]
        : []),
    ];
  } else if (actionable && feedbackOpen) {
    actions = [
      { label: COPY.actions.cancel_feedback, variant: 'ghost', shortcut: gateKeyChips('escape'), onClick: cancelFeedback },
      {
        label: COPY.actions.send_feedback,
        variant: 'primary',
        shortcut: gateKeyChips('mod_enter'),
        onClick: sendFeedback,
        disabled: busy || !feedback.trim(),
        loading: busy,
      },
    ];
  }

  const autopilotMenu =
    actionable && !feedbackOpen && canAutopilot && onApprove ? (
      <MenuRoot>
        <MenuTrigger render={<IconButton icon="chevron-down" label={COPY.moreApprovalOptions} size="sm" disabled={busy} />} />
        <MenuPopup align="end" side="top">
          <MenuItem description={COPY.autopilotHint} onClick={() => approve('implement_autopilot')}>
            {COPY.actions.approve_autopilot}
          </MenuItem>
        </MenuPopup>
      </MenuRoot>
    ) : undefined;

  const tone: GateTone = pending ? 'warn' : plan.status === 'approved' ? 'ok' : 'idle';
  const onKeyDown = actionable
    ? gateKeyDown(
        feedbackOpen
          ? { escape: cancelFeedback, mod_enter: sendFeedback }
          : { mod_enter: onApprove ? () => approve('implement_interactive') : undefined },
      )
    : undefined;

  return (
    <GateCardFrame
      tone={tone}
      icon="plan"
      title={pending ? COPY.title : title}
      meta={COPY.revision(plan.revision)}
      actions={actions}
      trailing={autopilotMenu}
      onKeyDown={onKeyDown}
      data-testid="plan-card"
      data-gai-block="plan"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {onOpen ? (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 self-start"
              icon="file-text"
              aria-label={COPY.openPlan(title)}
              onClick={() => onOpen(plan.planId)}
            >
              <span className="truncate text-ui font-medium text-fg">{title}</span>
            </Button>
          ) : (
            <span className="truncate text-ui font-medium text-fg">{title}</span>
          )}
          {plan.fileName ? <span className="truncate font-mono text-small text-fg-3">{plan.fileName}</span> : null}
          {summary && summary !== title ? <p className="line-clamp-2 text-ui text-fg-2">{summary}</p> : null}
        </div>
        <StatusBadge state={STATUS_STATE[plan.status]} label={COPY.status[plan.status]} className="shrink-0" />
      </div>
      {actionable && feedbackOpen ? (
        <label className="flex flex-col gap-1 text-small text-fg-2">
          {COPY.feedbackLabel}
          <Textarea autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={COPY.feedbackPlaceholder} />
        </label>
      ) : null}
    </GateCardFrame>
  );
}
