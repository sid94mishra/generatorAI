# M10 notes — lockdown and store readiness

Evidence for M10-02…M10-06 that is not a decision (decisions are MD-192 onward). Device runs are the owner's; each
section ends with the exact commands.

## 1. M10-02 — Maestro covers the screens

The web-preview Playwright scripts are deleted (`apps/mobile/e2e/*.mjs` except the a11y checker). Route families and
the flow that exercises them (smoke = tagged `smoke`; everything else runs in the full suite):

| Route family | Flow(s) |
|---|---|
| `/pair`, `/paired` | `pairing/pair-via-link` (smoke) |
| `/` Home, `/needs-you` | `home/home` (smoke), `approvals/clear`, `navigation/tour`, `navigation/deep-links` |
| drawer, search palette, servers | `navigation/tour`, `navigation/android-back`, `search/palette` (smoke), `servers/switch` |
| `/chats`, `/chats/new` | `chats/archive-unarchive` (smoke), `chats/new-chat` (smoke) |
| `/chats/[id]` + composer, Turn sheet, model picker | `chat/send-stream`, `chat/send-stream-approve`, `chat/two-phase-stop`, `chat/composer-extras`, `chat/model-pick` |
| `/chats/[id]/gate/[interactionId]`, notification actions | `chat/send-stream-approve`, `notifications/approval-action` |
| pane tabs, `/workspaces/[id]/{diff,commit}` | `pane/tabs`, `pane/browser`, `changes/keep-undo-commit`, `terminal/open-type` |
| `/projects/**` | `projects/create-tabs-delete`, `projects/codebase` (new in M10-02) |
| `/agents/**` | `agents/create-delete` |
| `/automations/**` | `automations/create-run` |
| `/scripts/**` | `scripts/list-detail` |
| `/workflows/**` (list, detail, new, builder, stage editor, settings, run sheet, run, stage chat, run pane, graph) | `workflows/*` (7 flows) |
| `/settings/**`, `/scope-request` | `settings/sections`, `settings/system`, `settings/device`, `settings/scope-request`, `settings/theme-switch`, `auth/companion-scopes` |

Not covered by a flow, with the reason:

| Screen | Why | Covered instead by |
|---|---|---|
| `/chats/[id]/steps/[stepId]` | the step row's id is the Faux tool call's id, unknown to the flow | Jest (`TranscriptView.test.tsx` opens a step) + device walkthrough |
| `/agents/import` | needs the system document picker | device walkthrough (MV-30) |
| `/share` | opened by another app's share sheet, not a link (MD-190) | device checklist (§6 of this file, M9 list) |
| `/revoked` | needs the device revoked on the server mid-run | device walkthrough |
| `/projects/[id]/skills/**`, codebase logs, PR detail | no seeded skill / remote / PR in the sandbox | device walkthrough (MV-30); `links.json` smoke |
| dev routes `/live`, `/notify`, `/storybook`, `/theme` | development aids | `/theme` is used by `settings/theme-switch`; `/notify` by `notifications/approval-action` |

New env for flows: `PROJECT_ID`, `CODEBASE_ID` (the seeded project and the Edits fixture's codebase;
`scripts/mobile/lib/sandbox-maestro.mjs`).

**Owner run** (both platforms, after `sandbox-pair.mjs pair`):

```sh
node scripts/mobile/sandbox-pair.mjs maestro --platform=ios --udid=<udid> -- test apps/mobile/.maestro
node scripts/mobile/sandbox-pair.mjs maestro --platform=android --serial=<serial> -- test apps/mobile/.maestro
```
