// packages/core/src/tools — TOL-01 / TOL-02 barrel.
export { CustomToolRegistry } from './CustomToolRegistry.js';
export {
  withPermissionGate,
  gateTools,
  ToolPermissionDeniedError,
} from './gatedTool.js';
export type { GateOptions } from './gatedTool.js';
// Re-export `ToolDefinition` from the port for single-import ergonomics.
export type { ToolDefinition } from '../domain/ports/IAgentHarness.js';

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

