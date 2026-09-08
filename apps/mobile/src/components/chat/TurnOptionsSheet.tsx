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
//
// The option models live in `composer/turnOptions.ts` so the chips, this
// sheet and the new-chat sheet agree on wording, and so they are testable.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { ChevronRight, Cpu, FolderGit2, Gauge, ShieldCheck, Sparkles, Wand2 } from 'lucide-react-native';
import type { AgentMode, ModelInfo } from '@generatorai/client-core';

import { Sheet, SheetRow, SheetSection } from '../ui/Sheet';
import { ProgressBar, usageTone } from '../ui/ProgressRing';
import { Badge } from '../ui/primitives';
import { promptLimit } from '../../api/useModels';
import { formatTokens } from './ModelSheet';
import {
  MODE_OPTIONS,
  PERMISSION_MODES,
  TIER_OPTIONS,
  effectiveEffort,
  effortOptionsFor,
} from './composer/turnOptions';
import { useTheme } from '../../theme/ThemeProvider';

export { PERMISSION_MODES };

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
  onOpenModel,
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
  /** Hands off to the model picker; the composer owns that sheet. */
  onOpenModel?: () => void;
}): React.ReactElement {
  const { colors } = useTheme();

  const efforts = effortOptionsFor(model);
  const limit =
    contextTier === 'long_context'
      ? (model?.longContext?.promptTokenLimit ?? promptLimit(model))
      : promptLimit(model);
  const ratio = limit && contextTokens ? contextTokens / limit : 0;

  return (
    <Sheet visible={visible} onClose={onClose} title="Turn options" detents={[0.75, 0.92]}>
      {/* The model leads: it is the choice that changes the answer most, and
          since the composer now carries ONE chip for this whole decision the
          picker has to be reachable from inside it. */}
      {onOpenModel ? (
        <>
          <SheetSection title="Model" />
          <SheetRow
            title={model?.name ?? 'Server default'}
            subtitle={model?.description ?? 'The provider default for this chat.'}
            onPress={onOpenModel}
            left={<Cpu size={18} color={colors['muted-foreground']} />}
            right={<ChevronRight size={18} color={colors['muted-foreground']} />}
          />
        </>
      ) : null}

      <SheetSection title="How it answers" />
      {MODE_OPTIONS.map((option) => (
        <SheetRow
          key={option.value}
          title={option.title}
          subtitle={option.help}
          selected={mode === option.value}
          onPress={() => onModeChange(option.value)}
          left={<Wand2 size={18} color={colors['muted-foreground']} />}
        />
      ))}

      {efforts.length > 0 ? (
        <>
          <SheetSection title="Reasoning effort" />
          {efforts.map((option) => (
            <SheetRow
              key={option.value}
              title={option.title}
              subtitle={option.help || null}
              selected={effectiveEffort(effort, model) === option.value}
              onPress={() => onEffortChange(option.value)}
              left={<Sparkles size={18} color={colors['muted-foreground']} />}
            />
          ))}
        </>
      ) : null}

      {model?.supportsLongContext ? (
        <>
          <SheetSection title="Context window" />
          {TIER_OPTIONS.map((option) => (
            <SheetRow
              key={option.value}
              title={option.title}
              subtitle={
                (option.value === 'default'
                  ? formatTokens(model.standardContextWindow ?? promptLimit(model))
                  : formatTokens(model.longContext?.promptTokenLimit)) ?? option.help
              }
              selected={contextTier === option.value}
              onPress={() => onContextTierChange(option.value)}
            />
          ))}
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
