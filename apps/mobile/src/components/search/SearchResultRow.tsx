// ────────────────────────────────────────────────────────────────
// SearchResultRow — one flat `ListItem` per search hit.
//
// Mirrors the tab lists' rows (same glyphs, one status signal) but reports
// the tap to the screen instead of navigating itself, so the screen can
// remember the query before it leaves.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Network } from 'lucide-react-native';

import { displayChatName } from '../common/chatName';
import { ENTITY_ICON } from '../common/entityIcons';
import { relativeTime } from '../runs/formatTime';
import { runTitle } from '../runs/runModel';
import { isActive, statusLabel } from '../runs/statusStyle';
import { runTone } from '../work/cards';
import { ListItem, TONE_COLOR_TOKEN } from '../ui/ListItem';
import { useTheme } from '../../theme/ThemeProvider';
import type { SearchItem } from './searchModel';

export function SearchResultRow({
  item,
  onPress,
  separator = true,
}: {
  item: SearchItem;
  onPress: (item: SearchItem) => void;
  separator?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const muted = colors['muted-foreground'];
  const press = (): void => onPress(item);

  switch (item.kind) {
    case 'chat': {
      const name = displayChatName(item.raw.name);
      return (
        <ListItem
          title={name}
          subtitle={item.raw.preview ?? null}
          meta={relativeTime(item.raw.updatedAt)}
          avatar={{ icon: <ENTITY_ICON.chat size={17} color={muted} />, tone: 'neutral' }}
          badge={item.archived ? { label: 'Archived', tone: 'neutral' } : null}
          separator={separator}
          accessibilityLabel={`Chat, ${name}${item.archived ? ', archived' : ''}`}
          onPress={press}
        />
      );
    }
    case 'run': {
      const tone = runTone(item.raw.status);
      const active = isActive(item.raw.status);
      const status = statusLabel(item.raw.status);
      return (
        <ListItem
          title={runTitle(item.raw.name)}
          subtitle={item.raw.error ?? status}
          subtitleTone={item.raw.error ? 'danger' : 'muted'}
          meta={relativeTime(item.raw.updatedAt)}
          avatar={{
            icon: <ENTITY_ICON.workflow size={17} color={colors[TONE_COLOR_TOKEN[tone]]} />,
            tone,
            indicator: active ? 'info' : null,
          }}
          separator={separator}
          accessibilityLabel={`Run, ${runTitle(item.raw.name, 'Run')}, ${status}`}
          onPress={press}
        />
      );
    }
    case 'workflow':
      return (
        <ListItem
          title={item.raw.name}
          subtitle={item.raw.description ?? 'Workflow'}
          avatar={{ icon: <ENTITY_ICON.workflow size={17} color={muted} />, tone: 'neutral' }}
          separator={separator}
          accessibilityLabel={`Workflow, ${item.raw.name}`}
          onPress={press}
        />
      );
    case 'project':
      return (
        <ListItem
          title={item.raw.name}
          subtitle={item.raw.description ?? `Created ${relativeTime(item.raw.createdAt)}`}
          avatar={{ icon: <ENTITY_ICON.project size={17} color={muted} />, tone: 'neutral' }}
          separator={separator}
          accessibilityLabel={`Project, ${item.raw.name}`}
          onPress={press}
        />
      );
    case 'automation': {
      const Icon = ENTITY_ICON.automation;
      return (
        <ListItem
          title={item.raw.name}
          subtitle={item.raw.lastRunAt ? `Last ran ${relativeTime(item.raw.lastRunAt)}` : 'Never run'}
          avatar={{ icon: <Icon size={17} color={muted} />, tone: 'neutral' }}
          badge={item.raw.enabled ? null : { label: 'Off', tone: 'neutral' }}
          separator={separator}
          accessibilityLabel={`Automation, ${item.raw.name}, ${item.raw.enabled ? 'on' : 'off'}`}
          onPress={press}
        />
      );
    }
    case 'agent': {
      const Icon = item.raw.role === 'orchestrator' ? Network : ENTITY_ICON.agent;
      return (
        <ListItem
          title={item.raw.name}
          subtitle={item.raw.description || item.raw.slug}
          avatar={{ icon: <Icon size={17} color={muted} />, tone: 'neutral' }}
          badge={item.raw.enabled ? null : { label: 'Disabled', tone: 'neutral' }}
          separator={separator}
          accessibilityLabel={`Agent, ${item.raw.name}`}
          onPress={press}
        />
      );
    }
  }
}
