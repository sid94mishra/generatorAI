// `@generatorai/client-runtime/pairing-offer` — decoding a pairing offer
// without the rest of the runtime. The desktop main process (D-126) reads the
// offer a user pastes into "Connect to a server" to learn the server's
// addresses and the CA fingerprint to pin; it must not bundle the browser
// runtime to do that (06 §3.2).
export { decodePairingOffer, pairingEndpoints } from '@generatorai/relay-protocol';
export type { PairingEndpoint, PairingOffer } from '@generatorai/relay-protocol';
