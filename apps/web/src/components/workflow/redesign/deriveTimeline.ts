// ────────────────────────────────────────────────────────────────
// deriveTimeline — moved to the shared agent module. Re-export shim
// so existing imports keep working.
// ────────────────────────────────────────────────────────────────

export {
  deriveTimeline,
  deriveAnswer,
  countTools,
  deriveStreamView,
} from '@generatorai/client-core';
export type { DeriveTimelineOptions, StreamView } from '@generatorai/client-core';
