import type { BuilderIssue, StageUpdate } from '@/stores/workflowBuilderStore.js';
import type { AgentStageSpec } from '../../types.js';

/** What every agent-stage tab receives. */
export interface AgentTabProps {
  stage: AgentStageSpec;
  onUpdate: (updates: StageUpdate) => void;
  /** The stage's issues. */
  issues: readonly BuilderIssue[];
}
