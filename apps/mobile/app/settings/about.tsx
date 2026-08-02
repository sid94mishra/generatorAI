// ────────────────────────────────────────────────────────────────
// Settings › About.
//
// States plainly what this app can and cannot do relative to the desktop and
// web clients. Users otherwise conclude a deliberately absent feature is a
// bug — and then look for it repeatedly.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Check, Minus, X } from 'lucide-react-native';

import { Card, SectionHeader } from '../../src/components/ui/primitives';
import { Screen } from '../../src/components/ui/Screen';
import { useTheme } from '../../src/theme/ThemeProvider';

type Support = 'full' | 'partial' | 'none';

const CAPABILITIES: Array<{ title: string; support: Support; note: string }> = [
  { title: 'Chat with an agent', support: 'full', note: 'Full composer, live streaming, tool detail.' },
  { title: 'Approve plans and answer questions', support: 'full', note: 'Same decisions as desktop.' },
  { title: 'Review changes and diffs', support: 'full', note: 'Read-only; comments are added on desktop.' },
  { title: 'Browse workspace files', support: 'full', note: 'Read-only.' },
  { title: 'Terminal', support: 'partial', note: 'Available once you grant terminal permission.' },
  {
    title: 'Browser preview',
    support: 'partial',
    note: 'View-only. The page is laid out for a desktop window, so touches are not forwarded.',
  },
  {
    title: 'Interactive widgets',
    support: 'none',
    note: 'Widgets run in a sandboxed frame on a separate origin, which this app cannot host safely.',
  },
  {
    title: 'Editing workflows',
    support: 'none',
    note: 'A node graph is not usable at phone width. Authored on desktop or web.',
  },
  {
    title: 'Creating automations',
    support: 'none',
    note: 'Multi-step trigger and schema configuration. Their runs and history are visible here.',
  },
  {
    title: 'Starting, pausing or cancelling runs',
    support: 'none',
    note: 'Needs workflow-edit permission, deliberately withheld from phones. Unblocking a stopped run is allowed.',
  },
  { title: 'Editing files', support: 'none', note: 'No file-write permission on this device.' },
  {
    title: 'Committing or opening pull requests',
    support: 'none',
    note: 'Not a decision to confirm on a phone.',
  },
];

export default function AboutScreen(): React.ReactElement {
  const { colors } = useTheme();

  const icon = (support: Support): React.ReactElement =>
    support === 'full' ? (
      <Check size={16} color={colors.success} />
    ) : support === 'partial' ? (
      <Minus size={16} color={colors.warning} />
    ) : (
      <X size={16} color={colors['muted-foreground']} />
    );

  return (
    <Screen title="About" back>
      <Card className="gap-1 p-4">
        <Text className="text-lg font-semibold text-foreground">GeneratorAI</Text>
        <Text className="text-sm text-muted-foreground">
          Version {Constants.expoConfig?.version ?? 'development'}
        </Text>
      </Card>

      <SectionHeader title="What works here" />
      <Card className="gap-3.5 p-4">
        {CAPABILITIES.map((capability) => (
          <View key={capability.title} className="flex-row gap-2.5">
            <View className="pt-0.5">{icon(capability.support)}</View>
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-medium text-foreground">{capability.title}</Text>
              <Text className="text-xs leading-relaxed text-muted-foreground">
                {capability.note}
              </Text>
            </View>
          </View>
        ))}
      </Card>

      <Text className="px-1 pt-2 text-xs leading-relaxed text-muted-foreground">
        Anything marked unavailable is a deliberate decision, not a missing feature — either because
        a phone cannot do it safely, or because the interaction would be worse than useless at this
        size.
      </Text>
    </Screen>
  );
}
