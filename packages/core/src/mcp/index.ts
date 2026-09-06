// packages/core/src/mcp — MCP config forwarding: catalog merge rule,
// credential vault + injection, server-side settings, wire mapping.
export type { IMcpHub, ResolvedMcpConfig, InMemoryMcpHubOptions } from './IMcpHub.js';
export { InMemoryMcpHub } from './IMcpHub.js';
export { McpCredentialVault } from './McpCredentialVault.js';
export type { McpSecretInjectionResult } from './McpCredentialVault.js';
export { McpSettingsStore, MCP_SETTINGS_FILE } from './McpSettingsStore.js';
export type { CustomMcpServerInput } from './McpSettingsStore.js';
export { mergeMcpServers } from './mergeMcpServers.js';
export type { MergeMcpServersInput } from './mergeMcpServers.js';
export { toMcpServerEntry } from './mcpWire.js';
