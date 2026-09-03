// ────────────────────────────────────────────────────────────────
// HarnessFactory — Creates harness provider instances by type.
//
// Design: Uses lazy-loaded module singletons to keep SDK dependencies
// optional at install-time while avoiding redundant dynamic imports.
// Each provider module is loaded at most once and cached. If the SDK
// is not installed, the import fails with a clear actionable error.
// ────────────────────────────────────────────────────────────────

import type { IAgentHarness } from '@generatorai/core';
import type {
  HarnessType,
  HarnessProviderConfig,
  HarnessFactoryOptions,
} from './types.js';
import type { CopilotProvider } from './providers/copilot/CopilotProvider.js';
import type { WorkspacedCopilotPool } from './providers/copilot/WorkspacedCopilotPool.js';
import type { ClaudeAgentProvider } from './providers/claude-agent/ClaudeAgentProvider.js';
// W41 — codex/opencode/acp are now loaded the same way as copilot/claude-agent.
// They used to be STATIC value imports on the grounds that they need no external
// SDK. That is true of codex and opencode but was never true of acp (it
// value-imported `@agentclientprotocol/sdk`), and it misses the point either
// way: a static import here pulls ~3 000 lines of provider code, its protocol
// tables and its child-process plumbing into every boot, for providers most
// installs never select. `import type` is erased, so the types below are free.
import type { CodexProvider } from './providers/codex/CodexProvider.js';
import type { OpenCodeProvider } from './providers/opencode/OpenCodeProvider.js';
import type { AcpProvider } from './providers/acp/AcpProvider.js';

// ── Lazy Module Cache ──
// Provider modules are loaded once on first access and cached for the
// process lifetime. This avoids repeated dynamic imports while still
// keeping both SDKs optional (they are only resolved when selected).

type CopilotModule = {
  CopilotProvider: typeof CopilotProvider;
  WorkspacedCopilotPool: typeof WorkspacedCopilotPool;
  /** W41 — resolves @github/copilot-sdk; see `getAvailableProviders`. */
  loadCopilotSdk: () => Promise<unknown>;
};
type ClaudeAgentModule = {
  ClaudeAgentProvider: typeof ClaudeAgentProvider;
  /** W41 — resolves @anthropic-ai/claude-agent-sdk; see `getAvailableProviders`. */
  loadClaudeSdk: () => Promise<unknown>;
};
type CodexModule = { CodexProvider: typeof CodexProvider };
type OpenCodeModule = { OpenCodeProvider: typeof OpenCodeProvider };
type AcpModule = { AcpProvider: typeof AcpProvider };

let copilotModule: CopilotModule | null = null;
let claudeAgentModule: ClaudeAgentModule | null = null;
let codexModule: CodexModule | null = null;
let openCodeModule: OpenCodeModule | null = null;
let acpModule: AcpModule | null = null;

async function loadCopilotModule(): Promise<CopilotModule> {
  if (copilotModule) return copilotModule;
  try {
    copilotModule = await import('./providers/copilot/index.js') as CopilotModule;
    return copilotModule;
  } catch (err: unknown) {
    if (isModuleNotFound(err, '@github/copilot-sdk')) {
      throw new Error(
        `Harness type "copilot" requires @github/copilot-sdk to be installed. ` +
        `Run: pnpm add @github/copilot-sdk`,
      );
    }
    throw err;
  }
}

async function loadClaudeAgentModule(): Promise<ClaudeAgentModule> {
  if (claudeAgentModule) return claudeAgentModule;
  try {
    claudeAgentModule = await import('./providers/claude-agent/index.js') as ClaudeAgentModule;
    return claudeAgentModule;
  } catch (err: unknown) {
    if (isModuleNotFound(err, '@anthropic-ai/claude-agent-sdk')) {
      throw new Error(
        `Harness type "claude-agent" requires @anthropic-ai/claude-agent-sdk to be installed. ` +
        `Run: pnpm add @anthropic-ai/claude-agent-sdk`,
      );
    }
    throw err;
  }
}

// W41 — codex / opencode / acp: same lazy-cached pattern, no optional-dep
// error mapping (codex and opencode need no npm SDK, and `@agentclientprotocol/sdk`
// is a hard dependency of this package, so a failure here is a real fault
// rather than "not installed").
async function loadCodexModule(): Promise<CodexModule> {
  codexModule ??= await import('./providers/codex/index.js') as CodexModule;
  return codexModule;
}

async function loadOpenCodeModule(): Promise<OpenCodeModule> {
  openCodeModule ??= await import('./providers/opencode/index.js') as OpenCodeModule;
  return openCodeModule;
}

async function loadAcpModule(): Promise<AcpModule> {
  acpModule ??= await import('./providers/acp/index.js') as AcpModule;
  return acpModule;
}

// ── Public API ──

/**
 * Create a harness provider instance for the given type.
 *
 * Uses lazy-cached dynamic imports so SDK dependencies are only loaded
 * when the corresponding provider is selected. If a user never selects
 * "claude-agent", the Claude Agent SDK is never loaded (and doesn't
 * need to be installed).
 *
 * @throws Error if the required SDK package is not installed
 */
export async function createHarnessProvider(
  config: HarnessProviderConfig,
  options?: HarnessFactoryOptions,
): Promise<IAgentHarness> {
  const type = config.type;

  switch (type) {
    case 'copilot': {
      // W36 / P0-13 — always use WorkspacedCopilotPool so each workspace
      // gets its own CopilotClient (CLI process). The pool is a strict
      // superset of CopilotProvider: it works correctly with one workspace
      // and adds no overhead in the single-workspace case.
      const mod = await loadCopilotModule();
      return new mod.WorkspacedCopilotPool(config.copilot ?? {});
    }

    case 'claude-agent': {
      const mod = await loadClaudeAgentModule();
      return new mod.ClaudeAgentProvider(config.claudeAgent ?? {});
    }

    // W37 — Codex app-server (JSON-RPC over stdio)
    case 'codex': {
      const mod = await loadCodexModule(); /* W41 */
      return new mod.CodexProvider(config.codex ?? {});
    }

    // W38 — OpenCode serve (HTTP + SSE)
    case 'opencode': {
      // No default baseUrl is invented here. `opencode serve --port` defaults
      // to an EPHEMERAL port, so the old `http://localhost:4096` fallback
      // pointed at nothing on a stock install and surfaced as "server
      // unreachable". The provider requires either a real `baseUrl` or
      // `autoStart` (which discovers the port the server actually bound), and
      // says which is missing.
      const mod = await loadOpenCodeModule(); /* W41 */
      return new mod.OpenCodeProvider(config.opencode ?? {});
    }

    // W39 — ACP breadth client (long-tail agents, real JSON-RPC-over-stdio ACP)
    case 'acp': {
      if (!config.acp?.command) {
        throw new Error(
          `Harness type "acp" requires acp.command — the ACP agent binary to spawn.`,
        );
      }
      const mod = await loadAcpModule(); /* W41 */
      return new mod.AcpProvider(config.acp);
    }

    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown harness type: "${type}". Available: copilot, claude-agent, codex, opencode, acp`);
    }
  }
}

/**
 * Returns which provider types are currently available (have their SDK installed).
 * Uses the same module cache — probing does not trigger redundant imports.
 *
 * W41 — this DOES load the optional SDKs, because that is precisely the
 * question being asked. It is on no boot path; callers that only want to
 * construct a provider use `createHarnessProvider`, which loads only what it
 * actually needs.
 */
export async function getAvailableProviders(): Promise<HarnessType[]> {
  const available: HarnessType[] = [];

  // W41 — importing the provider module no longer resolves its SDK (that was
  // the whole point of the change), so "is it installed?" must be asked of the
  // SDK itself. Without this second step the function would report every
  // provider available on a build with no SDKs at all.
  try {
    const mod = await loadCopilotModule();
    await mod.loadCopilotSdk();
    available.push('copilot');
  } catch {
    // @github/copilot-sdk not installed — copilot unavailable
  }

  try {
    const mod = await loadClaudeAgentModule();
    await mod.loadClaudeSdk();
    available.push('claude-agent');
  } catch {
    // @anthropic-ai/claude-agent-sdk not installed — claude-agent unavailable
  }

  // W37/W38/W39: no optional SDK gate — always available.
  // W41: deliberately NOT probed by importing them. `getAvailableProviders()`
  // runs on boot paths, and importing three provider modules just to say "yes,
  // they exist" is exactly the eager loading this work item removes. Their
  // availability is a static property of the build, so state it.
  available.push('codex', 'opencode', 'acp');

  return available;
}

// ── Internals ──

function isModuleNotFound(err: unknown, packageName: string): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes('Cannot find module') ||
      err.message.includes('Cannot find package') ||
      err.message.includes(packageName)
    );
  }
  return false;
}
