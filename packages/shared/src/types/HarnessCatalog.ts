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

/**
 * One model a provider serves for the signed-in account. Every field is what the
 * provider's own listing returned (D-131); an absent field was not returned.
 */
export interface HarnessCatalogModel {
  id: string;
  name: string;
  /** Owning provider (`copilot`, `claude-agent`, …); set on every catalog entry. */
  provider?: string;
  /** The provider's own blurb. */
  description?: string;
  /** The provider marks this model as the account's default. */
  isDefault?: boolean;
  /** Canonical wire id an alias resolves to (Claude `opus` → `claude-opus-5-5`). */
  resolvedModel?: string;
  /** Input kinds the model accepts, as the provider names them. */
  inputModalities?: string[];
  /** Provider-reported capability flags, named for display. */
  features?: string[];
  /** The provider's own picker category label, when it sends one (Copilot). */
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
  /** Its CLI is not here yet but can be downloaded in-app (`POST /harness/providers/:type/install`; Copilot). */
  installable?: boolean;
  /** That download is running. */
  installing?: { receivedBytes: number; totalBytes?: number };
}

/** `GET /api/harness/providers[?refresh=1]`. */
export interface HarnessProvidersResponse {
  /** The server's configured default provider — reported whether or not it is ready. */
  primary: string;
  /**
   * Where a chat that names no provider actually goes: `primary` when it is ready, else the first ready provider
   * (`MultiHarness.defaultTarget`); null when none is ready. Settings shows it next to a default that is not signed in.
   */
  inUse?: string | null;
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

/** Why a provider is or is not served (D-131): its stability default, an admin's setting, or the env reveal list. */
export type HarnessProviderVisibilitySource = 'default' | 'setting' | 'env';

/** One supported provider in the server's visibility list. */
export interface HarnessProviderVisibility {
  type: string;
  label: string;
  stability: 'stable' | 'experimental';
  /** Served to clients. A hidden provider is absent from every provider/model API and cannot run a turn. */
  visible: boolean;
  source: HarnessProviderVisibilitySource;
}

/** `GET /api/harness/visibility` and the answer of `PUT /api/harness/visibility` (admin:harnesses). */
export interface HarnessVisibilityResponse {
  providers: HarnessProviderVisibility[];
}

/** `PUT /api/harness/visibility` body: the providers whose setting changes; `null` returns one to its default. */
export interface HarnessVisibilityUpdate {
  visible: Record<string, boolean | null>;
}
