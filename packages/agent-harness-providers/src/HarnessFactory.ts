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
import type { ClaudeAgentProvider } from './providers/claude-agent/ClaudeAgentProvider.js';

// ── Lazy Module Cache ──
// Provider modules are loaded once on first access and cached for the
// process lifetime. This avoids repeated dynamic imports while still
// keeping both SDKs optional (they are only resolved when selected).

type CopilotModule = { CopilotProvider: typeof CopilotProvider };
type ClaudeAgentModule = { ClaudeAgentProvider: typeof ClaudeAgentProvider };

let copilotModule: CopilotModule | null = null;
let claudeAgentModule: ClaudeAgentModule | null = null;

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
      const mod = await loadCopilotModule();
      return new mod.CopilotProvider(config.copilot ?? {});
    }

    case 'claude-agent': {
      const mod = await loadClaudeAgentModule();
      return new mod.ClaudeAgentProvider(config.claudeAgent ?? {});
    }

    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown harness type: "${type}". Available: copilot, claude-agent`);
    }
  }
}

/**
 * Returns which provider types are currently available (have their SDK installed).
 * Uses the same module cache — probing does not trigger redundant imports.
 */
export async function getAvailableProviders(): Promise<HarnessType[]> {
  const available: HarnessType[] = [];

  try {
    await loadCopilotModule();
    available.push('copilot');
  } catch {
    // @github/copilot-sdk not installed — copilot unavailable
  }

  try {
    await loadClaudeAgentModule();
    available.push('claude-agent');
  } catch {
    // @anthropic-ai/claude-agent-sdk not installed — claude-agent unavailable
  }

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
