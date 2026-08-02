// @generatorai/review — inline review comments anchored to diff lines

export { ReviewThreadService } from './ReviewThreadService.js';
export type { ReviewContentReader } from './ReviewThreadService.js';
export {
  hashAnchor,
  resolveAnchor,
  mapLineThroughPatch,
  changedRangesFromPatch,
  rangesOverlap,
} from './AnchorResolver.js';
export type { AnchorInput, AnchorOutcome } from './AnchorResolver.js';
export { serializeReviewThreads } from './ReviewPromptSerializer.js';
export type { SerializeOptions } from './ReviewPromptSerializer.js';
export type { IReviewRepository } from './ports/IReviewRepository.js';
export type {
  ReviewScope,
  ReviewSide,
  ReviewThreadStatus,
  ReviewIntent,
  ReviewAuthor,
  ReviewComment,
  ReviewThread,
  CreateReviewThreadParams,
  ListReviewThreadsFilters,
  ReviewSubmitTarget,
  SubmitReviewParams,
  SubmitReviewResult,
} from './types.js';
