// ────────────────────────────────────────────────────────────────
// @generatorai/relay-protocol — isomorphic pairing + relay wire format + E2EE
//
// Runs in Node (server, CLI, relay), the browser (web SPA) and React Native
// (mobile companion) with no runtime-specific imports.
//
// Honesty note: `e2ee.ts` is a complete, tested construction that NO transport
// in this repository currently calls (`sealFrame`/`openFrame` have no importers
// outside this package). Do not describe LAN or relay traffic as end-to-end
// encrypted until that changes. See the header of `e2ee.ts`.
// ────────────────────────────────────────────────────────────────

export * from './bytes.js';
export * from './e2ee.js';
export * from './hostBinding.js';
export * from './pairingOffer.js';
export * from './relayProtocol.js';
export * from './relayRoutes.js';
