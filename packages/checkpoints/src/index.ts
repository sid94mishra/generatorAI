// @generatorai/checkpoints — workspace snapshots via private git refs

export { CheckpointService, EMPTY_TREE_SHA } from './CheckpointService.js';
export type { CheckpointServiceOptions } from './CheckpointService.js';
export {
  GitShadowRefStore,
  CHECKPOINT_REF_PREFIX,
  checkpointRefName,
  sanitizeRefComponent,
} from './GitShadowRefStore.js';
export type { ISnapshotStore, SnapshotHandle } from './ports/ISnapshotStore.js';
export type { ICheckpointRepository } from './ports/ICheckpointRepository.js';
