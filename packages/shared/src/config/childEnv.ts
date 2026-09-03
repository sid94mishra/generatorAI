// ────────────────────────────────────────────────────────────────
// Child-process environment construction.
//
// Anything that executes model-authored commands — an agent harness, an
// integrated terminal, a workflow script sandbox — can read its entire
// environment and pass it to whatever it spawns next. Cloning `process.env`
// into such a child hands the model:
//
//   * GENERATORAI_SECRET_KEY   — the key that decrypts EVERY stored credential
//   * GENERATORAI_DESKTOP_ADMIN_TOKEN — mints admin pairing grants
//   * GITHUB_TOKEN / GH_TOKEN  — the user's source-control identity
//   * ANTHROPIC_API_KEY / OPENAI_API_KEY — other providers' billing credentials
//   * DATABASE_URL, AWS_*, AZURE_*, GOOGLE_* — infrastructure credentials
//
// A single prompt injection then becomes full credential compromise.
//
// This module implements the plan's rule (§11.1: "No capability may be granted
// by negation") — build the child environment from an explicit allowlist,
// never by subtraction from the parent — so a variable added to the server
// tomorrow is private by default rather than leaked by default.
//
// It lives in @generatorai/shared, not in the providers package, because the
// terminal hosts and the script sandbox need exactly the same guarantee and
// cannot import from an L2 package. Before this move each of them had grown
// its own *denylist*, and they disagreed: `NodePtyHost` stripped
// `GENERATORAI_*` and `DATABASE_URL` but passed `ANTHROPIC_API_KEY`,
// `OPENAI_API_KEY`, `GITHUB_TOKEN` and `AWS_ACCESS_KEY_ID` straight through,
// while `FallbackChildProcessHost` stripped three names in total and its
// comment claimed parity with `NodePtyHost`.
//
// Two layers of defence, deliberately redundant:
//   1. ALLOWLIST decides what may pass through at all.
//   2. DENY patterns re-scan the result, so an allowlisted-but-dangerous name
//      (or one injected via explicit `extra`) still cannot escape.
// ────────────────────────────────────────────────────────────────

/**
 * Environment variables every child needs to function at all.
 *
 * Intentionally small. Anything a *specific* child needs is added by its own
 * call site through `passthrough`/`extra`, so the requirement is visible where
 * it is made rather than buried in a shared list.
 */
export const BASE_CHILD_ENV_ALLOWLIST: readonly string[] = [
  // Process/OS identity and path resolution.
  'PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP',
  'SHELL', 'COMSPEC', 'SystemRoot', 'SystemDrive', 'windir', 'OS',
  'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
  // Locale and terminal behaviour — wrong values here break tool output.
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR',
  // Node/runtime resolution for CLIs the child shells out to.
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
 * Names that must NEVER reach a child, regardless of how they got there.
 *
 * Matched case-insensitively against the whole variable name. This is the
 * backstop for the allowlist, and the reason `extra` can be trusted: a caller
 * cannot accidentally re-introduce a credential it does not own.
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

/**
 * A caller passing its own credential through `extra` is the one legitimate
 * way a denied name may appear — that is the whole point of just-in-time
 * injection. The deny list still applies to everything it did NOT ask for.
 */
function isOwnCredential(
  name: string,
  extra: Record<string, string | undefined> | undefined,
): boolean {
  return extra !== undefined && Object.prototype.hasOwnProperty.call(extra, name);
}

export interface ChildEnvOptions {
  /** Source environment. Defaults to `process.env`; injectable for tests. */
  source?: Record<string, string | undefined>;
  /**
   * Extra parent variables this particular child genuinely needs, beyond the
   * base allowlist. Still subject to the deny patterns.
   */
  passthrough?: readonly string[];
  /**
   * Values this call site owns and is deliberately injecting — a credential
   * fetched from the vault, a workspace id, a config directory. A denied name
   * is permitted here (and only here), because injecting it is the explicit
   * intent rather than an accident of inheritance.
   */
  extra?: Record<string, string | undefined>;
}

/**
 * Build a child environment from the allowlist.
 *
 * Never returns a variable that was not either on the base allowlist, named in
 * `passthrough`, or supplied in `extra` — so a new secret added to the server
 * cannot leak into a model-controlled process by default.
 */
export function buildChildEnv(options: ChildEnvOptions = {}): Record<string, string> {
  const source = options.source ?? process.env;
  const env: Record<string, string> = {};

  const allowed = [...BASE_CHILD_ENV_ALLOWLIST, ...(options.passthrough ?? [])];
  for (const name of allowed) {
    const value = source[name];
    if (value === undefined || isDenied(name)) continue;
    env[name] = value;
  }

  for (const [name, value] of Object.entries(options.extra ?? {})) {
    if (value === undefined) continue;
    if (isDenied(name) && !isOwnCredential(name, options.extra)) continue;
    env[name] = value;
  }

  return env;
}

/**
 * Names this module will strip. Exported so tests (and the security smoke
 * test) can assert the contract rather than re-deriving it.
 */
export function isBlockedChildEnvVar(name: string): boolean {
  return isDenied(name);
}
