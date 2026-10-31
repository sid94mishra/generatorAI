// Code mode (D-182): `run_code`, a QuickJS-wasm script over the session's own tools.
export {
  buildCodeModeTool,
  toScriptValue,
  RUN_CODE_TOOL_NAME,
  RUN_CODE_DEFAULT_TIMEOUT_S,
  RUN_CODE_MAX_TIMEOUT_S,
} from './codeModeTool.js';
export type { CodeModeToolOptions } from './codeModeTool.js';
export { runInQuickJs, fitReport, DEFAULT_SANDBOX_LIMITS } from './sandbox.js';
export type { SandboxCall, SandboxLimits, SandboxReport, SandboxTool } from './sandbox.js';
export { schemaToType, toolSignature, renderToolListing, firstLine, propertyKey } from './signatures.js';
export type { ListingEntry, SignatureOptions } from './signatures.js';
