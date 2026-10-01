// ────────────────────────────────────────────────────────────────
// WebCrypto bootstrap (web).
//
// Browsers already expose a native `crypto.subtle`, so there is nothing to
// install — and the native counterpart must NOT be imported here, because
// `react-native-quick-crypto` is a TurboModule whose registry lookup throws on
// web ("Cannot read properties of undefined (reading 'getEnforcing')").
//
// The check below is not decoration. The auth runtime signs DPoP proofs with
// P-256 via `crypto.subtle`, which browsers only expose in a secure context;
// on plain `http://` over a LAN IP `crypto.subtle` is `undefined` and every
// signature fails later with a far less obvious error. Fail loudly here.
// ────────────────────────────────────────────────────────────────

export function installCrypto(): void {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error(
      'WebCrypto (crypto.subtle) is unavailable. It is exposed only in a secure ' +
        'context — use http://localhost, or serve the preview over HTTPS.',
    );
  }
}
