# Final review — the mobile design overhaul (M0–M10)

Batch F (07 §0, M10-07). Reviewer: Claude (fresh pass over the whole branch at `5fdfa870`, 2026-10-03), against
`01-decisions.md` (MD-01…MD-197), `07-phases.md`, `04-screen-map.md`, `05-gap-matrix.md`, `06-platform-and-shell.md`,
`08-verification.md` and the committed board snapshot. Device runs were out of scope for this review (the owner runs
devices); everything below that needs a device says so. Severity: **Critical** (ship-blocking defect), **Major**
(wrong behaviour or a gap in acceptance), **Minor** (polish, docs, dead code).

## 1. Verdict

The overhaul is **code-complete and statically green** on both platforms: every screen of 04 is on the kit, the legacy
layer is gone (M10-01) and the design gate is hard zero in `src/` and `app/`. It is **not verified on devices**: the
batch reviews A–E never ran in fresh sessions, and the device walkthroughs, Maestro suite, VRT baselines, perf and
accessibility device audits of M1–M10 are all outstanding (PENDING MV-xx, §5). Two defects were found and fixed
(F-1, F-2); no Critical finding is open.

## 2. Evidence (static, at `5fdfa870` + this review's fixes)

| Gate | Result |
|---|---|
| `pnpm typecheck` | green |
| `pnpm lint` (incl. `check:design`, hard zero, no baseline) | green |
| `pnpm exec vitest run` | 156 files, 1,108 tests green |
| `pnpm exec jest` (iOS + Android projects) | 204 suites, 706 tests green (2 skipped) — includes the M10-04 story sweep (99 stories × 2 platforms, 0 findings) |
| Node tooling tests (`scripts/mobile/lib/*.test.mjs`, `apps/mobile/scripts/__tests__`) | 17 + 10 green |
| `pnpm bundle:check` | clean; `entry.hbc` 9.90 MB (8.78 MB before Sentry), 3,990 modules |
| Palette contrast (18 themes × 2 modes × 7 accents) | 0 pairs under threshold |
| Maestro flows ↔ testIDs (static cross-check of every `id:` in `.maestro/**`) | every literal id exists; the remaining ids are composed (`${testID}-${value}`) and match their builders |

## 3. Findings

| # | Severity | Area | Finding | Disposition |
|---|---|---|---|---|
| F-1 | Major | M8-06 stage editor | "Contains" / "Does not contain" rules were created with the literal value `"TODO"`, which passes the spec's 1-character minimum and would be saved as a real rule (the stage then fails until the agent writes "TODO"). | **Fixed** `ad2940fb`: new text rules start empty, the editor asks for the text (`ruleProblem`, tested); the `workflows/stage-editor` flow types a value. |
| F-2 | Minor | M10-01 refactor of `AuthProvider` | The context's `endpoint` used to be re-read on every transport change (inside the memo); M10-01 refreshed it with auth-state changes only. The runtime's active endpoint changes only with a state change today, so no failure was reachable, but the guarantee was narrower than before. | **Fixed** `3ce988c9`: the supervisor's status callback refreshes it (partial reducer update). |
| F-3 | Minor | docs / comments | Pre-M1-09 paths (`src/auth`, `src/prefs`, `src/notifications`, the deleted `AppLock.tsx`) in `app.config.ts`, the device-key modules, `prefs.ts`, `pushToTalk.ts` and the mobile README; AGENTS.md and the plan README said MD-01…MD-96; 07 named `F-review.md`. | **Fixed** `5fdfa870`. |
| F-4 | Major (process) | Batches A–E | The per-batch independent reviews (07 §0) never ran in fresh sessions; phases were accepted on static gates plus the owner's partial iOS device checks (M3–M8). Device acceptance of every phase is open (MV-05, MV-07…MV-11, MV-13…MV-33). | **Open → owner**: this review covers the code; the device checklist in `merge-readiness.md` §4 is the remaining acceptance. |
| F-5 | Major (blocked) | M3-01 / M3-02, M9-05 Android | SDK 58 is still `next` (58.0.2), not `latest` (57.0.26 on 2026-10-03): no RNGH 3 / router-core / React Compiler upgrade, `withSceneLifecycle` still needed, Android widgets deferred (MD-188). | **Blocked — external** (MV-25). Note: 57.0.26 is a patch above the pinned 57.0.25. |
| F-6 | Minor | dead / unreachable code | `services/voice/useTextToSpeech.ts` + `wavEncoding.ts` are unused ("Read aloud" stays off, MD-156); push-to-talk (`pushToTalk.ts`) is read by the composer but nothing can turn it on (no board row). | **Deferred → owner**: wire "Read aloud" behind the server's `ttsEnabled` and add a push-to-talk row to Settings › Audio when the boards draw them, or delete both. Not deleted here: both are working features one flag away. |
| F-7 | Minor | M10-05 | No Icon Composer `.icon` (clear appearance designed by hand); iOS derives it from the PNGs. | **Deferred → designer** (MD-196). |
| F-8 | Minor | M10-06 | The Sentry SDK adds 1.1 MB of bytecode for an opt-in feature. | **Accepted** (MD-197): evaluated only when switched on. |
| F-9 | Minor | M10-03 | VRT captures the first screen of each story; gallery stories taller than the screen are cropped. | **Accepted** (MD-194); split a gallery into stories if a regression hides below the fold. |
| F-10 | Minor | M10-02 | Screens no flow reaches (step detail, agent import, share sheet, revoked, skills / logs / PR detail) — listed with reasons in `M10-notes.md` §1. | **Accepted**; device walkthrough covers them. |

## 4. Phase-by-phase check against 07

| Phase | Code | Device / acceptance | Notes |
|---|---|---|---|
| M0 | complete | complete | `M0-notes.md` |
| M1 | complete except M1-07 (markdown spike: MD-40 fallback in use) | M1-04 characterization flows not green on either OS (7/8, 6/8); MV-01…MV-11, MV-15 | the flows were rewritten for the kit since; rerun as the full suite |
| M2 | complete (M2-01…M2-10) | native acceptance MV-11…MV-22 | server gaps v64 / v65 (MG-02, MG-05) |
| M3 | M3-03…M3-08 complete on SDK 57 | MV-23 (Android icon / RTL / motion), MV-24 (release builds) | M3-01 / M3-02 blocked (F-5) |
| M4 | complete; M4-10 VRT built in M10-03 | on-device Storybook pass; MV-27 (iOS Select wrap) | baselines: MV-26 |
| M5 | complete | MV-28 | |
| M6 | complete | MV-29 (real-device approval signing), chat + pane walkthrough | |
| M7 | complete | MV-30, MV-31 | |
| M8 | complete | MV-32 | WO-gated fields not rendered (MG-29…MG-34) |
| M9 | complete | MV-33 (pairing automation fixed in M10, MD-192; M9 checklist pending) | Android widgets deferred (F-5) |
| M10 | M10-01…M10-07 done (this review) | VRT baselines, perf, a11y device audits, store console entries, test-DSN check | `M10-notes.md`, `M10-store.md` |

## 5. Spot checks that passed

- **Security-relevant server additions**: `POST /chats/ingest` requires `Idempotency-Key`, validates the target with
  zod, reuses `POST /chats`' permission gates (`prepareCreateParams`) and the prompt route's refusals, caps files at
  5 × 10 MB (multer limits) and never fetches a shared URL. Approval proofs bind gate kind / id / entity, decision,
  server, device and a single-use 60 s nonce (ES256 over canonical JSON); stage approvals from a mobile device require
  one (MD-177).
- **Privacy surfaces**: lock-screen surfaces (Live Activity, widgets, Live Update) use `redactForLockScreen`; the
  notification service extension replaces title / body with the payload's redacted copy when the App Group flag is
  set; crash reports are scrubbed to type + stack (MD-197); `pair` links pre-fill only (MD-34); dev routes resolve
  only in `__DEV__`.
- **Layers and platform rules**: lint-enforced everywhere (`boundaries`, MD-15 `Platform` confinement — services read
  the OS through `services/native/runtimeOs.ts` only).
- **Accessibility**: all stories expose names / roles, no font-scaling opt-outs, no `hitSlop`; palette contrast holds
  for every theme × mode × accent.

## 6. What the owner must run before calling the overhaul complete

See `merge-readiness.md` §4 (one ordered checklist: rebuild, pairing, M9 surfaces, Maestro suite, VRT baselines,
perf, accessibility, store).
