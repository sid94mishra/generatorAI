// MSetProviders (MD-35, MDF-108): each provider's status as a HEALTH-style dot + word, its one-line description and
// the hint shown while it has no catalog — the web Settings › Model providers copy, so both clients say the same.
import type { HarnessProviderStatus, HealthTone } from '@generatorai/shared';

export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  copilot: 'GitHub Copilot SDK — GPT, Claude, and Gemini models via your GitHub account.',
  'claude-agent': 'Claude Agent SDK — agentic execution with native tool use.',
  codex: 'OpenAI Codex app-server — GPT models via your ChatGPT sign-in or API key.',
  opencode: 'OpenCode server — models from any provider OpenCode is configured for.',
  acp: 'Agent Client Protocol — any ACP-compatible agent.',
};

const SIGN_IN_HINTS: Record<string, string> = {
  codex: 'Sign in with your ChatGPT account (or run `codex login` on the server), then test the connection.',
  'claude-agent': 'Run `claude` in a terminal on the server and sign in, then test the connection.',
};

const INSTALL_HINTS: Record<string, string> = {
  codex: 'Install Codex on the server (`npm i -g @openai/codex` or the ChatGPT desktop app) or set CODEX_CLI_PATH, then restart GeneratorAI.',
};

export interface ProviderStatusView {
  label: string;
  health: HealthTone;
}

export function providerStatus(p: HarnessProviderStatus, checking: boolean): ProviderStatusView {
  if (checking) return { label: 'Checking…', health: 'idle' };
  if (p.ready) return { label: 'Connected', health: 'ok' };
  if (!p.installed) return { label: 'Not installed', health: 'idle' };
  if (!p.authenticated) return { label: 'Not signed in', health: 'err' };
  return { label: 'Unavailable', health: 'err' };
}

/** Why the catalog is empty and what to do; null when it has one. */
export function providerHint(p: HarnessProviderStatus): string | null {
  if (p.ready) return p.models.length === 0 ? 'No models are available for this account.' : null;
  if (!p.installed) return INSTALL_HINTS[p.type] ?? "This provider isn't installed on the server.";
  return SIGN_IN_HINTS[p.type] ?? 'Sign in to this provider, then test the connection to load its catalog.';
}

export function providerDescription(p: HarnessProviderStatus): string {
  return PROVIDER_DESCRIPTIONS[p.type] ?? `${p.label} provider.`;
}

/** Which actions a provider offers (web parity): Sign in / Sign out only when it supports in-app login. */
export function providerActions(p: HarnessProviderStatus, isDefault: boolean): { signIn: boolean; signOut: boolean; makeDefault: boolean } {
  return {
    signIn: p.supportsLogin && p.installed && !p.authenticated,
    signOut: p.supportsLogin && p.authenticated,
    makeDefault: p.ready && !isDefault,
  };
}
