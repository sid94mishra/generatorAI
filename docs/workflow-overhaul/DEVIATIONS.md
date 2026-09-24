# Deviations from the plan

Record every intentional deviation **before** implementing it. Use this format:

| Date | Phase / WP | Plan said | Doing instead | Why | Approved by |
|---|---|---|---|---|---|
| 2026-09-24 | all / README §0.4 | One branch per phase, each merged to the base branch | One integration branch `wf/overhaul` in the git worktree `C:/gaiwf/repo`, with one commit per WP and a `wf-phase-NN-done` tag per phase. Local only, never pushed. | The agent implements every phase end to end in one session. A short path avoids git long-path and OneDrive problems (R-9). The user's main checkout and any running :3100 server are untouched. | product owner ("complete everything end to end") |
| 2026-09-24 | P08 | Phase gated by PD-21 | WP-8.3 and WP-8.4 ship. WP-8.1, 8.2 and 8.8 stay gated (PD-21 default: deferred). WP-8.5–8.7 stay backlog. | Follows the plan's own defaults. | plan default |
