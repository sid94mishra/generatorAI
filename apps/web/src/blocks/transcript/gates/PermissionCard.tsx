// ────────────────────────────────────────────────────────────────
// B-20 PermissionCard — the tool-permission gate ("Allow this command?").
//
// A chat set to ask before tools (`default` / `acceptEdits`) parks the agent on
// `chat.permission.requested` until the user allows or denies the call. Deny
// asks for an optional reason first. Replayed history has no handler: a card
// persisted while pending is expired (the SDK callback is gone), so it renders
// read-only. `inputSummary` arrives bounded and secret-redacted from the
// server and is shown verbatim.
//
// The board's "Always in this chat" needs a server-side standing grant the
// permission API does not have (it answers allow | deny per request); it is
// not rendered (D-36).
//
// A gate the server marked risky (mobile MG-04) carries a neutral "Risky"
// badge; on web and desktop the answer stays a click (signing is phone-only).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { PermissionBlock } from '@generatorai/client-core';
import { PERMISSION_GATE_COPY as COPY } from '@generatorai/shared/ui-contract';
import { GateCardFrame, type GateAction, type GateTone } from '@/ui/patterns/GateCardFrame/GateCardFrame.js';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { gateKeyChips, gateKeyDown } from './gateKeys.js';

export interface PermissionCardProps {
  permission: PermissionBlock;
  /** Submits the decision. Omitted for replayed history → read-only. */
  onAnswer?: ((interactionId: string, behavior: 'allow' | 'deny', message?: string) => void) | undefined;
  busy?: boolean;
}

export function PermissionCard({ permission, onAnswer, busy = false }: PermissionCardProps) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const { status, toolName } = permission;
  const answerable = status === 'pending' && !!onAnswer;

  const allow = () => onAnswer?.(permission.interactionId, 'allow');
  const confirmDeny = () => {
    onAnswer?.(permission.interactionId, 'deny', reason.trim() || undefined);
    setDenying(false);
    setReason('');
  };
  const cancelDeny = () => {
    setDenying(false);
    setReason('');
  };

  const title = answerable
    ? COPY.title
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
      {
        label: COPY.actions.allow_once,
        ariaLabel: COPY.actionLabel('allow_once', toolName),
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
      meta={permission.permissionType}
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
          {permission.inputSummary}
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
      {status === 'allowed' || status === 'denied' ? (
        <p
          data-testid="permission-outcome"
          className={status === 'allowed' ? 'flex items-center gap-1.5 text-small text-ok' : 'flex items-center gap-1.5 text-small text-err'}
        >
          <Icon concept={status === 'allowed' ? 'status-succeeded' : 'status-failed'} size={14} />
          {status === 'allowed' ? COPY.outcomeAllowed : COPY.outcomeDenied}
          {permission.message ? `: ${permission.message}` : ''}
        </p>
      ) : null}
      {!answerable && (status === 'expired' || status === 'pending') ? <p className="text-small text-fg-3">{COPY.expired}</p> : null}
    </GateCardFrame>
  );
}
