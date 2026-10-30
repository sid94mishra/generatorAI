// ────────────────────────────────────────────────────────────────
// `@generatorai/shared/node` — the parts of shared that need Node built-ins.
//
// The main barrel is imported by the web app, which Rollup bundles for a
// browser: anything reachable from it that touches `node:fs`/`node:path`
// fails the build outright. Node-only helpers therefore live behind this
// subpath, imported by the server, the hosts and the CLI but never by the
// browser bundle.
// ────────────────────────────────────────────────────────────────

export { readBuildStamp, makeHostHello } from './protocol/buildStamp.js';
export { hashWebhookToken } from './security/webhookToken.js';
export { writeFileAtomicRestricted, renameWithRetry } from './security/atomicWrite.js';
