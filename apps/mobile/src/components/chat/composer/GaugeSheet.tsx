// ────────────────────────────────────────────────────────────────
// Context gauge breakdown — tap the ring.
//
// Web shows this as a popover; on a phone it is a fit-content sheet. It
// shows exactly the numbers the provider reported (`harness.context_usage`)
// and nothing invented: a breakdown section only when the snapshot carries
// one, API usage only when it does.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { Gauge } from 'lucide-react-native';
import type { ContextUsageSnapshot } from '@generatorai/client-core';

import { Sheet, SheetSection } from '../../ui/Sheet';
import { ProgressBar, usageTone } from '../../ui/ProgressRing';
import { Badge } from '../../ui/primitives';
import { useTheme } from '../../../theme/ThemeProvider';
import { formatTokens } from '../ModelSheet';

const BREAKDOWN_LABELS: Record<string, string> = {
  system: 'System prompt',
  tools: 'Tool definitions',
  mcpTools: 'MCP tools',
  memoryFiles: 'Memory files',
  conversation: 'Conversation',
  toolCalls: 'Tool calls',
  toolResults: 'Tool results',
  attachments: 'Attachments',
  userMessages: 'Your messages',
  assistantMessages: 'Agent messages',
  skills: 'Skills',
  agents: 'Agents',
};

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View className="flex-row items-center justify-between gap-3 py-1">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium tabular-nums text-foreground">{value}</Text>
    </View>
  );
}

export function GaugeSheet({
  visible,
  onClose,
  usage,
  contextTokens,
  limit,
  modelName,
}: {
  visible: boolean;
  onClose: () => void;
  usage: ContextUsageSnapshot | null | undefined;
  /** Fallback when only a token count is known. */
  contextTokens: number | null;
  limit: number | null;
  modelName?: string | undefined;
}): React.ReactElement | null {
  const { colors } = useTheme();
  if (!visible) return null;

  const current = usage?.currentTokens ?? contextTokens ?? 0;
  const denominator = usage?.promptTokenLimit ?? limit ?? usage?.totalContextWindow ?? null;
  const ratio = denominator ? current / denominator : 0;
  const breakdown = Object.entries(usage?.breakdown ?? {}).filter(
    (e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0,
  );
  const api = usage?.apiUsage;
  const asOf = usage?.at ? new Date(usage.at) : null;

  return (
    <Sheet visible={visible} onClose={onClose} title="Context usage" detents={[0.6, 0.92]} fitContent>
      <View className="gap-2 px-4 pb-2 pt-1">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Gauge size={16} color={colors['muted-foreground']} />
            <Text className="text-sm text-muted-foreground">
              {denominator
                ? `${formatTokens(current) ?? '0'} of ${formatTokens(denominator)} tokens`
                : `${formatTokens(current) ?? '0'} tokens`}
            </Text>
          </View>
          {denominator ? (
            <Badge label={`${Math.round(ratio * 100)}%`} tone={ratio > 0 ? usageTone(ratio) : 'neutral'} />
          ) : null}
        </View>
        {denominator ? <ProgressBar ratio={ratio} /> : null}
        {ratio >= 0.8 ? (
          <Text className="text-xs text-danger">
            Close to the limit. The agent may start dropping earlier turns.
          </Text>
        ) : null}
        {usage?.compactionThreshold ? (
          <Text className="text-xs text-muted-foreground">
            Compaction at {formatTokens(usage.compactionThreshold)} tokens.
          </Text>
        ) : null}
      </View>

      {breakdown.length > 0 ? (
        <>
          <SheetSection title="Where it goes" />
          <View className="px-4 pb-2">
            {breakdown
              .sort((a, b) => b[1] - a[1])
              .map(([key, value]) => (
                <Row key={key} label={BREAKDOWN_LABELS[key] ?? key} value={formatTokens(value) ?? String(value)} />
              ))}
          </View>
        </>
      ) : null}

      {api && (api.input || api.output || api.cacheRead || api.cacheWrite) ? (
        <>
          <SheetSection title="Last request" />
          <View className="px-4 pb-2">
            {api.input ? <Row label="Input" value={formatTokens(api.input) ?? '0'} /> : null}
            {api.output ? <Row label="Output" value={formatTokens(api.output) ?? '0'} /> : null}
            {api.cacheRead ? <Row label="Cache read" value={formatTokens(api.cacheRead) ?? '0'} /> : null}
            {api.cacheWrite ? <Row label="Cache write" value={formatTokens(api.cacheWrite) ?? '0'} /> : null}
          </View>
        </>
      ) : null}

      <View className="px-4 pb-6 pt-2">
        <Text className="text-xs text-muted-foreground">
          {[
            modelName ?? usage?.model,
            usage?.source === 'derived' ? 'estimated from turn usage' : usage ? 'reported by the provider' : null,
            asOf ? `as of ${asOf.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Usage appears once the model reports a context window.'}
        </Text>
      </View>
    </Sheet>
  );
}
