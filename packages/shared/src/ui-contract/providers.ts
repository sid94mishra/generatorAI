// ────────────────────────────────────────────────────────────────
// Agent providers' display names for ui-contract consumers — re-exported from
// the one source (`HARNESS_PROVIDER_LABELS` in types/ProviderConfig.ts) so a
// provider is named identically everywhere. Lists of selectable providers come
// from the server (`/api/harness/providers`), never from a static list, since
// the server hides experimental providers (D-131).
// ────────────────────────────────────────────────────────────────

export { harnessProviderLabel } from '../types/ProviderConfig.js';
