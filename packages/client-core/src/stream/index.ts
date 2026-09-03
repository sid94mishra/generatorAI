// ────────────────────────────────────────────────────────────────
// Streaming domain — the block model every client renders.
//
// This barrel is deliberately platform-free: no zustand, no DOM, no
// React. `apps/web` wraps it in a Zustand store; `apps/mobile` wraps the
// same functions in its own store. Neither owns the semantics.
// ────────────────────────────────────────────────────────────────

export * from './contextUsage.js';
export * from './parseInlineToolCalls.js';
export * from './types.js';
export * from './eventRouter.js';
export * from './applyEffects.js';
export * from './frameScheduler.js';
export * from './stopController.js';
export * from './sseParser.js';
export * from './MuxStreamClient.js';
export * as streamReducer from './reducer.js';
