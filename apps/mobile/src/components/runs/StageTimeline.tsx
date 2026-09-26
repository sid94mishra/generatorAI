// ────────────────────────────────────────────────────────────────
// StageTimeline — a run's stages as one railed list.
//
// The status glyph sits ON the rail, vertically aligned with the stage name,
// and the connector runs from glyph to glyph. (It used to be a dot floating
// in the gutter beside a separate card, which with one stage read as a stray
// bullet.) Each row opens the stage: transcript, output and files.
//
// Loops (P05): a loop row carries its `n/max` badge, its exit reason once
// done and a "Needs decision" badge while parked; its body stages sit
// indented under it, one iteration at a time (the latest unless another is
// picked), with the loop's wrap-up after them. Tapping a loop row folds its
// body. A check stage reads its verdict ("Passed · exit 0").
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import type { StageRunSummary } from '@generatorai/client-core';

import { formatDuration, runElapsed } from './formatTime';
import {
  checkLabel,
  checkResultOf,
  isLoopStage,
  isParkedLoop,
  loopBadge,
  loopExitLabel,
  stageTree,
  type RunStage,
  type StageNode,
} from './loopModel';
import { effectiveStageStatus, stageControlsFor, type StageControls } from './runModel';
import { isActive, statusLabel } from './statusStyle';
import { StatusGlyph } from './StatusGlyph';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Badge } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { useTheme } from '../../theme/ThemeProvider';

export function stageSubtitle(stage: StageRunSummary): string {
  const s = stage as RunStage;
  const check = checkResultOf(s);
  const parts: string[] = [check ? checkLabel(check) : statusLabel(stage.status)];
  const exit = loopExitLabel(s);
  if (exit) parts.push(exit);
  // Retries are the attempts beyond the first.
  const retries = (stage.currentAttempt ?? 0) - 1;
  if (retries > 0) parts.push(`retry ${retries}`);
  return parts.join(' · ');
}

/** Indent per nesting level (a loop's body, a loop inside a loop). */
const INDENT = 18;

type Row =
  | { type: 'stage'; stage: RunStage; depth: number; context?: string; loop?: boolean }
  | { type: 'iterations'; loop: RunStage; ks: number[]; selected: number; depth: number };

function flatten(
  nodes: readonly StageNode[],
  depth: number,
  selectedIteration: Readonly<Record<string, number>>,
  folded: ReadonlySet<string>,
  out: Row[],
  context?: string,
): Row[] {
  for (const node of nodes) {
    const loop = node.loop;
    out.push({ type: 'stage', stage: node.stage, depth, ...(context ? { context } : {}), ...(loop ? { loop: true } : {}) });
    if (!loop || folded.has(node.stage.id)) continue;
    const iterations = loop.iterations;
    if (iterations.length > 0) {
      const latest = iterations[iterations.length - 1]!.k;
      const picked = selectedIteration[node.stage.id];
      const selected = picked !== undefined && iterations.some((i) => i.k === picked) ? picked : latest;
      if (iterations.length > 1) {
        out.push({ type: 'iterations', loop: node.stage, ks: iterations.map((i) => i.k), selected, depth: depth + 1 });
      }
      const iteration = iterations.find((i) => i.k === selected);
      if (iteration) flatten(iteration.nodes, depth + 1, selectedIteration, folded, out, `Iteration ${selected + 1}`);
    }
    flatten(loop.wrapUp, depth + 1, selectedIteration, folded, out, 'Wrap-up');
  }
  return out;
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
  // Per loop: the iteration picked (absent = the latest) and whether its body is folded.
  const [selectedIteration, setSelectedIteration] = useState<Record<string, number>>({});
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());

  const rows = useMemo(
    () => flatten(stageTree(stages as readonly RunStage[]), 0, selectedIteration, folded, []),
    [stages, selectedIteration, folded],
  );

  const toggleFold = (loopId: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(loopId)) next.delete(loopId);
      else next.add(loopId);
      return next;
    });

  return (
    <View className="overflow-hidden rounded-3xl border border-border bg-card">
      {rows.map((row, index) => {
        const first = index === 0;
        const last = index === rows.length - 1;
        const indent = { paddingLeft: 16 + row.depth * INDENT };

        if (row.type === 'iterations') {
          return (
            <View key={`${row.loop.id}:iterations`} className="flex-row gap-3 pr-4" style={indent}>
              <View className="w-7 items-center">
                <View className="w-px flex-1 bg-border" />
              </View>
              <View className={`flex-1 flex-row flex-wrap gap-1.5 py-2 ${last ? '' : 'border-b border-border-muted'}`}>
                {row.ks.map((k) => (
                  <Chip
                    key={k}
                    label={`${k + 1}`}
                    size="sm"
                    tone="tab"
                    selected={k === row.selected}
                    accessibilityLabel={`Iteration ${k + 1}`}
                    onPress={() => setSelectedIteration((prev) => ({ ...prev, [row.loop.id]: k }))}
                  />
                ))}
              </View>
            </View>
          );
        }

        const raw = row.stage;
        const stage = { ...raw, status: effectiveStageStatus(raw, runStatus) } as RunStage;
        const elapsed = runElapsed(stage, isActive(stage.status) ? null : stage.completedAt);
        const controls = stageControlsFor(stage.status, runStatus);
        const quick = controls.retry ? 'retry' : controls.resume ? 'resume' : null;
        const isLoop = row.loop === true || isLoopStage(stage);
        const badge = isLoop ? loopBadge(stage) : null;
        const parked = isParkedLoop(stage);
        const isFolded = folded.has(stage.id);
        const subtitle = row.context ? `${row.context} · ${stageSubtitle(stage)}` : stageSubtitle(stage);
        const expanded = !isLoop && expandedId === stage.id;

        return (
          <View key={stage.id}>
            <View className="flex-row gap-3 pr-4" style={indent}>
              {/* Rail: connector above, glyph, connector below. */}
              <View className="w-7 items-center">
                <View className={`h-3.5 w-px ${first ? 'bg-transparent' : 'bg-border'}`} />
                <StatusGlyph status={stage.status} size={28} />
                <View className={`w-px flex-1 ${last ? 'bg-transparent' : 'bg-border'}`} />
              </View>

              <View className={`flex-1 gap-1 pb-3.5 pt-3.5 ${last ? '' : 'border-b border-border-muted'}`}>
                <Touchable
                  accessibilityLabel={`${isLoop ? 'Loop' : `Stage ${index + 1}`}, ${stage.name ?? stage.stageKey}, ${badge ? `iteration ${badge}, ` : ''}${statusLabel(stage.status)}`}
                  accessibilityHint={
                    isLoop
                      ? isFolded
                        ? 'Shows the stages of this loop'
                        : 'Hides the stages of this loop'
                      : onToggle
                        ? 'Shows what this stage is doing'
                        : 'Opens the stage transcript and output'
                  }
                  {...(isLoop
                    ? { accessibilityState: { expanded: !isFolded } }
                    : onToggle
                      ? { accessibilityState: { expanded } }
                      : {})}
                  haptic="tap"
                  onPress={() => (isLoop ? toggleFold(stage.id) : onToggle ? onToggle(stage) : onOpen(stage))}
                  className="min-h-12 gap-1"
                >
                  <View className="min-h-7 flex-row items-center gap-2">
                    <Text numberOfLines={1} className="flex-1 text-md font-medium text-foreground">
                      {stage.name ?? stage.stageKey}
                    </Text>
                    {badge ? <Badge label={`loop ${badge}`} tone={parked ? 'warning' : 'neutral'} /> : null}
                    {elapsed != null ? (
                      <Text className="text-sm text-muted-foreground">{formatDuration(elapsed)}</Text>
                    ) : null}
                    {(isLoop ? !isFolded : onToggle && expanded) ? (
                      <ChevronDown size={16} color={colors['muted-foreground']} />
                    ) : (
                      <ChevronRight size={16} color={colors['muted-foreground']} />
                    )}
                  </View>
                  <Text numberOfLines={1} className="text-sm text-muted-foreground">
                    {subtitle}
                  </Text>
                  {parked ? <Badge label="Needs decision" tone="warning" /> : null}
                  {stage.error ? (
                    <Text numberOfLines={3} className="text-sm text-danger">
                      {stage.error}
                    </Text>
                  ) : null}
                </Touchable>
                {expanded && renderExpanded ? renderExpanded(stage) : null}
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
