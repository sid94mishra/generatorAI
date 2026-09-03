export { getTracer, withSpan, recordException } from './tracing.js';
export { getMeter } from './metrics.js';

// §11.1 — "Every expensive fallback increments a counter; counter registry;
// tests assert deltas." Read back with `fallbackCount`/`fallbackReport`,
// which the bare OTel counter API cannot do.
export {
  FALLBACK_KINDS,
  recordFallback,
  fallbackCount,
  fallbackReport,
  resetFallbackCounters,
} from './fallbackCounters.js';
export type { FallbackKind } from './fallbackCounters.js';
