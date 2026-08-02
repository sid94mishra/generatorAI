// ────────────────────────────────────────────────────────────────
// deriveTimeline — moved to the shared agent module. Re-export shim
// so existing imports keep working.
// ────────────────────────────────────────────────────────────────

export {
  deriveTimeline,
  deriveAnswer,
  countTools,
  deriveStreamView,
} from '@/components/agent/deriveTimeline.js';
export type { DeriveTimelineOptions, StreamView } from '@/components/agent/deriveTimeline.js';
