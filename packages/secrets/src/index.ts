// ────────────────────────────────────────────────────────────────
// @generatorai/secrets — cross-platform secure secret storage
// ────────────────────────────────────────────────────────────────

export * from './SecretStore.js';
export * from './KeyProvider.js';
export { EncryptedFileSecretStore } from './EncryptedFileSecretStore.js';
export type { EncryptedFileSecretStoreOptions } from './EncryptedFileSecretStore.js';
export { MemorySecretStore } from './MemorySecretStore.js';
export { createSecretStore } from './createSecretStore.js';
export type { CreateSecretStoreOptions } from './createSecretStore.js';
export * from './redaction.js';
export * from './migrateLegacySecrets.js';
