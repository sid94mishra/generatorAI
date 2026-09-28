# Mobile coordination log

Every change the mobile branch (`mobile_redesign`) makes outside `apps/mobile/**` and `docs/redesign/mobile/**` gets one row here, per MD-12 and playbook §6. The owner uses this log when merging `mobile_redesign` into `desktop_redesign`.

It covers:
- shared packages;
- server, core or db;
- root config;
- scripts.

It also records every merge of `desktop_redesign` into this branch.

| Date | Task | Files | Change (additive?) | Why |
|---|---|---|---|---|
| 2026-09-26 | plan | `AGENTS.md` (new, root), `scripts/mobile/render-boards.mjs`, `scripts/mobile/compare.mjs` (new) | new files | Codex rulebook entry point; board rendering and comparison for the mobile snapshot |

| 2026-09-27 | M1-01 | `pnpm-lock.yaml` | mobile dependency graph updated | SDK 57 patch, dev client, removed unused direct dependencies; no shared runtime API changes. |

| 2026-09-27 | M1-02 | `scripts/redesign/sandbox.mjs`, `scripts/redesign/lib/sandbox-options.mjs`, its Node test | additive options and IPC shutdown | Support a second isolated sandbox (3297/5297), the mobile Faux fixture override, and graceful supervisor shutdown on Windows. Existing default ports/fixture unchanged. Owner-confirm item for Batch A as required by 08 §2.4. |

| 2026-09-27 | M1-03 | root `package.json`, `pnpm-lock.yaml` | additive devDependency | Exact `agent-device@0.21.15` pin (ef96a9cc), bootstrapped for M1-02 pairing. CLI and frozen install pass; all existing importer resolutions preserved. |
| 2026-09-27 | M1-02 | `scripts/mobile/doctor.mjs`, `fingerprint.mjs`, `sandbox-pair.mjs`, `lib/*.mjs` | new mobile-only tooling | Native environment checks, SDK fingerprints, guarded sandbox/fixture lifecycle, consent automation and per-flow Maestro seeding/report aggregation. |

| 2026-09-28 | M1-04 | `scripts/mobile/lib/sandbox-devices.mjs` | mobile tooling recovery | Recognize the native scanner screen and follow the visible stale-server recovery action before fresh sandbox consent (MD-102). Six existing tooling tests pass; native pairing verified on both platforms. |

| 2026-09-28 | M1-04 | `scripts/mobile/lib/sandbox-maestro.mjs`, its Node test | mobile-only runner extension | Scenario-only device scopes with finally restoration; iOS native notification setup/APNs injection and Android approval verification through stream replay. Seven tooling tests pass; these new native branches remain unverified while M1-04 is blocked on legacy app defects. |

| 2026-09-28 | M1-04 | `scripts/mobile/lib/sandbox-seed.mjs`, `sandbox-maestro.mjs` | mobile-only fixture reliability | Rotate the fixture project at its actual codebase cap (MD-105); retain all old fixtures. `EXPECT_COMMIT` verifies exact dummy-repo history automatically. Android keep/undo/commit passed and original device scopes were restored; seven tooling tests pass. |

## Merges of `desktop_redesign`

2026-09-28 — M1-04: `scripts/redesign/sandbox.mjs`, `lib/sandbox-options.mjs` and its test add an opt-in `GENERATORAI_SANDBOX_CORS_ORIGINS` list. The default web origin is retained; malformed origins are rejected. `scripts/mobile/lib/sandbox-session.mjs` supplies only the Android emulator origin and selects `/bin/sh` on POSIX to avoid personal shell startup prompts (Windows keeps the existing profile-free host). Thirteen sandbox/tooling tests pass. Native Android now attaches its terminal WebSocket; the remaining blank renderer/input defect is under characterization. Production server authorization is unchanged.

| Date | desktop_redesign sha | Conflicts | Notes |
|---|---|---|---|
| 2026-09-26 | `6045856` | — | branch point |
| 2026-09-27 | `744f3a02` | none | M0 phase-start merge; native emitter retained (MD-97). Receives Workflow Overhaul, D-81/D-82, P5/P6 and web-only P7-01. No mobile additions lost. Validation recorded in M0 notes. |
| 2026-09-27 | `744f3a02` | none | M1 phase-start merge: already up to date; pnpm install passed. |
