// ────────────────────────────────────────────────────────────────
// OperationCard — one row of the Home feed.
//
//   ┌────┐  Name, one line, cut with "…"             ⟳ Running
//   │ ◻  │  Workflow · 42m ago
//   └────┘
//   ───────  hairline, inset so it starts under the text, never the icon
//
// • The leading tile is the entity's glyph (ENTITY_ICON, the desktop
//   sidebar's icons), so a chat, a workflow and an automation read the same
//   here as in the drawer and in search.
// • The trailing slot is the status, icon and word, the way desktop's step
//   rows show it: a spinner while running, a tick when it completed, a cross
//   when it failed and a raised hand when it is waiting on you. It is not a
//   control. The whole row opens the chat, the run or the automation.
//
// No entering animation: the feed is history that already existed, and the
// spec reserves motion for genuinely new content.
// ────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { CheckCircle2, CircleDot, CircleSlash, Hand, XCircle } from 'lucide-react-native';

import type { Operation } from '../../api/activityRanking';
import { parseChatName } from '../common/chatName';
import { ENTITY_ICON } from '../common/entityIcons';
import { runTitle } from '../runs/runModel';
import { relativeTime } from '../runs/formatTime';
import { ListItem } from '../ui/ListItem';
import { operationState, operationStateLabel } from './operationStatus';
import { MAX_SCALE } from '../ui/accessibility';
import { Spinner } from '../ui/States';
import type { Tone } from '../ui/primitives';
import { useTheme } from '../../theme/ThemeProvider';

const KIND_ICON = {
  chat: ENTITY_ICON.chat,
  run: ENTITY_ICON.workflow,
  automation: ENTITY_ICON.automation,
} as const;

const KIND_LABEL = {
  chat: 'Chat',
  run: 'Workflow',
  automation: 'Automation',
} as const;

export function toneFor(op: Operation): Tone {
  // Failure is checked BEFORE `blocked`: a failed run satisfies both, and
  // amber for a failure is a genuine misreport.
  if (op.status === 'failed') return 'danger';
  if (op.blocked) return 'warning';
  if (op.running) return 'info';
  if (op.status === 'completed') return 'success';
  return 'neutral';
}

function StatusMark({ operation }: { operation: Operation }): React.ReactElement {
  const { colors } = useTheme();
  const state = operationState(operation);
  const label = operationStateLabel(operation);
  const color =
    state === 'failed'
      ? colors.danger
      : state === 'waiting'
        ? colors.warning
        : state === 'running'
          ? colors.info
          : state === 'completed'
            ? colors.success
            : colors['muted-foreground'];
  const icon =
    state === 'running' ? (
      <Spinner />
    ) : state === 'waiting' ? (
      <Hand size={15} color={color} />
    ) : state === 'completed' ? (
      <CheckCircle2 size={15} color={color} />
    ) : state === 'failed' ? (
      <XCircle size={15} color={color} />
    ) : state === 'cancelled' ? (
      <CircleSlash size={15} color={color} />
    ) : (
      <CircleDot size={15} color={color} />
    );
  return (
    <View className="flex-row items-center gap-1.5">
      {icon}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_SCALE.chrome}
        className="text-sm font-medium"
        style={{ color }}
      >
        {label}
      </Text>
    </View>
  );
}

export function OperationCard({
  operation,
  separator,
}: {
  operation: Operation;
  /** Retained for call-site compatibility; rows no longer stagger in. */
  index?: number;
  separator?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const Icon = KIND_ICON[operation.kind];
  const name =
    operation.kind === 'chat' ? parseChatName(operation.name) : { title: runTitle(operation.name), subAgent: false };
  const when = relativeTime(operation.updatedAt);
  const status = operationStateLabel(operation);

  const open = useCallback(() => {
    router.push(operation.href as never);
  }, [operation.href]);

  return (
    <ListItem
      title={name.title}
      titleBadge={name.subAgent ? { label: 'Sub-agent' } : null}
      subtitle={`${KIND_LABEL[operation.kind]} · ${when}`}
      avatar={{ icon: <Icon size={17} color={colors['muted-foreground']} />, tone: 'neutral' }}
      accessory={<StatusMark operation={operation} />}
      separator={separator}
      accessibilityLabel={`${KIND_LABEL[operation.kind]}, ${name.title}, ${status}, ${when}`}
      accessibilityHint={`Opens the ${KIND_LABEL[operation.kind].toLowerCase()}`}
      onPress={open}
    />
  );
}
