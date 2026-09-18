// ────────────────────────────────────────────────────────────────
// OperationCard — one row of the Home feed.
//
// Chats, runs and automations share one flat `ListItem` so the feed reads
// as one list. The avatar carries kind (glyph) and state (tint + live dot);
// status is also spelled out in the subtitle, never colour alone.
//
// No entering animation: the feed is history that already existed, and the
// spec reserves motion for genuinely new content.
// ────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { router } from 'expo-router';
import { Bot, MessagesSquare, Workflow } from 'lucide-react-native';

import type { Operation } from '../../api/activityRanking';
import { parseChatName } from '../common/chatName';
import { runTitle } from '../runs/runModel';
import { relativeTime } from '../runs/formatTime';
import { statusLabel } from '../runs/statusStyle';
import { ListItem, TONE_COLOR_TOKEN } from '../ui/ListItem';
import type { Tone } from '../ui/primitives';
import { useTheme } from '../../theme/ThemeProvider';

const KIND_ICON = {
  chat: MessagesSquare,
  run: Workflow,
  automation: Bot,
} as const;

const KIND_LABEL = {
  chat: 'Chat',
  run: 'Run',
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
  const tone = toneFor(operation);
  const failed = operation.status === 'failed';
  const status = operation.blocked && !failed ? 'Waiting on you' : operation.running ? 'Running' : statusLabel(operation.status);
  const name = operation.kind === 'chat' ? parseChatName(operation.name) : { title: runTitle(operation.name), subAgent: false };

  const open = useCallback(() => {
    router.push(operation.href as never);
  }, [operation.href]);

  return (
    <ListItem
      title={name.title}
      titleBadge={name.subAgent ? { label: 'Sub-agent' } : null}
      subtitle={failed ? KIND_LABEL[operation.kind] : `${status} · ${KIND_LABEL[operation.kind]}`}
      meta={relativeTime(operation.updatedAt)}
      avatar={{
        icon: <Icon size={17} color={colors[TONE_COLOR_TOKEN[tone]]} />,
        tone: tone === 'success' ? 'neutral' : tone,
        indicator: operation.blocked && !failed ? 'warning' : operation.running ? 'info' : null,
      }}
      badge={failed ? { label: 'Failed', tone: 'danger' } : null}
      separator={separator}
      accessibilityLabel={`${name.title}, ${status}`}
      accessibilityHint={`Updated ${relativeTime(operation.updatedAt)}`}
      onPress={open}
    />
  );
}
