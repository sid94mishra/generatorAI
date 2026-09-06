# GeneratorAI Mobile (`apps/mobile`) — Code Review and Inventory

Audited 2026-09-06 on branch `arch-redesign`. Every file under `apps/mobile/app/**`, `apps/mobile/src/**` (except the body of `tokens.generated.ts`), `plugins/`, and the root config files was read in full. All paths below are relative to `apps/mobile/` unless prefixed with `packages/`.

---

## 1. Architecture summary and stack notes

### 1.1 Stack (from `package.json`)

| Layer | Package / version | Notes |
|---|---|---|
| Runtime | `expo ~57.0.0`, `react-native 0.86.2`, `react 19.2.3` | New Architecture unconditional (comment in `app.config.ts:31`). CNG: `ios/`/`android/` are not committed. |
| Routing | `expo-router ~57.0.9` (`typedRoutes: true`) | File-based; root `Stack` + `(tabs)` group. |
| Styling | `nativewind ^4.2.1`, `tailwindcss ^3.4.17` | `darkMode: 'class'`; colours from `src/theme/tokens.generated.ts` (generated from `@generatorai/design-tokens`). Palette delivered as `vars()` on the root View (`ThemeProvider.tsx:183`). |
| Animation | `react-native-reanimated ~4.5.1`, `react-native-worklets ^0.10.3`, `react-native-gesture-handler ~2.32.0` | Every animation goes through `src/components/ui/motion.ts` presets carrying `ReduceMotion.System`. |
| Lists | `@legendapp/list ^3.3.3` | Used everywhere a list is virtualised (Activity, Chats, Projects, Work, chat transcript, diffs, files). No `FlatList` anywhere. |
| Graphics | `@shopify/react-native-skia ^2.6.2` | **Declared but never imported** (grep: zero hits in `app/` or `src/`). |
| Sheets | `@gorhom/bottom-sheet ^5.2.6`, `@gorhom/portal ^1.0.14` | `BottomSheetModalProvider` is mounted in `app/_layout.tsx:282` but no `BottomSheetModal` is ever rendered; `src/components/ui/Sheet.tsx:7-11` explains both libraries were tried and rejected. Effectively dead dependencies plus one dead provider. |
| Storage | `react-native-mmkv ^4.3.2` (prefs), `expo-secure-store` (key + session) | `src/storage/prefs.ts`, `src/auth/secureItemStore.ts` (+ `.web.ts` shim). |
| Data | `@tanstack/react-query ^5.90.21`, `zustand ^5.0.11` | One `QueryClient` (`_layout.tsx:46`, retry 2, staleTime 30 s). Zustand for stream state (`streamStore.ts`) and push status (`pushStatus.ts`). |
| Crypto | `react-native-quick-crypto ^1.1.6` | Installed as `global.crypto` at boot (`src/crypto/installCrypto.ts`), aliased for Node `crypto` in `metro.config.js:48`. |
| Markdown | `marked ^15` | Custom RN renderer in `src/components/markdown/Markdown.tsx`. |
| Web view | `react-native-webview 13.16.1` | Terminal renderer only. |
| Shared workspace packages | `@generatorai/client-core`, `client-runtime`, `client-transport`, `relay-protocol`, `shared`, `design-tokens`; devDep `@generatorai/auth` | Consumed as TS source via Metro `resolveRequest` shim that strips `.js` from relative NodeNext specifiers (`metro.config.js:56-62`). |
| Unused deps (no import anywhere) | `@shopify/react-native-skia`, `@gorhom/portal`, `expo-background-task`, `expo-task-manager`, `expo-sharing`, `expo-network`, `expo-linking`, `expo-system-ui`, `react-native-qrcode-svg`, `semver` | `@gorhom/bottom-sheet` is imported only for the (unused) provider. |

### 1.2 Provider stack (`app/_layout.tsx:268-296`)

```
GestureHandlerRootView
  SafeAreaProvider
    ThemeProvider            (MMKV-read mode/theme/accent, vars() bag)
      PreferencesProvider    (motion, haptics)
        ThemedShell          (applies vars, hides splash)
          QueryClientProvider
            AuthProvider     (client-runtime + EndpointSupervisor)
              MuxStreamProvider   (ONE MuxStreamClient per auth session)
                ToastProvider
                  BottomSheetModalProvider   (dead)
                    AuthGate  (usePushNotifications + useGlobalStream + redirects)
                      RootStack
```

### 1.3 Auth / transport pipeline

`AuthenticatedClientRuntime` (client-runtime) is given a `fetchImpl` that routes through `EndpointSupervisor.connect()` (client-transport) so DPoP signing and host pinning are transport-agnostic (`AuthProvider.tsx:169-183`). Candidates come from `src/transport/endpointPlan.ts`: paired endpoint + discovered endpoints, loopback outranks LAN; **relay candidates are an empty stub** (`endpointPlan.ts:112-117`, "RelayTransport lands in Phase 1b"). Host identity is verified with the raw `fetch` against `/api/auth/server-info` (`AuthProvider.tsx:102`).

Key storage (`src/auth/stores.ts`): hardware P-256 via optional native module `GeneratorAIDeviceKey` (`src/native/deviceKeyModule.ts`), falling back to an extractable JWK in SecureStore, falling back to `localStorage` on web. `KeyBacking` is surfaced in Settings › Security and Diagnostics.

### 1.4 Streaming

`MuxStreamProvider` builds one `MuxStreamClient` (client-core) using authenticated fetch for the control plane and `expo/fetch` (`expoStreamFetch.ts`) for the long-lived attach GET (RN's fetch has no streaming body). It is torn down on background and rebuilt on foreground via a `generation` counter (`MuxStreamProvider.tsx:48-67`). `useGlobalStream` subscribes `global/all` once app-wide and invalidates list queries per 16 ms tick; `useChatStream` subscribes `chat/<id>`, routes frames through `StreamEventRouter` with `MOBILE_CAPABILITIES.highLatencyBlockDelivery`, and flushes effects into the zustand `streamStore` every 16 ms.

### 1.5 Navigation map

```
/                     → redirect to /(tabs)     (app/index.tsx)
/pair                 (headerShown:false, gesture off)
/revoked              (headerShown:false, gesture off)
/(tabs)/index         Activity tab
/(tabs)/chats         Chats tab   (?new=1 opens NewChatSheet)
/(tabs)/runs          Work tab    (Runs | Workflows | Automations)
/(tabs)/projects      Projects tab
/chats/[id]           Chat        (headerRight → Workbench sheet)
/runs/[id]            Run detail  (StageGate approve/changes/reject)
/workflows/[id]       Workflow definition (stage list)
/automations/[id]     Automation detail
/projects/[id]        Project detail (codebases)
/changes/[workspaceId]           file list
/changes/[workspaceId]/file      single diff
/terminal/[workspaceId]          TerminalView (gated on exec:terminal)
/settings/*           index, appearance, notifications, providers, capabilities,
                      source-control, tools, diagnostics, about, security
```

Every non-tab route gets an explicit `headerLeft` back button with a fallback (`_layout.tsx:184-193`, `goBack()` in `Screen.tsx:49`). Settings routes are `headerShown:false` because they draw their own `<Screen back>` — **except `settings/security.tsx`, which draws neither** (see defect D1).

---

## 2. Screen-by-screen inventory

| Route / file | Purpose | Data (endpoints via `@generatorai/client-core` `createApiClient`) | Navigation & gestures | States | Notes |
|---|---|---|---|---|---|
| `app/_layout.tsx` | Provider stack, AuthGate, RootStack | none | Redirects to `/pair` / `/revoked`; ConnectionError with retry + "Pair with a different host" | initializing spinner, error | Mounts `usePushNotifications` and `useGlobalStream` once. |
| `app/index.tsx` | Entry → `/(tabs)` | none | Redirect | `pairing` spinner | Imports `Spinner` from `common/States` shim. |
| `app/pair.tsx` | QR scan → consent → enrol | `parsePairingCode` (client-runtime), `isPairingCode` (shared), `completePairing` | `router.replace('/(tabs)')` on success; phases scan / manual / consent / enrolling | camera-permission gate, error text | Raw `Pressable`/`TextInput`, no design-system components, no safe-area padding on the scan overlay (`pb-10` hard-coded). `useState(Device.nativeApplicationVersion ? 'My phone' : 'My phone')` at line 38 is a no-op ternary. |
| `app/revoked.tsx` | Terminal revoked wall | `unpair()` | "Pair again" → `/pair` | — | Raw `Pressable`; no Screen scaffold. |
| `app/(tabs)/_layout.tsx` | 4-tab shell | `useActivity` (for badge) | Haptic on tab change; re-tap scrolls to top via `scrollToTop.ts` registry; badge on Activity when `counts.attention>0` | — | Labels dropped past fontScale 1.4. `sceneStyle` themed. |
| `app/(tabs)/index.tsx` (Activity) | Mission-control feed: stat rail + Today/Running/Needs-you filter + merged feed | `useActivity` → `/api/health` (10 s), chats (limit 50), runs (15 s), automations (30 s) | Horizontal pan swipes filter (`Gesture.Pan` + `useSegmentSwipe`); pull-to-refresh; FAB → `/chats?new=1`; cards push `op.href` | skeletons, `ErrorState`, three `EmptyState` variants with "older items" hint | Auto-switches to "Needs you" once when blocked>0. `Stat` health tile shows harness type string in the big-number slot. Row entering `FadeIn` staggered; disabled under reduce-motion. |
| `app/(tabs)/chats.tsx` | Chat catalogue | `chats.list({limit:200})`, `models`, `projects.list`, `agents.selectable`, `chats.create/update/remove`, `useActivity` for `runningChatIds` | Search, Active/Archived segmented, swipe-to-archive/delete (`SwipeableRow`), long-press `ActionSheet` (rename/archive/delete), `RenameSheet`, `ConfirmSheet`, FAB, `?new=1` opens `NewChatSheet` | skeleton, error, empty (search-aware) | Undo toast on archive. Live dot from health snapshot. Client-side sort by `epochOr(updatedAt)`. |
| `app/(tabs)/runs.tsx` (Work) | Runs / Workflows / Automations | `runs.list` (10 s poll only while active), `workflows.list`, `automations.list` | Segmented + horizontal swipe; search; pull-to-refresh refetches all three | skeleton, error, per-tab empty | `WorkflowCard` recomputes `runs.filter` per row (O(n·m), fine at these sizes). |
| `app/(tabs)/projects.tsx` | Project list | `projects.list` | Search, pull-to-refresh, push `/projects/[id]` | skeleton, error, empty | Read-only by design. |
| `app/chats/[id].tsx` | Chat core loop (965 lines) | `chats.get/messages/plans/send/update/cancel/decidePlan/respond/respondPermission`, `projects.get`, `workspaces.tree`; stream `chat/<id>`; voice `/api/stt/stream` (WS); TTS `/api/tts/stream` (WS) | `headerRight` → Workbench; long-press message → copy/share/read-aloud sheet; "Latest" jump pill; Load-earlier button; `KeyboardAvoidingView` with measured header offset | `LoadingState`, `ErrorState` (transcript), `EmptyState`, reconnect banner | See §3.4 for a full feature matrix. |
| `app/runs/[id].tsx` | Run detail + HITL gate | `runs.get` (5 s until terminal), `runs.pendingInterrupts` (5 s **always**), `runs.approve` | Pull-to-refresh; links to `/changes/<ws>` and `/terminal/<ws>` (gated) | skeleton, error, "Run not found", empty stages | Stage timeline with connector; `StageGate` uses `FadeInDown` without reduce-motion check. Run control deliberately absent (`runControl.reason`). |
| `app/workflows/[id].tsx` | Definition as stage list | `workflows.get` (queryKey `['workflows', id]`, not `queryKeys`), `runs.list({definitionId})` | Pull-to-refresh; run cards push `/runs/[id]` | skeleton, error, empty stages, "Never run" | Loose `StageNode`/`EdgeNode` typing accepts `from/to` and `source/target`. |
| `app/automations/[id].tsx` | Automation status + executions | `automations.get`, `automations.executions` (5 s while active) | Pull-to-refresh; "Workflow" row → `/workflows/[id]` | skeleton, error, empty history | Executions rendered with `.map`, not virtualised (fine for tens). |
| `app/projects/[id].tsx` | Codebases of a project | `projects.get` | Pull-to-refresh | skeleton, error, empty codebases | — |
| `app/changes/[workspaceId]/index.tsx` | Workspace change list | `workspaces.changes(id)` | Pull-to-refresh (`RefreshControl`); rows push `/changes/[ws]/file` with blob pair | skeleton, error, "No change data", "Not a git repository", "No changes yet" | Plain `ScrollView` + `.map` (not virtualised; 300 files would render eagerly). Uses `STATUS_MARK` colours that differ from `ChangesSection`'s (`modified` = `text-info` here vs `text-warning` in the Workbench). |
| `app/changes/[workspaceId]/file.tsx` | Single diff, virtualised | `workspaces.filePatch` (staleTime ∞ keyed by blob pair) | none beyond back | `LoadingState`, `ErrorState` (no retry), "No textual changes", truncated banner | Two-gutter `DiffRowView`; no wrap toggle unlike Workbench diff. `ErrorState` imported from `common/States`. |
| `app/terminal/[workspaceId].tsx` | Full-screen terminal | via `TerminalView` | Gated by `checkFeature('terminal')` → `FeatureLocked` | — | Thin wrapper. |
| `app/settings/index.tsx` | Hub (App / Agents / Integrations / System) | `health` (15 s), `harness.providers` | `ListRow` push to each sub-screen | "Checking…" subtitles | Two duplicate imports of `primitives` (lines 35 and 37). |
| `app/settings/appearance.tsx` | Mode / theme / accent picker | none (design-tokens registry) | Immediate apply | — | `ThemePreview` miniatures; preview card. **No motion or haptics toggle anywhere in the app** even though `PreferencesProvider` supports both (D8). |
| `app/settings/notifications.tsx` | OS permission + 3 category switches | `Notifications.getPermissionsAsync/requestPermissionsAsync`, `usePushStatusStore` | "Open system settings" when denied | push-status explanation card | Switches disabled until permission granted. Prefs stored raw `'1'/'0'` in MMKV. |
| `app/settings/providers.tsx` | Provider readiness, make-default, re-probe | `harness.providers`, `harness.providers(true)`, `harness.setDefault` | header refresh IconButton, pull-to-refresh | skeleton, error | Invalidates `['harness','models']` but `useModels` uses `queryKeys.models()` — verify key equality (potential stale catalogue after default change). |
| `app/settings/capabilities.tsx` | Skills / Agents / Prompts / MCP | `system.artifacts`, `system.mcpServers`, `system.artifactContent` | Segmented; row → `Sheet` preview with Markdown | skeleton, error, per-tab empty | `EmptyState title={\`No ${tab}s installed\`}` yields "No mcps installed"/"No skills installed" style strings. |
| `app/settings/source-control.tsx` | Provider/host/credential (read-only) | `sourceControl.config`, `sourceControl.status` | pull-to-refresh | skeleton, error | — |
| `app/settings/tools.tsx` ("Permissions") | Capability matrix for this device | `checkFeature` × 6 | none | — | Static cards. |
| `app/settings/diagnostics.tsx` | Health + transport + key backing | `health` (10 s), `describeTransport`, `describeKeyBacking`, `reconnect` | Connection row → `reconnect()` | skeleton, error | Uptime via `formatDuration(uptime*1000)`. |
| `app/settings/about.tsx` | Capability honesty list | `Constants.expoConfig.version` | none | — | Static. |
| `app/settings/security.tsx` | Key backing, scopes, posture, device list, revoke, unpair | raw `authFetch('/api/auth/devices')` (only if `admin:devices`), `/api/security/posture`, `revokeDeviceRequest` (DELETE), `refreshPermissions`, `unpair`, `LocalAuthentication` | `ConfirmSheet` ×2, biometric prompt before revoke | posture spinner/error, devices gated by `deviceAdmin.reason` | **Renders a bare `ScrollView` with no title and no back button while the stack header is also disabled** (D1). Uses raw `Pressable`, `rounded-lg` cards instead of `Card`/`ListRow`, and its own `Section`/`Field`/`Divider` helpers. |

---

## 3. Module-by-module review (`src/**`)

### 3.1 Auth

| File | Review |
|---|---|
| `auth/AuthProvider.tsx` | Solid. Restore effect always clears `initializing` in `finally`. `endpoint` in context is `runtimeRef.current?.endpoint` computed inside `useMemo` keyed on `state` (comment at 279-281 justifies). `refreshPermissions` re-mints the token. `HostIdentityMismatchError` becomes a blocking error screen rather than retry. Nit: two near-identical `fetchImpl` closures (177-179, 224-227). |
| `auth/stores.ts` | Hardware → software → web fallback with `backing` reporting. `clear()` clears both paths. `loadSoftware` swallows corrupt-key errors as "not paired". Good threat-model comments. |
| `auth/deviceRequests.ts` | Pure request shape for `DELETE /api/auth/devices/:id` with `{reason}`; tested. |
| `auth/featureGate.ts` | Pure matrix of 8 features → scopes, with `grantable` flag; tested against `packages/auth` scope list. |
| `auth/scopeLabels.ts` | Human labels + `SENSITIVE_SCOPES`; unknown scopes derive a label. Tested. |
| `auth/describeTransport.ts` | Exhaustive switch over `TransportStatus` and `KeyBacking`. |
| `auth/secureItemStore(.web).ts` | Platform-split; web shim warns once and reports `IS_OS_PROTECTED=false`. |

### 3.2 Transport and stream

| File | Review |
|---|---|
| `transport/endpointPlan.ts` | Dedup by canonical origin, loopback priority −100. `buildRelayCandidates` returns `[]` — relay is not implemented on mobile despite the pairing consent screen and `relay-protocol` dependency. `hasReachableCandidate` unused. |
| `stream/expoStreamFetch.ts` | One-line adapter; isolates `expo/fetch`. |
| `stream/MuxStreamProvider.tsx` | Client rebuilt on foreground; `disposeAll()` in effect cleanup. `foreground` initial state treats `inactive` as foreground (fine). Every dependent hook re-subscribes on rebuild. |
| `stream/muxTransport.ts` | Factory + `GLOBAL_SCOPE_FILTER` + `listKeysForEvent`; tested. |
| `stream/streamStore.ts` | Thin zustand adapter over `applyStreamEffects`. `clear()` is never called from any screen — stream state for every chat visited accumulates for the process lifetime (D14). |
| `stream/useChatStream.ts` | 16 ms flush timer runs continuously while mounted even with nothing pending (cheap, but a wake-up per frame). `onStatusChange` is in the effect deps: passing an unstable callback would re-subscribe; the chat screen passes `setConnection` (stable). `gap:` reason triggers a messages refetch. Good. |
| `stream/useGlobalStream.ts` | Same tick pattern; batched invalidation. |
| `stream/useTwoPhaseStop.ts` | Binding for `StopController`; 200 ms tick only while live. **The chat screen's `onCancel: () => cancel.mutate()` drops `budgetSeconds` and `force`, and `api.chats.cancel(id)` takes no body**, so the "force" second press is indistinguishable from the first (D9). |

### 3.3 API hooks

| File | Review |
|---|---|
| `api/useApi.ts` | `createApiClient(fetch)` memoised on the auth `fetch` identity (which changes whenever `state` changes — every auth state transition rebuilds the client; acceptable). |
| `api/useActivity.ts` | `useQueries` ×4; `refetch` fires all four. `counts.attention` counts only runs (chats never `blocked`, so a chat waiting on a permission/plan gate does **not** badge the tab, D10). |
| `api/activityRanking.ts` | Pure, tested. |
| `api/useModels.ts` / `modelCatalogue.ts` | Cached 10 min. `reasoningEfforts` tolerates array or string. `useProviders` separate 5-min query. |

### 3.4 Chat components

**`components/chat/Composer.tsx` (512 lines)** — one text field row + control row (`+`, Model chip, "Plan first" chip only when mode==='plan', Options chip, context ring, morphing Send/Stop). Slash and @-mention strips are horizontal chip rows driven by `composerMenu.ts`. Voice mic shows only when draft is empty or voice active. Attachments row renders only when `attachments.length>0`, which the screen hard-codes to `[]`. The `+` button with `attachAvailable` true calls `props.onAttach ?? (() => {})` — **a dead control when the scope is granted** (D2; acknowledged by `surfaceCapabilities.test.ts`, which pins `MOBILE_CAPABILITIES.fileAttachment=false`). Uses `Alert.alert` for the not-granted explanation. Caret tracking via `onSelectionChange` with a one-shot `selection` prop for programmatic insertion. `LinearTransition` on the card.

**`composerMenu.ts`** — pure trigger detection (`/` at start, `@` after whitespace), `filterCommands`, 4-tier `filterPaths`. Tested. Slash commands only open Workbench sections; there is no `/model`, `/mode`, `/clear`, `/compact` etc.

**`BlockView.tsx`** — memoised on block identity. Renders `text` (Markdown), `thinking` (collapsible, expanded while live), `tool_call` (via `ToolRow`), `system` (subagent / error / other), `widget` ("Desktop only" placeholder). `plan`, `question`, `permission` return `null` because they are pinned cards. **Gaps vs the shared `ToolCallBlock` model (`packages/client-core/src/stream/types.ts:52-66`):** `fileOp` (+/− stats and hunks) is ignored; `parentCallId` is ignored, so subagent tool calls are not grouped under their `Agent` call; `error: true` is not styled (a failed tool looks identical to a successful one) (D5). `SystemCategory.warning` is rendered with the neutral style, not amber (D6). `StreamState.hooks` is never rendered. `ToolRow` re-renders JSON via `safeStringify` on every expand; `DiffPreview` caps at 200 lines.

**`toolPresentation.ts`** — anchored-regex classification; `label` for `str` matches "Edit file". Tested.

**`ApprovalGate.tsx`** — **dead code**: no importer outside its own file and the test of `gateActions.ts`. Uses raw `Pressable` and `expo-haptics` directly instead of `haptics.ts`. Superseded by `PlanCard`/`QuestionCard`/`PermissionCard` (D11).

**`PermissionCard.tsx`, `PlanCard.tsx`, `QuestionCard.tsx`** — pinned above the composer, `FadeInDown.springify()` entrance (no reduce-motion branch, though `Reanimated` layout animations do honour the OS switch only if configured — they are not here). PermissionCard: Deny (danger) left, Allow (primary) right, single in-flight flag. PlanCard: server-supplied `plan.actions` mapped by `toGateAction`; "Read the full plan" opens Workbench › Plan. QuestionCard: multi-question, single/multi-select, freeform counts toward completeness; `option.preview` is not rendered. `question.header` is not rendered.

**`ModelSheet.tsx`** — provider rail (brand icons), fuzzy search (`lib/fuzzyMatch.ts`), inline detail expansion, refresh. Reads `useProviders()` itself. Good empty/locked states. Uses `.map`, not virtualised (catalogues are tens of rows).

**`NewChatSheet.tsx`** — name, model, project, agent pickers as in-sheet pages; "More options" reveals description, Plan-first switch, permission mode, orchestrator switch. State is reset on close. `agents.selectable` list filtered on `enabled`. Selecting an orchestrator-role agent forces the toggle on but selecting "No agent" afterwards does not turn it back off.

**`TurnOptionsSheet.tsx`** — mode, reasoning effort (only when model supports), context tier (only `supportsLongContext`), permission mode (3 values), context usage bar, codebase count. Every change PATCHes the chat immediately (except `mode`, which is local).

**`RenameSheet.tsx`, `UsageFooter.tsx`** — fine. UsageFooter shows model/in/out/duration and expands to cache/provider/cost.

**`Workbench.tsx`** — one `Sheet` with detents `[0.28, 0.6, 0.92]`, section chips (Changes/Files/Plan/Tasks/Terminal/Browser), in-sheet detail push (diff/file) with Back. Sections without a workspace show "No workspace yet" except Plan/Tasks. Terminal/Browser gated with `LockedState`. Changes badge count from a separate `changes` query with `staleTime 15 s` while `ChangesSection` uses `[...changes, base]` keys — two queries for the same data.

**`workbench/ChangesSection.tsx` (806 lines)** — toolbar (count, +/−, expand-all, wrap, checkpoints, refresh), base picker via `CheckpointList`, `LegendList` of `FileRow` with inline `InlineDiff` (capped 400 lines, non-virtualised) and full `DiffView` (virtualised, wrap toggle). Discard = `restoreCheckpoint` for one path with two-step confirm. Unwrapped diffs render inside a fixed `width: 760` horizontal ScrollView (magic number, D13). `extraData` string concatenates every expanded key each render.

**`workbench/FilesSection.tsx`** — breadcrumb browser (`fileTree.ts`, tested), repo alias chips, search flattening (200 cap), `FileView` with line numbers, wrap toggle, Markdown render/source toggle. Read-only by design.

**`workbench/PlanSection.tsx`** — plan chips, Markdown body from `chats.planContent`, pinned Approve / Request changes (requires feedback) / Discard. Duplicates the decision mapping that `gateActions.toPlanDecision` already encodes (D12).

**`workbench/TasksSection.tsx`** — background tasks list, polls 4 s while active. Read-only.

**`workbench/BrowserSection.tsx`** — descriptor poll 5 s, JPEG frame poll 2 s via authenticated fetch → base64 data URI (`bytesToBase64` duplicated from `TerminalView`), start/stop/navigate/back/forward/reload. No touch forwarding by design. `Field` is used as the address bar. Comment "Hermes has no `btoa`" (line 292) contradicts `deviceKeyModule.ts:54` which calls `globalThis.btoa` — one of the two is wrong for the target runtime (D15).

**`workbench/TerminalSection.tsx`** — re-exports `TerminalView`.

### 3.5 Terminal

| File | Review |
|---|---|
| `terminal/bridgeProtocol.ts` | `OutputBatcher` (16 ms coalescing, `'\|'`-joined base64), `parseFromWebView` with dimension bounds and selection cap. Tested. |
| `terminal/terminalHtml.ts` | **Not xterm.js.** A `<pre>` that strips CSI/OSC sequences; comment at lines 9-12 admits "xterm.js itself must be vendored … before the terminal renders". No cursor, no colours, no line editing, no `search`/`fit`/`theme` message handling (`ToWebView` declares them, the document ignores them). Hidden `<input>` captures keystrokes; Enter/Backspace only. Palette injected as CSS vars (bg/fg only; the `terminal` xterm theme from `ThemeProvider` is unused). (D3) |
| `terminal/TerminalView.tsx` | Creates session over HTTP, replays scrollback, opens WS via `socketUrl`, ACKs every 64 KB, kills on unmount. Key bar (esc/tab/^C/^D/^Z/arrows/…). Web preview shows an `EmptyState`. Exited state says "Close and reopen to restart" — no restart button. `start(80,24)` fires on `ready` before the real resize arrives; a second `resize` is sent immediately, fine. |

### 3.6 Voice

| File | Review |
|---|---|
| `voice/pcm.ts` | Downmix → linear resample to 16 kHz; `rms`. Tested. |
| `voice/wavEncoding.ts` | Int16 WAV assembly. Tested. |
| `voice/useVoiceInput.ts` | `useAudioStream` (expo-audio 57) → `/api/stt/stream` WS; `ready/interim/segment/final/paused/resumed/error` frames; pause/resume without teardown; `cancel` guards late finals; teardown on unmount. `amplitude` is computed but the composer never renders a level meter. `setAmplitude` on every buffer causes a re-render per audio callback (~every 20-100 ms) of the whole chat screen (D16). |
| `voice/useTextToSpeech.ts` | Per-sentence WAV files appended to `useAudioPlaylist`; `speak` and `speakStream(sessionId)`; monotonic session token for barge-in; temp files deleted on stop/unmount. 30 s connection guard cleared on first audio. Good. |

### 3.7 Notifications

| File | Review |
|---|---|
| `notifications/push.ts` | `setNotificationHandler` reads prefs each time; Android channels `approval/failed/completed`; `requestPushToken(projectId)`; `routeFromNotification`. Note `existing.ios?.status === 2` magic number for PROVISIONAL. |
| `notifications/usePushNotifications.ts` | Registers on auth + foreground + token rotation; PUT `/api/auth/push-token`; 501 → server-disabled; `PUT /api/auth/push-token/mute` synced on `preferencesVersion`; tap routing through `routeGuard.safeRoute`. Cold-start route via `getLastNotificationResponseAsync`. |
| `notifications/routeGuard.ts` | Allow-list of first segments (`chats, runs, automations, projects, changes, settings`); `workflows` and `terminal` are **not** allowed, so a notification routing to `/workflows/<id>` is silently dropped (D17). Tested. |
| `notifications/notificationFilter.ts` | Category → switch mapping; `shouldMuteOnServer`. Tested. |
| `notifications/pushStatus.ts` | Zustand store + `describePushStatus`. |

### 3.8 Theme, prefs, storage, misc

| File | Review |
|---|---|
| `theme/ThemeProvider.tsx` | Reads MMKV synchronously; `Appearance.setColorScheme` feature-detected; exposes `style` (vars bag), `colors`, `terminal`. `setAccent` validates against current theme but switching theme does not re-validate the stored accent id (handled by `resolveAccentId` fallback in `bag`). |
| `theme/global.css` | Tailwind directives + web focus-ring reset. |
| `theme/tokens.generated.ts` | 14.5 K lines generated; `themeVars[theme][appearance][accent]`, `terminalThemes`, `tailwindColors`, `radius`, `fontSize`, `spacing`, `lineHeight`, `motion`. |
| `prefs/preferences.tsx` | Motion + haptics context; **no screen reads `setMotion`/`setHaptics`** (grep confirms only `accessibility.ts` consumes `motion`). |
| `storage/prefs.ts` | MMKV wrapper; `PREF_KEYS.biometricLock`, `lastRoute`, `disabledSkills` are declared and never used; `NSFaceIDUsageDescription` promises "Unlock GeneratorAI" but no app lock exists (D8). |
| `crypto/installCrypto(.web).ts` | Native installs quick-crypto; web asserts `crypto.subtle`. |
| `native/deviceKeyModule.ts` | Optional native module facade; base64 via `globalThis.btoa/atob`. No native implementation exists in this repo (no `modules/` dir), so on every current build `isSupported()` is false and keys are software (D4). |
| `lib/fuzzyMatch.ts` | Subsequence scoring; tested. |
| `navigation/scrollToTop.ts` | Module registry keyed by tab route name. |

### 3.9 UI kit (`src/components/ui`)

| File | Purpose | Notes |
|---|---|---|
| `index.ts` | Barrel; imports `./animated` first | Screens mostly import from individual files, not the barrel, so the "animated must be first" guarantee depends on `_layout.tsx:36` importing the barrel (it does). |
| `animated.ts` | `cssInterop` registration for `Animated.View/Text/ScrollView` and `AnimatedPressable` | Load-order critical. |
| `accessibility.ts` | `MAX_SCALE`, `useReduceMotion` (pref wins over system), `useScreenReader` (unused), `useFontScale`, `scaled` (unused), `announce`, `MIN_TARGET` | — |
| `haptics.ts` | 7-verb vocabulary; module flag for user preference; no-op on web | `CodeBlock.tsx` and `ApprovalGate.tsx` bypass it and call `expo-haptics` directly. |
| `motion.ts` | Timing/spring presets with `ReduceMotion.System`; `stagger` | — |
| `Touchable.tsx` | Single tap primitive: UI-thread press scale, haptic intent, `hitSlop`, Android ripple, `a11yRole` | `hitSlop` default `(MIN_TARGET-28)/2` assumes a 28 pt control regardless of actual size. |
| `Button.tsx` | `Button`, `IconButton` (compact + hitSlop), `Fab` (safe-area aware) | `Fab` shadow uses `shadowColor: 'rgba(0,0,0,0.9)'` + `shadowOpacity` (double alpha). |
| `Chip.tsx` | `Chip`, `StaticChip` (unused) | — |
| `SegmentedControl.tsx` | Springing indicator, counts, `useSegmentSwipe` | Indicator measured from inner content box. |
| `ListRow.tsx`, `primitives.tsx` | Grouped rows, `Card`, `Surface` (unused), `SectionHeader`, `Divider`, `Badge`, `StatusDot` | Good a11y (`toggle` merges switch into row). |
| `Form.tsx` | `Switch`, `Field` (labelledBy), `SearchField` | — |
| `Sheet.tsx` (481 lines) | Modal + Reanimated + gesture detents, scrim, keyboard lift, a11y modal, Android back | Re-applies theme `vars()` inside the Modal host. This is the live implementation; **`components/common/Sheet.tsx` is an older Modal+ScrollView version with zero importers** (D11). `common/States.tsx` is an 11-line re-export shim used by `app/index.tsx`, `app/pair.tsx`, `app/changes/[workspaceId]/file.tsx`. |
| `ActionSheet.tsx` | Menu + `ConfirmSheet` built on `Sheet` with `fitContent` | Keys actions by `label`. |
| `SwipeableRow.tsx` | Trailing actions, arm-at-50% full swipe, module-level single-open, a11y custom actions | `rowStyle` disabled under reduce-motion, which also disables the reveal entirely (actions become reachable only via a11y actions or long-press). |
| `Skeleton.tsx` | One shared pulse clock via `makeMutable`; `SkeletonCard` unused | — |
| `States.tsx` | `Spinner`, `LoadingState`, `EmptyState`, `ErrorState` (assertive), `LockedState` | — |
| `Toast.tsx` | Top-anchored single toast with optional action; announces | Only one toast at a time; a second replaces the first. |
| `Screen.tsx` | Collapsing large title on UI thread, `goBack` fallback, pull-to-refresh, `PlainScroll` | Top inset applied manually (`paddingTop: insets.top`). |
| `ProgressRing.tsx` | SVG arc animated with `useAnimatedProps`; `ProgressBar` | Thresholds match web. |
| `SettingsButton.tsx` | Header settings IconButton | — |

### 3.10 Markdown, diff, runs, brand

- `markdown/Markdown.tsx` — `marked.lexer` → RN; headings, paragraphs, code, lists (task boxes), blockquote, table (h-scroll), hr, inline strong/em/del/code/link/br. Headings render `t.text` (inline formatting inside headings lost). No image support (falls to raw text). Links open via `Linking.openURL` without scheme validation (`javascript:` is harmless in RN but `file:`/custom schemes are not vetted) (D18).
- `markdown/CodeBlock.tsx` — copy button with success haptic; no syntax highlighting (documented as deliberate).
- `diff/DiffRowView.tsx` — two-gutter unified row, `onTouchEnd` used as press handler (not `Pressable`), unused in practice (`onPress` never passed).
- `runs/formatTime.ts`, `runs/statusStyle.ts` — pure, tested. `runs/RunStatusPill.tsx` — **unused** (grep: zero importers).
- `brand/VendorIcons.tsx` — SVG marks; `vendorForModel` heuristic.

---

## 4. Consolidated defect list (ranked)

Severity: **P0** breaks a flow · **P1** visibly wrong / feature claimed but absent · **P2** smell / consistency · **P3** nit.

| # | Sev | Location | Finding |
|---|---|---|---|
| D1 | P0 | `app/settings/security.tsx:171-377` + `app/_layout.tsx:263` | Security screen renders a bare `ScrollView` — no `<Screen title back>` — while the stack registers it `headerShown:false`. Result: no title, no back button; the only way out is the OS gesture/hardware back. Content also ignores `insets.top` (`py-6` only). |
| D2 | P1 | `src/components/chat/Composer.tsx:361-370`, `app/chats/[id].tsx:775-778` | Attachment button is a dead control whenever `write:files` is granted: `onAttach` is never passed, `attachments={[]}`, no picker dependency. Pinned as "unsupported" by `surfaceCapabilities.test.ts` and `MOBILE_CAPABILITIES`. |
| D3 | P1 | `src/terminal/terminalHtml.ts:9-21,93-100` | Terminal renderer is an ANSI-stripping `<pre>`, not xterm.js: no cursor, colours, line editing, arrow-key echo, search, fit or theme messages. Ledger `MOBILE_CAPABILITIES.terminalRendering: a(true)` cites "xterm in a WebView" (`packages/shared/src/transport/TransportCapabilities.ts:298`) — overstated. |
| D4 | P1 | `src/native/deviceKeyModule.ts:49` | `requireOptionalNativeModule('GeneratorAIDeviceKey')` — no native module source exists in the repo, so every build falls back to the extractable software key; the Security screen will always show "Software" unless a module is added. |
| D5 | P1 | `src/components/chat/BlockView.tsx:199-250` | `ToolCallBlock.error`, `fileOp` (+/− counts, hunks) and `parentCallId` are ignored: failed tools look successful, edit tools show no line stats, subagent tool calls are not nested/grouped under the `Agent` call. Web renders all three. |
| D6 | P1 | `src/components/chat/BlockView.tsx:341-357` | `SystemCategory 'warning'` (MCP failures etc.) renders with the neutral system style; only `error` is tinted. |
| D7 | P1 | `app/chats/[id].tsx:100` | `mode` starts at `'auto'` and is never seeded from `chat.data.defaultAgentMode`; a chat created with "Plan before acting" in `NewChatSheet` sends its first message in `auto` from the chat screen. Mode changes are also never persisted. |
| D8 | P1 | `src/prefs/preferences.tsx`, `src/storage/prefs.ts:35`, `app.config.ts:47` | Motion and haptics preferences have no UI; `PREF_KEYS.biometricLock/lastRoute/disabledSkills` unused; `NSFaceIDUsageDescription` promises "Unlock GeneratorAI" but no app-lock exists (Face ID is only used for device revoke). |
| D9 | P1 | `app/chats/[id].tsx:257-260`, `packages/client-core/src/api/client.ts:913` | `useTwoPhaseStop` supplies `{budgetSeconds, force}` but `onCancel` discards them and `chats.cancel(id)` has no body. The "force" phase is cosmetic on mobile. |
| D10 | P1 | `src/api/useActivity.ts:70-86` | Chats are never `blocked`, so a chat waiting on a permission/plan/question gate does not count toward the Activity badge or "Needs you" filter — the main reason to open the app on a phone. |
| D11 | P2 | `src/components/common/Sheet.tsx`, `src/components/chat/ApprovalGate.tsx`, `src/components/runs/RunStatusPill.tsx` | Dead files with zero importers (ApprovalGate only referenced from its own test via `gateActions`). `common/States.tsx` is a live shim (3 importers) that should be migrated to `ui/States`. |
| D12 | P2 | `src/components/chat/workbench/PlanSection.tsx:63-70` vs `gateActions.toPlanDecision` | Two independent encodings of the plan decision body; PlanSection hard-codes three outcomes while PlanCard uses server-supplied `plan.actions`. |
| D13 | P2 | `ChangesSection.tsx:785,799`, `FilesSection.tsx:322` | Unwrapped code panes use a magic `width: 760`; long lines beyond that are clipped (`numberOfLines={1}`), not scrollable. |
| D14 | P2 | `src/stream/streamStore.ts:45` | `clear(key)` is never called; stream state for every chat visited persists for the session. |
| D15 | P2 | `BrowserSection.tsx:292`, `TerminalView.tsx:343` vs `deviceKeyModule.ts:54` | Duplicate `bytesToBase64` with a comment claiming Hermes lacks `btoa`, while `deviceKeyModule` relies on `globalThis.btoa`. One assumption is wrong; either dedupe into a util or fix the module. |
| D16 | P2 | `src/voice/useVoiceInput.ts:108` | `setAmplitude` on every audio buffer re-renders the chat screen at buffer rate; `amplitude` is never displayed. |
| D17 | P2 | `src/notifications/routeGuard.ts:16-23` | Allow-list omits `workflows` and `terminal`; a server push with `route: '/workflows/<id>'` is dropped. |
| D18 | P2 | `src/components/markdown/Markdown.tsx:163` | `Linking.openURL(t.href)` on any link in agent output without scheme allow-listing; images are not rendered at all. |
| D19 | P2 | `app/runs/[id].tsx:76-80` | `pendingInterrupts` polls every 5 s forever, including after the run is terminal (the `run` query stops). |
| D20 | P2 | `app/changes/[workspaceId]/index.tsx:22-27` vs `ChangesSection.tsx:52-57` | `modified` is `text-info` on the standalone screen and `text-warning` in the Workbench; the two Changes surfaces also differ in layout, wrap support and discard. |
| D21 | P2 | `package.json` | Unused deps: `@shopify/react-native-skia`, `@gorhom/portal`, `expo-background-task`, `expo-task-manager`, `expo-sharing`, `expo-network`, `expo-linking`, `expo-system-ui`, `react-native-qrcode-svg`, `semver`; `@gorhom/bottom-sheet` only for a dead provider (`_layout.tsx:282`). |
| D22 | P2 | `app/pair.tsx`, `app/revoked.tsx`, `app/settings/security.tsx`, `CodeBlock.tsx`, `ApprovalGate.tsx` | Raw `Pressable` and `rounded-lg` styling outside the design system; pairing screen has no safe-area handling and no `Screen` scaffold. |
| D23 | P2 | `src/components/chat/PermissionCard.tsx:50`, `PlanCard.tsx:44`, `QuestionCard.tsx:69`, `app/runs/[id].tsx:289` | `FadeInDown.springify()` entrances with no `useReduceMotion` branch (other components do branch). |
| D24 | P2 | `app/chats/[id].tsx:762-766` | Effort/context-tier/permission-mode PATCH the chat immediately with no optimistic UI; the sheet row highlights only after refetch. `modelOverride` local state can diverge from server if PATCH fails (toast only). |
| D25 | P3 | `app/pair.tsx:38` | `useState(Device.nativeApplicationVersion ? 'My phone' : 'My phone')` — pointless ternary; `expo-application` imported as `Device`. |
| D26 | P3 | `app/settings/index.tsx:35,37` | Duplicate import of `../../src/components/ui/primitives`. |
| D27 | P3 | `app/settings/capabilities.tsx:112` | `No ${tab}s installed` produces "No mcps installed"-style copy (unreachable for mcp but "No skills installed"/"No agents installed"/"No prompts installed" are fine; template still fragile). |
| D28 | P3 | `app/workflows/[id].tsx:59` | Query key `['workflows', id]` bypasses `queryKeys` and collides with the shape of the workflow list key prefix. |
| D29 | P3 | `src/components/chat/QuestionCard.tsx` | `question.header` and `option.preview` from `QuestionBlock` are not rendered. |
| D30 | P3 | `src/components/chat/NewChatSheet.tsx:206` | Choosing an orchestrator agent forces `orchestrator=true`; choosing "No agent" afterwards leaves it on. |
| D31 | P3 | `src/terminal/TerminalView.tsx:278-284` | "Close and reopen to restart" — no restart affordance after exit. |
| D32 | P3 | `src/components/ui/Button.tsx:199-200` | `Fab` shadow: `shadowColor: 'rgba(0,0,0,0.9)'` combined with `shadowOpacity: 0.28`. |
| D33 | P3 | Global | No tablet or landscape layouts anywhere (`supportsTablet: true`, `orientation: 'default'`): every screen is a single column; the chat `KeyboardAvoidingView` offset is measured but the Workbench detents are fractions of screen height, so landscape gives a 28 % peek of ~100 pt. |

---

## 5. What the mobile app CAN do today

**Pairing / auth**
- Scan a QR pairing code (`expo-camera`) or paste a `generatorai://pair?…` link; review server name, address, fingerprint and requested scopes; name the device; enrol via `client-runtime` with a DPoP key (software-backed in practice).
- Restore a session on cold start, verify host identity, block on host-identity mismatch, show a retry/re-pair error screen, unpair, handle revocation.
- Re-mint the access token to pick up newly granted scopes (Settings › Security).

**Transport / live data**
- Direct loopback/LAN connections with candidate ordering; relay is not implemented.
- One multiplexed stream (chat scope + global scope) with resume, reconnect banner in chat, and live invalidation of Chats/Runs/Workflows/Automations lists.

**Activity tab** — urgency-ranked feed of chats/runs/automations, stat rail (Needs you / Running / Chats / Runs / server health), Today/Running/Needs-you filter with swipe, tab badge for blocked runs, pull-to-refresh, FAB to new chat.

**Chats tab** — search, Active/Archived, swipe archive/delete with undo toast, long-press menu (rename/archive/restore/delete), new-chat sheet (name, model grouped by provider, project, agent, description, plan-first, permission mode, orchestrator mode), live "Running" dot.

**Chat screen**
- Transcript: history (paginated 120, "Load earlier"), optimistic user bubble, live blocks: text (Markdown), thinking (collapsible), tool calls (humanised label, summary, args/result, diff-tinted results), system/subagent/error notes, widget placeholder, usage footer, "Working…/Thinking…/Writing…/Responding…" activity row, "Latest" jump pill, keyboard-interactive dismiss.
- Gates pinned above the composer: tool permission (Allow/Deny), agent questions (single/multi/freeform), plan review (server-supplied actions, open full plan).
- Composer: model picker (provider rail, fuzzy search, details), turn options (mode, reasoning effort, context tier, permission mode, context usage bar, codebase count), plan-first chip, context ring, slash commands (`/changes /files /plan /tasks /terminal /browser`), `@` file mentions from the workspace tree, two-phase Stop (label only), draft restore on send failure.
- Voice: live dictation to the server STT WebSocket with interim text, insert-at-caret, pause-on-touch, resume; TTS read-aloud of a finished message and live speak-as-generated for the current turn.
- Message long-press: copy, share sheet, read aloud.
- Workbench sheet (3 detents): Changes (per-file expand, full diff, wrap, base checkpoint picker, discard file via checkpoint restore, checkpoints list), Files (breadcrumb browser, search, viewer with line numbers, Markdown preview), Plan (revisions, Markdown, approve/request changes/discard), Tasks (background task list), Terminal (if `exec:terminal`), Browser (if `exec:browser`: view-only screencast, address bar, start/stop/back/forward/reload).

**Work tab** — runs (urgency-sorted, live poll while active), workflows (stage list with dependencies, run history), automations (trigger, enabled, executions with polling). Run detail: stage timeline, HITL gate (Approve / Request changes / Reject with haptics), links to Changes and Terminal.

**Projects** — list and detail with codebases and sync state (read-only).

**Changes screens** — standalone workspace change list and virtualised single-file diff.

**Terminal** — session create/attach/kill, scrollback replay, ACK flow control, key bar; rendering is plain text only.

**Notifications** — push registration with status explanation, Android channels, per-category foreground filter, server-side mute for non-approval categories, safe deep-link routing including cold start.

**Settings** — appearance (system/light/dark, every design-token theme with live preview, accent), notifications, model providers (readiness, re-probe, make default), capabilities (skills/agents/prompts/MCP with Markdown preview), source control (read-only), permissions matrix, diagnostics (health, transport, key backing, reconnect), about, security (scopes, missing capabilities, server posture, device list + revoke with biometrics, unpair).

**Deliberately absent (documented in `about.tsx`)** — widgets, workflow editing, automation authoring, run start/pause/cancel, file editing, commits/PRs, browser touch forwarding, codebase linking.

---

## 6. Design language, consistency and UX gaps

**Strengths**
- A coherent, well-reasoned design system in `src/components/ui`: one `Touchable` primitive (UI-thread press scale, haptic vocabulary, platform hit target, Android ripple), a fixed elevation ladder (`background → card → raised → overlay`), tone tokens that stay semantic regardless of accent, `MAX_SCALE` caps and `min-h-*` sizing for Dynamic Type, reduce-motion honoured at both the worklet and component level, `accessibilityRole`/`LiveRegion`/`announce` used consistently, sentence-case section headers.
- Native-feeling chrome: collapsing large titles on the UI thread, haptic tab changes, re-tap to scroll-to-top, swipe actions with arming haptic, detented sheets that drag by header, top-anchored toasts with undo, iOS inset-grouped lists.
- Every list has skeleton / error-with-retry / contextual empty states; gated features show `LockedState`/`FeatureLocked` with the reason instead of a 403.
- Streaming performance considerations are explicit: frame-coalesced flushes, block-identity memoisation, `freezeOnBlur`, `recycleItems`.

**Inconsistencies**
- Two visual generations coexist. `pair.tsx`, `revoked.tsx` and `settings/security.tsx` use raw `Pressable`, `rounded-lg`, `bg-primary-emphasis`, hand-rolled `Section/Field/Divider` and no `Screen` scaffold; everything else uses `Card`/`ListRow`/`Button`/`rounded-3xl`. Security is the most important settings screen and is the least polished (and lacks a header).
- Three ways to confirm/notify: `Alert.alert` (runs, security, composer attach), `ConfirmSheet`, toasts. The composer's "attachments are off" explanation is an OS alert while every other explanation is inline copy.
- Two Changes surfaces (`app/changes/*` and Workbench › Changes) with different status colours, different diff renderers (`DiffRowView` two-gutter vs `DiffLines` single-gutter), wrap toggle only in one.
- Two Sheet implementations, two base64 encoders, two plan-decision encoders, two `formatDuration` functions (`runs/formatTime.ts` returns `'0s'` for bad input; `chat/toolPresentation.ts` returns `null`).
- `haptics.ts` vocabulary bypassed in `CodeBlock.tsx` and `ApprovalGate.tsx`.
- Pull-to-refresh is `RefreshControl` in some screens and `LegendList refreshing/onRefresh` in others; the `Screen` scaffold's `onRefresh` is used only by settings screens.

**UX gaps**
- Chat: no edit/retry of a user message, no regenerate, no per-message timestamps, no scroll-to-message from a notification, no checkpoint/rewind affordance in the transcript (only in Workbench › Changes), no inline plan chip in the transcript (plan block returns `null`), no display of hook invocations, no image rendering in Markdown, no attachment support, no "compact context" action, no way to change `mode` persistently.
- Activity: chats blocked on a gate are not counted (D10), so the headline badge misses the most phone-relevant event.
- Terminal: text-only renderer with no cursor makes interactive programs unusable; no restart after exit.
- Settings: motion/haptics preferences exist in code but have no toggle; no "local only" toggle for `PREF_KEYS.localOnly` even though `AuthProvider` reads it.
- Tablet/landscape: none. `supportsTablet: true` ships a stretched phone layout.
- Onboarding: after pairing the user lands on Activity with no hint about notifications permission until they open Settings.
- Copy: mostly excellent and honest, but a few template strings (`No ${tab}s installed`) and mixed capitalisation of "Needs you" vs "Needs attention".

---

## 7. Tests, typecheck and test run

### 7.1 Test inventory (`src/__tests__`, vitest, node environment, 20 files / 211 tests)

| File | Covers |
|---|---|
| `activity.test.ts` | `rankOperations`, `filterOperations` (24 h window), `levelEntries`, `crumbsFor` |
| `androidManifestCleartext.test.ts` | manifest transform sets `usesCleartextTraffic`, throws without `<application>` |
| `approvalGate.test.ts` | `toGateAction` tone classification and humanised labels |
| `cleartextEndpointPolicy.test.ts` | `PairingEndpointSchema` allows http only on loopback/RFC1918/.local |
| `composerMenu.test.ts` | slash/mention detection, `applyMenuSelection`, `filterCommands`, `filterPaths` ranking |
| `deviceRequests.test.ts` | `revokeDeviceRequest` path/method/body/escaping |
| `endpointPlan.test.ts` | candidate ordering, dedup, loopback priority, local-only, adapter creation |
| `featureGate.test.ts` | default-scope matrix, reasons, grantability, integrity vs server scope list |
| `fuzzyMatch.test.ts` | typo/subsequence matching and ranking |
| `models.test.ts` | `reasoningEfforts` array/string, `promptLimit`, `findModel`, `groupModels` |
| `muxTransport.test.ts` | one connection for two scopes, ticket attach URL, per-scope delivery, `listKeysForEvent`, dedup |
| `notificationFilter.test.ts` | category mapping, `shouldPresent`, defaults, `shouldMuteOnServer` |
| `pcm.test.ts` | downmix, resample, `toMono16k`, `rms` |
| `routeGuard.test.ts` | accepted routes and rejected escapes |
| `runStatus.test.ts` | `relativeTime`, `formatDuration`, `runElapsed`, status classification and styles |
| `scopeLabels.test.ts` | every server scope labelled, sensitive set matches non-default scopes |
| `surfaceCapabilities.test.ts` | source-text probe: `onAttach` not wired ⇔ `MOBILE_CAPABILITIES.fileAttachment=false`, `attachments={[]}` |
| `terminalBridge.test.ts` | `OutputBatcher`, `splitBatch`, `parseFromWebView` validation |
| `toolPresentation.test.ts` | `toolKind/toolLabel`, `toolSummary`, `looksLikeDiff`, `formatDuration` |
| `ttsWavEncoding.test.ts` | Int16 conversion, WAV header, assembly |

No screen, hook or component is tested (documented choice in `vitest.config.ts`). Untested areas of note: `useChatStream` flush/dedup, `AuthProvider` restore paths, `Sheet` detent maths, `SwipeableRow`, `Markdown` token mapping, `useTextToSpeech`/`useVoiceInput` state machines, `terminalHtml` script.

### 7.2 `pnpm --filter @generatorai/mobile typecheck`

```
> @generatorai/mobile@0.1.0 typecheck C:\Users\sidmishra\Desktop\New folder (2)\GeneratorAI\apps\mobile
> tsc --noEmit

TYPECHECK EXIT 0
```

Clean, no diagnostics.

### 7.3 `pnpm --filter @generatorai/mobile test`

```
> @generatorai/mobile@0.1.0 test C:\Users\sidmishra\Desktop\New folder (2)\GeneratorAI\apps\mobile
> vitest run

 RUN  v3.2.7 C:/Users/sidmishra/Desktop/New folder (2)/GeneratorAI/apps/mobile

 ✓ src/__tests__/pcm.test.ts (16 tests) 14ms
 ✓ src/__tests__/models.test.ts (15 tests) 11ms
 ✓ src/__tests__/approvalGate.test.ts (15 tests) 9ms
 ✓ src/__tests__/terminalBridge.test.ts (13 tests) 24ms
 ✓ src/__tests__/composerMenu.test.ts (18 tests) 13ms
 ✓ src/__tests__/toolPresentation.test.ts (17 tests) 16ms
 ✓ src/__tests__/activity.test.ts (13 tests) 29ms
 ✓ src/__tests__/routeGuard.test.ts (16 tests) 8ms
 ✓ src/__tests__/fuzzyMatch.test.ts (8 tests) 10ms
 ✓ src/__tests__/ttsWavEncoding.test.ts (8 tests) 9ms
 ✓ src/__tests__/androidManifestCleartext.test.ts (2 tests) 9ms
 ✓ src/__tests__/notificationFilter.test.ts (7 tests) 8ms
 ✓ src/__tests__/deviceRequests.test.ts (3 tests) 6ms
 ✓ src/__tests__/endpointPlan.test.ts (11 tests) 14ms
 ✓ src/__tests__/cleartextEndpointPolicy.test.ts (3 tests) 11ms
 ✓ src/__tests__/muxTransport.test.ts (6 tests) 24ms
 ✓ src/__tests__/runStatus.test.ts (16 tests) 44ms
 ✓ src/__tests__/surfaceCapabilities.test.ts (3 tests) 5ms
 ✓ src/__tests__/scopeLabels.test.ts (7 tests) 12ms
 ✓ src/__tests__/featureGate.test.ts (14 tests) 12ms

 Test Files  20 passed (20)
      Tests  211 passed (211)
   Start at  22:59:38
   Duration  13.57s (transform 33.27s, setup 0ms, collect 68.49s, tests 288ms, environment 8ms, prepare 11.00s)

TEST EXIT 0
```

---

## Appendix A — Shared-package surface used by mobile

| Package | Symbols used |
|---|---|
| `@generatorai/client-core` | `createApiClient`, `ApiError`, `queryKeys`, `epochOr`, `toEpochMs`, `isArchived`, `messageToolCalls`, `parseUnifiedDiff`, `toDiffList`, `MuxStreamClient`, `StreamEventRouter`, `applyStreamEffects`, `streamReducer.clearStream`, `DEFAULT_STREAM`, `StopController`, types (`ChatSummary`, `ChatMessage`, `StreamBlock`, `StreamUsage`, `PlanSummary`, `WorkflowRunSummary`, `StageRunSummary`, `AutomationSummary`, `ProjectSummary`, `CodebaseSummary`, `ModelInfo`, `ProviderStatus`, `ProvidersResponse`, `SystemArtifact`, `BackgroundTaskSummary`, `ChangeFileEntry`, `DiffListItem`, `TerminalDescriptor`, `HealthSnapshot`, `AgentMode`, `AgentSummary`) |
| `@generatorai/client-runtime` | `AuthenticatedClientRuntime`, `parsePairingCode`, `PairingCodeError`, `PairingConsent`, `AuthState`, `DeviceKeyStore`, `SessionStore`, `StoredSession`, `generateDeviceKeyPair`, `deviceKeyFromCryptoKeyPair`, `jwkThumbprint`, `PublicJwk` |
| `@generatorai/client-transport` | `EndpointSupervisor`, `HostIdentityMismatchError`, `DirectTransport`, `TransportStatus`, `TransportCandidate` |
| `@generatorai/shared` | `isPairingCode`, `CaretInsertionSequencer`, `MOBILE_CAPABILITIES` |
| `@generatorai/relay-protocol` | `PairingEndpointSchema` (tests only; runtime relay path unimplemented) |
| `@generatorai/design-tokens` | theme registry (`THEMES`, `MODES`, `getThemeDef`, `themesByGroup`, `resolveAccentId`, `resolveAppearanceTokens`, `resolveAccentTokens`, storage keys) |

## Appendix B — Server endpoints touched directly (outside `createApiClient`)

`/api/auth/server-info` (raw fetch), `/api/auth/devices` (GET, DELETE `:id`), `/api/security/posture`, `/api/auth/push-token` (PUT), `/api/auth/push-token/mute` (PUT), `/api/workspaces/:id/browser/{descriptor,start,stop,actions,screencast.jpg}`, `/api/workspaces/:id/terminals/:tid/{scrollback,stream}`, `/api/stt/stream` (WS), `/api/tts/stream` (WS).
