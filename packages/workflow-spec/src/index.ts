// ────────────────────────────────────────────────────────────────
// @generatorai/workflow-spec: the one source of truth for workflow shapes.
//
// Pure and browser-safe; depends only on zod. Everything that reads or
// writes a workflow (server routes, the store, the builder, CLI, SDK, MCP,
// the authoring skill and the generated JSON Schema) derives from here.
// ────────────────────────────────────────────────────────────────

export * from './constants.js';

// schemas
export * from './schemas/common.js';
export * from './schemas/errors.js';
export * from './schemas/session.js';
export * from './schemas/stage.js';
export * from './schemas/edge.js';
export * from './schemas/workflow.js';
export * from './schemas/graph.js';
export * from './schemas/invocation.js';
export * from './schemas/commands.js';

// Expression v2 and templates
export * from './expr/index.js';

// state machines as data
export * from './state/index.js';

// validation
export * from './validate/index.js';

// session merge, command-bearing registry, safe regex, documents
export { resolveSessionSpec } from './session/resolveSessionSpec.js';
export {
  collectCommandFields,
  commandFingerprint,
  COMMAND_COLLECTORS,
  type CommandField,
  type CommandFieldKind,
  type CommandCollector,
} from './commandBearing.js';
export {
  compileSafeRegex,
  SAFE_REGEX_MAX_REPEAT,
  SAFE_REGEX_MAX_STATES,
  type SafeRegex,
  type SafeRegexResult,
} from './regex/safeRegex.js';
export { exportGraph, importGraph, parseGraph } from './document.js';

// persisted definitions, templates, script profiles
export * from './definition.js';
