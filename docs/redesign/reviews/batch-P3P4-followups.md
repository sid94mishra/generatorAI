# P3+P4 batch — follow-ups collected while merging

Fix in the batch fix pass (after the combined review).

## Load-sensitive tests (pass alone, time out under parallel load)
- `apps/web/src/__tests__/app/ConnectedSidebar.test.tsx` — "lists Needs you and Running items with their asks and elapsed time" (elapsed time from the real clock; use fake timers / fixed `now`).
- `apps/server/src/__tests__/chatList.test.ts` — "fills in Changes ± from the dummy repo and keeps it current" (9.4 s; real git recompute — raise the per-test timeout or poll with a deadline).
- `apps/server/__tests__/routes/auth-pairing.test.ts` — "rejects mobile pairing when only loopback is reachable" (5.7 s; network probing — stub the interface probe).
- `packages/core` `PtyHostAdapter.test.ts` — "a failed start is retried rather than cached forever" (30 s timeout under load; needs `apps/pty-host` built in a fresh worktree).
- First `test:stories` run after a dependency change can fail with "Failed to import test file" while Vite re-bundles deps (second run passes) — pre-bundle in the storybook vitest config (`optimizeDeps.include`) or warm up once in CI.

## Known cross-plan / environment items
- `apps/cli` tui-e2e "resets the cursor when a pane is replaced" depends on a server at :3100 (fails without it) — make it use an isolated server or skip without one.
- Chat-workspace mounts do not write `worktrees` rows (G-17 `link.entity:'chat'` never appears) — reconcile the mount model with the worktrees table.
