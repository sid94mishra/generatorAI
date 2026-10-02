// Review surfaces still on the legacy layer: the plan sheet (until M6-11's PlanView). The review threads moved to
// blocks/DiffView, the checkpoints to blocks/CheckpointScrubber (M6-07).

export { PlanSheet, PlanBody, usePlanDocument, statusLabel, type PlanSheetProps, type PlanDocumentApi } from './PlanSheet';
export { useCapability, useGrantedScopes } from '../../services/auth/useCapability';
export { checkCapability, WORKBENCH_REQUIREMENTS, type WorkbenchCapability, type CapabilityCheck } from '../../services/auth/capabilities';
export { planDecisionFor, offersAutopilot, canRequestChanges, PLAN_ACTION_ID, type PlanDecisionKind } from './planDecisions';
