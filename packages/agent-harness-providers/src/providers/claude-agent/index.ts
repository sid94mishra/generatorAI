// @generatorai/agent-harness-providers — Claude Agent provider
export { ClaudeAgentProvider } from './ClaudeAgentProvider.js';
export type { ClaudeAgentProviderOptions } from './types.js';
export { mapClaudeAgentMessageToAgentEvents, mapClaudeAgentMessagesToAgentEvents } from './event-mapper.js';
export { buildClaudeAgentMcpTools, getQualifiedToolName } from './tool-factory.js';
