# Batch F — VRT baselines (merge-readiness §4 step 6, MV-26, MD-194)

`node scripts/mobile/vrt.mjs --platform=<p> --device=phone [--variants=…] [--update]`, Metro with
`EXPO_PUBLIC_STORYBOOK=1 EXPO_PUBLIC_VRT=1`.

## Tooling fixes before anything could be captured on iOS

- `agent-device settings animations off` is Android-only (INVALID_ARGS on the simulator); iOS relies on VRT mode's
  forced Reduce Motion.
- The `vrt-ready` marker was an empty zero-size view, pruned from the iOS accessibility tree: every wait timed out.
  It is a 4 pt labelled element now, and readiness also settles 1.5 s after a selection that emits no
  `storyRendered` (same globals).
- Dev LogBox banners (stories that log warnings) were drawn into captures and over the marker: VRT mode ignores logs.
- The ready wait is 30 s (10 s timed out whenever the host was loaded).

## iOS 27 — gai-iphone

Scope recorded: **phone, one variant (Instrument dark, default size), 97 stories → 95 baselines** (2 stories timed
out). The full plan is 485 captures (five variants); at the measured ~6–16 s per capture on this host that is 1–2 h per
run, and the stability run doubles it — left to the owner with the commands below. Baselines:
`apps/mobile/vrt/baselines/ios/phone/` + `META.json`.

Stability run: **invalid** — it ran while an Xcode build loaded the host and Metro reloaded mid-run (captures of
"Refreshing…"); see the re-run below.

Stability re-run on an idle host (same variant, 97): **46 match, 49 diff, 2 missing** — not stable yet:

| Cause | Captures | Fix (owner, tooling) |
|---|---|---|
| The Dynamic Island is drawn in the capture (the baseline had none; most likely a Live Activity from the surface checks, not verified) | 22 (0.88 % each) | crop below the top safe area or mask the island region before odiff; end all activities in `prepare()` |
| Sub-threshold noise reported as diff ("0.00 %") | 15 | odiff reports a pixel count above 0 even under the threshold; treat < 0.01 % as match in `summarize` |
| Content that moves between runs (Toast, StoryKit, a few lists: 10–51 %) | ~12 | timers or entering animations still running in VRT mode; mark `parameters.vrt.skip` or freeze them |
| Missing (the two stories that timed out while recording) | 2 | re-record |

Baselines committed as a first recording (95 PNGs, 5.7 MB, `META.json` iPhone 18 Pro / iOS 27.0); the other four
variants and the stability gate remain open (MV-26, owner).

## Android

Not run: a Storybook-mode Metro (`EXPO_PUBLIC_STORYBOOK=1 EXPO_PUBLIC_VRT=1`) and 97+ captures per variant did not fit
after the Android rebuilds and suite (MV-26, owner): `node scripts/mobile/vrt.mjs --platform=android --device=phone
--update`, then a no-update run.
