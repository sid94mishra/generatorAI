// ────────────────────────────────────────────────────────────────
// @generatorai/client-core
//
// Platform-agnostic client logic shared by apps/web, apps/desktop and
// apps/mobile. Nothing in here may import a UI framework, a state
// container, or a DOM/React-Native API — that is what makes it shareable.
//
// Layering: this package may import @generatorai/shared (wire types) and
// nothing from core / db / any provider SDK.
// ────────────────────────────────────────────────────────────────

export * from './stream/index.js';
export * from './api/index.js';
export * from './diff/parseUnifiedDiff.js';
export * from './runTitle.js';
export * from './attention/index.js';
export * from './activity/index.js';
export * from './live/index.js';
export * from './chats/index.js';
export * from './models/index.js';
export * from './computer/index.js';
export * from './composer/index.js';
export * from './transcript/index.js';
export * from './workspace/index.js';
