# Batch F — crash reporting against a test DSN (merge-readiness §4 step 9, M10-06, MD-197)

Test receiver: a minimal Sentry-compatible sink on the host (`POST /api/<project>/envelope/`, logs every envelope).
DSN iOS simulator `http://testkey@127.0.0.1:9898/1`, Android emulator `http://testkey@10.0.2.2:9898/1`.

## iOS 27 — gai-iphone (dev client with `@sentry/react-native` 7.11.0 / sentry-cocoa 8.58.0)

| Check | Result |
|---|---|
| Settings › Diagnostics › Crash reports: DSN accepted, switch enabled, row reads "To 127.0.0.1:9898" | pass |
| JS error (global handler, via the Metro inspector): one envelope arrives | pass |
| Envelope content: `exception.type` "Error", `value` "[redacted]"; release, app / OS / device contexts, tags, breadcrumb category only; no `user`, `request` empty, no message text, no path, no query (the thrown message held a prompt, a `/Users/…` path and `?token=`) | pass (envelope kept at `docs/redesign/shots/mobile/F/ios-sentry-envelope.txt`, git-ignored) |
| Stack frames | empty for this error: it was created in the debugger's eval context, which has no app frames. A render error caught by the shell's ErrorBoundary carries frames (unit-tested in `crashScrub`) |
| Switch off → the same trigger → nothing arrives | pass (0 bytes in 8 s) |
| Native crash (`Sentry.nativeCrash()`) | not run: the SDK is not reachable from the inspector's global scope in the dev build, and there is no debug crash route by design (MD-197) |
| Symbol upload | not run (needs `SENTRY_*` EAS secrets, owner) |

Fix found on the way: the DSN field was the last row and stayed under the keyboard (Diagnostics now scrolls fields
above it, 5674eb52).
