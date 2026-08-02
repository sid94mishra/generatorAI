// ────────────────────────────────────────────────────────────────
// Turn options sheet.
//
// The web composer spreads these across a pill row plus an overflow menu,
// because a desktop has 900pt of horizontal room. On a phone every secondary
// control lives here, in one scrollable surface, grouped by what it affects:
//
//   How it answers   agent mode, reasoning effort
//   How much it sees context tier, live context usage
//   What it can do   permission mode
//   What it knows    linked codebases (read-only)
//
// Nothing is dropped relative to web; it is re-homed. Each group carries the
// same explanatory copy the web tooltips do, because there is no hover.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { FolderGit2, Gauge, ShieldCheck, Sparkles, Wand2 } from 'lucide-react-native';
import type { AgentMode, ModelInfo } from '@generatorai/client-core';

import { Sheet, SheetRow, SheetSection } from '../ui/Sheet';
import { ProgressBar, usageTone } from '../ui/ProgressRing';
import { Badge } from '../ui/primitives';
import { promptLimit, reasoningEfforts } from '../../api/useModels';
import { formatTokens } from './ModelSheet';
import { useTheme } from '../../theme/ThemeProvider';

const MODE_COPY: Record<AgentMode, { title: string; help: string }> = {
  auto: {
    title: 'Auto',
    help: 'The agent works straight through and only stops if it needs you.',
  },
  plan: {
    title: 'Plan first',
    help: 'The agent writes a plan and waits for your approval before making any change.',
  },
};

const EFFORT_COPY: Record<string, string> = {
  low: 'Fastest. Best for small, well-specified edits.',
  medium: 'Balanced.',
  high: 'Thinks longer before acting. Better on ambiguous work.',
  xhigh: 'Substantially longer reasoning.',
  max: 'Maximum reasoning. Slowest and most expensive.',
};

/** Server values for `PATCH /api/chats/:id { permissionMode }`. */
export const PERMISSION_MODES = [
  { value: 'default', title: 'Ask me', help: 'Pause for approval before sensitive actions.' },
  { value: 'acceptEdits', title: 'Auto-accept edits', help: 'File edits apply without asking.' },
  {
    value: 'bypassPermissions',
    title: 'Full autonomy',
    help: 'Nothing is gated. Use only in a sandbox you can throw away.',
  },
] as const;

export function TurnOptionsSheet({
  visible,
  onClose,
  model,
  mode,
  onModeChange,
  effort,
  onEffortChange,
  contextTier,
  onContextTierChange,
  permissionMode,
  onPermissionModeChange,
  contextTokens,
  codebaseCount,
}: {
  visible: boolean;
  onClose: () => void;
  model: ModelInfo | undefined;
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  effort: string | null;
  onEffortChange: (effort: string) => void;
  contextTier: 'default' | 'long_context';
  onContextTierChange: (tier: 'default' | 'long_context') => void;
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  contextTokens: number | null;
  codebaseCount: number;
}): React.ReactElement {
  const { colors } = useTheme();

  const efforts = reasoningEfforts(model);
  const limit =
    contextTier === 'long_context'
      ? (model?.longContext?.promptTokenLimit ?? promptLimit(model))
      : promptLimit(model);
  const ratio = limit && contextTokens ? contextTokens / limit : 0;

  return (
    <Sheet visible={visible} onClose={onClose} title="Turn options" detents={[0.75, 0.92]}>
      <SheetSection title="How it answers" />
      {(['auto', 'plan'] as const).map((value) => (
        <SheetRow
          key={value}
          title={MODE_COPY[value].title}
          subtitle={MODE_COPY[value].help}
          selected={mode === value}
          onPress={() => onModeChange(value)}
          left={<Wand2 size={18} color={colors['muted-foreground']} />}
        />
      ))}

      {efforts.length > 0 ? (
        <>
          <SheetSection title="Reasoning effort" />
          {efforts.map((value) => (
            <SheetRow
              key={value}
              title={value.charAt(0).toUpperCase() + value.slice(1)}
              subtitle={EFFORT_COPY[value] ?? null}
              selected={(effort ?? model?.defaultReasoningEffort) === value}
              onPress={() => onEffortChange(value)}
              left={<Sparkles size={18} color={colors['muted-foreground']} />}
            />
          ))}
        </>
      ) : null}

      {model?.supportsLongContext ? (
        <>
          <SheetSection title="Context window" />
          <SheetRow
            title="Standard"
            subtitle={formatTokens(model.standardContextWindow ?? promptLimit(model)) ?? undefined}
            selected={contextTier === 'default'}
            onPress={() => onContextTierChange('default')}
          />
          <SheetRow
            title="Long context"
            subtitle={formatTokens(model.longContext?.promptTokenLimit) ?? undefined}
            selected={contextTier === 'long_context'}
            onPress={() => onContextTierChange('long_context')}
          />
        </>
      ) : null}

      <SheetSection title="Permissions" />
      {PERMISSION_MODES.map((option) => (
        <SheetRow
          key={option.value}
          title={option.title}
          subtitle={option.help}
          selected={permissionMode === option.value}
          onPress={() => onPermissionModeChange(option.value)}
          left={<ShieldCheck size={18} color={colors['muted-foreground']} />}
        />
      ))}

      <SheetSection title="Context usage" />
      <View className="gap-2 px-4 py-3">
        {limit ? (
          <>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Gauge size={16} color={colors['muted-foreground']} />
                <Text className="text-sm text-muted-foreground">
                  {formatTokens(contextTokens ?? 0)} of {formatTokens(limit)} tokens
                </Text>
              </View>
              <Badge
                label={`${Math.round(ratio * 100)}%`}
                tone={ratio > 0 ? usageTone(ratio) : 'neutral'}
              />
            </View>
            <ProgressBar ratio={ratio} />
            {ratio >= 0.8 ? (
              <Text className="text-xs text-danger">
                Close to the limit. The agent may start dropping earlier turns.
              </Text>
            ) : null}
          </>
        ) : (
          <Text className="text-sm text-muted-foreground">
            Usage appears once the model reports a context window.
          </Text>
        )}
      </View>

      <SheetSection title="Knowledge" />
      <View className="flex-row items-center gap-2 px-4 py-3">
        <FolderGit2 size={16} color={colors['muted-foreground']} />
        <Text className="flex-1 text-sm text-muted-foreground">
          {codebaseCount > 0
            ? `${codebaseCount} codebase${codebaseCount === 1 ? '' : 's'} linked to this chat.`
            : 'No codebase linked. Link one from the project on the desktop app.'}
        </Text>
      </View>
    </Sheet>
  );
}
