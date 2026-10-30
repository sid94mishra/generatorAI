// ────────────────────────────────────────────────────────────────
// WebCrypto bootstrap (native).
//
// `@generatorai/client-runtime` implements DPoP against the WebCrypto API, so
// mobile inherits the whole auth stack unmodified — but only once
// `global.crypto` exists. React Native ships no WebCrypto, so the JSI/OpenSSL
// implementation has to be installed before anything imports the auth runtime.
//
// This is deliberately a platform-resolved module (`.web.ts` sibling): the
// native package is a TurboModule and calling into it on web throws
// "Cannot read properties of undefined (reading 'getEnforcing')".
// ────────────────────────────────────────────────────────────────

import { install } from 'react-native-quick-crypto';

export function installCrypto(): void {
  install();
}
