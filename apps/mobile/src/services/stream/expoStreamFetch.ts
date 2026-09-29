// ────────────────────────────────────────────────────────────────
// The one place `expo/fetch` is imported.
//
// React Native's global `fetch` is XHR-backed: `response.body` is undefined,
// so a streaming reader has nothing to read. `expo/fetch` is the only fetch on
// this platform with a real `ReadableStream` body, which is what the
// multiplexed stream's read loop needs.
//
// Isolated in its own module because `expo/fetch` cannot be loaded outside a
// React Native runtime — importing it from `muxTransport.ts` made that
// module, and everything that imports it, impossible to test in the node-only
// suite (`vitest.config.ts` explains why that suite is node-only). Keeping the
// untestable dependency to a single one-line adapter is the trade.
// ────────────────────────────────────────────────────────────────

import { fetch as expoFetch } from 'expo/fetch';

/**
 * `expo/fetch`'s Response is structurally the standard one for everything the
 * read loop touches (`ok`, `status`, `body`), but Expo types it separately.
 * The cast lives at this single boundary rather than loosening
 * `MuxStreamClientOptions` for every caller of the shared client.
 */
export function expoStreamFetch(url: string, init: RequestInit): Promise<Response> {
  return expoFetch(url, init as Parameters<typeof expoFetch>[1]) as unknown as Promise<Response>;
}
