// @generatorai/changes — centralized change-set (diff/status) engine

export { ChangeSetService, isMetadataPath, extractFileDiff } from './ChangeSetService.js';
export {
  discoverRepos,
  hasLocalGit,
  nestedRepoPrefixes,
  isNestedRepoPath,
  RESERVED_DIRS,
} from './RepoDiscovery.js';
export type { DiscoveredRepo, DiscoverReposParams } from './RepoDiscovery.js';
export {
  ChangeSummaryService,
  stripAliasPrefix,
  languageFor,
} from './ChangeSummaryService.js';
export type { CheckpointLookup } from './ChangeSummaryService.js';
export {
  WorkspaceTreeService,
  MAX_TREE_PATHS_PER_REPO,
} from './WorkspaceTreeService.js';
export type {
  WorkspaceTree,
  WorkspaceTreeRepo,
  WorkspaceTreeFile,
  ListWorkspaceTreeParams,
  ReadWorkspaceFileParams,
} from './WorkspaceTreeService.js';
export {
  MAX_FILE_BODY_BYTES,
  MAX_PATCH_BYTES,
} from './summaryTypes.js';
export type {
  ChangeRevisionKind,
  ChangeRevision,
  ChangeRevisionSelector,
  ChangeSummaryFile,
  ChangeSummaryRepo,
  ChangeSummary,
  GetChangeSummaryParams,
  ChangeFileVersions,
  ChangeFilePatch,
} from './summaryTypes.js';
export type {
  ChangeSet,
  ChangeRepo,
  ChangeRepoKind,
  ChangedFile,
  ChangeStatus,
  GetChangeSetParams,
  WorktreeRef,
} from './types.js';
