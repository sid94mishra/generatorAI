# Mobile verification helpers (`apps/mobile/e2e`)

The Expo web-preview Playwright scripts are gone (M10-02): every screen is verified on the iOS Simulator and the
Android Emulator, paired with the isolated sandbox, through Maestro flows (`apps/mobile/.maestro/`) and agent-device
walkthroughs (`docs/redesign/mobile/08-verification.md`). What stays here is data and tooling those use:

| File | Used by |
|---|---|
| `fixtures/mobile.faux.json` | the sandbox's Faux script (`scripts/mobile/sandbox-pair.mjs`, 08 §2.4) |
| `push/*.json` | push payloads for the notification smoke (`xcrun simctl push`, the `/notify?case=` dev route) |
| `links.json` | the batch deep-link smoke (allowed / rejected / unknown-server links, MD-145) |
| `a11y-check.mjs` (+ tests) | the static check of an agent-device snapshot: labels, roles, hit frames ≥ 44 / 48 (MD-91), focus leakage |
| `a11y-allow.json` | exceptions to the checker (empty unless an MD names one) |
| `a11y-routes.json`, `A11yAuditTests.swift` | the XCUITest accessibility audit target (`GAI_A11Y_AUDIT=1`, `plugins/withA11yAuditTarget.js`, 08 §4.8) |

```sh
# pair, then run one flow or a directory (one target per run)
node scripts/mobile/sandbox-pair.mjs pair --platform=ios
node scripts/mobile/sandbox-pair.mjs maestro --platform=ios --udid=<udid> -- test apps/mobile/.maestro/chat/send-stream.yaml
# check a snapshot
./node_modules/.bin/agent-device snapshot --raw --json --platform ios > "$TMPDIR/home-ios.json"
node apps/mobile/e2e/a11y-check.mjs "$TMPDIR/home-ios.json" --platform ios
```

The checker exits 1 for missing labels / roles, undersized native targets, focus leakage or scoped runtime errors;
duplicate siblings, unlabelled images and status glyph / word mismatches are advisory. Failed, empty, sparse, truncated
and foreign-app captures cannot pass. `--logs <file>` checks messages after the last driver log marker;
`--modal-open --modal-selector 'id="drawer"'` checks the complete native tree for focus leakage.
