# Batch F — performance (merge-readiness §4 step 7, M10-03, MD-194)

`node scripts/mobile/perf.mjs --platform=<p> --batch=F` → `perf.json`. Tooling fixes first (066a4806): the scroll
scenario flings the reply the streaming scenario produces, so streaming runs first; a dev-build cold start waits up to
120 s and starts from Home (a cold start restores the last route).

## iOS 27 — gai-iphone, **dev build** (not release)

A Release build did not fit: with ~4 GB free the Release build-for-testing crossed the 2 GB guard half way and was
stopped; its artifacts were deleted. Numbers below are from the Debug dev client against Metro, so they are not
comparable with the budgets (08 §4.7 wants release) — recorded as a first relative point.

| Scenario | Metric | Value | Budget | Verdict |
|---|---|---|---|---|
| cold start | launch → Home | 16,220 ms | 3,000 ms | over — a dev build downloads and evaluates its bundle from Metro on every cold start; not meaningful |
| streaming 2,000 lines | memory after completion | 190.4 MB | 400 MB | pass |
| streaming | janky frames, longest frame | — | 8 %, 100 ms | unmeasured: agent-device reports no frame data on the iOS simulator |
| transcript scroll | janky frames, p95 | — | 5 %, 20 ms | unmeasured (same) |

Owner: a Release build on a machine with room (or the owner's phones, 08 §4.7) for the budget verdicts.

## Android 16 — gai-phone emulator, **dev build** (not release)

| Scenario | Metric | Value | Budget | Verdict |
|---|---|---|---|---|
| cold start | launch → Home | 3,808 ms | 3,000 ms | over (dev build: bundle from Metro) |
| streaming 2,000 lines | janky frames | 100 % | 8 % | over |
| streaming | longest frame | 652 ms | 100 ms | over |
| streaming | memory after completion | 1,274 MB | 400 MB | over — 6.7× the iOS dev figure (190 MB); dev-build overhead (Metro symbolication, LogBox, dev Hermes) inflates it, but the gap to iOS is worth a release measurement first (owner) |
| transcript scroll | janky frames | 0 % | 5 % | pass |
| transcript scroll | p95 frame | — | 20 ms | unmeasured (gfxinfo percentiles absent on this emulator) |

A dev build on an emulator sharing a loaded 8 GB host is not comparable with the budgets; the streaming numbers are
recorded as a first relative point. Release `assembleRelease` was not built (release.md).
