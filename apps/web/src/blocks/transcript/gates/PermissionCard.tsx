// ────────────────────────────────────────────────────────────────
// B-20 PermissionCard — the tool-permission gate ("Run this command?", "Open a page in the browser?": D-107).
//
// A chat set to ask before tools (`default` / `acceptEdits`) parks the agent on
// `chat.permission.requested` until the user allows or denies the call. Deny
// asks for an optional reason first. Replayed history has no handler: a card
// persisted while pending is expired (the SDK callback is gone), so it renders
// read-only. `inputSummary` arrives bounded and secret-redacted from the
// server and is shown verbatim.
//
// U-16 (D-147): "Allow <rule> for this chat / run" remembers the gate as the
// rules the server derived from the full request (`rememberRules`: `pnpm lint`,
// `ls`, or the tool's name); later requests they cover are allowed without a
// card. A gate that cannot be remembered (risky, an always-ask tool, a
// never-listed command) shows why instead of the action. The host says whose
// rules they are (`rememberScope`); without one only Allow once is offered.
// In a project (`projectScope`) a second action remembers them for the whole
// project — every chat and run in it, a team's workers included.
//
// A gate the server marked risky (mobile MG-04) carries a neutral "Risky"
// badge; on web and desktop the answer stays a click (signing is phone-only).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { PermissionBlock } from '@generatorai/client-core';
import { PERMISSION_GATE_COPY as COPY, permissionWording, type PermissionRuleScope } from '@generatorai/shared/ui-contract';
import { GateCardFrame, type GateAction, type GateTone } from '@/ui/patterns/GateCardFrame/GateCardFrame.js';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { gateInputText } from './gateInput.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { gateKeyChips, gateKeyDown } from './gateKeys.js';

/** How an answer is given: `remember` = "Allow for this chat / run" (`owner`, U-16) or "… for this project". */
export interface PermissionAnswerOptions {
  remember?: 'owner' | 'project';
}

export interface PermissionCardProps {
  permission: PermissionBlock;
  /** Submits the decision. Omitted for replayed history → read-only. */
  onAnswer?: ((interactionId: string, behavior: 'allow' | 'deny', message?: string, options?: PermissionAnswerOptions) => void) | undefined;
  /** Whose rules "Allow for this …" remembers (a chat, a workflow run). Omitted → Allow once only. */
  rememberScope?: PermissionRuleScope | undefined;
  /** The chat or run belongs to a project: also offer "Allow … for this project". */
  projectScope?: boolean | undefined;
  busy?: boolean;
}

/** One rule for a button label: a long command is cut, the rest counted ("pnpm lint +2"). */
function shortRules(matches: readonly string[]): string {
  const first = matches[0] ?? '';
  const cut = first.length > 32 ? `${first.slice(0, 31)}…` : first;
  return matches.length > 1 ? `${cut} +${matches.length - 1}` : cut;
}

export function PermissionCard({ permission, onAnswer, rememberScope, projectScope = false, busy = false }: PermissionCardProps) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const { status, toolName } = permission;
  const answerable = status === 'pending' && !!onAnswer;
  const ruleMatches = (permission.rememberRules ?? []).map((r) => r.match);

  const allow = () => onAnswer?.(permission.interactionId, 'allow');
  const allowForOwner = () => onAnswer?.(permission.interactionId, 'allow', undefined, { remember: 'owner' });
  const allowForProject = () => onAnswer?.(permission.interactionId, 'allow', undefined, { remember: 'project' });
  // Rules a project remembered (or that covered this gate) say so; otherwise they are the host's.
  const outcomeScope: PermissionRuleScope =
    permission.remembered?.length && permission.remembered.every((r) => r.scope === 'project') ? 'project' : (rememberScope ?? 'chat');
  const confirmDeny = () => {
    onAnswer?.(permission.interactionId, 'deny', reason.trim() || undefined);
    setDenying(false);
    setReason('');
  };
  const cancelDeny = () => {
    setDenying(false);
    setReason('');
  };

  const wording = permission.title && permission.kindLabel
    ? { title: permission.title, kindLabel: permission.kindLabel }
    : permissionWording(toolName, permission.permissionType);
  const title = answerable
    ? wording.title
    : status === 'allowed'
      ? COPY.titleAllowed
      : status === 'denied'
        ? COPY.titleDenied
        : COPY.titleExpired;
  const tone: GateTone = answerable ? 'warn' : status === 'allowed' ? 'ok' : status === 'denied' ? 'err' : 'idle';

  let actions: GateAction[] = [];
  if (answerable && !denying) {
    actions = [
      {
        label: COPY.actions.deny,
        ariaLabel: COPY.actionLabel('deny', toolName),
        shortcut: gateKeyChips('escape'),
        onClick: () => setDenying(true),
        disabled: busy,
      },
      ...(rememberScope && ruleMatches.length > 0
        ? [
            {
              label: COPY.allowForOwner(shortRules(ruleMatches), rememberScope),
              ariaLabel: COPY.allowForOwnerLabel(ruleMatches.join(', '), rememberScope),
              onClick: allowForOwner,
              disabled: busy,
              'data-testid': 'permission-allow-scope',
            } satisfies GateAction,
            ...(projectScope
              ? [
                  {
                    label: COPY.allowForOwner(shortRules(ruleMatches), 'project'),
                    ariaLabel: COPY.allowForOwnerLabel(ruleMatches.join(', '), 'project'),
                    onClick: allowForProject,
                    disabled: busy,
                    'data-testid': 'permission-allow-project',
                  } satisfies GateAction,
                ]
              : []),
          ]
        : []),
      {
        label: COPY.actions.allow_once,
        // WCAG 2.5.3 (label in name): the visible "Allow once" must be in the name
        // (the shared `actionLabel` says "Allow <tool>"; mobile keeps it).
        ariaLabel: `${COPY.actions.allow_once} ${toolName}`,
        variant: 'primary',
        shortcut: gateKeyChips('enter'),
        onClick: allow,
        disabled: busy,
        loading: busy,
      },
    ];
  } else if (answerable && denying) {
    actions = [
      { label: COPY.actions.cancel_deny, variant: 'ghost', shortcut: gateKeyChips('escape'), onClick: cancelDeny, disabled: busy },
      {
        label: COPY.actions.confirm_deny,
        ariaLabel: COPY.actionLabel('confirm_deny', toolName),
        variant: 'danger',
        shortcut: gateKeyChips('enter'),
        onClick: confirmDeny,
        disabled: busy,
        loading: busy,
      },
    ];
  }

  const onKeyDown = answerable
    ? gateKeyDown(denying ? { escape: cancelDeny, enter: confirmDeny } : { escape: () => setDenying(true), enter: allow })
    : undefined;

  return (
    <GateCardFrame
      tone={tone}
      icon="hand"
      title={title}
      meta={wording.kindLabel}
      actions={actions}
      onKeyDown={onKeyDown}
      data-testid="permission-card"
      data-gai-block="permission"
    >
      <div className="flex min-w-0 items-center gap-2 text-ui text-fg-2">
        <InlineCode>{toolName}</InlineCode>
        {permission.description ? <span className="min-w-0 text-fg">{permission.description}</span> : null}
        {permission.risk === 'risky' ? <Badge className="ml-auto shrink-0">{COPY.risky}</Badge> : null}
      </div>
      {permission.inputSummary ? (
        <CodeBlock wrap className="max-h-40 overflow-auto">
          {gateInputText(permission.inputSummary)}
        </CodeBlock>
      ) : null}
      {answerable && denying ? (
        <label className="flex flex-col gap-1 text-small text-fg-2">
          {COPY.denyReasonLabel}
          <Input
            autoFocus
            size="sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={COPY.denyReasonPlaceholder}
          />
        </label>
      ) : null}
      {answerable && rememberScope && ruleMatches.length === 0 && permission.rememberRefusal ? (
        <p className="text-small text-fg-3" data-testid="permission-remember-refusal">
          {permission.rememberRefusal}
        </p>
      ) : null}
      {status === 'allowed' || status === 'denied' ? (
        <p
          data-testid="permission-outcome"
          className={status === 'allowed' ? 'flex items-center gap-1.5 text-small text-ok' : 'flex items-center gap-1.5 text-small text-err'}
        >
          <Icon concept={status === 'allowed' ? 'status-succeeded' : 'status-failed'} size={14} />
          {status === 'allowed' && permission.remembered?.length
            ? COPY.outcomeRemembered(permission.remembered.map((r) => r.match).join(', '), outcomeScope)
            : status === 'allowed'
              ? COPY.outcomeAllowed
              : COPY.outcomeDenied}
          {permission.message ? `: ${permission.message}` : ''}
        </p>
      ) : null}
      {!answerable && (status === 'expired' || status === 'pending') ? <p className="text-small text-fg-3">{COPY.expired}</p> : null}
    </GateCardFrame>
  );
}
