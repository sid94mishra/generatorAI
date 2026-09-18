// ────────────────────────────────────────────────────────────────
// ScriptRow — one workflow script in the Work tab's Scripts segment.
//
// Same flat `ListItem` as the other work rows (kept out of cards.tsx, which
// the shell owns). Scripts have no live state of their own, so the avatar is
// neutral and there is no badge.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { router } from 'expo-router';
import { FileCode2 } from 'lucide-react-native';

import { ListItem } from '../ui/ListItem';
import { useTheme } from '../../theme/ThemeProvider';
import { scriptSubtitle, type ScriptRowView } from './scriptModel';

export function scriptRoute(scriptId: string): string {
  return `/scripts/${encodeURIComponent(scriptId)}`;
}

export function ScriptRow({ script }: { script: ScriptRowView }): React.ReactElement {
  const { colors } = useTheme();
  const subtitle = scriptSubtitle(script);
  return (
    <ListItem
      title={script.name}
      subtitle={subtitle}
      avatar={{ icon: <FileCode2 size={17} color={colors['muted-foreground']} />, tone: 'neutral' }}
      accessibilityLabel={`${script.name}, ${subtitle}`}
      accessibilityHint="Opens the script"
      onPress={() => router.push(scriptRoute(script.id) as never)}
    />
  );
}
