// @generatorai/git — local git operations (ports/adapters)

export { GitClient } from './GitClient.js';
export type {
  IGitClient,
  GitClientOptions,
  GitTreeEntry,
  GitRef,
  GitNumstatEntry,
  GitNameStatusEntry,
  GitRawDiffEntry,
  GitBlobEntry,
  WriteTreeOptions,
  ShadowRepoOptions,
  AddWorktreeOptions,
  GitAheadBehind,
  GitMergeTreeResult,
  GitMergeResult,
  GitCommitResult,
  MergeOptions,
} from './ports/IGitClient.js';
export type {
  IGitProcessRunner,
  GitProcessRunOptions,
  GitProcessRunResult,
} from './ports/IGitProcessRunner.js';
