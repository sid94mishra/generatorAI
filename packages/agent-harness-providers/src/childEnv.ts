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

import {
  BASE_CHILD_ENV_ALLOWLIST,
  buildChildEnv,
  filterDelegatedChildEnv,
  isBlockedChildEnvVar,
} from '@generatorai/shared';
import { PARENT_PID_ENV, SPAWN_BOOT_ID, SPAWN_MARKER_ENV } from './childRegistry.js';

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
  /**
   * Per-conversation variables handed down by the core through
   * `CreateConversationParams.env` — the chat's `GENERATORAI_WORKSPACE_ROOT`
   * and `GENERATORAI_SCRATCH_DIR`.
   *
   * NOT the same trust level as `extra`: the provider does not own these, so
   * they are reduced to `GENERATORAI_*` names and still filtered by the deny
   * list, with no own-credential exemption. A caller cannot use this to push
   * `GENERATORAI_SECRET_KEY` (or anything else) into a harness.
   */
  delegated?: Record<string, string | undefined> | undefined;
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
  // The allowlist/deny logic now lives in @generatorai/shared so the terminal
  // hosts and the script sandbox — which execute the same model-authored
  // commands but cannot import an L2 package — share one implementation
  // instead of each maintaining a weaker denylist of its own.
  const env = buildChildEnv({
    ...(options.source ? { source: options.source } : {}),
    ...(options.passthrough ? { passthrough: options.passthrough } : {}),
    ...(options.delegated ? { delegated: options.delegated } : {}),
    ...(options.extra ? { extra: options.extra } : {}),
  });

  // P0-14 — provenance, NOT a heartbeat.
  //
  // Phase 0 item 7 asks for "a parent-PID heartbeat in every spawned child".
  // That is not achievable here: both vendor SDKs spawn their own CLI binary
  // internally, so we never see the pid and cannot add cooperating code to a
  // binary we did not write. Prevention and recovery therefore live entirely on
  // the parent side (see childRegistry.ts), and these variables are not read by
  // the reaper — Windows does not expose another process's environment block
  // anyway.
  //
  // They exist for children that CAN cooperate — our own host processes, from
  // Phase 3 — and for a human reading a process listing during an incident.
  // They carry no authority: a pid and a random boot id, both already visible
  // to any local process.
  env[SPAWN_MARKER_ENV] = SPAWN_BOOT_ID;
  env[PARENT_PID_ENV] = String(process.pid);

  return env;
}

/**
 * Names this module will strip. Exported so tests (and the security smoke
 * test) can assert the contract rather than re-deriving it.
 */
export function isBlockedHarnessEnvVar(name: string): boolean {
  return isBlockedChildEnvVar(name);
}

/** The base allowlist, exported for diagnostics and tests. */
export const HARNESS_ENV_ALLOWLIST = BASE_CHILD_ENV_ALLOWLIST;

/**
 * Reduce `CreateConversationParams.env` to the delegable `GENERATORAI_*`
 * subset. Providers call this once when the conversation is created and store
 * the result, so the rule is applied at the boundary rather than per turn.
 */
export { filterDelegatedChildEnv as filterDelegatedHarnessEnv };
