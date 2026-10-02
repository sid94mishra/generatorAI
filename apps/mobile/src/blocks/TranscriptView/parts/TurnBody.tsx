// MB-07 turn body: one agent message's blocks as client-core segments, in the order the agent produced them —
// thought pill, tool blocks (MB-13) and delegations (MB-17), assistant text (MB-10), gate cards (MB-15, rendered by
// the screen through the context), source-control results, workflow run / draft cards (MB-18), inline widgets
// ("Open on desktop": no widget host on mobile this pass), operator messages. The turn footer says how it ended.
import React, { memo, useMemo, useState } from 'react';
import { View } from 'react-native';
import { deriveSegments, digestBlocks, formatDigest, formatStepDuration, type StreamBlock, type StreamSegment } from '@generatorai/client-core';
import { STATUS_MAPS, type RunStatus } from '@generatorai/shared';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';

import { AssistantText } from '../../AssistantText/AssistantText';
import { Badge } from '../../../ui/primitives/Badge';
import { Button } from '../../../ui/primitives/Button';
import { Icon } from '../../../ui/primitives/Icon';
import { Pressable } from '../../../ui/primitives/Pressable';
import { StatusBadge } from '../../../ui/primitives/StatusBadge';
import { Text } from '../../../ui/primitives/Text';
import { stepRuns } from '../model/stepModel';
import { useTranscriptActions, type GateSegment } from '../transcriptContext';
import { DelegationGroup } from './DelegationGroup';
import { StepGroupCard } from './StepGroupCard';
import { UserMessage } from './UserMessage';

function ThoughtPill({ text, live }: { text: string; live: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-1.5">
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={live ? TRANSCRIPT_COPY.thinking : TRANSCRIPT_COPY.thought} className="flex-row items-center gap-1.5 self-start">
        <Icon concept="think" size={14} tone="fg-3" spinning={false} />
        <Text role="footnote" tone="fg-3">
          {live ? TRANSCRIPT_COPY.thinking : TRANSCRIPT_COPY.thought}
        </Text>
        <Icon concept={open ? 'chevron-up' : 'chevron-down'} size={12} tone="fg-3" />
      </Pressable>
      {open ? (
        <View className="border-s-2 border-line ps-3">
          <Text role="footnote" tone="fg-2" selectable>
            {text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A gate whose card the screen does not render (no renderer, or no longer pending): its outcome in one line. */
function GateOutcome({ segment }: { segment: GateSegment }): React.ReactElement | null {
  const words =
    segment.type === 'permission'
      ? segment.permission.status === 'allowed'
        ? `Allowed ${segment.permission.toolName}`
        : segment.permission.status === 'denied'
          ? `Denied ${segment.permission.toolName}`
          : segment.permission.status === 'expired'
            ? 'Permission request expired'
            : null
      : segment.type === 'question'
        ? segment.question.status === 'answered'
          ? 'Answered'
          : null
        : segment.plan.status === 'approved'
          ? `Plan approved: ${segment.plan.title}`
          : null;
  if (!words) return null;
  return (
    <View className="min-h-item flex-row items-center gap-2 rounded-card border border-line-soft px-3 py-2">
      <Icon concept={/Denied|expired/.test(words) ? 'x' : 'check'} size={14} tone="fg-3" />
      <Text role="footnote" tone="fg-2" numberOfLines={1} className="flex-1">
        {words}
      </Text>
    </View>
  );
}

function ScmResultCard({ block }: { block: Extract<StreamBlock, { type: 'scm_result' }> }): React.ReactElement {
  const { onOpenLink } = useTranscriptActions();
  const r = block.result;
  const tone = r.status === 'ok' ? 'succeeded' : r.status === 'conflicts' ? 'needs_you' : 'failed';
  const lines = [
    r.commit ? `Committed ${r.commit.sha.slice(0, 7)} · ${r.commit.message.split('\n')[0]}` : null,
    r.pushed ? `Pushed ${r.branch ?? ''}`.trim() : null,
    r.pullRequest ? `PR #${r.pullRequest.number} · ${r.pullRequest.title}` : null,
    r.conflicts ? `Merge conflicts in ${r.conflicts.files.length} file${r.conflicts.files.length === 1 ? '' : 's'} (${r.conflicts.head} ← ${r.conflicts.base})` : null,
    r.error ?? null,
  ].filter((l): l is string => Boolean(l));
  return (
    <View testID="scm-result" className="gap-1.5 rounded-card border border-line-soft p-3">
      <View className="flex-row items-center gap-2">
        <StatusBadge state={tone} label={r.status === 'ok' ? 'Committed' : r.status === 'conflicts' ? 'Conflicts' : r.status === 'blocked' ? 'Blocked' : 'Failed'} size="sm" />
        <Text role="monoSm" tone="fg-3" numberOfLines={1}>
          {r.alias === '.' ? 'workspace' : r.alias}
        </Text>
      </View>
      {lines.map((line) => (
        <Text key={line} role="footnote" tone="fg-2" numberOfLines={2}>
          {line}
        </Text>
      ))}
      {r.pullRequest?.url ? <Button label="Open pull request" size="sm" icon="external-link" onPress={() => onOpenLink?.(r.pullRequest!.url)} /> : null}
    </View>
  );
}

function WorkflowRunCard({ segment }: { segment: Extract<StreamSegment, { type: 'workflow_run' }> }): React.ReactElement {
  const { onOpenHref } = useTranscriptActions();
  const mapping = segment.run.status ? (STATUS_MAPS.workflowRun as Record<string, { state: Parameters<typeof StatusBadge>[0]['state']; label?: string } | null>)[segment.run.status as RunStatus] : null;
  return (
    <View testID="workflow-run-card" className="gap-2 rounded-card border border-line-soft p-3">
      <View className="flex-row items-center gap-2">
        <Icon concept="workflows" size={18} tone="fg-2" />
        <Text role="subhead" weight={600} numberOfLines={1} className="flex-1">
          {segment.run.workflowName ?? 'Workflow run'}
        </Text>
        {mapping ? <StatusBadge state={mapping.state} {...(mapping.label ? { label: mapping.label } : {})} size="sm" /> : null}
      </View>
      {segment.run.link && onOpenHref ? <Button label="Open run" size="sm" icon="external-link" onPress={() => onOpenHref(segment.run.link!)} /> : null}
    </View>
  );
}

function WorkflowDraftCard({ segment }: { segment: Extract<StreamSegment, { type: 'workflow_draft' }> }): React.ReactElement {
  return (
    <View testID="workflow-draft-card" className="gap-2 rounded-card border border-line-soft p-3">
      <View className="flex-row items-center gap-2">
        <Icon concept="workflows" size={18} tone="fg-2" />
        <Text role="subhead" weight={600} numberOfLines={1} className="flex-1">
          {segment.draft.name}
        </Text>
        <Badge label="Agent draft" icon="wand" size="sm" />
      </View>
      {segment.draft.warnings.length ? (
        <Text role="footnote" tone="fg-3">
          {`${segment.draft.warnings.length} warning${segment.draft.warnings.length === 1 ? '' : 's'} · Not published`}
        </Text>
      ) : (
        <Text role="footnote" tone="fg-3">
          Not published
        </Text>
      )}
    </View>
  );
}

function WidgetNote({ title }: { title: string }): React.ReactElement {
  return (
    <View className="min-h-item flex-row items-center gap-2 rounded-card border border-line-soft px-3 py-2">
      <Icon concept="widgets" size={16} tone="fg-2" />
      <Text role="footnote" tone="fg-2" numberOfLines={1} className="flex-1">
        {title}
      </Text>
      <Text role="footnote" tone="fg-3">
        Open on desktop
      </Text>
    </View>
  );
}

function Segment({ segment, active, streaming }: { segment: StreamSegment; active: boolean; streaming: boolean }): React.ReactElement | null {
  const { renderGate, onOpenLink } = useTranscriptActions();
  switch (segment.type) {
    case 'thinking':
      return <ThoughtPill text={segment.text} live={segment.live && active} />;
    case 'steps':
      return (
        <View className="gap-2">
          {stepRuns(segment.steps).map((run) => (run.type === 'delegation' ? <DelegationGroup key={run.id} steps={run.steps} /> : <StepGroupCard key={run.id} steps={run.steps} />))}
        </View>
      );
    case 'answer':
      return <AssistantText text={segment.text} streaming={streaming} {...(onOpenLink ? { onLinkPress: onOpenLink } : {})} />;
    case 'widget':
      return <WidgetNote title={segment.widget.title ?? 'Widget'} />;
    case 'plan':
    case 'question':
    case 'permission':
      return renderGate?.(segment) ?? <GateOutcome segment={segment} />;
    case 'scm_result':
      return <ScmResultCard block={segment.scmResult} />;
    case 'operator':
      return <UserMessage text={segment.text} />;
    case 'workflow_run':
      return <WorkflowRunCard segment={segment} />;
    case 'workflow_draft':
      return <WorkflowDraftCard segment={segment} />;
    default:
      return null;
  }
}

/** "✓ Done · 6 steps · 1m 06s" or the stopped note. */
export function TurnFooter({ blocks, durationMs, stopped }: { blocks: StreamBlock[]; durationMs?: number; stopped: boolean }): React.ReactElement {
  const digest = useMemo(() => digestBlocks(blocks, durationMs), [blocks, durationMs]);
  const empty = digest.steps === 0 && !digest.finalText;
  const words = stopped ? (empty ? TRANSCRIPT_COPY.stoppedEmpty : TRANSCRIPT_COPY.stoppedPartial) : `Done · ${formatDigest(digest, formatStepDuration)}`;
  return (
    <View className="flex-row items-center gap-1.5" accessibilityRole="text" accessibilityLabel={words}>
      <Icon concept={stopped ? 'status-skipped' : 'status-succeeded'} size={14} tone={stopped ? 'fg-3' : 'ok'} />
      <Text role="footnote" tone="fg-3">
        {words}
      </Text>
    </View>
  );
}

export interface TurnBodyProps {
  blocks: StreamBlock[];
  /** The turn is live (streaming or parked on a gate). */
  active: boolean;
}

export const TurnBody = memo(function TurnBody({ blocks, active }: TurnBodyProps): React.ReactElement | null {
  const segments = useMemo(() => deriveSegments(blocks, { active }), [blocks, active]);
  if (segments.length === 0) return null;
  let lastAnswer = -1;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i]!.type === 'answer') {
      lastAnswer = i;
      break;
    }
  }
  return (
    <View className="gap-2.5">
      {segments.map((segment, i) => (
        <Segment key={segment.id} segment={segment} active={active} streaming={active && i === lastAnswer && i === segments.length - 1} />
      ))}
    </View>
  );
});

/** The plain answer text of a turn (Copy, Read aloud). */
export function answerText(blocks: readonly StreamBlock[]): string {
  return blocks.filter((b): b is Extract<StreamBlock, { type: 'text' }> => b.type === 'text').map((b) => b.content).join('');
}
