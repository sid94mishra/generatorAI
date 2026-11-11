// ────────────────────────────────────────────────────────────────
// ACP agents (docs/acp/README.md, ACP-1…ACP-10) — the wire shapes of
// `/api/acp/*` and the sub-provider fields the `acp` provider adds to
// `GET /api/harness/providers`.
//
// One provider id (`acp`) drives many agents: every agent of the ACP Registry
// (https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json) the
// user installs and enables, plus custom agents typed by hand. Each enabled
// agent is a SUB-PROVIDER of `acp`: its models are ids `<agentId>/<value>`
// and carry `subProvider: <agentId>`; the picker draws one provider entry per
// sub-provider (`acp:<agentId>`) with the agent's own label and mark.
// ────────────────────────────────────────────────────────────────

/** Elements a sanitised provider mark may contain (ACP-5). Everything else is dropped by the server. */
export type ProviderMarkTag = 'g' | 'path' | 'circle' | 'ellipse' | 'rect' | 'line' | 'polyline' | 'polygon';

/** One element of a sanitised mark. `attrs` hold only allow-listed geometry/paint attributes. */
export interface ProviderMarkNode {
  tag: ProviderMarkTag;
  attrs: Record<string, string>;
  /** Children of a `g`. */
  children?: ProviderMarkNode[];
}

/**
 * A vendor's monochrome mark, parsed from its registry SVG against an
 * element/attribute allow-list on the server, so a client draws it as plain
 * SVG elements and never loads a third-party URL. Paint is `currentColor` /
 * `none` / `inherit` only. The marks are the vendors' trademarks, used only to
 * identify the agent.
 */
export interface ProviderMark {
  viewBox: string;
  nodes: ProviderMarkNode[];
}

/** Sign-in state of one ACP agent (`auth/status` when the agent has it, else inferred). */
export type AcpAuthState = 'authenticated' | 'unauthenticated' | 'not_required' | 'unknown';

/** One enabled agent of a multiplexing provider (`acp`): what the picker draws as its own provider entry. */
export interface HarnessSubProviderStatus {
  /** The agent id (registry id, or `custom-…`); models carry it as `subProvider`. */
  id: string;
  label: string;
  mark?: ProviderMark;
  /** Installed version (registry agents) — absent for custom agents. */
  version?: string;
  /** The agent's launch command exists. */
  installed: boolean;
  /** Its process is up and answered `initialize`. */
  connected: boolean;
  authState: AcpAuthState;
  /** Signed in (or needs no sign-in) — `authState` is `authenticated` or `not_required`. */
  authenticated: boolean;
  /** Its models are in the catalog. */
  ready: boolean;
  error?: string;
  modelCount: number;
}

// ── /api/acp ──

/** How an agent is distributed by the registry (`custom`: a typed command). */
export type AcpDistributionKind = 'binary' | 'npx' | 'uvx' | 'custom';

/** A provider GeneratorAI supports natively (ACP-7): the registry agent is also available that way. */
export type AcpNativeProvider = 'claude-agent' | 'codex' | 'copilot' | 'opencode';

/**
 * One way the agent can sign the user in (`initialize.authMethods`).
 * - `agent`: `POST /api/acp/agents/:id/authenticate { methodId }`; the agent does the rest (often opens a browser).
 * - `terminal`: the user runs the agent's own command plus `args`/`env` in a terminal
 *   (`POST /api/acp/agents/:id/terminal-auth { methodId }` gives the exact command), then
 *   `POST /api/acp/agents/:id/reinitialize` once it exits 0.
 */
export interface AcpAuthMethodInfo {
  id: string;
  name: string;
  description?: string;
  type: 'agent' | 'terminal';
  /** Terminal methods: arguments appended to the agent's launch arguments. Shown to the user before running. */
  args?: string[];
  /** Terminal methods: environment overlaid on the agent's launch environment. Shown before running. */
  env?: Record<string, string>;
}

/** What the platform can run for an agent. */
export interface AcpAgentDistribution {
  /** Every distribution the registry lists for the agent. */
  offered: AcpDistributionKind[];
  /** The one this machine would install (binary for this platform first, then npx). Null: none can run here. */
  selected: AcpDistributionKind | null;
  /** Why nothing can run here (no build for this platform, uvx only, no Node.js for npx). */
  unavailableReason?: string;
  /** The selected binary has no sha256 in the registry: an install cannot be verified and is labelled so. */
  unverified?: boolean;
  /** For npx: the npm package spec (`name@version`). */
  package?: string;
}

/** An installed copy of an agent. */
export interface AcpInstalledAgent {
  version: string;
  kind: Exclude<AcpDistributionKind, 'uvx' | 'custom'>;
  installedAt: number;
  /** Installed without a checksum to verify against. */
  unverified: boolean;
}

/** An install / update in progress. */
export interface AcpInstallProgress {
  phase: 'resolving' | 'downloading' | 'verifying' | 'extracting' | 'npm' | 'finishing';
  version: string;
  receivedBytes: number;
  totalBytes?: number;
}

/** Live state of an enabled agent's connection. */
export interface AcpAgentRuntimeStatus {
  connected: boolean;
  authState: AcpAuthState;
  /** Models are listed in the picker. */
  ready: boolean;
  modelCount: number;
  error?: string;
  /** Sign-in methods the agent advertised in `initialize` (empty until it connected once). */
  authMethods: AcpAuthMethodInfo[];
  /** The agent can sign out (`agentCapabilities.auth.logout`): `POST /api/acp/agents/:id/logout`. */
  supportsLogout: boolean;
  /** `initialize.agentInfo`. */
  agentInfo?: { name: string; version?: string; title?: string };
  /** When the agent last answered a probe (epoch ms). */
  checkedAt?: number;
}

/** One user-set environment variable of an agent. The value is in the secret store and never sent back. */
export interface AcpAgentEnvVar {
  name: string;
  set: true;
}

/** One agent of the catalogue: a registry agent (installed or not) or a custom agent. */
export interface AcpAgentInfo {
  id: string;
  name: string;
  description: string;
  /** Latest version in the registry (custom agents: absent). */
  version?: string;
  custom: boolean;
  repository?: string;
  website?: string;
  license?: string;
  authors?: string[];
  mark?: ProviderMark;
  /** ACP-7: also available as this native provider (the recommended way to use it). */
  nativeProvider?: AcpNativeProvider;
  distribution: AcpAgentDistribution;
  installed: AcpInstalledAgent | null;
  /** The registry has a newer version than the installed one. */
  updateAvailable: boolean;
  installing?: AcpInstallProgress;
  /** The last install / update / uninstall failed. Cleared by the next attempt. */
  installError?: string;
  /** In the model picker (an enabled agent runs while the server runs). */
  enabled: boolean;
  /** Present while enabled. */
  status?: AcpAgentRuntimeStatus;
  /** Environment variables the user set for this agent (values hidden). */
  env: AcpAgentEnvVar[];
  /** Environment the registry distribution sets itself (not secret). */
  distributionEnv?: Record<string, string>;
  /** Custom agents: the typed command (env values are never echoed). */
  command?: { command: string; args: string[] };
}

/** Where the catalogue came from. */
export interface AcpRegistryInfo {
  url: string;
  source: 'network' | 'cache' | 'snapshot';
  /** When the index was fetched (epoch ms); for the snapshot, when it was generated. */
  fetchedAt?: number;
  /** When the server last asked the network (epoch ms), successful or not. */
  checkedAt?: number;
  /** The last network refresh failed (the catalogue is the cache or the snapshot). */
  error?: string;
}

/** `GET /api/acp/agents`, and the answer of every `/api/acp` mutation. */
export interface AcpAgentsResponse {
  registry: AcpRegistryInfo;
  /** This machine's registry platform key (`darwin-aarch64`, `linux-x86_64-musl`, …); null when unsupported. */
  platform: string | null;
  /** System Node.js for npx agents: found on PATH and recent enough. */
  node: { available: boolean; version?: string; error?: string };
  agents: AcpAgentInfo[];
}

/** `PUT /api/acp/agents/:id/enabled` body. */
export interface AcpSetEnabledRequest {
  enabled: boolean;
}

/** `PUT /api/acp/agents/:id/env` body: variables to set; `null` removes one. */
export interface AcpSetEnvRequest {
  env: Record<string, string | null>;
}

/** `POST /api/acp/agents/:id/authenticate` and `/terminal-auth` body. */
export interface AcpAuthMethodRequest {
  methodId: string;
}

/**
 * `POST /api/acp/agents/:id/terminal-auth` — the exact process to run for a terminal sign-in
 * (ACP terminal auth: the agent's own launch command, its launch args + the method's `args`,
 * its launch env + the method's `env`). Run it in an interactive terminal; when it exits 0, call
 * `POST /api/acp/agents/:id/reinitialize`.
 */
export interface AcpTerminalAuthSpec {
  agentId: string;
  methodId: string;
  /** Executable (absolute path inside the agent's install directory, or the custom command). */
  command: string;
  args: string[];
  /**
   * Variables to set on top of the terminal's own environment: the distribution's env, the user's
   * env (secrets included: the caller holds admin:harnesses) and the method's env.
   */
  env: Record<string, string>;
  /** Run from here (the agent's install directory for registry agents). */
  cwd: string;
  /** The same invocation as one line for a POSIX shell (`KEY='v' '/path/agent' 'arg'`). */
  posixCommandLine: string;
  /** The same invocation for PowerShell (`$env:KEY='v'; & 'C:\…\agent.exe' 'arg'`). */
  powershellCommandLine: string;
}

/** `POST /api/acp/agents/:id/test` — a fresh connection and probe, reported. */
export interface AcpTestResult {
  ok: boolean;
  authState: AcpAuthState;
  modelCount: number;
  durationMs: number;
  error?: string;
  agentInfo?: { name: string; version?: string; title?: string };
}

/** `POST /api/acp/custom` body (ACP-10). */
export interface AcpCustomAgentRequest {
  name: string;
  command: string;
  args?: string[];
  /** Stored in the secret store, like `PUT /env`. */
  env?: Record<string, string>;
}
