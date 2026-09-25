// @generatorai/shared - Cross-cutting types, constants, utilities
export * from './types/index.js';
export * from './errors/index.js';
export * from './config/index.js';
export * from './constants/index.js';
export * from './utils/index.js';
export * from './logging/index.js';
export * from './telemetry/index.js';
// W12 — IPC protocol for inter-process communication
export * from './ipc/AgentHostIpc.js';
export * from './ipc/PtyHostIpc.js';
export * from './ipc/BrowserHostIpc.js';
export * from './ipc/CuaHostIpc.js';
// Plan item 43 — host protocol version handshake shared by all four hosts
export * from './protocol/hostProtocol.js';
// W29 — Transport capability ledger per surface
export * from './transport/TransportCapabilities.js';
