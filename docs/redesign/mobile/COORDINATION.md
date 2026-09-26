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

## Merges of `desktop_redesign`

| Date | desktop_redesign sha | Conflicts | Notes |
|---|---|---|---|
| 2026-09-26 | `6045856` | — | branch point |
