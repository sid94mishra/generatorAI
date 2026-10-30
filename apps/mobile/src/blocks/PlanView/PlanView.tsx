// MB-31 PlanView (MPanePlan): the Plan tab — the revision bar ("v1 / v2 / v3", a Select past four) with "Revision 3 of
// 3 · 14:08" and the plan file, "Edit as new revision", ⋯ (Save to workspace, Approve & run autonomously when the
// server offers it, Discard plan — confirmed); the document (title, status — "Needs you" while it awaits review —
// and the markdown, MB-10); the comments of the shown revision (earlier revisions' comments marked "Stale") with a
// field to add one; and, while it awaits review, the decision footer — "Notes for <agent>" + "Request changes (n)" +
// "Approve plan" (the plan gate's actions, `GATE_ACTIONS.plan`, through the one encoder). States: drafting, approved
// (read-only), superseded ("A newer revision exists"), an edit race (reloaded, with a toast).
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { STATUS_MAPS, type StatusMapping } from '@generatorai/shared';

import { AssistantText } from '../AssistantText';
import { Menu } from '../../ui/native/Menu';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Select } from '../../ui/native/Select';
import { confirm } from '../../ui/native/AlertDialog';
import { overflowIcon } from '../../ui/platform/overflow';
import { useInsets } from '../../ui/platform/insets';
import { formatRelativeShort } from '../../ui/lib/format';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Spinner } from '../../ui/primitives/Spinner';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { offersAutopilot, planBodyWithoutTitle } from './model/planDecisions';
import { usePlanDocument } from './PlanView.queries';

export interface PlanViewProps {
  chatId: string;
  active: boolean;
  /** Open on this plan (a plan card's "Open plan", a `?dock=plan&plan=` link). */
  planId?: string | null;
  /** "Notes for <agent>". */
  agentName?: string | null;
  /** After a decision: the pane closes so the chat shows the work it started. */
  onDecided?: () => void;
}

const planStatus = (status: string): StatusMapping => (STATUS_MAPS.plan as Record<string, StatusMapping | null>)[status] ?? { state: 'queued', label: status };

export function PlanView({ chatId, active, planId: initialPlanId = null, agentName = null, onDecided }: PlanViewProps): React.ReactElement {
  const insets = useInsets();
  const [planId, setPlanId] = useState<string | null>(initialPlanId);
  const plan = usePlanDocument(chatId, { active, planId, ...(onDecided ? { onDecided } : {}) });
  const [revision, setRevision] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [comment, setComment] = useState('');

  const doc = plan.document.data;
  const selected = plan.selected;
  const current = doc?.currentRevision ?? selected?.revision ?? 1;
  const shown = revision ?? current;
  const revisionDoc = useMemo(() => doc?.revisions.find((r) => r.revision === shown) ?? doc?.revisions[doc.revisions.length - 1], [doc, shown]);
  const comments = doc?.comments ?? [];
  const open = comments.filter((c) => !c.resolved && c.revision === current);

  if (plan.plans.isLoading) {
    return (
      <View className="p-4" accessibilityLabel="Loading plans">
        <Skeleton preset="list" count={4} />
      </View>
    );
  }
  if (plan.plans.isError) return <ErrorState title="Couldn't load the plans" error={plan.plans.error} onRetry={() => void plan.plans.refetch()} />;
  if (!selected) return <EmptyState icon="plan" title="No plan yet" description="Ask for “Plan first” in the Turn sheet. Providers with plan review publish the plan here; others present it in the chat." />;

  const status = planStatus(selected.status);
  const awaiting = selected.status === 'awaiting_review';
  const drafting = selected.status === 'drafting';
  const editedByYou = Boolean(doc?.revisions.some((r) => r.authoredBy === 'user' && r.revision === current));
  const busy = plan.decision.isPending ? plan.decision.variables?.kind : null;
  const revisions = doc?.revisions ?? [];
  const menu = [
    { id: 'save', label: 'Save to workspace', icon: 'save' as const },
    ...(awaiting && offersAutopilot(selected.actions) ? [{ id: 'autopilot', label: 'Approve & run autonomously', icon: 'zap' as const, disabled: !plan.canDecide }] : []),
    ...(awaiting ? [{ type: 'separator' as const }, { id: 'discard', label: 'Discard plan', icon: 'trash' as const, destructive: true, disabled: !plan.canDecide }] : []),
  ];
  const onMenu = (id: string): void => {
    if (id === 'save') plan.saveToWorkspace.mutate();
    else if (id === 'autopilot') plan.decision.mutate({ kind: 'autopilot', feedback: notes, ...(editedByYou ? { useEditedContent: true, expectedRevision: current } : {}) });
    else if (id === 'discard')
      void confirm({ title: 'Discard this plan?', message: 'The agent stops planning and does not implement it.', confirmLabel: 'Discard' }).then((yes) => {
        if (yes) plan.decision.mutate({ kind: 'discard' });
      });
  };

  return (
    <View className="flex-1" testID="plan-view">
      {(plan.plans.data?.length ?? 0) > 1 ? (
        <View className="px-4 pt-2">
          <Select label="Plan" presentation="field" value={selected.planId} onValueChange={(next) => {
              setPlanId(next);
              setRevision(null);
            }} options={(plan.plans.data ?? []).map((p) => ({ value: p.planId, label: p.title, description: planStatus(p.status).label ?? p.status }))} />
        </View>
      ) : null}
      <View className="min-h-hit flex-row items-center gap-2 px-4 pt-2">
        {revisions.length > 1 && revisions.length <= 4 ? (
          <SegmentedControl<string> accessibilityLabel="Revision" value={String(shown)} onValueChange={(v) => setRevision(Number(v))} segments={revisions.map((r) => ({ value: String(r.revision), label: `v${r.revision}` }))} size="sm" testID="plan-revisions" />
        ) : revisions.length > 4 ? (
          <View className="w-24">
            <Select label="Revision" presentation="field" value={String(shown)} onValueChange={(v) => setRevision(Number(v))} options={revisions.map((r) => ({ value: String(r.revision), label: `v${r.revision}${r.authoredBy === 'user' ? ' · you' : ''}` }))} />
          </View>
        ) : null}
        <View className="flex-1 gap-0.5">
          <Text role="footnote" weight={600} numberOfLines={1}>
            {`Revision ${shown} of ${current}${revisionDoc?.createdAt ? ` · ${formatRelativeShort(String(revisionDoc.createdAt))}` : ''}`}
          </Text>
          {doc?.filePath || doc?.fileName ? (
            <Text role="monoSm" tone="fg-3" numberOfLines={1} ellipsizeMode="middle">
              {doc.filePath ?? doc.fileName}
            </Text>
          ) : null}
        </View>
        {awaiting && editing === null ? <IconButton icon="edit" size="sm" label="Edit as new revision" disabled={!plan.canDecide} onPress={() => setEditing(revisionDoc?.content ?? '')} testID="plan-edit" /> : null}
        <Menu items={menu} onSelect={onMenu} accessibilityLabel="More plan actions" trigger={<IconButton icon={overflowIcon} size="sm" label="More plan actions" onPress={() => undefined} />} />
      </View>
      <ScrollView className="flex-1" contentContainerClassName="gap-3 px-4 pb-6 pt-2" keyboardShouldPersistTaps="handled">
        {shown < current ? <Callout tone="info" form="banner" title="A newer revision exists" action={{ label: `Show v${current}`, onPress: () => setRevision(null) }} /> : null}
        <View className="flex-row flex-wrap items-center gap-2">
          <Text role="title" accessibilityRole="header" className="shrink">
            {selected.title}
          </Text>
          <StatusBadge state={status.state} label={awaiting ? 'Needs you' : (status.label ?? selected.status)} size="sm" />
        </View>
        {drafting ? (
          <View className="flex-row items-center gap-2">
            <Spinner size={14} />
            <Text role="footnote" tone="fg-2">
              The agent is drafting the plan…
            </Text>
          </View>
        ) : null}
        {plan.document.isLoading ? (
          <Skeleton preset="list" count={5} />
        ) : plan.document.isError ? (
          <ErrorState title="Couldn't load the plan" error={plan.document.error} onRetry={() => void plan.document.refetch()} />
        ) : editing !== null ? (
          <View className="gap-2">
            <Textarea label="Plan" value={editing} onChangeText={setEditing} mono minRows={12} maxRows={30} presentation="standalone" autoFocus testID="plan-editor" />
            <View className="flex-row justify-end gap-2">
              <Button label="Cancel" variant="ghost" size="sm" onPress={() => setEditing(null)} />
              <Button
                label="Save as new revision"
                size="sm"
                loading={plan.saveRevision.isPending}
                disabled={!editing.trim() || editing === revisionDoc?.content}
                onPress={() => plan.saveRevision.mutate({ content: editing, expectedRevision: current }, { onSuccess: () => setEditing(null), onError: () => setEditing(null) })}
              />
            </View>
          </View>
        ) : (
          <AssistantText text={planBodyWithoutTitle(revisionDoc?.content ?? selected.summary, selected.title)} />
        )}
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <Icon concept="message" size={16} tone="fg-2" />
            <Text role="footnote" weight={600} tone="fg-2">
              Comments
            </Text>
            <Text role="monoSm" tone="fg-3">
              {comments.length}
            </Text>
          </View>
          {comments.map((c) => (
            <View key={c.id} className="gap-1 rounded-card border border-line-soft bg-raised p-3">
              <View className="flex-row items-center gap-2">
                <Icon concept="user" size={12} tone="fg-3" />
                <Text role="caption" weight={600}>
                  You
                </Text>
                <Text role="monoSm" tone="fg-3">{`${formatRelativeShort(String(c.createdAt))} · v${c.revision}`}</Text>
                <View className="flex-1" />
                {c.revision < current ? <Badge label="Stale" size="sm" /> : c.resolved ? <Badge label="Resolved" size="sm" /> : null}
              </View>
              {c.anchor?.quotedText ? (
                <Text role="monoSm" tone="fg-3" numberOfLines={2}>
                  {c.anchor.quotedText}
                </Text>
              ) : null}
              <Text role="footnote" tone={c.resolved ? 'fg-3' : 'fg'}>
                {c.body}
              </Text>
            </View>
          ))}
          {plan.canDecide ? (
            <View className="gap-2">
              <Textarea label={`Comment on v${shown}`} value={comment} onChangeText={setComment} placeholder="Add a comment…" minRows={1} presentation="standalone" />
              {comment.trim() ? (
                <View className="flex-row justify-end">
                  <Button label="Add comment" size="sm" loading={plan.addComment.isPending} onPress={() => plan.addComment.mutate({ body: comment.trim(), revision: shown }, { onSuccess: () => setComment('') })} />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
      {awaiting ? (
        <View className="gap-2 border-t border-line-soft px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          {!plan.canDecide && plan.decideReason ? (
            <Text role="footnote" tone="fg-3">
              {plan.decideReason}
            </Text>
          ) : null}
          <Textarea label={agentName ? `Notes for ${agentName} (optional)` : 'Notes for the agent (optional)'} value={notes} onChangeText={setNotes} minRows={1} presentation="standalone" testID="plan-notes" />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                label={open.length ? `Request changes (${open.length})` : 'Request changes'}
                fullWidth
                disabled={!plan.canDecide || (!notes.trim() && open.length === 0)}
                {...(!notes.trim() && open.length === 0 ? { disabledReason: 'Write a note or a comment for the agent first.' } : {})}
                loading={busy === 'changes'}
                onPress={() => plan.decision.mutate({ kind: 'changes', feedback: notes.trim() || open.map((c) => c.body).join('\n') })}
                testID="plan-request-changes"
              />
            </View>
            <View className="flex-1">
              <Button
                label="Approve plan"
                icon="check"
                variant="primary"
                fullWidth
                disabled={!plan.canDecide}
                loading={busy === 'approve'}
                onPress={() => plan.decision.mutate({ kind: 'approve', feedback: notes, ...(editedByYou ? { useEditedContent: true, expectedRevision: current } : {}) })}
                testID="plan-approve"
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
