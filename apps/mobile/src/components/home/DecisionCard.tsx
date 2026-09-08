// ────────────────────────────────────────────────────────────────
// DecisionCard — one thing waiting for a person.
//
// Used by the Home approvals queue and the `/approvals` sheet. The card
// says four things in reading order: what it is waiting for, which chat or
// run, how long, and what you can do about it right here. For a tool
// permission the answer can be given on the card (Allow / Deny — never
// alike, see PermissionCard); a question or a plan needs its own surface,
// so those cards open it.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { CircleHelp, ClipboardList, MessagesSquare, ShieldAlert, Workflow } from 'lucide-react-native';

import type { Operation } from '../../api/activityRanking';
import { relativeTime } from '../runs/formatTime';
import { statusLabel } from '../runs/statusStyle';
import { Button } from '../ui/Button';
import { Badge, Card, type Tone } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { useCardEntering } from '../common/enterMotion';
import { useTheme } from '../../theme/ThemeProvider';

export interface DecisionCardProps {
  operation: Operation;
  /** Open the chat/run (or, for a gate, its sheet). */
  onOpen: () => void;
  /** Present only for a tool-permission gate. Resolves when the server has answered. */
  onPermission?: (behavior: 'allow' | 'deny') => Promise<void>;
  /** Suppresses the entering spring — the sheet lists many at once. */
  animate?: boolean;
}

function describe(op: Operation): { title: string; badge: string; tone: Tone; Icon: typeof ShieldAlert } {
  if (op.kind === 'run') {
    const failed = op.status === 'failed';
    return {
      title: failed ? 'Run failed' : 'Stage needs approval',
      badge: statusLabel(op.status),
      tone: failed ? 'danger' : 'warning',
      Icon: Workflow,
    };
  }
  const gate = op.gate;
  if (gate?.kind === 'tool_permission') {
    return { title: gate.summary, badge: 'Permission', tone: 'danger', Icon: ShieldAlert };
  }
  if (gate?.kind === 'question') {
    return { title: gate.summary, badge: 'Question', tone: 'info', Icon: CircleHelp };
  }
  if (gate?.kind === 'plan_review') {
    return {
      title: gate.subject ? `Review plan: ${gate.subject}` : 'Review plan',
      badge: 'Plan',
      tone: 'primary',
      Icon: ClipboardList,
    };
  }
  return { title: 'Waiting for you', badge: 'Needs you', tone: 'warning', Icon: MessagesSquare };
}

export function DecisionCard({
  operation,
  onOpen,
  onPermission,
  animate = true,
}: DecisionCardProps): React.ReactElement {
  const { colors } = useTheme();
  const entering = useCardEntering();
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null);
  const { title, badge, tone, Icon } = describe(operation);
  const iconColor =
    tone === 'danger'
      ? colors.danger
      : tone === 'info'
        ? colors.info
        : tone === 'primary'
          ? colors.primary
          : colors.warning;
  const waiting = `since ${relativeTime(operation.updatedAt)}`;
  const where = operation.kind === 'run' ? 'Run' : 'Chat';

  const decide = async (behavior: 'allow' | 'deny'): Promise<void> => {
    if (!onPermission || pending) return;
    setPending(behavior);
    try {
      await onPermission(behavior);
    } finally {
      setPending(null);
    }
  };

  const borderClass =
    tone === 'danger'
      ? 'border-danger'
      : tone === 'info'
        ? 'border-info'
        : tone === 'primary'
          ? 'border-primary'
          : 'border-warning';

  return (
    <Animated.View entering={animate ? entering : undefined}>
      <Card className={`gap-3 p-3.5 ${borderClass}`}>
        <Touchable
          accessibilityLabel={`${title}. ${where}: ${operation.name}, waiting ${waiting}`}
          accessibilityHint="Opens it"
          haptic="tap"
          scale="large"
          ripple={false}
          onPress={onOpen}
          className="gap-2"
        >
          <View className="flex-row items-center gap-2.5">
            <View className="h-8 w-8 items-center justify-center rounded-2xl bg-subtle">
              <Icon size={16} color={iconColor} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text numberOfLines={2} className="text-md font-semibold text-foreground">
                {title}
              </Text>
              <Text numberOfLines={1} className="text-xs text-muted-foreground">
                {where} · {operation.name}
              </Text>
            </View>
            <Badge label={badge} tone={tone} />
          </View>
          <Text className="text-xs text-muted-foreground">Waiting {waiting}</Text>
        </Touchable>

        {/* Each button sits in its own flex-1 cell: `full` alone makes both
            100 % wide and the row overflows the card (seen in the Sept 7
            web-preview run, where the whole Home list scrolled sideways). */}
        {onPermission && operation.gate?.kind === 'tool_permission' ? (
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                label="Deny"
                variant="danger"
                size="md"
                grow
                loading={pending === 'deny'}
                disabled={pending !== null}
                onPress={() => void decide('deny')}
              />
            </View>
            <View className="flex-1">
              <Button
                label="Allow"
                variant="primary"
                size="md"
                grow
                loading={pending === 'allow'}
                disabled={pending !== null}
                onPress={() => void decide('allow')}
              />
            </View>
          </View>
        ) : (
          <Button
            label={operation.kind === 'run' ? 'Open run' : 'Open'}
            variant="secondary"
            size="sm"
            haptic="tap"
            onPress={onOpen}
          />
        )}
      </Card>
    </Animated.View>
  );
}
