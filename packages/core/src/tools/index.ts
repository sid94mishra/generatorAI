// packages/core/src/tools — TOL-01 / TOL-02 barrel.
export { CustomToolRegistry } from './CustomToolRegistry.js';
export {
  withPermissionGate,
  gateTools,
  ToolPermissionDeniedError,
} from './gatedTool.js';
export type { GateOptions } from './gatedTool.js';
// Re-export `ToolDefinition` from the port for single-import ergonomics.
export type { ToolDefinition, ToolCallContext } from '../domain/ports/IAgentHarness.js';

// Workflow tools (P06) — one implementation for chats, stages and MCP.
export * from './workflows/index.js';

// Built-in browser tool set — VSCode-parity 10 tools + factory helpers.
export {
  buildBrowserToolSet,
  BROWSER_TOOL_NAMES,
  isBrowserToolName,
} from './browser/index.js';
export type {
  BrowserToolContext,
  BrowserToolFactory,
  BrowserToolName,
} from './browser/index.js';

// Computer Use tool set — desktop application automation.
export {
  buildComputerToolSet,
  COMPUTER_TOOL_NAMES,
  isComputerToolName,
} from './computer/index.js';
export type {
  ComputerToolContext,
  ComputerToolFactory,
  ComputerToolName,
} from './computer/index.js';

// Mobile devices (docs/devices) — iOS simulators, Android emulators and phones.
export { buildDeviceToolSet, DEVICE_TOOL_NAMES, DEVICE_APP_ASKING_ACTIONS, parseDeviceStep } from './devices/index.js';
export type { DeviceToolContext } from './devices/index.js';

// v2 widget tools — render / update / close / search widgets.
// Legacy `ui_*` names are also exported as aliases from the same module.
export {
  buildWidgetTools,
  buildRenderWidgetTool,
  buildUpdateWidgetTool,
  buildCloseWidgetTool,
  buildSearchWidgetTool,
  WIDGET_TOOL_NAMES,
} from './widgetTools.js';
export type {
  WidgetToolBinding,
  WidgetToolFactoryContext,
  WidgetToolName,
} from './widgetTools.js';

// D-187 — stop what listens on a local port, outside any agent sandbox.
export { buildStopPortListenerTool, createOsProcessControl, STOP_PORT_LISTENER_TOOL_NAME } from './processTools.js';
export type { PortListener, ProcessControl } from './processTools.js';

// Extension-author tools — scaffold + reload user extensions from chat.
export {
  buildWriteExtensionTool,
  buildReloadExtensionTool,
  EXTENSION_AUTHOR_TOOL_NAMES,
} from './extensionAuthorTools.js';
export type {
  ExtensionAuthorContext,
  ExtensionAuthorToolName,
} from './extensionAuthorTools.js';


// GitHub issue + merge tools (D-146) — bound into project sessions.
export * from './github/index.js';

// Platform tools (D-181) — chats, projects, agents, automations, activity, chat files; one implementation for chats, stages and MCP.
export * from './platform/index.js';
