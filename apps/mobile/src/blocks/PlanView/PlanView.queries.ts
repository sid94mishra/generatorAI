// MB-31 data: a chat's plans, the selected plan's document (revisions + comments), and its mutations — the decision
// (through the one encoder, `planDecisionFor`), saving an edit as a new revision (`expectedRevision`, 409 on a race),
// a comment on a revision, saving the plan file to the workspace. A decision refreshes the plans and the chat's
// interactions (the plan gate settles with it).
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type PlanSummary } from '@generatorai/client-core';

import { useApi } from '../../services/api/useApi';
import { useCapability } from '../../services/auth/useCapability';
import { haptic } from '../../ui/platform/haptics';
import { toast } from '../../ui/primitives/Toast';
import { planDecisionFor, type PlanDecisionKind } from './model/planDecisions';

export function usePlanDocument(chatId: string, options: { active?: boolean; planId?: string | null; onDecided?: (kind: PlanDecisionKind) => void } = {}) {
  const api = useApi();
  const client = useQueryClient();
  const decide = useCapability('decidePlan');
  const active = options.active ?? true;
  const plans = useQuery({ queryKey: queryKeys.chatPlans(chatId), queryFn: () => api.chats.plans(chatId), subscribed: active });
  const planId = options.planId ?? null;
  const selected = useMemo<PlanSummary | undefined>(() => {
    const list = plans.data ?? [];
    if (planId) return list.find((p) => p.planId === planId) ?? list[list.length - 1];
    return list.find((p) => p.status === 'awaiting_review') ?? list[list.length - 1];
  }, [plans.data, planId]);
  const document = useQuery({
    queryKey: [...queryKeys.chatPlans(chatId), selected?.planId ?? '', 'document'],
    queryFn: () => api.plans.get(chatId, selected!.planId),
    enabled: Boolean(selected?.planId),
    subscribed: active,
  });
  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: queryKeys.chatPlans(chatId) });
    void client.invalidateQueries({ queryKey: queryKeys.chatInteractions(chatId) });
  };
  const fail = (fallback: string) => (err: unknown) => {
    haptic('error');
    toast({ kind: 'error', message: err instanceof Error && err.message ? err.message : fallback });
  };
  const decision = useMutation({
    mutationFn: (vars: { kind: PlanDecisionKind; feedback?: string; useEditedContent?: boolean; expectedRevision?: number }) =>
      api.chats.decidePlan(chatId, selected!.planId, planDecisionFor(vars.kind, vars.feedback, vars)),
    onSuccess: (_d, vars) => {
      invalidate();
      haptic('success');
      options.onDecided?.(vars.kind);
    },
    onError: (err) => {
      invalidate();
      haptic('error');
      toast({
        kind: 'error',
        message: err instanceof Error && /409|conflict|already/i.test(err.message) ? 'This plan is no longer waiting for review — it was decided elsewhere or expired.' : err instanceof Error && err.message ? err.message : "Couldn't record that decision.",
      });
    },
  });
  const saveRevision = useMutation({
    mutationFn: (vars: { content: string; expectedRevision: number }) => api.plans.saveRevision(chatId, selected!.planId, vars),
    onSuccess: () => {
      invalidate();
      haptic('success');
    },
    onError: (err) => {
      invalidate();
      fail("Couldn't save the revision. Someone may have changed the plan; it has been reloaded.")(err);
    },
  });
  const addComment = useMutation({
    mutationFn: (vars: { body: string; revision: number }) => api.plans.addComment(chatId, selected!.planId, vars),
    onSuccess: invalidate,
    onError: fail("Couldn't add the comment."),
  });
  const saveToWorkspace = useMutation({
    mutationFn: () => api.plans.saveToWorkspace(chatId, selected!.planId),
    onSuccess: (result) => {
      if (result.ok) haptic('success');
      else toast({ kind: 'error', message: "Couldn't save the plan to the workspace." });
    },
    onError: fail("Couldn't save the plan to the workspace."),
  });
  return { plans, selected, document, canDecide: decide.available, decideReason: decide.reason, decision, saveRevision, addComment, saveToWorkspace };
}

export type PlanDocumentApi = ReturnType<typeof usePlanDocument>;
