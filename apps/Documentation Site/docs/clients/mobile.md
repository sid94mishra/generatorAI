---
title: Mobile application
description: iOS and Android navigation, pairing, chat panes, work monitoring, permissions, and native builds.
---

# Mobile application

The mobile application is an Expo SDK 57 / React Native 0.86 companion for iOS and Android. It connects to a GeneratorAI host; the phone does not run the host's provider processes, Git workspaces or terminal shell. Expo Router supplies native navigation and file-based routes.

## Pair and connect

1. On a trusted client, open **Settings → Security & Devices** and create a pairing invitation for a mobile device. Enable network access if the host must be reachable on the LAN.
2. Open the pairing link or scan the QR code on the phone. Review the host identity and offered capabilities before accepting.
3. Allow local-network access on iOS when connecting to a LAN host. Confirm the host is reachable from the phone; its `localhost` is different from your computer's.
4. Once paired, use **Settings → Security** to inspect key protection, granted capabilities, connection and pending access requests.
5. For a locked feature, use **Request access** where offered. An administrator approves on a trusted client. Refresh permissions after approval.

The app has explicit states for pairing, restoration, revocation, and locked secure storage. A revoked credential routes to `/revoked`; an iOS launch while secure storage is locked should wait for unlock rather than silently discard pairing.

Private LAN HTTP endpoints are allowed by the pairing policy. These requests are authenticated with signed proofs, but HTTP traffic is not made confidential by those signatures. The repository's message-level E2EE helper is not wired into this transport; do not describe LAN HTTP as end-to-end encrypted.

## Navigation and all screen families

| Surface | Routes / controls |
| --- | --- |
| Home | `(tabs)/index`: host health, current operations, attention queue and approvals |
| Chats | `(tabs)/chats`: conversations, search and new-chat sheet; `/chats/[id]` for the session |
| Work | `(tabs)/runs`: segmented catalogue of runs/workflows/automations/scripts and related actions |
| Projects | `(tabs)/projects`: projects and agent-related browsing; `/projects/[id]` for project detail |
| Project repositories | `/projects/[id]/codebases/[cid]`, `/files`, `/file`; project pull-request list and codebase pull-request detail |
| Workflow | `/workflows/[id]`: stage/dependency inspection, variable form, start run, run history |
| Run | `/runs/[id]`: progress and decisions; `/runs/[id]/stages/[stageRunId]` for stage transcript |
| Script | `/scripts/[id]`: script metadata/profile and launch form |
| Automation | `/automations/[id]`: status, trigger, enable/disable, inputs and execution inspection |
| Review | `/changes/[workspaceId]`, `/changes/[workspaceId]/file`: changes and expanded file diff |
| Terminal | `/terminal/[workspaceId]`: expanded terminal |
| Decisions | `/approvals`, `/chats/[id]/gate/[interactionId]`, `/chats/[id]/plan/[planId]` |
| Search | `/search`: cross-resource results |
| Access | `/pair`, `/scope-request`, `/revoked` |
| Settings | The settings index and eleven detail routes described in [settings](./settings.md#mobile-settings) |

The four primary tabs are **Home, Chats, Work and Projects**. Settings is a header destination. Re-tapping an active tab scrolls to the top. Home carries an attention badge for work waiting on a decision.

## Chat and the mobile workbench

Create a chat, select the project/codebase and provider/model, then configure turn options before sending. The composer supports draft state, prompt history, slash suggestions, attachments/captures and voice controls. Uploads need the appropriate file-write scope; voice capture also needs operating-system microphone permission and a working server speech pipeline.

The transcript displays user messages, streamed assistant content, tool activity, plans, questions and source-control results. Use the session menu for supported rename/branching/archive and rewind actions. A new turn can use different options; check the effective model and permission mode rather than assuming a global setting overrides an existing conversation.

The session pane strip uses one full-width surface at a time:

| Pane | Mobile behavior |
| --- | --- |
| Chat | Conversation and composer |
| Changes | File summary, expandable diff, review comments, checkpoint comparison and commit flow where allowed |
| Files | Repository selector/tree, recent files, syntax-highlighted code, Markdown preview, wrap/copy/share; no general-purpose editor |
| Tasks | Background-task progress, detail, open associated conversation and cancel where allowed |
| Terminal | Host PTY rendered through a WebView terminal; keyboard accessory controls |
| Browser | Host browser preview, navigation, start/stop, sharing with chat and screenshot/page-text capture |
| Computer | Latest desktop frame, activity, consent and standing grants when enabled |

Changes, Files, Terminal and Browser depend on a workspace. Tasks appears for orchestrator sessions or after tasks exist. Computer appears when computer use is enabled on the host. The Plan surface remains available through the workbench/More sheet and plan routes. A locked pane remains discoverable with a reason; it is not evidence that the capability is absent from the server.

## Permissions and intentional limits

| Feature | Required device scopes / limitation |
| --- | --- |
| Terminal | `exec:terminal` |
| Browser control | `exec:browser` |
| Computer observation/actions | `exec:computer`, plus server enablement and host permissions |
| Voice input | `write:chats` plus microphone permission |
| File attachments | `write:files` |
| Start/pause/cancel runs and automation execution | Both `write:workflows` and `exec:agent` |
| Project creation/settings/Git URL attachment | `write:projects` |
| Catalogue administration | `admin:settings` |
| Pair/revoke other devices | `admin:devices` |
| Local codebase folder picker | Structural limitation: use a Git URL or another client on the host |
| Full graph/automation authoring | Use desktop/web; obtaining a scope does not create a missing editor |

Non-admin devices cannot self-request new `admin:*` scopes. An administrator must grant those from an already trusted client. The mobile About capability list contains older summaries; current implementation includes review comments and scoped source-control flows beyond those summaries.

## Native design and accessibility

Supported iOS builds use native Liquid Glass through `expo-glass-effect` for control chrome. Older APIs, Reduce Transparency, Android and web use opaque themed surfaces. Content such as code and transcripts remains readable on solid surfaces. Android uses a Material-style bottom bar and selected-icon indicator. Both platforms share semantic tokens and adapt safe areas, keyboard behavior and sheet layout.

Motion uses Reanimated with system/app reduce-motion settings. Haptics, collapsing large titles, text-size accommodation, push-to-talk and app lock are configurable. Swipeable rows, pagers and sheets complement visible controls; they should not be the only way to invoke a critical action. See the [design system](../design/system.md).

## Build and test

Run from the repository root:

```bash
pnpm --filter @generatorai/mobile start
pnpm --filter @generatorai/mobile ios
pnpm --filter @generatorai/mobile android
pnpm --filter @generatorai/mobile web
```

Native runs require Xcode/iOS or Android tooling. Continuous Native Generation creates `ios/` and `android/`; these are generated outputs. Native modules mean a development/device build is the meaningful test target for the complete app.

```bash
pnpm --filter @generatorai/mobile typecheck
pnpm --filter @generatorai/mobile test
pnpm --filter @generatorai/mobile export:android
pnpm --filter @generatorai/mobile bundle:analyze
pnpm --filter @generatorai/mobile build:preview
pnpm --filter @generatorai/mobile build:production
```

EAS profiles are `development` (dev client, internal build, iOS simulator), `preview` (internal installable build), and `production` (store build with version increment). Configure `EAS_PROJECT_ID` for push registration. `APS_ENVIRONMENT` is development for local/dev builds and production for distributed preview/store builds.

Browser preview tests are useful for shared logic and screen flows, but do not validate secure hardware keys, push delivery/actions, biometrics, native glass, WebView/PTY behavior, keyboard insets or platform gestures. Before releasing, exercise a real device build in portrait/landscape, iPad split view, large text, light/dark, locked launch and background/foreground transitions.

## Troubleshooting

- **QR succeeds but requests fail:** verify LAN address reachability and local-network permission; Android cleartext support only permits endpoints accepted by the app's private-address policy.
- **Push disabled:** check EAS project ID, notification permission and profile/APNs environment.
- **Feature returns forbidden:** inspect all required scopes; run control needs two scopes.
- **Terminal or composer covered by keyboard:** reproduce in the native build and record OS, device and keyboard mode.
- **Review action missing:** check workspace state, active review scope and source-control permissions, not only whether a diff can be read.

Sources: `apps/mobile/package.json`, `apps/mobile/app/`, `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, `apps/mobile/src/auth/featureGate.ts`, `apps/mobile/src/components/chat/{composer,workbench,panes}/`, `apps/mobile/src/components/review/`, `apps/mobile/src/components/scm/`, and `apps/mobile/README.md`.
