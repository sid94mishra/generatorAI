// ────────────────────────────────────────────────────────────────
// StageTimeline — a run's stages as one railed list.
//
// The status glyph sits ON the rail, vertically aligned with the stage name,
// and the connector runs from glyph to glyph. (It used to be a dot floating
// in the gutter beside a separate card, which with one stage read as a stray
// bullet.) Each row opens the stage: transcript, output and files.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import type { StageRunSummary } from '@generatorai/client-core';

import { formatDuration, runElapsed } from './formatTime';
import { effectiveStageStatus, stageControlsFor, type StageControls } from './runModel';
import { isActive, statusLabel } from './statusStyle';
import { StatusGlyph } from './StatusGlyph';
import { Button } from '../ui/Button';
import { Touchable } from '../ui/Touchable';
import { useTheme } from '../../theme/ThemeProvider';

export function stageSubtitle(stage: StageRunSummary): string {
  const parts: string[] = [statusLabel(stage.status)];
  if (isActive(stage.status) && stage.totalSteps && stage.totalSteps > 1) {
    parts.push(`step ${Math.min((stage.currentStep ?? 0) + 1, stage.totalSteps)} of ${stage.totalSteps}`);
  }
  if (stage.retryCount) parts.push(`retry ${stage.retryCount}`);
  return parts.join(' · ');
}

export function StageTimeline({
  stages,
  runStatus,
  canControl,
  busyStageId,
  onOpen,
  onAction,
  expandedId = null,
  onToggle,
  renderExpanded,
}: {
  stages: readonly StageRunSummary[];
  runStatus: string;
  canControl: boolean;
  busyStageId: string | null;
  onOpen: (stage: StageRunSummary) => void;
  onAction: (stage: StageRunSummary, action: keyof StageControls) => void;
  /**
   * Steps expand in place, one at a time (the desktop run page's behaviour).
   * Without `onToggle` a tap opens the stage screen, as it always did.
   */
  expandedId?: string | null;
  onToggle?: (stage: StageRunSummary) => void;
  renderExpanded?: (stage: StageRunSummary) => React.ReactNode;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View className="overflow-hidden rounded-3xl border border-border bg-card">
      {stages.map((raw, index) => {
        const stage = { ...raw, status: effectiveStageStatus(raw, runStatus) } as StageRunSummary;
        const last = index === stages.length - 1;
        const elapsed = runElapsed(stage, isActive(stage.status) ? null : stage.completedAt);
        const controls = stageControlsFor(stage.status, runStatus);
        const quick = controls.retry ? 'retry' : controls.resume ? 'resume' : null;

        return (
          <View key={stage.id}>
            <View className="flex-row gap-3 px-4">
              {/* Rail: connector above, glyph, connector below. */}
              <View className="w-7 items-center">
                <View className={`h-3.5 w-px ${index === 0 ? 'bg-transparent' : 'bg-border'}`} />
                <StatusGlyph status={stage.status} size={28} />
                <View className={`w-px flex-1 ${last ? 'bg-transparent' : 'bg-border'}`} />
              </View>

              <View className={`flex-1 gap-1 pb-3.5 pt-3.5 ${last ? '' : 'border-b border-border-muted'}`}>
                <Touchable
                  accessibilityLabel={`Stage ${index + 1}, ${stage.name ?? stage.stageKey}, ${statusLabel(stage.status)}`}
                  accessibilityHint={onToggle ? 'Shows what this stage is doing' : 'Opens the stage transcript and output'}
                  {...(onToggle ? { accessibilityState: { expanded: expandedId === stage.id } } : {})}
                  haptic="tap"
                  onPress={() => (onToggle ? onToggle(stage) : onOpen(stage))}
                  className="min-h-12 gap-1"
                >
                  <View className="min-h-7 flex-row items-center gap-2">
                    <Text numberOfLines={1} className="flex-1 text-md font-medium text-foreground">
                      {stage.name ?? stage.stageKey}
                    </Text>
                    {elapsed != null ? (
                      <Text className="text-sm text-muted-foreground">{formatDuration(elapsed)}</Text>
                    ) : null}
                    {onToggle && expandedId === stage.id ? (
                      <ChevronDown size={16} color={colors['muted-foreground']} />
                    ) : (
                      <ChevronRight size={16} color={colors['muted-foreground']} />
                    )}
                  </View>
                  <Text numberOfLines={1} className="text-sm text-muted-foreground">
                    {stageSubtitle(stage)}
                  </Text>
                  {stage.error ? (
                    <Text numberOfLines={3} className="text-sm text-danger">
                      {stage.error}
                    </Text>
                  ) : null}
                </Touchable>
                {expandedId === stage.id && renderExpanded ? renderExpanded(stage) : null}
                {quick && canControl ? (
                  <View className="pt-1">
                    <Button
                      label={quick === 'retry' ? 'Retry stage' : 'Resume stage'}
                      variant="secondary"
                      size="sm"
                      haptic="commit"
                      loading={busyStageId === stage.id}
                      disabled={busyStageId === stage.id}
                      onPress={() => onAction(stage, quick)}
                    />
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
