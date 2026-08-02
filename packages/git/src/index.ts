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
} from './ports/IGitClient.js';
export type {
  IGitProcessRunner,
  GitProcessRunOptions,
  GitProcessRunResult,
} from './ports/IGitProcessRunner.js';
