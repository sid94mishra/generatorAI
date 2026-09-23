// ────────────────────────────────────────────────────────────────
// StatTiles — the desktop dashboard's count cards (Chats / Workflows /
// Automations / System health), as one row of four compact tiles. Each opens
// the list it counts; health opens Diagnostics, as on desktop.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { GitBranch, HeartPulse, MessageSquare, Zap, type LucideIcon } from 'lucide-react-native';

import { Touchable } from '../ui/Touchable';
import { MAX_SCALE } from '../ui/accessibility';
import { useTheme } from '../../theme/ThemeProvider';

export interface StatTilesProps {
  chats: number | null;
  workflows: number | null;
  automations: number | null;
  /** `ok`, anything else (degraded), or null while unknown / unreachable. */
  health: string | null;
}

function Tile({
  Icon,
  tint,
  label,
  value,
  href,
  accessibilityLabel,
}: {
  Icon: LucideIcon;
  tint: string;
  label: string;
  value: string;
  href: string;
  accessibilityLabel: string;
}): React.ReactElement {
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      haptic="tap"
      onPress={() => router.push(href as never)}
      className="min-h-[72px] flex-1 justify-between rounded-3xl border border-border-muted bg-card px-2.5 py-2.5"
    >
      <Icon size={16} color={tint} />
      <View>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.control}
          className="text-lg font-bold text-foreground"
        >
          {value}
        </Text>
        {/* Four tiles share a phone's width; "Automations" is the long one and
            shrinks a touch rather than truncating to "Automatio…". */}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={MAX_SCALE.chrome}
          className="text-xs text-muted-foreground"
        >
          {label}
        </Text>
      </View>
    </Touchable>
  );
}

export function StatTiles({ chats, workflows, automations, health }: StatTilesProps): React.ReactElement {
  const { colors } = useTheme();
  const show = (n: number | null): string => (n == null ? '—' : String(n));
  const healthy = health === 'ok';
  const healthValue = health == null ? '—' : healthy ? 'OK' : 'Check';
  return (
    <View className="flex-row gap-2 px-4" accessibilityRole="summary">
      <Tile
        Icon={MessageSquare}
        tint={colors.info ?? colors.primary!}
        label="Chats"
        value={show(chats)}
        href="/(tabs)/chats"
        accessibilityLabel={`${show(chats)} active chats. Open chats`}
      />
      <Tile
        Icon={GitBranch}
        tint={colors.primary!}
        label="Workflows"
        value={show(workflows)}
        href="/(tabs)/runs?segment=workflows"
        accessibilityLabel={`${show(workflows)} workflows. Open workflows`}
      />
      <Tile
        Icon={Zap}
        tint={colors.warning!}
        label="Automations"
        value={show(automations)}
        href="/(tabs)/runs?segment=automations"
        accessibilityLabel={`${show(automations)} automations. Open automations`}
      />
      <Tile
        Icon={HeartPulse}
        tint={health == null ? colors['muted-foreground']! : healthy ? colors.success! : colors.danger!}
        label="Health"
        value={healthValue}
        href="/settings/diagnostics"
        accessibilityLabel={`Server health ${health == null ? 'unknown' : healthy ? 'OK' : 'needs attention'}. Open diagnostics`}
      />
    </View>
  );
}
