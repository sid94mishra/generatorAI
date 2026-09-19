// ────────────────────────────────────────────────────────────────
// PlanSheet — a plan's revisions, document, comments and decision.
//
// Reading a plan and deciding on it are exactly what someone wants to do
// away from their desk, so the decision controls are pinned under the
// document rather than left at the end of it. Editing is a sheet with one
// multiline field — not an IDE, but enough to fix a heading or drop a step
// — and saves as a NEW revision the way web does (`PUT …/content` with
// `expectedRevision`, 409 on a race).
//
// One decision encoder (D12): every button goes through `planDecisionFor`
// → `gateActions.toPlanDecision`. "Approve & run autonomously" appears only
// when the server listed `implement_autopilot` for this plan.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleSlash, MessageSquare, Pencil, Save, ScrollText, Zap } from 'lucide-react-native';
import { queryKeys, type PlanSummary } from '@generatorai/client-core';

import { useApi } from '../../api/useApi';
import { useTheme } from '../../theme/ThemeProvider';
import { Markdown } from '../markdown/Markdown';
import { Sheet } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Form';
import { Badge, type Tone } from '../ui/primitives';
import { EmptyState, ErrorState, LoadingState } from '../ui/States';
import { useToast } from '../ui/Toast';
import { haptics } from '../ui/haptics';
import { usePlanExtras, type PlanDocumentInfo } from './api';
import { canRequestChanges, offersAutopilot, planDecisionFor, type PlanDecisionKind } from './planDecisions';
import { useCapability } from './useScopes';

const STATUS_TONE: Record<string, Tone> = {
  awaiting_review: 'primary',
  approved: 'success',
  changes_requested: 'warning',
  rejected: 'danger',
  expired: 'neutral',
  superseded: 'neutral',
  recorded: 'neutral',
  drafting: 'info',
};

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Everything a plan surface needs: the summaries, the selected document
 * with revisions and comments, and the mutations. Shared by the pane and
 * the route sheet so the two never disagree.
 */
export function usePlanDocument(chatId: string, options: { active?: boolean; planId?: string | null } = {}) {
  const api = useApi();
  const extras = usePlanExtras();
  const queryClient = useQueryClient();
  const toast = useToast();
  const decide = useCapability('decidePlan');
  const active = options.active ?? true;

  const plans = useQuery({
    queryKey: queryKeys.chatPlans(chatId),
    queryFn: () => api.chats.plans(chatId),
    subscribed: active,
  });

  const selected = useMemo<PlanSummary | undefined>(() => {
    const list = plans.data ?? [];
    if (options.planId) return list.find((p) => p.planId === options.planId);
    return list.find((p) => p.status === 'awaiting_review') ?? list[0];
  }, [plans.data, options.planId]);

  const document = useQuery({
    queryKey: [...queryKeys.chatPlans(chatId), selected?.planId ?? '', 'document'],
    queryFn: () => extras.get(chatId, selected!.planId),
    enabled: Boolean(selected?.planId),
    subscribed: active,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chatPlans(chatId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chatInteractions(chatId) });
  };
  const fail = (fallback: string) => (err: unknown) =>
    toast({ message: err instanceof Error ? err.message : fallback, tone: 'error' });

  const decision = useMutation({
    mutationFn: (vars: { kind: PlanDecisionKind; feedback?: string; useEditedContent?: boolean; expectedRevision?: number }) =>
      api.chats.decidePlan(chatId, selected!.planId, planDecisionFor(vars.kind, vars.feedback, vars)),
    onSuccess: (_data, vars) => {
      invalidate();
      toast({
        message:
          vars.kind === 'changes' ? 'Feedback sent' : vars.kind === 'discard' ? 'Plan discarded' : 'Plan approved',
        tone: 'success',
      });
    },
    onError: (err) => {
      invalidate();
      toast({
        message:
          err instanceof Error && /409|conflict|already/i.test(err.message)
            ? 'This plan is no longer awaiting review — it may have expired or been decided elsewhere.'
            : err instanceof Error
              ? err.message
              : 'Decision not recorded',
        tone: 'error',
      });
    },
  });

  const saveRevision = useMutation({
    mutationFn: (vars: { content: string; expectedRevision: number }) =>
      extras.saveRevision(chatId, selected!.planId, vars),
    onSuccess: () => {
      invalidate();
      toast({ message: 'Saved as a new revision', tone: 'success' });
    },
    onError: fail('Could not save the revision'),
  });

  const addComment = useMutation({
    mutationFn: (vars: { body: string; revision: number }) => extras.addComment(chatId, selected!.planId, vars),
    onSuccess: invalidate,
    onError: fail('Could not add the comment'),
  });

  const saveToWorkspace = useMutation({
    mutationFn: () => extras.saveToWorkspace(chatId, selected!.planId),
    onSuccess: (result) =>
      toast({
        message: result.ok && result.path ? `Saved to ${result.path}` : 'Could not save to the workspace',
        tone: result.ok ? 'success' : 'error',
      }),
    onError: fail('Could not save to the workspace'),
  });

  return {
    plans,
    selected,
    document,
    canDecide: decide.available,
    decideReason: decide.reason,
    decision,
    saveRevision,
    addComment,
    saveToWorkspace,
  };
}

export type PlanDocumentApi = ReturnType<typeof usePlanDocument>;

export interface PlanSheetProps {
  visible: boolean;
  onClose: () => void;
  chatId: string;
  planId?: string | null;
}

/** Route/sheet form: the same body as the pane, inside a Sheet. */
export function PlanSheet({ visible, onClose, chatId, planId }: PlanSheetProps): React.ReactElement | null {
  const plan = usePlanDocument(chatId, { active: visible, planId: planId ?? null });
  if (!visible) return null;
  return (
    <Sheet visible={visible} onClose={onClose} title={plan.selected?.title ?? 'Plan'} detents={[0.6, 0.92]} initialDetent={1} scrollable={false}>
      <PlanBody chatId={chatId} plan={plan} onSelectPlan={() => {}} />
    </Sheet>
  );
}

/**
 * The plan surface itself: revision strip, document, comments, decision
 * bar. Used by `PlanSheet` and by the workbench `PlanSection`.
 */
export function PlanBody({
  plan,
  onSelectPlan,
}: {
  chatId: string;
  plan: PlanDocumentApi;
  onSelectPlan: (planId: string) => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [revision, setRevision] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [comment, setComment] = useState('');
  const [showComments, setShowComments] = useState(false);

  const doc = plan.document.data;
  const current = doc?.currentRevision ?? plan.selected?.revision ?? 1;
  const shownRevision = revision ?? current;
  const revisionDoc = useMemo(
    () => doc?.revisions.find((r) => r.revision === shownRevision) ?? doc?.revisions[doc.revisions.length - 1],
    [doc, shownRevision],
  );
  const comments = useMemo(
    () => (doc?.comments ?? []).filter((c) => c.revision === shownRevision),
    [doc, shownRevision],
  );

  // A new plan or revision resets the viewer to the latest.
  useEffect(() => {
    setRevision(null);
    setEditing(false);
  }, [plan.selected?.planId, current]);

  if (plan.plans.isLoading) return <LoadingState label="Loading plans…" />;
  if (plan.plans.isError) {
    return <ErrorState message="Could not load plans." onRetry={() => void plan.plans.refetch()} />;
  }
  if (!plan.plans.data || plan.plans.data.length === 0 || !plan.selected) {
    return (
      <EmptyState
        title="No plan yet"
        message="Use “Plan first” to request a plan. Providers with plan-review support publish it here; other providers, including Codex, present it in chat."
        icon={<ScrollText size={22} color={colors['muted-foreground']} />}
      />
    );
  }

  const selected = plan.selected;
  const awaiting = selected.status === 'awaiting_review';
  const editedSinceAgent = doc ? doc.revisions.some((r) => r.authoredBy === 'user' && r.revision === current) : false;
  const autopilot = offersAutopilot(selected.actions);
  const busyKind = plan.decision.isPending ? plan.decision.variables?.kind : null;

  const startEdit = () => {
    setDraft(revisionDoc?.content ?? '');
    setEditing(true);
  };

  return (
    <View className="flex-1">
      {plan.plans.data.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          {plan.plans.data.map((p) => (
            <Chip
              key={p.planId}
              label={p.title}
              size="sm"
              selected={p.planId === selected.planId}
              tone={p.planId === selected.planId ? 'accent' : 'neutral'}
              onPress={() => onSelectPlan(p.planId)}
              maxWidth={180}
            />
          ))}
        </ScrollView>
      ) : null}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}>
        <View className="gap-2">
          <Text className="text-xl font-bold text-foreground">{selected.title}</Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <Badge label={statusLabel(selected.status)} tone={STATUS_TONE[selected.status] ?? 'neutral'} />
            {doc && doc.revisions.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {doc.revisions.map((r) => (
                  <Chip
                    key={r.revision}
                    label={`r${r.revision}${r.authoredBy === 'user' ? ' · you' : ''}`}
                    size="sm"
                    selected={r.revision === shownRevision}
                    tone={r.revision === shownRevision ? 'accent' : 'neutral'}
                    onPress={() => setRevision(r.revision)}
                  />
                ))}
              </ScrollView>
            ) : (
              <Text className="text-xs text-muted-foreground">Revision {current}</Text>
            )}
          </View>
          <View className="flex-row flex-wrap gap-1.5">
            {awaiting && !editing ? (
              <Button
                label="Edit"
                size="sm"
                variant="secondary"
                icon={<Pencil size={14} color={colors.foreground} />}
                onPress={startEdit}
              />
            ) : null}
            <Button
              label={showComments ? 'Hide comments' : `Comments${comments.length ? ` (${comments.length})` : ''}`}
              size="sm"
              variant="secondary"
              icon={<MessageSquare size={14} color={colors.foreground} />}
              onPress={() => setShowComments((v) => !v)}
            />
            <Button
              label="Save to workspace"
              size="sm"
              variant="ghost"
              icon={<Save size={14} color={colors.primary} />}
              loading={plan.saveToWorkspace.isPending}
              onPress={() => plan.saveToWorkspace.mutate()}
            />
          </View>
        </View>

        {plan.document.isLoading ? (
          <LoadingState />
        ) : plan.document.isError ? (
          <ErrorState message="Could not load the plan document." onRetry={() => void plan.document.refetch()} />
        ) : editing ? (
          <View className="gap-2">
            <Field
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              accessibilityLabel="Plan document"
              style={{ minHeight: 260, textAlignVertical: 'top', fontFamily: 'JetBrainsMono' }}
            />
            <View className="flex-row justify-end gap-2">
              <Button label="Cancel" variant="ghost" size="sm" onPress={() => setEditing(false)} />
              <Button
                label="Save as revision"
                size="sm"
                loading={plan.saveRevision.isPending}
                disabled={!draft.trim() || draft === revisionDoc?.content}
                onPress={() =>
                  plan.saveRevision.mutate(
                    { content: draft, expectedRevision: current },
                    { onSuccess: () => setEditing(false) },
                  )
                }
              />
            </View>
          </View>
        ) : (
          <Markdown content={revisionDoc?.content ?? selected.summary} />
        )}

        {showComments ? (
          <PlanComments
            comments={comments}
            revision={shownRevision}
            value={comment}
            onChange={setComment}
            busy={plan.addComment.isPending}
            canWrite={plan.canDecide}
            onAdd={() =>
              plan.addComment.mutate({ body: comment.trim(), revision: shownRevision }, { onSuccess: () => setComment('') })
            }
          />
        ) : null}
      </ScrollView>

      {awaiting ? (
        <View className="gap-2.5 border-t border-border bg-card px-4 pb-4 pt-3">
          {!plan.canDecide ? <Text className="text-xs text-muted-foreground">{plan.decideReason}</Text> : null}
          <Field
            placeholder="Notes for the agent (optional)"
            value={feedback}
            onChangeText={setFeedback}
            multiline
            accessibilityLabel="Feedback"
          />
          <Button
            label={editedSinceAgent ? 'Approve edited plan & implement' : 'Approve & implement'}
            icon={<Check size={16} color={colors['primary-foreground']} />}
            disabled={!plan.canDecide}
            loading={busyKind === 'approve'}
            onPress={() => {
              haptics.success();
              plan.decision.mutate({
                kind: 'approve',
                feedback,
                ...(editedSinceAgent ? { useEditedContent: true, expectedRevision: current } : {}),
              });
            }}
          />
          {autopilot ? (
            <Button
              label="Approve & run autonomously"
              variant="secondary"
              icon={<Zap size={16} color={colors.foreground} />}
              disabled={!plan.canDecide}
              loading={busyKind === 'autopilot'}
              onPress={() =>
                plan.decision.mutate({
                  kind: 'autopilot',
                  feedback,
                  ...(editedSinceAgent ? { useEditedContent: true, expectedRevision: current } : {}),
                })
              }
            />
          ) : null}
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                label="Request changes"
                variant="secondary"
                icon={<MessageSquare size={16} color={colors.foreground} />}
                disabled={!plan.canDecide || !canRequestChanges(feedback)}
                loading={busyKind === 'changes'}
                onPress={() => plan.decision.mutate({ kind: 'changes', feedback })}
              />
            </View>
            <Button
              accessibilityLabel="Discard the plan without implementing it"
              label="Discard"
              variant="ghost"
              icon={<CircleSlash size={16} color={colors.danger} />}
              disabled={!plan.canDecide}
              loading={busyKind === 'discard'}
              onPress={() => {
                haptics.warn();
                plan.decision.mutate({ kind: 'discard' });
              }}
            />
          </View>
          {!canRequestChanges(feedback) ? (
            <Text className="text-xs text-muted-foreground">
              Requesting changes needs a note — the agent cannot act on an empty rejection.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function PlanComments({
  comments,
  revision,
  value,
  onChange,
  busy,
  canWrite,
  onAdd,
}: {
  comments: PlanDocumentInfo['comments'];
  revision: number;
  value: string;
  onChange: (next: string) => void;
  busy: boolean;
  canWrite: boolean;
  onAdd: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View className="gap-2 rounded-2xl border border-border bg-card p-3">
      <Text className="text-xs font-semibold text-foreground">Comments on r{revision}</Text>
      {comments.length === 0 ? (
        <Text className="text-xs text-muted-foreground">
          Unresolved comments are folded into the feedback when you request changes.
        </Text>
      ) : (
        comments.map((c) => (
          <View key={c.id} className="gap-0.5">
            {c.anchor?.quotedText ? (
              <Text numberOfLines={2} className="font-mono text-xs text-muted-foreground">
                {c.anchor.quotedText}
              </Text>
            ) : null}
            <Text className={`text-sm ${c.resolved ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{c.body}</Text>
          </View>
        ))
      )}
      {canWrite ? (
        <View className="flex-row items-end gap-2">
          <View className="flex-1">
            <Field placeholder="Add a comment…" value={value} onChangeText={onChange} multiline accessibilityLabel="Plan comment" />
          </View>
          <IconButton
            accessibilityLabel="Add comment"
            icon={<MessageSquare size={18} color={value.trim() ? colors.primary : colors['muted-foreground']} />}
            disabled={!value.trim() || busy}
            onPress={onAdd}
          />
        </View>
      ) : null}
    </View>
  );
}
