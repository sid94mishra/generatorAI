// MB-15 permission gate: the command (MP-42 code block) and the explanation, then GATE_ACTIONS.permission — Deny
// (secondary) · Allow once (primary); Deny opens the optional reason with Cancel (quiet) · Confirm deny (danger).
// No "Always allow" (MD-55). A risky gate (MG-04, MD-31) is answered with the biometric-signed approval key: the
// row says "Face ID required" under it, asks to register the key first, or explains why this device cannot answer.
import React, { useState } from 'react';
import { View } from 'react-native';
import type { StreamBlock } from '@generatorai/client-core';
import { PERMISSION_GATE_COPY } from '@generatorai/shared/ui-contract';

import { ActionRow, type RowAction } from '../../ui/layout/ActionRow';
import { Badge } from '../../ui/primitives/Badge';
import { CodeText } from '../../ui/primitives/CodeText';
import { Input } from '../../ui/primitives/Input';
import { Text } from '../../ui/primitives/Text';
import { GateCardFrame } from './GateCardFrame';
import { permissionCategory, permissionView, riskyActionState, type ApprovalReadiness } from './model/gateModel';

type PermissionBlock = Extract<StreamBlock, { type: 'permission' }>;

export interface GateApproval {
  /** The gate is risky (MG-04, or the MD-31 fallback). */
  risky: boolean;
  readiness: ApprovalReadiness;
  /** "Face ID" / "fingerprint" (platform noun). */
  noun: string;
  onRegister: () => void;
  registering: boolean;
  /** The last prompt's outcome when it produced no signature; shown in place of the usual note. */
  error?: string | null;
}

export interface PermissionCardProps {
  block: PermissionBlock;
  /** Resolves when the server confirmed; rejects to keep the card pending (the caller toasts). */
  onDecide: (behavior: 'allow' | 'deny', message?: string) => Promise<void>;
  approval?: GateApproval;
}

export function PermissionCard({ block, onDecide, approval }: PermissionCardProps): React.ReactElement {
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const view = permissionView(block);
  const expired = block.status === 'expired';
  const risky = approval?.risky === true;
  const riskState = risky ? riskyActionState(approval.readiness, approval.noun) : null;

  const decide = (behavior: 'allow' | 'deny'): void => {
    if (pending) return;
    setPending(behavior);
    const message = behavior === 'deny' ? reason.trim() : '';
    void onDecide(behavior, message || undefined)
      .catch(() => undefined)
      .finally(() => setPending(null));
  };

  let actions: RowAction[];
  if (riskState?.needsRegistration) {
    actions = [{ id: 'register', label: 'Register approval key', role: 'primary', icon: 'key', loading: approval?.registering === true, onPress: () => approval?.onRegister(), testID: 'gate-permission-register' }];
  } else if (denying) {
    actions = [
      { id: 'cancel_deny', label: PERMISSION_GATE_COPY.actions.cancel_deny, role: 'quiet', onPress: () => setDenying(false), testID: 'gate-permission-cancel_deny' },
      {
        id: 'confirm_deny',
        label: PERMISSION_GATE_COPY.actions.confirm_deny,
        role: 'danger',
        loading: pending === 'deny',
        disabled: pending !== null || (riskState !== null && !riskState.canAnswer),
        accessibilityLabel: PERMISSION_GATE_COPY.actionLabel('confirm_deny', block.toolName),
        onPress: () => decide('deny'),
        testID: 'gate-permission-confirm_deny',
      },
    ];
  } else {
    const blocked = riskState !== null && !riskState.canAnswer;
    actions = [
      { id: 'deny', label: PERMISSION_GATE_COPY.actions.deny, role: 'secondary', disabled: pending !== null || blocked, accessibilityLabel: PERMISSION_GATE_COPY.actionLabel('deny', block.toolName), onPress: () => setDenying(true), testID: 'gate-permission-deny' },
      {
        id: 'allow_once',
        label: PERMISSION_GATE_COPY.actions.allow_once,
        role: 'primary',
        loading: pending === 'allow',
        disabled: pending !== null || blocked,
        ...(blocked && riskState ? { disabledReason: riskState.note } : {}),
        accessibilityLabel: PERMISSION_GATE_COPY.actionLabel('allow_once', block.toolName),
        onPress: () => decide('allow'),
        testID: 'gate-permission-allow_once',
      },
    ];
  }

  return (
    <GateCardFrame
      title={expired ? PERMISSION_GATE_COPY.titleExpired : PERMISSION_GATE_COPY.title}
      meta={permissionCategory(block.permissionType)}
      badge={risky ? <Badge label={PERMISSION_GATE_COPY.risky} tone="outline" size="sm" /> : null}
      expired={expired}
    >
      <CodeText form="block" code={view.code} maxLines={8} />
      {view.explanation ? (
        <Text role="footnote" tone="fg-3">
          {view.explanation}
        </Text>
      ) : null}
      {expired ? (
        <Text role="footnote" tone="fg-2">
          {PERMISSION_GATE_COPY.expired}
        </Text>
      ) : (
        <>
          {denying ? (
            <Input
              label={PERMISSION_GATE_COPY.denyReasonLabel}
              value={reason}
              onChangeText={setReason}
              placeholder={PERMISSION_GATE_COPY.denyReasonPlaceholder}
              presentation="standalone"
              autoFocus
              testID="gate-permission-reason"
            />
          ) : null}
          <View>
            <ActionRow actions={actions} {...(riskState ? { note: approval?.error ?? riskState.note } : {})} />
          </View>
        </>
      )}
    </GateCardFrame>
  );
}
