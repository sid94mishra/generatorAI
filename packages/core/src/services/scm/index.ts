// ────────────────────────────────────────────────────────────────
// Source control — accounts, readiness, the commit → PR flow, editors
//
// Contract: `.github/docs/feature-source-control.md`; shared shapes:
// `packages/shared/src/types/SourceControl.ts`.
// ────────────────────────────────────────────────────────────────

export { redactTokens } from './redact.js';

export { SourceControlConfigService } from './SourceControlConfigService.js';
export type {
  SourceControlConfigDeps,
  SafeSourceControlConfig,
} from './SourceControlConfigService.js';

export {
  RepoReadinessService,
  notConnectedReason,
  REASON_NOT_A_REPO,
  REASON_NOTHING_TO_COMMIT,
  REASON_MERGE_IN_PROGRESS,
  REASON_NO_REMOTE_PUSH,
  REASON_NO_REMOTE_PR,
  REASON_DETACHED,
  REASON_NOTHING_TO_PROPOSE,
} from './RepoReadinessService.js';
export type { RepoReadinessDeps } from './RepoReadinessService.js';

export {
  ScmTextGenerator,
  capDiffExcerpt,
  buildCommitPrompt,
  buildPullRequestPrompt,
  parseCommitReply,
  parsePullRequestReply,
  heuristicCommitMessage,
  heuristicPullRequestText,
  narrowHint,
} from './ScmTextGenerator.js';
export type {
  ScmTextGeneratorDeps,
  CommitTextResult,
  PullRequestTextResult,
  CommitPromptInput,
  PullRequestPromptInput,
} from './ScmTextGenerator.js';

export {
  SourceControlFlowService,
  slugifyBranchHint,
  readPullRequestTemplate,
} from './SourceControlFlowService.js';
export type { SourceControlFlowDeps } from './SourceControlFlowService.js';

export { buildPullRequestReviewPrompt } from './reviewPrompt.js';
export type { PullRequestReviewPromptInput } from './reviewPrompt.js';

export {
  EditorLauncherService,
  EDITOR_TABLE,
  buildFallbackUrl,
  toFileUrlPath,
} from './EditorLauncherService.js';
export type { EditorLauncherDeps } from './EditorLauncherService.js';

export {
  AutoSourceControlRunner,
  isSilent as isSilentScmResult,
} from './AutoSourceControlRunner.js';
export type {
  AutoScmFlowPort,
  AutoScmReadinessPort,
  AutoSourceControlDeps,
  AutoSourceControlInput,
} from './AutoSourceControlRunner.js';

export { mountDirFor, scmMountTargets } from './workspaceMounts.js';
export type { ScmMountTarget } from './workspaceMounts.js';

export { buildTurnHint, extractSummaryLine, TURN_HINT_MAX_CHARS } from './turnHint.js';
export type { TurnHintInput } from './turnHint.js';
