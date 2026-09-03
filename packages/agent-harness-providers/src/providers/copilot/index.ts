// @generatorai/agent-harness-providers — Copilot provider
export { CopilotProvider } from './CopilotProvider.js';
export type { CopilotProviderOptions } from './CopilotProvider.js';
// W41 — the SDK is no longer resolved by importing this module, so anything
// that needs to know whether `@github/copilot-sdk` is actually installed
// (`HarnessFactory.getAvailableProviders`) has to ask for it explicitly.
export { loadCopilotSdk, isCopilotSdkLoaded } from './CopilotProvider.js';
export { mapSdkEventToAgentEvent, mapSdkEventsToAgentEvents } from './event-mapper.js';
// NOTE (W41): `./tool-factory.js` is deliberately NOT re-exported here. It
// value-imports `defineTool` from the Copilot SDK, so re-exporting it would
// make importing this module load the SDK — the exact defect W41 fixes. Import
// it directly (`.../copilot/tool-factory.js`) if you need it.
export { WorkspacedCopilotPool } from './WorkspacedCopilotPool.js';
export type { WorkspacedCopilotPoolOptions } from './WorkspacedCopilotPool.js';
