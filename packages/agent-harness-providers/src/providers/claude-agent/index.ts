// @generatorai/agent-harness-providers — Claude Agent provider
export { ClaudeAgentProvider } from './ClaudeAgentProvider.js';
export type { ClaudeAgentProviderOptions } from './types.js';
// W41 — the SDK is no longer resolved by importing this module, so anything
// that needs to know whether `@anthropic-ai/claude-agent-sdk` is actually
// installed (`HarnessFactory.getAvailableProviders`) must ask for it.
export { loadClaudeSdk, isClaudeSdkLoaded } from './ClaudeAgentProvider.js';
export { mapClaudeAgentMessageToAgentEvents, mapClaudeAgentMessagesToAgentEvents } from './event-mapper.js';
// NOTE (W41): `./tool-factory.js` is deliberately NOT re-exported here. It
// value-imports `createSdkMcpServer` from the Claude Agent SDK (and `zod`), so
// re-exporting it would make importing this module load the SDK — the exact
// defect W41 fixes. Import it directly if you need it.
