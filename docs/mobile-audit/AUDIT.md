# Mobile audit and redesign — 19 September 2026

Status: mobile audit and implementation review. No source commits or staging performed. Evidence below distinguishes source review, web-preview interaction, native execution, and outstanding platform verification; this is not a blanket iOS/Android release sign-off.

The additional native audit and subsequent fixes are in [FOLLOWUP.md](FOLLOWUP.md). Read its verification ledger for the latest status.

## Architecture and feature map

GeneratorAI is a server-hosted agent workspace with four clients: React web, Electron desktop, CLI/TUI, and Expo mobile. Mobile is a native client, not a wrapper around the web SPA. Its web preview runs the same React components through React Native Web, but substitutes or omits native services. The complete source inventory is in [INVENTORY.md](INVENTORY.md).

The server composition root assembles projects/codebases/worktrees, chat sessions, agents and capability resolution, workflow definitions/DAG scheduling/durable stage execution, automation/data-source/webhook orchestration, plans and approval gates, checkpoints/changes/reviews/source control, browser/terminal/computer hosts, voice, widgets/extensions, and device security. Provider processes are isolated through agent-host; PTY, browser, and computer use have separate hosts. Available provider implementations include Copilot, Claude Agent, Codex, OpenCode and ACP; availability depends on the host's installation and credentials. The audit server reported Codex and Claude Agent ready.

Shared packages divide responsibilities as follows:

- `shared`: contracts, schemas and client-safe utilities; `design-tokens`: palettes, type and spacing tokens.
- `client-core`: typed API clients, transcript/diff/stream models; `client-runtime`: authentication/session runtime; `client-transport` and `relay-protocol`: direct/remote connections and protocol.
- `core`: domain services, scheduling, execution, tool and permission orchestration; `agent-harness-providers`: provider adapters and supervision; `db`: persistence and migrations.
- `auth` and `secrets`: pairing, DPoP, device scopes, credentials; `git`, `source-control`, `changes`, `checkpoints`, `review`: repository operations and review state.
- `sdk` and `mcp-server`: programmatic and agent-facing APIs; `cli-core` and `tui-kit`: command and terminal presentation.

Mobile uses Expo Router, TanStack Query, Zustand, NativeWind, Reanimated, Gesture Handler, LegendList, WebView, MMKV and platform secure storage. Its lifecycle is pairing → authenticated provider stack → shared multiplexed stream → queries and screen-specific subscriptions. Mutations must preserve device scopes; a missing scope must produce an explanation, not a fake empty state.

## Current mobile feature catalogue and page audit

| Module / pages | Existing functionality | Design assessment / action |
|---|---|---|
| Pair / revoked / restore | QR/manual link or code, grant consent, secure device identity, reconnect, revoked/locked states | Keep explicit consent and actionable failures; credentials are not screenshot/report material. Native camera and locked restore require device checks. |
| Home | Today/running/needs-you filters, approval queue, urgency-ranked live activity, degraded-server status, new chat, search/inbox/settings | Keep decisions ahead of decorative metrics. Adaptive filters preserve labels/counts and minimum targets. |
| Chats list | Search, active/archived, new chat, row actions and swipe actions | Preserve explicit alternatives to gestures, archive recovery, and list position. |
| New chat | Model, project, agent/capability overrides, sources, worktree/branch choices, tags, browser policy, plan mode, permissions, orchestrator | Progressive disclosure is appropriate. Picker pages remain inside one sheet. Test names and long models at phone width. |
| Chat transcript | Streaming text/reasoning/tools, markdown/code/tables/images, tool detail, plans/questions/permissions, inline changes, copy/share, speech, rewind/fork/archive | Keep transcript opaque. Do not blur code. Pane gestures must yield to code scrolling, WebViews, and platform back. |
| Chat composer | Drafts, slash commands, file mentions, attachments/capture, dictation, history, model/mode/effort/context/permissions, context gauge, send/stop, plan-send | Native glass around the input on supported iOS; Material surface on Android. Preserve stable send/stop position and keyboard handling. Press-and-hold callbacks now coexist with press feedback. |
| Changes and file diff | File/hunk navigation, staged/unstaged diffs, wrap controls, review comments, checkpoints/compare/rewind, commit controls and source-control actions | Full-screen tool pane. Horizontal code scrolling wins over pane swipe. Actual commits/pushes are excluded from this audit by the user's instruction. |
| Files | Breadcrumb tree, search, repository filter, recent files, markdown/source preview, syntax highlighting, wrap/copy/share, large-file fallback | Promote Files to a named chat pane; retain overflow shortcut for compatibility and pre-workspace state. Avoid using a tall sheet as the only file browser. |
| Terminal | Multiple PTYs, terminal/agent console, key bar, search/paste, lifecycle and scope checks | Keep full height and preserve WebView selection and horizontal input gestures. Web preview cannot verify the native terminal renderer. |
| Browser | Workspace browser lifecycle, navigation, preview, agent sharing, capture, active-tab information and access policy | Keep dedicated full-height pane and explicit controls. Native WebView behavior needs emulator/device evidence. |
| Tasks / Computer | Background worker status/detail/actions; computer-use frame/activity/consent/grants where enabled | Keep counts and status discoverable. Do not steal computer interaction drags. Permission denial must remain distinct from empty tasks. |
| Work: workflows / runs / automations / scripts | Searchable catalogues, counts, refresh, templates | Adaptive scrolling replaces shrinking four long names into fixed slots. Work is one primary destination with peer subviews. |
| Workflow detail | Stage/dependency outline, hooks, history, template creation, run inputs and overrides, delete | **Defect:** API edges use `fromStageId/toStageId`; UI omitted both, hiding prerequisites. Corrected with regression coverage. Added tappable stage inspector for prompts, model overrides and approval behavior. Full graphical authoring remains a parity gap. |
| Run / stage detail | Stage timeline, transcripts, status, gates, pause/resume/retry/cancel, permission mode, variables, changes/terminal | Use a vertical execution outline, explicit labels, and pinned primary actions. Do not claim linear order means a serial DAG. |
| Automation detail / execution | Enable/disable, run with inputs, history, execution detail/cancel, webhook-related information and deletion | Manual execution is testable without leaving recurring work behind. Full creation/editing, data-source setup and scheduling remain primarily web/desktop features. |
| Script detail | Profiles, typed variables, project choice, stage outline, execute | Forms benefit from shared target and accessible-name fixes. Real scripts depend on the host catalogue. |
| Projects / project detail | Search, create, rename/archive, overview, chats/runs/workflows/automations, codebases, artifacts/settings, PR links | Keep grouped native rows; local host folder selection remains constrained on a phone. Test project settings without touching production repos. |
| Codebase / files / PR list and detail | Repository state, worktrees, file tree/source, source-control status and PR review | Long paths need wrapping/scrolling and explicit repository context. Remote GitHub mutations are outside isolated local tests. |
| Agents (Projects segment + sheets) | Built-in/global/project catalogues, detail, instructions, capability/runtime editing where authorized, chat binding | Preserve read-only built-ins and scope feedback. No separate hidden desktop-only navigation assumption. |
| Search / approvals / scope request | Cross-module search, grouped pending decisions, request access and tracking | Named controls, large targets, pinned actions. Use real gates rather than seeded screenshots as evidence. |
| Settings landing | Connection/provider summary and destinations | Shared spacing, readable groups; no unnecessary primary navigation tab. |
| Appearance / accessibility | System/light/dark, palettes/accent, previews, motion/haptics/text options, app lock | Tab labels should remain present at large text sizes. Respect Reduce Transparency separately from Reduce Motion. |
| Notifications | Permission status, category toggles, system settings, build configuration feedback | EAS project id is absent here: push delivery is not configured and cannot be marked passed. |
| Providers / capabilities / extensions | Provider health/models, artifacts/MCP toggles, extension state | Admin mutations require explicit scope. Built-in lists are not proof that provider calls or extensions work. |
| Security / access / diagnostics / about | Device grants/pair/revoke, step-up, connection/key/server health, capabilities and version | Emulator key storage is not proof of Secure Enclave or biometric behavior. Source-control settings require real account context. |

## Research and design decisions

Consulted primary platform/library documentation, rather than copying a competitor's screenshots:

1. [Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials) and [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/): separate controls from content. Application: glass only on navigation/composer surfaces; readable opaque transcripts, diffs and forms.
2. [Expo SDK 57 GlassEffect](https://docs.expo.dev/versions/v57.0.0/sdk/glass-effect/): native `GlassView`, API/compiler availability checks, appearance, and transparency accessibility considerations. Application: platform-specific iOS module, both availability checks, live Reduce Transparency subscription, opaque initial/fallback surface. No glass opacity animation.
3. [Expo native tabs](https://docs.expo.dev/router/advanced/native-tabs/): native platform navigation is available but its layout/inset and interaction contract differs. This pass retains the working tab navigator and installs native material behind it; it does **not** claim the navigator itself was migrated to UITabBarController.
4. [Android accessibility](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility): preserve usable targets, contrast, names, scalable content, and alternatives to gesture-only actions. Application: 48dp Android / 44pt iOS control floors, named tab labels and scrollable peer controls.
5. [Android predictive back](https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back): back is system navigation. Application: reserve both Android screen edges from the horizontal pager and disable competing page swipes while a screen reader is active. This is gesture coexistence, not a claim of a new native predictive-back animation.

The navigation model stays Home / Chats / Work / Projects. Inside chat, each substantial tool gets usable screen space. Tool labels scroll instead of shrinking; selection brings the active item into view. Browser, terminal, computer and files keep their own interior gestures. Model and execution policy remain in a single setup sheet so the send control never gets pushed offscreen.

## Test plan and evidence rules

1. Establish source inventory, clean working tree and existing checks.
2. Pair isolated test clients to an isolated server/database/workspace on port 3111.
3. Capture baseline top-level pages; exercise an actual GPT-5.6 Sol/high chat through the UI.
4. Generate a small but multi-file Incident Desk project with domain logic, tests, a responsive chart dashboard and a local server; inspect changes/files/tools; issue a brownfield change with additional validation.
5. Use a four-stage design → implement → validate → human-reviewed handoff workflow, typed input, then a manual automation. Definitions may be seeded because mobile lacks full authoring; starting/monitoring/approving must be exercised through mobile UI and reported separately from seeding.
6. Verify navigation, settings, light/dark, narrow/large-text layouts, sheets, keyboard, explicit and gesture back. Test native-only surfaces on the emulator where usable.
7. Re-run focused regression tests, typecheck/lint, platform bundles and Android build. Never report a web viewport as an iOS simulator.

### Baseline evidence

- Starting working tree: clean.
- Mobile TypeScript: passed.
- Mobile logic suite: 90 files, 1,006 tests passed.
- Mobile web pairing: 5/5 steps passed.
- Mobile web initial route tour: 19/19 destinations rendered, no application console errors. This is rendering/navigation coverage, not feature completion.
- Native environment: Android API 35 arm64 Pixel AVD available. Xcode and `simctl` absent. Initial software renderer produced System UI ANRs; host renderer with Vulkan disabled booted in ~28 seconds, but concurrent build/memory pressure still affected responsiveness.
- Push configuration: no EAS project id. Physical camera, biometrics, lock-screen push, iOS gestures and Liquid Glass appearance remain device verification requirements.

### Verification after changes

- Final complete mobile logic suite: **93 files / 1,017 tests passed** with one worker after stopping the emulator (14 seconds). Earlier intermediate checks passed 1,012 tests; a subsequent loaded-host run timed out one existing large-buffer test, which passed both its focused rerun and this final complete run.
- Mobile TypeScript: passed after the native upload, keyboard and stable authentication callback fixes. ESLint: zero errors, two existing warnings in scope-request and web secure storage.
- Workflow service: 35 tests passed, including unreachable-successor retry regression coverage. Server CORS/run ordering/response ETags: six tests passed.
- Real Chrome integration: allowed `127.0.0.1` on an ephemeral development port loaded; unlisted `localhost` was blocked. This verifies interception, not just a mocked URL comparison.
- Mobile web: pairing 5/5, final 23-route tour without application console errors, six chat/pane scenario steps, workflow inspection/start, and automation trigger response/history assertions passed.
- Native Android: pairing recovery, route navigation, file tree → source → wrap, real PTY command entry/output (20 generated-project tests passed in the final retest), browser preview and page-text capture into the composer were exercised. Sending that attachment exposed an RN-specific failure. The final native retest uploaded the artifact, completed a Codex Sol/high turn, and extended the generated tests to 20 passing cases (12 incident + 8 report). Browser sharing off/on also passed.
- Native route tour initially reported 20/24 but one approvals capture still showed Search; that capture is excluded. Follow-up native captures verified Approvals, Extensions, Phone Access, Source Control settings, and the Agents catalogue. Route rendering is layout coverage, not proof of every operation.
- Android release builds succeeded and the final APK was installed for native checks. The final iOS JavaScript export was refreshed after all mobile changes and succeeded; Xcode/native iOS compilation was unavailable.

## Implemented changes and rationale

- **Native iOS material:** added the SDK-matched `expo-glass-effect` dependency and an iOS-only `GlassSurface`. The composer and tab bar use native glass when supported, with opaque Android/web/older-iOS and Reduce Transparency fallbacks. This preserves platform character without compromising code readability. It is not an iOS visual sign-off or a wholesale native-tabs migration.
- **Usable peer navigation:** full labels and counts remain available in horizontally scrollable controls; selected items scroll into view. Four Work categories and the chat tools no longer compete by shrinking text. Tab labels remain visible at larger text sizes.
- **Files as a destination:** Files now sits beside Chat and Changes, with the existing full tree/search/preview component. Tool surfaces retain independent horizontal gestures; tapping a destination dismisses the composer keyboard.
- **Accessible controls and gestures:** shared buttons/fields enforce platform target floors; code-block wrap/copy controls now have 48-point layout boxes instead of tiny icons with overlapping touch padding; fields have explicit accessible names; custom press handlers no longer replace press-feedback callbacks. Pager gestures yield to both Android back edges and to screen readers.
- **Reachable form actions:** Create chat, Start run, and automation input actions are pinned outside the scrolling form. Content-fit sheet sizing includes the footer, and form sheets use one tall detent to keep the action in view.
- **Connection recovery:** authentication now guards screens inside the mounted navigator. A failed saved connection can open Pair and accept incoming pairing links; Android recovery from the stale port-3100 connection was reproduced and verified after the fix.
- **Workflow comprehension:** canonical API edge fields now produce prerequisite labels. Tapping a stage opens its instructions, model override and approval details. Failed-stage quick actions are siblings of the stage-open control, avoiding nested interactive elements.
- **Browser failure feedback:** startup failure persists with a retry action. Starting with an address awaits navigation through the actions endpoint, so host policy failures are not silently treated as a successful blank page; live action errors remain visible beneath the address bar.
- **Native attachment sending:** byte-backed browser captures now upload through temporary native file URIs instead of unsupported React Native byte Blobs. Text-only prompts use JSON. Upload parts expose both a native URI and Expo 57’s required byte reader. Temporary upload files are cleaned up, and failed requests clear the optimistic streaming state while retaining the draft for retry.
- **Android keyboard overlap:** include the bottom system-bar inset that RN subtracts from its IME event. This addresses the observed clipped terminal key bar and lower composer controls in edge-to-edge mode. Existing iOS geometry remains separate. Browser and terminal content clear the bottom safe area; terminal accessory keys use 48-point layout targets.
- **Stable authenticated operations:** fetch and stream/socket URL callbacks now retain their identities across transport-status updates while reading the current runtime. This prevents API consumers from disposing live terminal connections just because authentication context was refreshed.
- **Reliable diff validation:** the server now derives a change-file ETag from the complete response, while preserving the blob-pair cache key for renderers. Native testing found a cached empty patch repeatedly validated by the old blob-only ETag. Forcing a fresh response restored all 204 added lines; the new validator returns a fresh body for the old ETag and 304 only for the matching representation.
- **Orchestrator discovery:** the Tasks pane now respects the chat’s orchestrator toggle even without a bound orchestrator agent.
- **Service fixes found through mobile:** CORS now permits the automation idempotency headers without broadening allowed origins. Retried workflows re-evaluate stages that the scheduler automatically skipped as unreachable; explicit skips and completed outputs retain their prior handling. Run details also return stages in the saved definition order instead of database update order. Browser request interception now compares hostname consistently with preflight policy, so an explicitly allowed development hostname works on a non-default port.
- **Repeatable evidence:** mobile test harness paths/browser selection are portable, navigation tolerates cold Metro compilation, automation assertions check the actual trigger response/history, and an Android accessibility/screenshot helper is included.

These changes improve the existing interaction system rather than replacing every page with new ornamental layouts. The current app already has shared tokens, platform haptics, motion preferences, sheets, grouped rows and full-screen tools. Keeping that structure reduces navigation relearning and concentrates the changes on observed friction and failures.

## Live scenario findings

The isolated environment uses its own database, workspaces, credentials and port 3111. No production project, remote repository, or account was used for mutations. The test app creates internal checkpoint objects/refs in disposable workspaces; no commit was made to the GeneratorAI source repository.

1. **Greenfield:** created `Incident Desk · mobile generation` through the mobile web UI, selected Codex `gpt-5.6-sol` and High effort, and requested immutable domain operations, validation/tests, a responsive SVG chart dashboard, localStorage, a local server and documentation. Approved real shell permission requests through the UI. Six initial project files were produced; seven tests passed.
2. **Brownfield:** sent a follow-up through the composer to add immutable reopen transitions and a dashboard control, preserve existing APIs/data, and cover repeated reopen, UTC boundary handling, empty weekly buckets and immutability. The agent completed it; an independent `node --test` invocation passed all 12 tests.
3. **Workflow failure and recovery:** started the four-stage Design → Implement → Validate → Handoff flow from the mobile inputs sheet. The first fixture's four-minute stage limit was too short. The UI showed timeout, failed and skipped states; retry, pause and resume were exercised. Retry exposed the unreachable-successor bug fixed in `WorkflowRunService`. A run snapshots its definition, so changing the live definition's timeout does not retroactively change a retry's frozen definition.
4. **Automation:** a manual trigger initially failed browser preflight because `Idempotency-Key` was not allowed. After the server fix, Run now created an execution and its linked workflow run, with live history and no application console errors. No recurring schedule was created. The fresh execution completed all four stages after the handoff was approved through the mobile UI; an independent invocation of `report.test.mjs` passed all seven tests.
5. **Native tools:** opened and wrapped `incident.mjs` in the Android Files pane, created a PTY, typed `node --test incident.test.mjs report.test.mjs` on the Android keyboard, and verified 19/19 passing tests in the native terminal. Started the generated dashboard and viewed it through the Browser pane. Page-text capture successfully became a draft attachment; sending it then exposed the byte-Blob bug described above. After the native fix, upload succeeded, the artifact was stored, and Codex added an additional top-level invalid-input case; both suites passed (20 total). After the authentication callback fix, the same command was entered again in the native terminal and visibly passed all 20 tests with the accessory key bar above the keyboard.
6. **Browser:** the first host lacked Playwright's Chromium binary. Startup failure was reproduced. The audit server was subsequently configured to use installed Chrome. Loopback navigation is intentionally blocked unless the test workspace explicitly allows it; this is a host policy condition, not a reason to weaken the global policy. A second defect was found after allowlisting: navigation preflight checked `hostname`, but request interception checked `host` including the port. The one-line consistency fix is covered by a real-browser integration test.

7. **Background tasks:** created an orchestrator chat through the native New Chat sheet, selected Codex Sol and High effort, and verified Tasks appears with no bound agent. The first prompt used Codex-internal workers, which do not populate GeneratorAI’s Tasks API. An explicit `spawn_background_agent` follow-up created a platform worker that completed successfully; its completed row, result, risks, and Open worker chat action rendered in the native task detail. This verifies the managed-task path, not cancellation or native-provider worker parity.

8. **Diff cache recovery:** a native file detail remained empty despite a valid server patch. A diagnostic proxy established that the native HTTP cache was being revalidated with a blob-only ETag. A fresh response displayed 204 additions. After changing the validator to a digest of the complete response, direct native navigation and hunk collapse/expand passed; API checks returned 200 for the old validator and 304 for the current one. The diagnostic proxy was removed.

## Remaining product and platform limits

- Full workflow graph editing, full automation/schedule/data-source authoring, and desktop multi-tab browser parity are not implemented by this mobile pass. The catalogue identifies the currently supported mobile subset.
- Mobile Browser is a remote preview with navigation/capture/share controls, not a general interactive browser or a set of independent desktop browser tabs. Computer use remains a separate consented feature.
- An iOS JavaScript export does not validate Swift compilation, iOS 26 glass appearance, safe-area/keyboard behavior, VoiceOver, or native interactive-back behavior. Xcode/simctl are not installed on this machine.
- The Android AVD repeatedly stalled under host memory/build pressure. Lowering emulator memory and separating builds allowed native pairing/recovery and a substantial route tour, but this environment cannot establish frame-rate or physical-device smoothness.
- Push delivery lacks EAS project configuration. Camera capture, microphone/dictation, biometrics, hardware-backed keys, physical-device haptics, notification delivery, Android OEM variations, and screen-reader navigation require device checks.
- PR publishing, commits/pushes, remote credentials, and destructive production operations were excluded. Their presence in a menu is not counted as successful testing.
- One transcript capture under heavy host load briefly overlapped a work-summary row and text; the final settled capture did not reproduce it. Long-transcript streaming/layout stress and frame-rate profiling remain release checks.
- Platform background-worker creation/completion/detail passed, but cancellation/error/review loops and Codex-internal worker visibility remain gaps. Computer-control gestures, native file/photo import, full terminal selection/key handling, offline/relay transitions and all permission-denial permutations remain unverified.

## Review artifacts

- [Complete source inventory](INVENTORY.md)
- [Android home](evidence/android-home.png)
- [Android connection recovery → pairing](evidence/android-pair-recovery.png)
- [Android workflow dependencies](evidence/android-workflow.png)
- [Android settled transcript](evidence/android-transcript.png)
- [Android source preview](evidence/android-file-source.png)
- [Android terminal: 19 passing tests, before keyboard fix](evidence/android-terminal-before-keyboard-fix.png)
- [Android terminal: final 20 passing tests](evidence/android-terminal-final.png)
- [Android file diff](evidence/android-diff-final.png)
- [Android browser preview](evidence/android-browser-preview.png)
- [Android composer and keyboard](evidence/android-composer-keyboard.png)
- [Android completed worker detail](evidence/android-task-detail.png)
- [Mobile web Files pane](evidence/mobile-web-files.png)
- [Mobile web automation execution/history](evidence/mobile-web-automation.png)
- [Completed four-stage workflow](evidence/mobile-web-workflow-completed.png)
- [Scenario prompts and release follow-up matrix](SCENARIOS.md)

## Review priorities

1. Run the iOS native build and device matrix before shipping Liquid Glass; this machine cannot provide that evidence.
2. Finish hardware-dependent and accessibility checks (VoiceOver/TalkBack, camera/microphone, biometrics, pushes, motion and physical haptics).
3. Treat graph/automation authoring and interactive browser parity as separate product work, with a mobile-specific scope rather than compressed desktop controls.
4. Profile transitions and long transcripts on representative phones. Simulator responsiveness under this host’s memory pressure is not a frame-rate measurement.

Full runtime logs and intermediate captures are under `/tmp/gai-mobile-audit` on the audit host.
That directory is temporary and includes private pairing/profile data; do not publish or commit it.
Only selected non-secret evidence is copied into this report directory.

At the end of the first pass, the isolated emulator and test services were stopped. The follow-up report records subsequent runtime status. Their disposable database/workspaces remain under the temporary audit directory for local investigation; no recurring automation or agent turn was left running.
