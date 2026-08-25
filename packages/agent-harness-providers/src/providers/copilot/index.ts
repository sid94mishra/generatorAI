// @generatorai/agent-harness-providers — Copilot provider
export { CopilotProvider } from './CopilotProvider.js';
export type { CopilotProviderOptions } from './CopilotProvider.js';
export { mapSdkEventToAgentEvent, mapSdkEventsToAgentEvents } from './event-mapper.js';
export { createSdkTool, buildSdkTools } from './tool-factory.js';
// W36 / P0-13 — per-workspace pool (one CopilotClient per cwd)
export { WorkspacedCopilotPool } from './WorkspacedCopilotPool.js';
export type { WorkspacedCopilotPoolOptions } from './WorkspacedCopilotPool.js';
