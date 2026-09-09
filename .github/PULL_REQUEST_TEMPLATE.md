## What changed

<!-- One or two sentences. What is different after this, from a user's point of view? -->

## Why

<!-- The problem being solved. Link the issue if there is one. -->

## How it was tested

<!-- Not "tests pass" — what did you actually run, and on what?
     e.g. "pnpm test; installed the Windows build on a clean VM and paired a phone" -->

## Checklist

- [ ] `pnpm lint` passes locally (this runs the six project gates, not just eslint)
- [ ] `pnpm typecheck` and `pnpm test` pass
- [ ] Docs updated if behaviour or configuration changed
- [ ] No new dependency added without a reason stated above
- [ ] If this touches the phone app: `pnpm --filter @generatorai/mobile bundle:check` still passes
- [ ] If this touches pairing, auth or the stream protocol: says so explicitly, because those break clients that are already installed
