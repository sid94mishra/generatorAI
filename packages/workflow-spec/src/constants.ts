// ────────────────────────────────────────────────────────────────
// Constants shared by every schema in the spec package.
//
// The enums below mirror values that the rest of the monorepo also names
// (provider ids, reasoning efforts, agent modes). The spec package depends
// only on zod, so it cannot import them from `@generatorai/shared`; a drift
// test (`packages/shared/__tests__/workflowSpecConstants.test.ts`) keeps both
// lists identical.
// ────────────────────────────────────────────────────────────────

/**
 * The engine generation that runs workflows. `validateWorkflow` rejects
 * spec fields the engine cannot execute yet (`engine-unsupported`), and the
 * builder hides those controls. PHASE-03 flips this one constant to `'v2'`.
 */
export const ENGINE_LEVELS = ['v1', 'v2'] as const;
export type EngineLevel = (typeof ENGINE_LEVELS)[number];
export const ENGINE_LEVEL: EngineLevel = 'v2';

/** The only `formatVersion` a `WorkflowGraph` document may carry. */
export const WORKFLOW_FORMAT_VERSION = 2 as const;

/** Agent providers a session can be routed to. */
export const HARNESS_PROVIDER_IDS = ['copilot', 'claude-agent', 'codex', 'opencode', 'acp'] as const;
export type HarnessProviderId = (typeof HARNESS_PROVIDER_IDS)[number];

/** Reasoning effort levels, the union across providers. */
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** How the agent behaves for a turn. */
export const AGENT_MODES = ['auto', 'plan'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** The one permission-mode enum shared by chats, workflows, stages and runs. */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Permission modes a run may be started with (ordered from least to most permissive). */
export const RUN_PERMISSION_MODES = ['plan', 'default', 'acceptEdits', 'bypassPermissions'] as const;
export type RunPermissionMode = (typeof RUN_PERMISSION_MODES)[number];

/** Stable stage identity: lower snake case, starts with a letter, at most 48 characters. */
export const STAGE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;

/** Variable names: identifiers. */
export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Names that are not user variables. `__*` names were the old channel for
 * system values; `repo_path_*` / `repo_branch_*` were magic codebase
 * variables, now the typed `run.codebases.<alias>` scope.
 */
export const FORBIDDEN_VARIABLE_NAME_PATTERN = /^(__|repo_path_|repo_branch_)/;

/**
 * Expression roots. None of them can be a variable name, because a bare
 * `{{name}}` template is sugar for `{{variables.name}}` and must never be
 * ambiguous with a scope.
 */
export const RESERVED_ROOTS = [
  'variables',
  'stages',
  'run',
  'loop',
  'loops',
  'item',
  'map',
  'maps',
  'parent',
  'child',
] as const;
export type ReservedRoot = (typeof RESERVED_ROOTS)[number];

/**
 * Commands a script, hook or `check` stage may run without any operator
 * opt-in (the script runner's default allow-list; P05 §1.2). Interpreters and
 * the tooling the product's own templates rely on: nothing that can fetch
 * from the network or destroy a tree on its own. The server re-validates
 * against its effective list, which adds the operator's extras.
 */
export const DEFAULT_COMMAND_ALLOWLIST: readonly string[] = [
  'node',
  'npm',
  'npx',
  'pnpm',
  'git',
  'python',
  'python3',
  'pip',
  'pip3',
  'pwsh',
  'echo',
  'gh',
  'tsc',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'jq',
];

/**
 * Commands that need an explicit operator opt-in (`scripts.extraAllowlist`):
 * shells, downloaders and destructive coreutils.
 */
export const OPT_IN_COMMANDS: readonly string[] = ['sh', 'bash', 'curl', 'wget', 'rm', 'chmod', 'mv', 'cp', 'find', 'sed', 'awk', 'tar', 'zip', 'unzip'];

/** A bare executable name: no path separator, no drive letter, no `..`. */
export const BARE_COMMAND_PATTERN = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.+-]{0,99}$/;

/** Agent providers that report the cost of a turn (a `maxCostUsd` budget can only fire on these). */
export const COST_REPORTING_PROVIDERS: readonly HarnessProviderId[] = ['claude-agent'];

/** How deep containers (loop, map, sub-workflow) may nest. */
export const MAX_CONTAINER_DEPTH = 3;

/** The carried state of one loop iteration, serialised, at most this many bytes (`loop_carry_too_large`). */
export const MAX_LOOP_CARRY_BYTES = 262_144;

/** Codebase aliases (`run.codebases.<alias>`, a `check` stage's `mount`). */
export const CODEBASE_ALIAS_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Graph size limits. */
export const MAX_STAGES = 100;
export const MAX_EDGES = 500;
export const MAX_VARIABLES = 50;
export const MAX_EXPRESSION_LENGTH = 2000;
export const MAX_TEMPLATE_LENGTH = 100_000;

/**
 * Engine defaults for fields that are optional in the schema. They are not
 * zod defaults, because a zod default would put the value into every parsed
 * document, and the v1 engine gate rejects some of them when set.
 */
export const STAGE_DEFAULTS = {
  onExhausted: 'pause',
  timeouts: { queueMs: 1_800_000, idleMs: 600_000 },
  maxParallel: 4,
} as const;
