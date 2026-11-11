// ACP Registry: catalogue, platform choice, icon sanitiser and installer (docs/acp ACP-4…ACP-7).
// SDK-free: exported from the package barrel (W41).

import type { AcpNativeProvider } from '@generatorai/shared';

export * from './schema.js';
export * from './platform.js';
export * from './iconSanitizer.js';
export * from './installer.js';
export * from './catalog.js';

/**
 * ACP-7 — registry agents GeneratorAI also supports natively. They stay listed (and can be enabled), with
 * "Also available as a native provider"; the native provider is the recommended one.
 */
export const ACP_NATIVE_PROVIDERS: Readonly<Record<string, AcpNativeProvider>> = {
  'claude-acp': 'claude-agent',
  'codex-acp': 'codex',
  'github-copilot-cli': 'copilot',
  opencode: 'opencode',
  'opencode-v2': 'opencode',
};
