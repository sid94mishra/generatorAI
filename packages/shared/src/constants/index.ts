// Shared constants

// Explicit re-exports rather than `export *` so the barrel shows exactly which
// security-critical lists are published.
export {
  BLOCKED_BUNDLE_IDS,
  BLOCKED_NAME_FRAGMENTS,
  BLOCKED_WORD_FRAGMENTS,
  BLOCKED_EXECUTABLES,
  SELF_BUNDLE_IDS,
  SELF_NAME_FRAGMENTS,
  SELF_EXECUTABLES,
} from './computerUseBlocklist.js';

/** Default harness model identifier */
export const DEFAULT_MODEL = 'claude-sonnet-4.6';

/** Default server port */
export const DEFAULT_PORT = 3100;

/** Default heartbeat interval for SSE in ms */
export const DEFAULT_HEARTBEAT_MS = 15_000;

/** Default timeout for harness responses in ms */
export const DEFAULT_HARNESS_TIMEOUT_MS = 120_000;

/** Default max replay events for SSE reconnection */
export const MAX_REPLAY_EVENTS = 10_000;

/** Maximum script execution timeout in ms */
export const MAX_SCRIPT_TIMEOUT_MS = 300_000;

/** Maximum output buffer size in bytes (10MB) */
export const MAX_OUTPUT_BUFFER_BYTES = 10 * 1024 * 1024;

// ── v2 Workflow / DAG Constants ──

/** Maximum stages allowed per WorkflowDefinition */
export const MAX_STAGES_PER_WORKFLOW = 50;

/** Maximum edges allowed per WorkflowDefinition */
export const MAX_EDGES_PER_WORKFLOW = 200;

/** Maximum concurrent stage sessions per WorkflowRun */
export const MAX_CONCURRENT_STAGE_SESSIONS = 10;

/** Default max concurrency for parallel stages */
export const DEFAULT_MAX_STAGE_CONCURRENCY = 5;

// ── Computer Use ──

/**
 * Env kill switch, following the repo's `0`/`1` convention. Any of
 * `0 | false | off | no | disabled` hard-disables the feature regardless of
 * config; anything else falls through to `AppConfig.computerUse.enabled`.
 * Recognising several spellings matters because a switch that only understands
 * one exact string fails OPEN on every other value.
 */
export const COMPUTER_USE_KILL_SWITCH_ENV = 'GENERATORAI_COMPUTER_USE';

/** Values of `COMPUTER_USE_KILL_SWITCH_ENV` that hard-disable the feature. */
export const COMPUTER_USE_DISABLE_TOKENS: readonly string[] = Object.freeze([
  '0',
  'false',
  'off',
  'no',
  'disabled',
]);

/**
 * Artifact id of the built-in Computer Use skill. Derived by
 * `SystemArtifactService` from `templates/system/artifacts/skills/computer-use.md`;
 * named here so the composer can find that one skill without string-matching a
 * display name a user could shadow with their own project skill.
 */
export const COMPUTER_USE_SKILL_ID = 'system-skill-computer-use';

/**
 * The name this skill is STAGED and REGISTERED under with the harness.
 *
 * Deliberately not `computer-use`: Orca ships a user-level skill by that exact
 * name at `~/.agents/skills/computer-use`, and its body tells the agent to
 * drive the desktop through Orca's CLI — bypassing our consent prompt, app
 * blocklist and audit log entirely. Two skills with one name is a coin flip we
 * cannot win from inside someone else's resolver, so we do not enter it. The
 * `/computer-use` command the user types is unaffected; only the identifier the
 * model resolves changes.
 */
export const COMPUTER_USE_SKILL_NAME = 'generatorai-computer-use';

/** Default lifetime of a pending consent prompt. `AppConfig` derives from this. */
export const COMPUTER_USE_CONSENT_TTL_MS = 120_000;

// ── Provider capability levels (P02) ──
export {
  PROVIDER_CAPABILITY_LEVELS,
  capabilityLevelsFor,
  sessionCapabilityWarnings,
  type ApprovalGatingLevel,
  type HostToolsLevel,
  type StructuredOutputLevel,
  type SkillsLevel,
  type CapabilityLevels,
  type LevelledProviderId,
  type SessionCapabilityWarning,
} from './providerCapabilityLevels.js';
