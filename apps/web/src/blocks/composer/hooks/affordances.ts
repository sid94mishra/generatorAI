import { composerAffordances } from '@/platform/surfaceCapabilities.js';

/**
 * W29 — what the composer offers on THIS surface, read from the capability
 * ledger. Module-level because the surface cannot change without a reload,
 * and a per-render read would be pure overhead on the composer's hot path.
 * One read shared by the composer view and its hooks.
 */
export const COMPOSER = composerAffordances();
