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

| 2026-09-28 | M1-04 | `scripts/redesign/sandbox.mjs`, `lib/sandbox-options.mjs` and test; `scripts/mobile/lib/sandbox-session.mjs` | additive sandbox option | Explicit emulator CORS origin preserves the web default and production authorization; clean POSIX fixture shell, existing profile-free Windows host. Thirteen tooling tests pass. Android terminal attaches; rendering/input still pending. |

| 2026-09-29 | M1-05 | root `eslint.config.mjs` | additive mobile-only config import | Mobile boundary/design/hook checks; no web/desktop config changes. Implementation lives under apps/mobile/scripts. |

| 2026-09-29 | M1-06 | `pnpm-lock.yaml` | mobile dev tooling and peer graph | Jest/RNTL, Storybook 10.6 and LiteUI; no other app manifests changed. Native control peers require rebuilds. |

## Merges of `desktop_redesign`

| Date | desktop_redesign sha | Conflicts | Notes |
|---|---|---|---|
| 2026-09-26 | `6045856` | — | branch point |
| 2026-09-27 | `744f3a02` | none | M0 phase-start merge; native emitter retained (MD-97). Receives Workflow Overhaul, D-81/D-82, P5/P6 and web-only P7-01. No mobile additions lost. Validation recorded in M0 notes. |
| 2026-09-27 | `744f3a02` | none | M1 phase-start merge: already up to date; pnpm install passed. |
