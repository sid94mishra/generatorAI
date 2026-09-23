# Reproduction and follow-up matrix

Use an isolated server/database and disposable workspace. Do not run the generation prompts against the GeneratorAI checkout. Pair each client independently; copying a browser profile can rotate/revoke the original device's credentials.

## Executed scenario inputs

**Greenfield, Codex / GPT-5.6 Sol / High**

> Build a dependency-free Node.js Incident Desk with immutable incident creation/resolution/filtering/priority ordering, weekly severity aggregation, validation tests, a responsive dashboard with accessible SVG charts and localStorage, a local server on port 4179, and README. Plan, implement, run tests and fix failures. Do not commit, push, deploy, or modify files outside the disposable workspace.

**Brownfield, same chat**

> Inspect the existing files. Add immutable reopening and a Reopen control without breaking APIs or stored data. Test repeated reopen, reopening open incidents, UTC week boundaries, empty weekly buckets and immutability. Update the README, run tests and report the diff. No dependencies, commits, pushes or deployments.

**Four-stage workflow / manual automation**

1. Design severity totals and weekly UTC buckets in a short DESIGN.md.
2. Implement pure `buildReport(incidents)` in report.mjs with validation and immutable results.
3. Write and run Node tests for empty/invalid input, totals, sorting, timezone boundaries and immutability.
4. Review the implementation and tests, write REVIEW.md, then require a human approval.

Definitions were provisioned through the isolated API because the current mobile client does not author arbitrary DAGs. Workflow launch, input entry, monitoring, stage inspection, retry, pause/resume, and manual automation trigger were exercised in the mobile UI. See AUDIT.md for actual outcomes and limits.

The additional native passes and fixes are recorded in [FOLLOWUP.md](FOLLOWUP.md). The matrix below separates those passes from remaining release work.

## Required release follow-up

| Area | Test cases that require explicit evidence |
|---|---|
| iOS 26 | Native compile/install, glass appearance in both themes, Reduce Transparency, keyboard avoidance, safe areas, interactive back, iPad layout |
| Older iOS | Opaque material fallback, secure restore, supported Expo minimum deployment target |
| Android | Builds/installations and native tool interactions were exercised. Remaining release checks include both-edge gesture navigation, rotation, TalkBack, OEM devices and measured frame pacing. |
| Chat | Native command allow/deny, screenshot/page-text attachments, fork/rename/archive/restore, drafts across restart, source/diff navigation and review comments passed. Codex returns plans in chat; dedicated plan-review is unsupported by its adapter. Still test questions, other providers’ plan gates, long-stream stress, dictation, stop/retry/rewind permutations. |
| Workers | Native orchestrator creation, a managed worker’s completion and result/detail verified. Still verify cancellation/error/review loops and clarify provider-internal worker visibility. |
| Terminal | PTY creation and native keyboard command/output verified (20 tests in the final retest). Two sessions and host-503 close/retry passed in the follow-up. Still verify selection/copy/paste, all accessory keys and network reconnect permutations. |
| Browser | Preview, page capture/upload and share off/on verified natively; real host-policy allow/block integration passed. Image capture/upload/agent interpretation and native start passed in the follow-up. Still verify all navigation/refresh/stop permutations. |
| Computer | Enable explicitly in a disposable environment, consent, frame stream, pause/revoke; do not operate unrelated user apps |
| Workflows | Native required-input validation, pause/resume/confirmed cancel passed in the follow-up; stage transcript, approval and retry exercised earlier. Still test request-changes/reject, repeat/parallel stages and gate races across devices. |
| Automation | Manual inputs/history/cancel and duplicate-trigger protection; scheduling/webhooks need separately configured fixtures |
| Source control | Review diff/comments/compare locally; commit/push/PR publication require separate authorization |
| Connectivity | LAN interruption/recovery, locked credential restore, revoked device, relay/offline transitions, server mismatch |
| Physical device | Camera, microphone, biometric step-up, hardware key protection, haptics, notification foreground/background/tap delivery |

A successful route screenshot proves layout/navigation only. It must not be used to mark every operation in that route as passed. API provisioning, service/unit tests, mobile web interaction and native interaction are separate evidence categories.
