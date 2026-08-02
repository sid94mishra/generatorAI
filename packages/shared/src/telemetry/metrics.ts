// ────────────────────────────────────────────────────────────────
// Metrics Utilities — shared helpers for OpenTelemetry metrics
// ────────────────────────────────────────────────────────────────

import { metrics, type Meter } from '@opentelemetry/api';

const PKG_VERSION = '0.1.0';

/**
 * Acquire a meter scoped to the given instrumentation name.
 * Safe to call even when OTel SDK is not initialised (returns no-op meter).
 */
export function getMeter(name: string): Meter {
  return metrics.getMeter(name, PKG_VERSION);
}
