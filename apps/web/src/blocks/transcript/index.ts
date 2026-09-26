// blocks/transcript — the transcript kit (03-domain §2.4 B-14…B-24; P4-07).
// Consumers: the chat (features/chat), the Tasks dock "Last steps", the
// workflow stage body. Model code lives in @generatorai/client-core.
export { TranscriptProvider, useTranscriptActions, browserArtifactUrl, type TranscriptActions, type PlanApproval } from './transcriptContext.js';
export { UserMessage, withInlineCode, type UserMessageProps } from './UserMessage/UserMessage.js';
export { AttachmentList, type AttachmentListProps } from './UserMessage/AttachmentList.js';
export { AgentTurnHeader, type AgentTurnHeaderProps } from './AgentTurnHeader/AgentTurnHeader.js';
export { ThoughtPill, ThinkingPlaceholder, type ThoughtPillProps } from './ThoughtPill/ThoughtPill.js';
export { StepList, type StepListProps } from './StepRow/StepList.js';
export { StepGlyph, STEP_KIND_ICON } from './StepRow/stepGlyph.js';
export { DiffSnippet, type DiffSnippetProps } from './StepRow/DiffSnippet.js';
export { ToolCallCard, ToolCallCardFrame, type ToolCallCardFrameProps } from './ToolCallCard/ToolCallCard.js';
export {
  registerToolCard,
  resolveToolCard,
  listToolCards,
  BUILTIN_TOOL_CARDS,
  type ToolCardEntry,
  type ToolCardProps,
  type ToolCardContext,
  type ToolCardOpenIn,
} from './ToolCallCard/toolCardRegistry.js';
export { AssistantText, type AssistantTextProps } from './AssistantText/AssistantText.js';
export { PermissionCard, type PermissionCardProps } from './gates/PermissionCard.js';
export { QuestionCard, type QuestionCardProps } from './gates/QuestionCard.js';
export { PlanReadyCard, toPlainText, type PlanReadyCardProps } from './gates/PlanReadyCard.js';
export { ComputerConsentCard, type ComputerConsentCardProps } from './gates/ComputerConsentCard.js';
export { InlineError, type InlineErrorProps } from './InlineError/InlineError.js';
export { DelegationGroup, delegationTasks, delegationSummary, type DelegatedTask, type DelegationGroupProps } from './DelegationGroup/DelegationGroup.js';
export { BackgroundStepTail, type BackgroundStepTailProps } from './BackgroundStepTail/BackgroundStepTail.js';
export { UsageChip, cacheScopeKey, noteCacheReport, hasReportedCache, _resetCacheReportLedger, type UsageChipProps } from './UsageChip/UsageChip.js';
export { TurnBody, type TurnBodyProps } from './TurnBody/TurnBody.js';
export { TranscriptTurn, StoppedNote, type TranscriptTurnProps } from './TranscriptTurn/TranscriptTurn.js';
export { TranscriptView, VIRTUALIZE_MIN_TURNS, type TranscriptViewProps } from './TranscriptView/TranscriptView.js';
