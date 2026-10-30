// ────────────────────────────────────────────────────────────────
// AutomationTriggerBadge — how an automation itself fires (manual/schedule/
// webhook) or how one execution was triggered (same three values,
// `AutomationExecution.triggeredBy`). This is a different vocabulary from
// the workflow kit's WF-20 `TriggerChip` (`blocks/workflow`), which answers
// "what started this workflow RUN" (`user | automation | fork | stage |
// chat | orchestrator | external_agent`, `RUN_TRIGGERS`) — an automation's
// own trigger config has no run-provenance meaning, so it is not forced
// into that component (per the coordinator's "reuse, don't duplicate"; this
// is a distinct three-value concept, not a duplicate of WF-20).
// ────────────────────────────────────────────────────────────────

import type { IconConcept } from '@generatorai/design-tokens';
import type { AutomationTriggerType } from '@generatorai/shared';
import { Badge } from '@/ui/primitives/Badge/Badge.js';

const TRIGGER_META: Record<AutomationTriggerType, { icon: IconConcept; label: string }> = {
  manual: { icon: 'hand', label: 'Manual' },
  schedule: { icon: 'clock', label: 'Schedule' },
  webhook: { icon: 'webhook', label: 'Webhook' },
};

export interface AutomationTriggerBadgeProps {
  triggerType: AutomationTriggerType;
  /** Overrides the default label (e.g. the cron expression instead of "Schedule"). */
  label?: string;
  className?: string;
}

/** Icon + label for an automation's trigger config or an execution's `triggeredBy`. */
export function AutomationTriggerBadge({ triggerType, label, className }: AutomationTriggerBadgeProps) {
  const def = TRIGGER_META[triggerType];
  return (
    <Badge icon={def.icon} className={className}>
      {label ?? def.label}
    </Badge>
  );
}
