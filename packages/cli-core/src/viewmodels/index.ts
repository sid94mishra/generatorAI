// ────────────────────────────────────────────────────────────────
// Renderer-agnostic projections.
//
// These turn wire shapes into what a view needs to draw, without knowing
// whether that view is Ink, a table on stdout, or a companion JSON payload.
// Keeping them here rather than in components means the binary surface can
// render the same DAG the TUI does.
// ────────────────────────────────────────────────────────────────

export * from './dagLayout.js';
export * from './runTimeline.js';
export * from './format.js';
