// @generatorai/source-control — pluggable VCS-host (PR) providers

export { GitHubProvider } from './GitHubProvider.js';
export type { GitHubProviderOptions } from './GitHubProvider.js';
export { GitHubDeviceFlow, deviceFlowWebBase } from './GitHubDeviceFlow.js';
export type {
  DeviceCodeGrant,
  DevicePollResult,
  GitHubDeviceFlowOptions,
} from './GitHubDeviceFlow.js';
export { ghCliToken } from './ghCli.js';
export { createProvider } from './providerFactory.js';
export type { ProviderFactoryDeps } from './providerFactory.js';
export { SourceControlRegistry, hostFromAccount, normalizeHost } from './SourceControlRegistry.js';
export { parseRepoSlug, isLocalRemote } from './parseRepoSlug.js';
export type { RepoSlug } from './parseRepoSlug.js';
export { ProviderNotConfiguredError, PullRequestNotMergeableError, SourceControlError } from './errors.js';
export type {
  ISourceControlProvider,
  IScmHttpClient,
  IScmProcessRunner,
  PullRequestMetadata,
  ScmHttpRequestOptions,
  ScmHttpResponse,
  ScmProcessRunResult,
} from './ports.js';
export type {
  ActiveProvider,
  ChecksSummary,
  CheckConclusion,
  CloseIssueInput,
  CreateIssueInput,
  CreatePullRequestInput,
  IssueCloseReason,
  IssueComment,
  IssueRef,
  IssueSummary,
  ListIssuesInput,
  MergePullRequestInput,
  MergePullRequestResult,
  PullRequestMergeMethod,
  DeviceLoginStart,
  DeviceLoginStatus,
  ListPullRequestsInput,
  ProviderRepository,
  ProviderUser,
  PullRequest,
  PullRequestComment,
  PullRequestDetail,
  PullRequestFile,
  PullRequestRef,
  PullRequestState,
  PullRequestSummary,
  SourceControlAccount,
  SourceControlAuthMethod,
  SourceControlConfig,
  SourceControlProviderId,
  SourceControlProviderInfo,
  SourceControlSettings,
} from './types.js';
