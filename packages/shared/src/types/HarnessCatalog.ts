// ────────────────────────────────────────────────────────────────
// Agent-provider catalog (G-09) — the wire shapes of `GET /api/harness/providers`,
// `GET /api/harness/models` and the provider sign-in routes.
//
// The server builds these from `HarnessRegistry` statuses and each adapter's
// `HarnessModel` (`packages/core/src/domain/ports/IAgentHarness.ts`); web, CLI
// and mobile read them through `IPlatformClient` / client-core's api client,
// and the model picker's read model lives in `@generatorai/client-core`
// (`buildModelPickerCatalog`).
// ────────────────────────────────────────────────────────────────

/** Capability tier the picker shows next to a model (`HarnessModel.category`). */
export const MODEL_TIERS = ['lightweight', 'versatile', 'powerful'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** What every picker (web, mobile) calls each tier. */
export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  lightweight: 'Fast',
  versatile: 'Balanced',
  powerful: 'Powerful',
};

/** One model a provider serves for the signed-in account. */
export interface HarnessCatalogModel {
  id: string;
  name: string;
  /** Owning provider (`copilot`, `claude-agent`, …); set on every catalog entry. */
  provider?: string;
  /** Provider blurb — for Claude Code this carries the concrete version and pricing. */
  description?: string;
  /** Capability tier; see `MODEL_TIERS` (other values are passed through untyped). */
  category?: string;
  /** Maximum PROMPT tokens (default tier) — the context-gauge denominator. */
  promptTokenLimit?: number;
  /** Advertised total window = promptTokenLimit + maxOutputTokens. Display only. */
  totalContextWindow?: number;
  /** Long-context tier limits, when the model offers one. */
  longContext?: { promptTokenLimit?: number; totalContextWindow?: number };
  /** @deprecated Use `totalContextWindow` / `promptTokenLimit`. */
  contextWindow?: number;
  /** @deprecated Use `promptTokenLimit`. */
  standardContextWindow?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  /** Reasoning-effort levels this model accepts (present when `supportsReasoning`). */
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  /** Relative token-cost tier: 'low' | 'medium' | 'high' | 'very_high'. */
  priceCategory?: string;
  billingMultiplier?: number;
  pricing?: { input?: number; output?: number; cached?: number; batchSize?: number };
  supportsLongContext?: boolean;
}

/** Live readiness and catalog of one agent provider. */
export interface HarnessProviderStatus {
  type: string;
  label: string;
  /** The provider's CLI / SDK was found on the server host. */
  installed: boolean;
  connected: boolean;
  authenticated: boolean;
  /** Usable right now — the provider answered with a live catalog. */
  ready: boolean;
  error?: string | null;
  checkedAt?: number;
  modelCount: number;
  models: HarnessCatalogModel[];
  /** The provider can sign the user in from the app (`POST /harness/providers/:type/login`). */
  supportsLogin: boolean;
}

/** `GET /api/harness/providers[?refresh=1]`. */
export interface HarnessProvidersResponse {
  /** The server's configured default provider — reported whether or not it is ready. */
  primary: string;
  /** Served from the last-known snapshot while a background re-probe runs; poll until false. */
  stale: boolean;
  providers: HarnessProviderStatus[];
}

/** `POST /api/harness/providers/:type/login`. */
export interface HarnessLoginResult {
  /** A browser sign-in URL to open; the client then re-probes until `authenticated`. */
  authUrl?: string;
  loginId?: string;
  /** Signed in without a browser step. */
  completed?: boolean;
}

/** `POST /api/harness/switch`. */
export interface HarnessSetDefaultResult {
  message: string;
  type: string;
  switched: boolean;
}
