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

| 2026-09-29 | M2-01 | `packages/client-core/src/transcript/{messageInput,wireMessage}.ts`, transcript exports, additive `chatMessageToBlocks` and generic `buildTranscriptTurns` overloads, tests | additive API adapter (MD-110) | Consume content/metadata without fabricated domain fields; preserve loose historical metadata and reuse the existing replay/grouping bodies. Existing desktop overload/runtime behavior unchanged. |

## Merges of `desktop_redesign`

| Date | desktop_redesign sha | Conflicts | Notes |
|---|---|---|---|
| 2026-09-26 | `6045856` | — | branch point |
| 2026-09-27 | `744f3a02` | none | M0 phase-start merge; native emitter retained (MD-97). Receives Workflow Overhaul, D-81/D-82, P5/P6 and web-only P7-01. No mobile additions lost. Validation recorded in M0 notes. |
| 2026-09-27 | `744f3a02` | none | M1 phase-start merge: already up to date; pnpm install passed. |

| 2026-09-29 | `744f3a02` | none | M2 phase-start merge already up to date. Frozen pnpm install passes. Native emitter remains present; no mobile additions lost. |

| 2026-09-29 | M2-02 | `packages/client-core/src/transcript/stepStatus.ts`, transcript export, contract test | additive | Maps transcript step waiting to shared needs_you (a human gate), not timer waiting; existing callers unchanged. |

| 2026-09-29 | M2-04 | `packages/client-core/src/api/scm.ts`, client property/exports, SCM contract tests | additive | Shared SCM/readiness/PR/device-login methods and query keys, preserving request bodies and 204/error handling. Core typecheck, 751 tests, lint (existing warnings only) pass. |

| 2026-09-29 | M2-04 | client-core review/plan methods, optional checkpoint/change/project fields, scoped worktree/MCP admin methods, project keys | additive | Existing method behavior retained. New methods encode identifiers; review submit target is optional on the existing method. Wire contracts checked against server (comment PATCH returns thread; content timestamp optional). Core typecheck, 758 tests, lint with six existing warnings pass. |

| 2026-09-29 | M2-04 | client-core multipart/resource/device methods and typed wire views | additive | Native FormData identity and boundaries preserved; binary bytes/content type use common ApiError; socket/resource URL factories encode identifiers. Adds workspace preparation, agent/config/audio reads and device/push actions. Core typecheck, 768 tests and lint pass (six existing warnings). No existing desktop method removed or changed. |

| 2026-09-29 | M2-09 / MG-20 | `packages/shared/src/ui-contract/deepLinks.ts` + export/tests; `packages/client-core/src/attention/route.ts` + export/tests | additive helpers; desktop implementation untouched | Shared allowlisted link queries, consent-only pairing entry, registered-command UI targets, traversal rejection; attention targets pin server identity and retain pane. Shared/core typecheck and lint pass; 440 shared / 770 core tests pass. `check:tokens` passes; existing token meter-density test remains MV-12 (533/534). |

| 2026-10-02 | M2-10 / MG-02, MG-03, MG-06A, MG-21 | db migration **v64** `chat_pin_and_read_state` (`pinned_at`, `last_read_at` + pin-aware list indexes), baseline + lock regenerated; `ChatRepository` pinned-first keyset; `ChatListService` `summary.model` / `summary.unread` (MD-112); `PATCH /api/chats/:id` `{pinned, unread}`, `GET /api/chats?pinned=`; `chatModelSummary`; push payload v2 (`shared/types/Push.ts`, `core push/pushRouting.ts`); `GET` artifact download route + client-core `artifactDownload`; openapi append | additive (new columns nullable; web list orders pinned first, no web pin UI yet) | Codex WIP reviewed and finished by Claude Code after the owner's handover. Tests: db 169, core summary/push 24, server chatList 10 (incl. pin/unread), client-core download, mobile 1118. |

| 2026-10-02 | M2-10 / MG-04 | `packages/shared/src/security/gateRisk.ts` (new; exported from `.` and `./client`); optional `risk`/`riskReasons` on `ToolPermissionRequestPayload`, `PermissionCardSummary`, `AttentionAsk`, `PushData`; core stamps the verdict in `buildToolPermissionPayload`, copies it to the ask and the push; push names the Allow/Deny category only when it carries actions (risky gates and run approvals open the app); client-core `PermissionBlock.risk`; web PermissionCard "Risky" badge; openapi `AttentionAsk.risk` | additive; web/desktop approvals unchanged apart from the badge and run-approval pushes losing their (inert) lock-screen buttons | Tests: shared gateRisk 3, core 1780 + policy/push, client-core 772, web related 129. |

| 2026-10-02 | M2-10 / MG-05 | `shared/security/approvalProof.ts` (payload types, canonical JSON; `.` + `./client`); `auth/approvalProof.ts` `ApprovalProofVerifier` + `INonceStore.issue(expiresAt, prefix?)`; `DeviceRecord.approval*`; db migration **v65** `device_approval_key`; `POST /api/auth/approval-nonce`, `PUT/DELETE /api/auth/devices/me/approval-key` (+ route policy carve-out); `checkApprovalProof` on `POST /chats/:id/interactions/:iid/permission` (`ResolveToolPermissionSchema.approvalProof`); client-core `auth.approvalNonce/setApprovalKey/removeApprovalKey`, `respondPermission({approvalProof})`; openapi | additive; desktop/web/CLI approvals unchanged (the rule binds mobile devices) | MD-113. Tests: auth verifier 9, server enforcement 3, client-core 2. |

| 2026-10-02 | M2-10 / MG-22 | client-core `admin.fs.dirs/gitInfo` (+ `FsDirListing`, `FsGitInfo`), `scm.startConflicts`; every other MG-22 route already had a typed method from M2-04 (`plans.addComment/saveRevision`, `chats.backgroundTask` digest, `scm.readiness/flow/generate/*Conflicts`, `codebaseBranches`, pull requests, codebase files, `agents.get`) | additive; no server change | Tests: client-core 776. |
