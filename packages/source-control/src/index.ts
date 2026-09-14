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
export { parseRepoSlug } from './parseRepoSlug.js';
export type { RepoSlug } from './parseRepoSlug.js';
export { ProviderNotConfiguredError, SourceControlError } from './errors.js';
export type {
  ISourceControlProvider,
  IScmHttpClient,
  IScmProcessRunner,
  ScmHttpRequestOptions,
  ScmHttpResponse,
  ScmProcessRunResult,
} from './ports.js';
export type {
  ActiveProvider,
  ChecksSummary,
  CheckConclusion,
  CreatePullRequestInput,
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
