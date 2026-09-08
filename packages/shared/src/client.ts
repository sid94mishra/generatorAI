// ────────────────────────────────────────────────────────────────
// `@generatorai/shared/client` — the subset of shared that belongs on a
// phone or in a browser.
//
// The main barrel (`index.ts`) is the SERVER's view of shared: it re-exports
// the app config schema, child-process environment allow-lists, the
// inter-process host protocols, OpenTelemetry tracing and the pino logger
// factory. None of that has any business in a client bundle, and on a phone
// it is pure dead weight in memory and start-up time (the Sept 2026 bundle
// audit measured ≈ 420 KB of shared source plus @opentelemetry/api in the
// Android bundle, of which the client used four values).
//
// The mobile Metro config aliases `@generatorai/shared` to THIS file, so
// every workspace package the phone bundles (client-core, client-runtime,
// client-transport) resolves here at runtime while `tsc` keeps type-checking
// against the full barrel. That means the rule for this file is simple and
// enforced by `apps/mobile/scripts/check-bundle.mjs` + the
// `sharedClientEntry` test: every VALUE a client package imports from
// `@generatorai/shared` must be exported from here. Types cost nothing and
// are all re-exported.
//
// Nothing in this file may import (transitively) `node:*`, `pino`,
// `@opentelemetry/*`, `./config/AppConfig`, `./config/childEnv`, `./ipc/*`,
// `./telemetry/*` or `./logging/*`.
// ────────────────────────────────────────────────────────────────

// Types (erased at runtime, but the few value exports in the types barrel —
// state-machine tables, `agentModeDescriptor`, default constants — are pure).
export * from './types/index.js';

// Error classes are plain `Error` subclasses.
export * from './errors/index.js';

// Constants: numeric defaults + the Computer Use block-lists (plain arrays).
export * from './constants/index.js';

// Pure helpers.
export { generateId, deepMerge, sleep, interpolateVariables } from './utils/pure.js';
export * from './utils/pairingCode.js';
export { insertTextAtCaret, CaretInsertionSequencer } from './utils/insertAtCaret.js';
export type { CaretInsertResult } from './utils/insertAtCaret.js';
export {
  SCRATCH_THAT,
  applyScratchCommand,
  splitScratchCommand,
  stripLocaleTags,
  dictationSeparator,
  continueCase,
  stitchDictation,
} from './utils/dictationText.js';
export type { StitchResult } from './utils/dictationText.js';

// Per-surface transport capability ledger (what a phone / browser / CLI can do).
export * from './transport/TransportCapabilities.js';
