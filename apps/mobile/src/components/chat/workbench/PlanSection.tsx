// ────────────────────────────────────────────────────────────────
// Workbench › Plan.
//
// A thin pane over `PlanBody` (src/components/review/PlanSheet.tsx): the
// route sheet and this pane render the same revisions, document, comments
// and decision bar, and both encode decisions through the one encoder
// (`planDecisionFor` → `gateActions.toPlanDecision`, D12).
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';

import { PlanBody, usePlanDocument } from '../../review';

export function PlanSection({
  chatId,
  active = true,
  initialPlanId = null,
  onDecided,
}: {
  chatId: string;
  active?: boolean;
  /** Close the host sheet so the chat shows the work the decision started. */
  onDecided?: () => void;
  /** Open on this plan rather than the latest (a plan card's "Open plan"). */
  initialPlanId?: string | null;
}): React.ReactElement {
  const [planId, setPlanId] = useState<string | null>(initialPlanId);
  const plan = usePlanDocument(chatId, { active, planId, ...(onDecided ? { onDecided } : {}) });
  return <PlanBody chatId={chatId} plan={plan} onSelectPlan={setPlanId} />;
}
