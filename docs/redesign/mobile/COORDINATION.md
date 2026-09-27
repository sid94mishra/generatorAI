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

## Merges of `desktop_redesign`

| Date | desktop_redesign sha | Conflicts | Notes |
|---|---|---|---|
| 2026-09-26 | `6045856` | — | branch point |
| 2026-09-27 | `744f3a02` | none | M0 phase-start merge; native emitter retained (MD-97). Receives Workflow Overhaul, D-81/D-82, P5/P6 and web-only P7-01. No mobile additions lost. Validation recorded in M0 notes. |
| 2026-09-27 | `744f3a02` | none | M1 phase-start merge: already up to date; pnpm install passed. |
