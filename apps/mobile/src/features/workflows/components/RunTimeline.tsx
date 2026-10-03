// MB-33 RunTimeline / StageRow (03 MB-33; MWorkflowRun, MRunLoop; MD-25, MD-28): the run's stages as a tree — top-level
// instances in the server's order; a loop or a map holds its body grouped by iteration / item (iteration chips;
// the current one shown) and its wrap-up. A row: the status glyph, the name (600) and the mono key, the duration
// (mono; `run` while live); the second line starts with the status word (glyph + word) then the agent or command,
// "attempt n of m" and the session reuse. Tapping expands the row in place: the stage's summary or output (with its
// usage), a check's verdict and output tails, the error, "Open chat" and the stage menu (MDF-74: the commands the
// server accepts for this status, ≤ 3 groups). Rows are min-h-item in a ListSection (grouped on iOS, flat on Android).
import React, { useState } from 'react';
import { View } from 'react-native';
import { resolveStatus, STATUS_STATE_DEFS, type StatusState } from '@generatorai/shared';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { StageSpec } from '@generatorai/workflow-spec';

import { usageLine, useLoopIterations } from '../../../blocks/DecisionCard';
import { ListSection } from '../../../ui/layout/ListSection';
import { cn } from '../../../ui/lib/cn';
import { Menu } from '../../../ui/native/Menu';
import type { MenuEntry } from '../../../ui/native/Menu/Menu.types';
import { Badge } from '../../../ui/primitives/Badge';
import { Button } from '../../../ui/primitives/Button';
import { Chip } from '../../../ui/primitives/Chip';
import { Icon } from '../../../ui/primitives/Icon';
import { IconButton } from '../../../ui/primitives/IconButton';
import { Pressable } from '../../../ui/primitives/Pressable';
import { Text } from '../../../ui/primitives/Text';
import { effectiveStageStatus, stageControlsFor } from '../model/runModel';
import { checkLabel, checkResultOf, isLoopStage, itemLabel, loopBadge, loopExitLabel, mapBadge, stageTree, type RunStage, type StageNode } from '../model/runStages';
import { stageRowView } from '../model/runView';

export type StageMenuId = 'pause' | 'resume' | 'retry-resume' | 'retry-restart' | 'skip' | 'rerun' | 'copy-output' | 'open-chat' | 'open-pane' | 'cancel';

export interface RunTimelineProps {
  runId: string;
  stages: readonly RunStage[];
  runStatus: string;
  /** The pinned graph's stages by key (agent / model, attempts, reuse). */
  specs: ReadonlyMap<string, StageSpec>;
  /** Run control (pause / resume / retry / skip / cancel) is allowed on this device. */
  canControl: boolean;
  /** Re-run from here (a fork) is allowed. */
  canFork: boolean;
  onOpenStage: (stage: RunStage) => void;
  onStageAction: (stage: RunStage, action: StageMenuId) => void;
}

export function stageMenu(stage: RunStage, runStatus: string, can: { control: boolean; fork: boolean }): MenuEntry[] {
  const c = stageControlsFor(stage.status, runStatus);
  const control: MenuEntry[] = [
    ...(c.pause && can.control ? [{ id: 'pause', label: 'Pause stage', icon: 'pause' as const }] : []),
    ...(c.resume && can.control ? [{ id: 'resume', label: 'Resume', icon: 'play' as const }] : []),
    ...(c.retry && can.control && runStatus !== 'failed' && runStatus !== 'cancelled'
      ? [{ id: 'retry', label: 'Retry', icon: 'retry' as const, children: [{ id: 'retry-resume', label: 'Resume', subtitle: 'keeps turns', icon: 'history' as const }, { id: 'retry-restart', label: 'Restart', icon: 'restart' as const }] }]
      : []),
    ...(c.skip && can.control ? [{ id: 'skip', label: 'Skip as completed', icon: 'check' as const }] : []),
    ...((c.rerun || (c.retry && (runStatus === 'failed' || runStatus === 'cancelled'))) && can.fork ? [{ id: 'rerun', label: 'Re-run from here', icon: 'forward' as const }] : []),
  ];
  const info: MenuEntry[] = [
    ...(stage.outputText || stage.summary ? [{ id: 'copy-output', label: 'Copy output', icon: 'copy' as const }] : []),
    ...(stage.sessionId ? [{ id: 'open-chat', label: 'Open chat', icon: 'message' as const }] : []),
    { id: 'open-pane', label: 'Open in run pane', icon: 'dock' },
  ];
  const destructive: MenuEntry[] = c.cancel && can.control ? [{ id: 'cancel', label: 'Cancel stage…', icon: 'status-failed', destructive: true }] : [];
  return [control, info, destructive].filter((g) => g.length).flatMap((g, i) => (i === 0 ? g : [{ type: 'separator' as const }, ...g]));
}

function glyph(state: StatusState): { concept: MobileIconConcept; tone: (typeof STATUS_STATE_DEFS)[StatusState]['tone']; spin: boolean } {
  const def = STATUS_STATE_DEFS[state];
  return { concept: def.glyph as MobileIconConcept, tone: def.tone, spin: def.spin };
}

function StageRow({ node, depth, props }: { node: StageNode; depth: number; props: RunTimelineProps }): React.ReactElement {
  const { stage } = node;
  const [open, setOpen] = useState(stage.status === 'awaiting_input' || stage.status === 'running');
  const status = resolveStatus('stageRun', effectiveStageStatus(stage, props.runStatus) as never) ?? resolveStatus('stageRun', 'pending')!;
  const g = glyph(status.state);
  const spec = props.specs.get(stage.stageKey);
  const view = stageRowView(stage, spec);
  const menu = stageMenu(stage, props.runStatus, { control: props.canControl, fork: props.canFork });
  const check = checkResultOf(stage);
  const body = stage.summary?.trim() || stage.outputText?.trim() || null;
  const usage = usageLine(stage.usage);
  const needs = status.state === 'needs_you';
  return (
    <View className={cn(depth > 0 && 'ps-4')} testID={`run-stage-${stage.instancePath ?? stage.stageKey}`}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        frame="none"
        accessibilityRole="button"
        accessibilityLabel={`${stage.name ?? stage.stageKey}, ${status.label}${view.duration ? `, ${view.duration}` : ''}`}
        accessibilityState={{ expanded: open }}
        className="min-h-item flex-row items-start gap-3 px-4 py-2.5"
      >
        <View className="pt-0.5">
          <Icon concept={g.concept} size={18} tone={g.tone} spinning={g.spin} />
        </View>
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text role="body" weight={600} numberOfLines={1} className="shrink">
              {stage.name ?? stage.stageKey}
            </Text>
            <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
              {stage.stageKey}
            </Text>
            <View className="flex-1" />
            {view.duration ? (
              <Text role="monoSm" tone={needs ? 'warn' : view.live ? 'run' : 'fg-3'}>
                {view.duration}
              </Text>
            ) : null}
          </View>
          <Text role="footnote" tone="fg-3" numberOfLines={2}>
            {[status.label, view.line].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </Pressable>
      {open ? (
        <View className="gap-2 pb-3 pe-4 ps-12">
          {check ? (
            <View className="gap-1">
              <Text role="footnote" weight={600} tone={check.passed ? 'ok' : 'err'}>
                {checkLabel(check)}
              </Text>
              {(check.stderrTail || check.stdoutTail) ? (
                <View className="rounded-control bg-sunken p-2">
                  <Text role="monoSm" tone="fg-2" selectable numberOfLines={12}>
                    {(check.stderrTail || check.stdoutTail).trim()}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {body && !check ? (
            <View className="gap-1 rounded-card bg-sunken p-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text role="footnote" weight={600}>
                  {stage.summary ? 'Summary' : 'Output'}
                </Text>
                {usage ? (
                  <Text role="monoSm" tone="fg-3" numberOfLines={1}>
                    {usage}
                  </Text>
                ) : null}
              </View>
              <Text role="footnote" tone="fg" selectable numberOfLines={8}>
                {body}
              </Text>
            </View>
          ) : null}
          {stage.error ? (
            <Text role="footnote" tone="err" selectable>
              {stage.error}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            {stage.sessionId ? <Button label="Open chat" icon="message" size="sm" onPress={() => props.onOpenStage(stage)} testID={`run-stage-${stage.stageKey}-chat`} /> : null}
            <View className="flex-1" />
            {menu.length ? (
              <Menu
                items={menu}
                onSelect={(id) => props.onStageAction(stage, id as StageMenuId)}
                accessibilityLabel={`${stage.name ?? stage.stageKey} actions`}
                trigger={<IconButton icon="more" label={`${stage.name ?? stage.stageKey} actions`} size="sm" onPress={() => undefined} testID={`run-stage-${stage.stageKey}-menu`} />}
              />
            ) : null}
          </View>
        </View>
      ) : null}
      {node.loop ? <LoopBody node={node} depth={depth} props={props} /> : null}
    </View>
  );
}

/**
 * MRunLoop: a loop's rules, read-only (MD-04 — rule editors are desktop): "Loop · max 5 · <phase>", each exit rule
 * (when · action, its streak "1/2" in a row), the carried values of the last iteration, the loop budget against what
 * it spent.
 */
function LoopRules({ stage, spec, runId }: { stage: RunStage; spec: StageSpec | undefined; runId: string }): React.ReactElement | null {
  const iterations = useLoopIterations(runId, stage.id, spec?.kind === 'loop');
  if (spec?.kind !== 'loop') return null;
  const ls = stage.loopState;
  const last = iterations.data?.[iterations.data.length - 1];
  const carry = Object.entries(last?.carry ?? {});
  const budget = spec.budget ?? {};
  const usage = (last?.usage ?? {}) as Record<string, unknown>;
  const spent = [budget.maxTurns ? `${typeof usage['turns'] === 'number' ? usage['turns'] : 0}/${budget.maxTurns} turns` : null, budget.maxCostUsd ? `$${typeof usage['costUsd'] === 'number' ? (usage['costUsd'] as number).toFixed(2) : '0.00'}/$${budget.maxCostUsd}` : null].filter(Boolean);
  return (
    <View className="gap-1.5 ps-12 pe-4" testID={`run-loop-rules-${stage.stageKey}`}>
      <Text role="footnote" tone="fg-3">
        {[`Loop · max ${ls?.effectiveMax ?? spec.loop.maxIterations}`, ls?.phase ? ls.phase.replace(/_/g, ' ') : null].filter(Boolean).join(' · ')}
      </Text>
      {spec.loop.exits.map((rule, i) => (
        <View key={`${rule.reason}-${i}`} className="flex-row items-baseline gap-2">
          <Text role="footnote" tone="fg-2" className="w-20" numberOfLines={1}>
            {rule.action === 'complete' ? 'Until' : rule.action === 'fail' ? 'Fail when' : rule.action === 'pause' ? 'Pause when' : 'Stop when'}
          </Text>
          <Text role="monoSm" numberOfLines={2} className="flex-1">
            {rule.reason || rule.when}
          </Text>
          {(rule.consecutive ?? 1) > 1 ? (
            <Text role="monoSm" tone="fg-3">{`${ls?.streaks?.[i] ?? 0}/${rule.consecutive}`}</Text>
          ) : null}
        </View>
      ))}
      {carry.length ? (
        <View className="flex-row flex-wrap items-baseline gap-x-2">
          <Text role="footnote" tone="fg-2" className="w-20">
            Carry
          </Text>
          {carry.slice(0, 4).map(([k, v]) => (
            <Text key={k} role="monoSm" tone="fg-2">{`${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`}</Text>
          ))}
        </View>
      ) : null}
      {spent.length ? (
        <View className="flex-row items-baseline gap-2">
          <Text role="footnote" tone="fg-2" className="w-20">
            Budget
          </Text>
          <Text role="monoSm" tone="fg-2">
            {spent.join(' · ')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function LoopBody({ node, depth, props }: { node: StageNode; depth: number; props: RunTimelineProps }): React.ReactElement | null {
  const loop = node.loop!;
  const isLoop = isLoopStage(node.stage);
  const current = loop.iterations[loop.iterations.length - 1]?.k ?? null;
  const [k, setK] = useState<number | null>(null);
  const shown = k ?? current;
  const badge = isLoop ? loopBadge(node.stage) : mapBadge(node.stage);
  const exit = loopExitLabel(node.stage);
  const nodes = loop.iterations.find((i) => i.k === shown)?.nodes ?? [];
  if (!loop.iterations.length && !loop.wrapUp.length) return null;
  return (
    <View className="gap-2 pb-2">
      <View className="flex-row flex-wrap items-center gap-2 ps-12 pe-4">
        <Text role="footnote" tone="fg-3">
          {isLoop ? 'Iteration' : 'Item'}
        </Text>
        {loop.iterations.map((it) => {
          const states = it.nodes.map((n) => n.stage.status);
          const state: StatusState = states.some((s) => s === 'failed') ? 'failed' : states.every((s) => s === 'completed' || s === 'skipped') ? 'succeeded' : states.some((s) => s === 'awaiting_input') ? 'needs_you' : 'running';
          return <Chip key={it.k} label={isLoop ? `#${it.k}` : itemLabel(node.stage, it.k)} icon={STATUS_STATE_DEFS[state].glyph as MobileIconConcept} selected={it.k === shown} onPress={() => setK(it.k)} testID={`run-iteration-${node.stage.stageKey}-${it.k}`} />;
        })}
        {badge ? <Badge label={badge} size="sm" mono /> : null}
      </View>
      {exit ? (
        <Text role="footnote" tone="fg-3" className="ps-12 pe-4">
          {exit}
        </Text>
      ) : null}
      {isLoop ? <LoopRules stage={node.stage} spec={props.specs.get(node.stage.stageKey)} runId={props.runId} /> : null}
      {nodes.map((n) => (
        <StageRow key={n.stage.id} node={n} depth={depth + 1} props={props} />
      ))}
      {loop.wrapUp.map((n) => (
        <StageRow key={n.stage.id} node={n} depth={depth + 1} props={props} />
      ))}
    </View>
  );
}

export function RunTimeline(props: RunTimelineProps & { title: string; action?: { label: string; onPress: () => void } }): React.ReactElement {
  const tree = stageTree(props.stages);
  return (
    <ListSection title={props.title} {...(props.action ? { action: props.action } : {})} testID="run-timeline">
      {tree.map((node) => (
        <StageRow key={node.stage.id} node={node} depth={0} props={props} />
      ))}
    </ListSection>
  );
}
