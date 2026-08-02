// ────────────────────────────────────────────────────────────────
// Harness child-process environment.
//
// Agent harnesses execute model-generated tool calls — including arbitrary
// shell commands. Anything in their environment is therefore readable by
// whatever the model decides to run, and by any process the agent spawns.
//
// Cloning `process.env` into a harness (the historical behaviour) hands that
// agent:
//
//   * GENERATORAI_SECRET_KEY   — the key that decrypts EVERY stored credential
//   * GENERATORAI_DESKTOP_ADMIN_TOKEN — mints admin pairing grants
//   * GITHUB_TOKEN / GH_TOKEN  — the user's source-control identity
//   * ANTHROPIC_API_KEY / OPENAI_API_KEY — other providers' billing credentials
//   * DATABASE_URL, AWS_*, AZURE_*, GOOGLE_* — infrastructure credentials
//
// A single prompt injection then becomes full credential compromise. This
// module implements the plan's §13.3 rule — build the child environment from
// an explicit allowlist, never by subtraction from the parent — so a variable
// added to the server tomorrow is private by default rather than leaked by
// default.
//
// Two layers of defence, deliberately redundant:
//   1. ALLOWLIST decides what may pass through at all.
//   2. DENY patterns re-scan the result, so an allowlisted-but-dangerous name
//      (or one injected via explicit `extra`) still cannot escape.
// ────────────────────────────────────────────────────────────────

/**
 * Environment variables every child needs to function at all.
 *
 * Intentionally small. Anything a *specific* provider needs is added by that
 * provider through `extra`, so the requirement is visible in its adapter
 * rather than buried in a shared list.
 */
const BASE_ALLOWLIST: readonly string[] = [
  // Process/OS identity and path resolution.
  'PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP',
  'SHELL', 'COMSPEC', 'SystemRoot', 'SystemDrive', 'windir', 'OS',
  'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
  // Locale and terminal behaviour — wrong values here break tool output.
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR',
  // Node/runtime resolution for CLIs the harness shells out to.
  'NODE', 'NODE_PATH', 'NODE_OPTIONS', 'NVM_DIR', 'VOLTA_HOME', 'FNM_DIR',
  // Corporate proxies — omitting these silently breaks every network tool.
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy',
  // Windows shells need these to locate user data.
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)',
  'USERNAME', 'USERDOMAIN', 'HOMEDRIVE', 'HOMEPATH',
  // Unix identity used by git and shells.
  'USER', 'LOGNAME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
];

/**
 * Names that must NEVER reach a harness, regardless of how they got there.
 *
 * Matched case-insensitively against the whole variable name. This is the
 * backstop for the allowlist, and the reason `extra` can be trusted: a
 * provider cannot accidentally re-introduce a credential it does not own.
 */
const DENY_PATTERNS: readonly RegExp[] = [
  // GeneratorAI's own security material — the crown jewels.
  /^GENERATORAI_(SECRET|API|ADMIN|DESKTOP|RELAY|ELECTRON|TOKEN)/i,
  // Generic credential-shaped names.
  /(^|_)(SECRET|PASSWORD|PASSWD|PRIVATE_KEY|CREDENTIALS?)($|_)/i,
  /(^|_)(API_?KEY|ACCESS_?KEY|SECRET_?KEY|AUTH_?TOKEN)($|_)/i,
  /_TOKEN$/i,
  // Database and message-broker connection strings.
  /^(DATABASE|DB|POSTGRES|PG|MYSQL|MONGO|REDIS)_?(URL|URI|PASSWORD|DSN)$/i,
  // Cloud provider credentials.
  /^AWS_(ACCESS|SECRET|SESSION)/i,
  /^AZURE_(CLIENT_SECRET|TENANT|CLIENT_ID)/i,
  /^GOOGLE_(APPLICATION_CREDENTIALS|API_KEY)$/i,
  /^GCP_/i,
  // Electron internals — leaking these into a child can re-enter the shell.
  /^ELECTRON_/i,
];

/** Provider credentials that must only ever reach their OWN provider. */
const PROVIDER_CREDENTIALS: readonly string[] = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL',
  'GITHUB_TOKEN', 'GH_TOKEN', 'COPILOT_GITHUB_TOKEN',
  'GITLAB_TOKEN', 'GITLAB_API_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
];

function isDenied(name: string): boolean {
  if (PROVIDER_CREDENTIALS.some((c) => c.toLowerCase() === name.toLowerCase())) return true;
  return DENY_PATTERNS.some((p) => p.test(name));
}

export interface HarnessEnvOptions {
  /**
   * Variables this specific harness genuinely needs — its own credentials,
   * managed-home paths, or CLI overrides.
   *
   * Applied AFTER the allowlist so a provider can inject its own credential,
   * but still filtered by the deny list so it cannot smuggle another
   * provider's secret through.
   */
  extra?: Record<string, string | undefined> | undefined;
  /**
   * Additional parent variables to pass through by name.
   *
   * For provider-specific settings that live in the operator's environment
   * (e.g. `CLAUDE_CLI_PATH`). Still subject to the deny list.
   */
  passthrough?: readonly string[] | undefined;
  /** Source environment. Defaults to `process.env`; injectable for tests. */
  source?: NodeJS.ProcessEnv;
}

/**
 * Builds a minimal, explicitly-allowed environment for a harness child.
 *
 * @example
 * // Claude gets its own credential and an isolated config dir; it does NOT
 * // get the vault key, the GitHub token, or OpenAI's key.
 * buildHarnessEnv({
 *   passthrough: ['CLAUDE_CLI_PATH'],
 *   extra: {
 *     ANTHROPIC_API_KEY: await vault.get('harness', 'claude-personal/api-key'),
 *     CLAUDE_CONFIG_DIR: managedHomeFor('claude-personal'),
 *   },
 * });
 */
export function buildHarnessEnv(options: HarnessEnvOptions = {}): Record<string, string> {
  const source = options.source ?? process.env;
  const env: Record<string, string> = {};

  const allowed = [...BASE_ALLOWLIST, ...(options.passthrough ?? [])];
  for (const name of allowed) {
    const value = source[name];
    if (value === undefined || isDenied(name)) continue;
    env[name] = value;
  }

  // Provider-owned injection. Filtered too: a provider must not be able to
  // hand its child another provider's credential, deliberately or otherwise.
  for (const [name, value] of Object.entries(options.extra ?? {})) {
    if (value === undefined) continue;
    if (isDenied(name) && !isOwnCredential(name, options.extra)) continue;
    env[name] = value;
  }

  return env;
}

/**
 * A provider passing its own credential through `extra` is the one legitimate
 * way a denied name may appear — that is the whole point of just-in-time
 * injection. The deny list still applies to everything it did NOT ask for.
 */
function isOwnCredential(
  name: string,
  extra: Record<string, string | undefined> | undefined,
): boolean {
  return extra !== undefined && Object.prototype.hasOwnProperty.call(extra, name);
}

/**
 * Names this module will strip. Exported so tests (and the security smoke
 * test) can assert the contract rather than re-deriving it.
 */
export function isBlockedHarnessEnvVar(name: string): boolean {
  return isDenied(name);
}

/** The base allowlist, exported for diagnostics and tests. */
export const HARNESS_ENV_ALLOWLIST = BASE_ALLOWLIST;
