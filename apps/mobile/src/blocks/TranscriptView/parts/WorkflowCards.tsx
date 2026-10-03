// MB-18 WorkflowRunCard / ApprovalCard / DraftCard (03 MB-18; MChatWorkflowRun; P06): a run the chat started — name,
// status, "Stage k of n · <stage>", the stage segments, the summary and pull request once it finalized, "Open run";
// a stage waiting on a person becomes the review card whose "Review" opens the approval sheet (MB-50, the one
// approval surface: every workflow approval is risky and signed there, MD-31); an agent's draft — "Agent draft",
// its warnings, Publish (people only, confirmed). Live data comes from the chat's run cards (REST + the
// `chat.workflow_run.*` events); without them the tool result alone draws the card.
import React, { createContext, useContext, useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { StreamSegment, WorkflowRunCardView } from '@generatorai/client-core';
import { resolveStatus, type StatusState } from '@generatorai/shared';

import { confirm } from '../../../ui/native/AlertDialog';
import { Badge } from '../../../ui/primitives/Badge';
import { Button } from '../../../ui/primitives/Button';
import { Icon } from '../../../ui/primitives/Icon';
import { ProgressSegments } from '../../../ui/primitives/ProgressSegments';
import { StatusBadge } from '../../../ui/primitives/StatusBadge';
import { Text } from '../../../ui/primitives/Text';
import { ReviewCard } from '../../DecisionCard/ReviewCard';
import { approvalHref, runHref } from '../../shell/hrefs';
import { useTranscriptActions } from '../transcriptContext';

/** The chat's run cards by run id (TranscriptView provides them). */
export const WorkflowRunCardsContext = createContext<ReadonlyMap<string, WorkflowRunCardView>>(new Map());

function segmentsOf(card: WorkflowRunCardView, state: StatusState): { state: StatusState; label: string }[] {
  return Array.from({ length: card.stagesTotal }, (_, i) => {
    if (i < card.stagesDone) return { state: 'succeeded' as const, label: `Stage ${i + 1} done` };
    if (i === card.stagesDone && state !== 'succeeded' && state !== 'failed' && state !== 'skipped') return { state, label: `Stage ${i + 1}` };
    return { state: 'queued' as const, label: `Stage ${i + 1}` };
  });
}

export function WorkflowRunCard({ segment }: { segment: Extract<StreamSegment, { type: 'workflow_run' }> }): React.ReactElement {
  const { onOpenHref } = useTranscriptActions();
  const card = useContext(WorkflowRunCardsContext).get(segment.run.runId);
  const statusValue = card?.status ?? segment.run.status;
  const status = statusValue ? resolveStatus('workflowRun', statusValue as never) : null;
  const href = card ? runHref(card.workflowId, card.runId) : (segment.run.link ?? null);
  const name = card?.workflowName ?? segment.run.workflowName ?? 'Workflow run';
  return (
    <View className="gap-2.5">
      <View testID="workflow-run-card" className="gap-2 rounded-card border border-line-soft p-3">
        <View className="flex-row items-center gap-2">
          <Icon concept="workflows" size={18} tone="fg-2" />
          <Text role="subhead" weight={600} numberOfLines={1} className="flex-1">
            {name}
          </Text>
          {status ? <StatusBadge state={status.state} label={status.label} size="sm" /> : null}
        </View>
        {card && card.stagesTotal ? (
          <>
            <Text role="footnote" tone="fg-2" numberOfLines={1}>
              {`Stage ${Math.min(card.stagesDone + 1, card.stagesTotal)} of ${card.stagesTotal}${card.currentStage ? ` · ${card.currentStage}` : ''}`}
            </Text>
            <ProgressSegments segments={segmentsOf(card, status?.state ?? 'running')} showFraction />
          </>
        ) : null}
        {card?.summary ? (
          <Text role="footnote" tone="fg-2" selectable numberOfLines={4}>
            {card.summary}
          </Text>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {href && onOpenHref ? <Button label="Open run" size="sm" icon="external-link" onPress={() => onOpenHref(href)} testID="workflow-run-card-open" /> : null}
          {card?.prUrl ? <Button label="Pull request" size="sm" icon="pr" onPress={() => void WebBrowser.openBrowserAsync(card.prUrl!).catch(() => undefined)} /> : null}
        </View>
      </View>
      {card && onOpenHref
        ? card.pendingApprovals
            .filter((a) => !a.answerableByAgent)
            .map((a) => (
              <ReviewCard
                key={a.instanceId}
                view={{ title: `Review ${a.stageName}`, round: null, summary: `${name}: ${a.stageName} waits for your decision.`, question: null, facts: [], promptTitle: `Approve ${a.stageName}?` }}
                onReview={() => onOpenHref(approvalHref(card.workflowId, card.runId, a.instanceId))}
                testID={`workflow-approval-card-${a.instanceId}`}
              />
            ))
        : null}
    </View>
  );
}

export function WorkflowDraftCard({ segment }: { segment: Extract<StreamSegment, { type: 'workflow_draft' }> }): React.ReactElement {
  const { onOpenHref, onPublishDraft } = useTranscriptActions();
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const { draft } = segment;
  return (
    <View testID="workflow-draft-card" className="gap-2 rounded-card border border-line-soft p-3">
      <View className="flex-row items-center gap-2">
        <Icon concept="workflows" size={18} tone="fg-2" />
        <Text role="subhead" weight={600} numberOfLines={1} className="flex-1">
          {draft.name}
        </Text>
        <Badge label="Agent draft" icon="wand" size="sm" />
      </View>
      <Text role="footnote" tone="fg-3">
        {[draft.warnings.length ? `${draft.warnings.length} warning${draft.warnings.length === 1 ? '' : 's'}` : null, published ? 'Published' : 'Not published'].filter(Boolean).join(' · ')}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {onOpenHref ? <Button label="Open workflow" size="sm" icon="workflows" onPress={() => onOpenHref(`/workflows/${encodeURIComponent(draft.workflowId)}`)} testID="workflow-draft-open" /> : null}
        {onPublishDraft && !published ? (
          <Button
            label="Publish"
            size="sm"
            loading={busy}
            onPress={() =>
              void confirm({ title: `Publish ${draft.name}?`, message: 'Runs, automations and other workflows use the published version from now on.', confirmLabel: 'Publish' }).then((ok) => {
                if (!ok) return;
                setBusy(true);
                void onPublishDraft(draft.workflowId)
                  .then(() => setPublished(true))
                  .catch(() => undefined)
                  .finally(() => setBusy(false));
              })
            }
            testID="workflow-draft-publish"
          />
        ) : null}
      </View>
    </View>
  );
}
