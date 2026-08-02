// @generatorai/source-control — pluggable VCS-host (PR) providers

export { GitHubProvider } from './GitHubProvider.js';
export type { GitHubProviderOptions } from './GitHubProvider.js';
export { SourceControlRegistry } from './SourceControlRegistry.js';
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
  ListPullRequestsInput,
  PullRequest,
  PullRequestRef,
  PullRequestState,
  SourceControlConfig,
  SourceControlProviderId,
} from './types.js';
