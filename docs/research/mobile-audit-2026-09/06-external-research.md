# External research: mobile agentic-coding client on Expo SDK 57 / RN 0.86

Compiled 2026-09-06 from public web sources. Every claim carries a URL; where a source was vague or
contradicted another, that is noted. Organized in the four requested areas plus a closing
"Recommended stack & patterns" section. Recommendation legend: **ADOPT** / **CONSIDER** / **AVOID**.

Baseline facts about the target platform (so the rest of the doc is grounded):

- Expo SDK 57 = React Native 0.86, React 19.2 unchanged, positioned as a non-breaking "small" release on top of SDK 56. Library bumps: react-native-reanimated 4.3 -> 4.5, react-native-worklets 0.8 -> 0.10, react-native-gesture-handler 2.31 -> 2.32. `expo prebuild` now cleans native dirs by default. https://expo.dev/changelog/sdk-57
- Two SDK 57 regressions were fixed in patch releases: the Hermes V1 memory regression with worklets/Reanimated (fixed `expo@57.0.9`) and a dev-startup regression (fixed `expo@57.0.17`, which also moves to RN 0.86.3). Pin >= 57.0.17. https://expo.dev/changelog/sdk-57 and https://nativekitstudio.com/blog/expo-sdk-57-whats-new-upgrade-guide
- SDK 56 (the base you inherit) set: Hermes V1 default, Expo Router forked away from react-navigation (codemod `npx expo-codemod sdk-56-expo-router-react-navigation-replace`), Expo UI production-ready (SwiftUI / Compose), `useAudioStream` hook in expo-audio for real-time mic PCM, expo-widgets stable, iOS minimum 16.4, Xcode 26.4. https://expo.dev/changelog/sdk-56
- RN 0.86 itself: View Transitions module groundwork, DevTools light/dark emulation, C++ NativeAnimatedNodesManager now processes scroll-driven animation synchronously (removes 1-frame latency), Android fixes for IME height and edge-to-edge layout. https://github.com/react/react-native/releases/tag/v0.86.0
- Reanimated 4 is New-Architecture-only and requires the `react-native-worklets` package + `react-native-worklets/plugin` in babel. https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/
- Google Play requires targetSdk 36 (Android 16) by 2026-08-31 and Android 16 removes the edge-to-edge opt-out entirely. https://developer.android.com/about/versions/16/behavior-changes-16 and https://dev.to/dainyjose/google-play-requires-android-16-api-level-36-by-august-31-2026-react-native-migration-guide-1d51

---

## 1. How the leading mobile agentic-coding apps design these surfaces (2025-2026)

### 1.1 Claude app (Code tab: cloud sessions + Remote Control + Dispatch)

Sources: https://code.claude.com/docs/en/mobile , https://code.claude.com/docs/en/remote-control , https://code.claude.com/docs/en/claude-code-on-the-web

Observed patterns:

- **No separate app.** Claude Code lives in a **Code tab** inside the general Claude app. Three backends share one UI: cloud sessions (Anthropic VM), Remote Control (session on the user's own machine), Dispatch (desktop app). The docs say "The app is the same for all three; they differ in where the work happens." That is exactly the LAN/relay split you have: one session UI, a transport badge.
- **Pairing = QR from the terminal.** `claude remote-control` prints a session URL; pressing spacebar toggles a QR code; scanning opens the session directly in the app. Also `/mobile`, `/ios`, `/android` print an app-download QR. Session list shows Remote Control sessions with "a computer icon with a green status dot when online."
- **Device cards (Aug 2026).** Any machine running `claude remote-control` shows up as a device card in the Code tab; tap it, pick a directory, and a new session starts on that machine from the phone. https://explainx.ai/blog/claude-code-mobile-remote-control-phone-guide-2026
- **Streaming timeline / tool calls.** Third-party hands-on: "In the Code tab, tool calls render as collapsible cards, and a diff stats indicator appears when files change." https://blakecrosley.com/blog/claude-code-desktop-remote-control-guide . The web/session view shows a `+42 -18` diff indicator that opens a diff view with inline line comments that get sent as the next message. Per-file diffs are computed from raw git blobs as Claude edits.
- **Subagents and workflows sync.** "the conversation and the progress of subagents and dynamic workflows stay in sync across all connected devices."
- **Approvals / questions.** Permission prompts and `AskUserQuestion` prompts are held open indefinitely until answered; *other* forwarded dialogs auto-expire after 5 min (`dialogExpiry`). When the link drops, the CLI "queues messages, permission prompts, and status updates from subagents and workflows, and delivers them once the connection recovers." Terminal shows an "Approve tool calls from your phone" nudge after several prompts, and a "Still working - Check in from your phone" nudge on long turns.
- **Permission modes exposed on mobile are a subset**: cloud sessions get Accept edits / Plan / Auto; Remote Control gets Manual / Accept edits / Plan; Bypass is never selectable from the phone. Users are still asking for a mode selector in the mobile chat UI (issue #29319) and there are several open bugs about permission prompts not rendering or not unblocking the host (#35637, #52084, #59855). https://github.com/anthropics/claude-code/issues/29319
- **Slash commands on mobile** are limited to text-output ones (`/compact`, `/context`, `/usage`, `/recap`, `/mcp` returns text status, `/config key=value`); picker-style commands are "local-only."
- **Attachments**: photos go straight to the model and are also saved under `~/.claude/uploads/`; other files are downloaded and passed as `@` references.
- **Push notifications**: only two toggles in `/config`: "Push when Claude decides" and "Push when actions required". Notifications are suppressed while the user is typing in the connected terminal (and optionally via `CLAUDE_CLIENT_PRESENCE_FILE`). Prompt-driven pushes ("notify me when the tests finish") are supported. iOS Focus/summaries are the usual failure mode.
- **Security**: transcript stored server-side to sync devices; trusted-device enrollment per phone/browser with revocation list.
- **Voice**: the general app has a full two-way voice mode (waveform button) and a dictation mic next to the composer; push-to-talk mode; 18 languages. https://www.engadget.com/2231293/how-to-use-claude-voice-mode/ and https://workingnotworking.com/claude-voice-mode-2026-ai-voice-conversations/

Takeaways for your app: QR + device-card pairing, a single session UI with transport badge, collapsible tool cards with a diff-stats chip, held-open approvals with expiry for non-critical dialogs, two-toggle notification model, subset permission modes on mobile, reconnect queueing.

### 1.2 ChatGPT app (Codex mobile, launched 2026-05-14)

Sources: https://www.testingcatalog.com/openai-brings-codex-to-chatgpt-mobile-app-for-ios-and-android/ , https://www.verdent.ai/guides/codex-in-chatgpt-mobile , https://www.macrumors.com/2026/05/15/openai-brings-codex-chatgpt-mobile-app/ , https://thenewstack.io/openai-codex-chatgpt-mobile/

- **Phone is a control surface; host is compute.** "Files, credentials, permissions, and local setup remain on the machine where Codex is operating." Mac only at launch; Windows "coming soon."
- **Pairing**: Codex Mac app has a "Codex mobile" section that shows a QR; scan from the ChatGPT app. On connect the phone "loads the live state from that environment, including active threads, approvals, plugins, and project context."
- **Surfaces**: thread list with running status; per-thread approve/reject at decision points ("a command it wants to run, a file change it's considering, a next step that requires confirmation"); terminal output, screenshots, diffs, test results all surfaced read-only; model switch; start new task; add context.
- Available on every plan including Free, i.e. the mobile client is treated as table stakes, not a premium tier.

Takeaways: load "live state" (threads + pending approvals) on connect as a single snapshot; approvals as first-class list, not buried in the timeline; read-only artifact viewers (screenshot, terminal, diff, test output).

### 1.3 GitHub Mobile (Copilot coding agent / cloud agent)

Sources: https://github.blog/changelog/2025-09-24-start-and-track-copilot-coding-agent-tasks-in-github-mobile/ , https://github.blog/changelog/2026-07-17-github-mobile-fix-pull-request-comments-with-copilot-cloud-agent/ , https://github.blog/changelog/2025-07-08-copilot-code-review-now-generally-available-on-github-mobile/ , https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/assign-copilot-to-an-issue

- **Task-first, not chat-first.** "+" button on Home or Repository -> pick repo -> enter prompt -> Copilot opens a draft PR and works in the background -> tags you for review. An **Agents** section under "My Work" lists all agent tasks.
- **PR is the unit of review.** Diff review happens in GitHub Mobile's existing PR review UI; "Fix with Copilot" appears on the PR main view and on individual review comments (one tap, no prompt composing).
- **Push notification** when the draft PR is ready.
- Assigning an issue to Copilot from the Assignees editor is the second entry point.

Takeaways: a "background tasks" list with status is a distinct surface from chat; one-tap "fix this comment" actions; the PR/diff is the artifact of record.

### 1.4 Cursor (web/PWA since 2025, native iOS public beta 2026-06-29)

Sources: https://cursor.com/blog/ios-mobile-app , https://cursor.com/mobile , https://cursor.com/changelog/ios-mobile-app , https://cursor.com/blog/agent-web , https://www.techrepublic.com/article/news-spacex-cursor-ai-coding-agents-iphone/

- **Agent list with live status**, each cloud agent in its own VM; launch from phone by choosing a repo, model, prompt; voice input; slash commands.
- **Live Activities on the lock screen + Dynamic Island**, tracking "up to eight simultaneous agents"; push when an agent "finishes, needs input, or is ready for review."
- **Review**: agents return "demos, screenshots, and logs"; diffs are inspectable in-app; PR card shows `+2 -21`, check status ("All Required Checks Passed") and a **Squash & Merge** button.
- **Remote Control of desktop agents** with an optional "keep your computer awake while connected" setting.
- **Markup tool** to annotate images and pin comments to a location; screenshot annotation as context.
- Public beta on paid plans only; Android "planned."

Takeaways: Live Activities are now an expected feature for agent runs; the PR/merge card with checks state; keep-awake toggle for the host machine; image markup for visual context.

### 1.5 Devin (Cognition)

Sources: https://cognition.com/blog/introducing-devin-2-2 , https://cognition.com/blog/devin-review , https://vibecoding.app/blog/devin-review

- **No native iOS/Android app.** Mobile access is the responsive web app plus Slack. Devin 2.2 rebuilt "every screen ... each step of the dev lifecycle should always be one click away. Start sessions from anywhere, review output in Devin, then jump back from code review."
- **Devin Review** is inline in the session page: issues bucketed **red (probable bug) / yellow (warning) / gray (FYI)**; reviewing via GitHub Mobile also works and Devin responds to review comments while the session is alive.
- After a PR, Devin offers to test on its own desktop and returns **screen recordings** for review.

Takeaways: severity-coded review findings as a compact list is a good phone-sized review surface; recordings/screenshots as evidence beat raw logs on a phone.

### 1.6 Replit mobile

Sources: https://replit.com/blog/try-agent , https://blog.replit.com/2025-replit-in-review , https://x.com/zhenthebuilder/status/2079976695604629859

- Agent-first ("Chat with Agent as if texting a friend"), full rebuild "for speed," redesigned in 2026 to be "10x more delightful to use agents from the phone." Live progress while it "writes, deploys, and hosts your app in real time," preview-centric rather than diff-centric. Public sources give no detail on tool-call rendering.

Takeaways: for non-expert flows, a preview/artifact tab matters more than diffs; keep the chat composer as the primary control.

### 1.7 Jules (Google) and third-party clients

Sources: https://jules.google/ , https://developers.google.com/jules/api , https://apps.apple.com/us/app/pievra-jules-stitch-ai/id6758630855 , https://github.com/linkalls/jules-mobile-client

- **No official mobile app** (GA at I/O 2026-05-19, web only). The API spawned third-party clients: **Pievra** (iOS/Android/Mac) exposes exactly the surfaces that matter: "Launch sessions with a prompt, choose source and branch ... approve proposed plans before implementation ... track live timeline activity, status changes, and failure reasons ... monitor GitHub pull requests ... send follow-up instructions ... voice-to-text prompt input." `linkalls/jules-mobile-client` is an Expo/React Native client, useful as a reference implementation.
- Jules' core loop is **plan -> approve -> execute -> PR**, i.e. plan approval is the primary gate, not per-tool permission.

Takeaways: plan approval as a modal/sheet with an explicit Approve button and editable feedback; timeline with status + failure reason rows.

### 1.8 Terminals on phones: Termius, Blink, Warp

Sources: https://docs.termius.com/terminal/mobile-terminal , https://blink.sh/ , https://github.com/blinksh/blink , https://termai.sh/blog/warp-alternative/ , https://elmlabs.dev/en/blog/best-mobile-ssh-app-2026

- **Warp has no mobile app** (macOS/Linux/Windows only; Warp Drive on web is read-only). Warp's relevant desktop patterns are vertical tabs, notifications, and native code review for agent CLIs. https://www.warp.dev/blog/universal-agent-support-level-up-coding-agent-warp
- **Termius mobile terminal UX** (the most complete public spec): hotkey bar above the system keyboard ("three groups of four hotkeys," customizable/reorderable); extended keyboard side panel (Ctrl, Esc, Tab, arrows, F-keys, symbols); arrow keys via long-press-and-drag or hold-Space-and-slide with "three speed gears"; double-tap = Tab; pinch to zoom text; press-hold word for selection handles; three-finger tap = paste; volume buttons mappable to keys; hardware keyboard auto-hides the on-screen bar; snippets + command history side panel; AI mode generates commands from natural language with selected terminal text as context; voice dictation into the prompt.
- **Blink**: SmartKeys bar with sticky Ctrl/Alt modifiers ("continuous presses, like in a real keyboard"), pinch to zoom, swipe between connections, slide down to close, 3-finger tap for menu, Mosh for roaming.

Takeaways: a terminal on a phone needs (a) a modifier/hotkey bar that stays above the IME, (b) gesture arrow keys, (c) pinch-zoom, (d) hardware-keyboard detection, (e) snippets. Most of your terminal use is *reading* agent output, so prioritize scrollback readability + a small key bar over full emulation fidelity.

### 1.9 Cross-competitor summary table

| Surface | Claude | Codex (ChatGPT) | GitHub Mobile | Cursor iOS | Pievra/Jules |
|---|---|---|---|---|---|
| Pairing | QR from CLI, device cards | QR from Mac app | GitHub login | Cursor login + Remote Control | API key |
| Timeline | collapsible tool cards, diff-stats chip | thread + artifacts | PR timeline | agent card + artifacts | activity timeline |
| Approvals | held-open prompts, 2 push toggles | approve/reject at decision points | review request | "needs input" push | plan approval |
| Diff review | `+N -M` chip -> diff view w/ inline comments | read-only diff | native PR review | diff + Squash & Merge | PR link |
| Background agents | session list w/ online dot | thread list w/ status | Agents list under My Work | agent list + Live Activities (8) | session list |
| Voice | full voice mode + dictation | dictation | none | voice input | voice-to-text |
| Lock screen | push only | push | push | Live Activities + Dynamic Island | push |

---

## 2. Expo SDK 57 / RN 0.86 stack: best practice per concern

### 2.1 Navigation: expo-router v6+ (SDK 56/57 forked router)

- **Native Tabs** (`expo-router/unstable-native-tabs`): real `UITabBarController` / Material tabs, Liquid Glass on iOS 26, badges, SF Symbols, iOS 26 search tab, minimize-on-scroll, bottom accessory view. Limits: max 5 tabs on Android, no nested native tabs, no dynamic add/remove, cannot measure tab-bar height, FlatList scroll-to-top is limited, tabs render eagerly (defer heavy tabs with `useIsFocused`). iOS 26 ignores `backgroundColor` (glass derives from content). Still labeled alpha. https://docs.expo.dev/router/advanced/native-tabs/ , https://expo.dev/blog/expo-router-v6
  - **ADOPT for the main shell** (Chat / Changes / Runs / More) *if* you accept alpha status and 5-tab cap; keep a JS-tabs fallback flag. Wrap in `ThemeProvider` to avoid white flash; use `disableTransparentOnScrollEdge` where a solid bar is required.
- **`expo-router/ui` headless Tabs** (`Tabs`, `TabList`, `TabTrigger`, `TabSlot`): use for *in-screen* segmented panes (Chat | Changes | Terminal inside a session) where you want custom chrome and swipe. https://docs.expo.dev/versions/latest/sdk/router/ui/ - **ADOPT** for session sub-tabs.
- **Protected routes** `Stack.Protected guard={...}` (and for Tabs/Drawer): redirect to anchor when guard false; use for "paired && unlocked" gating. https://docs.expo.dev/router/advanced/protected/ , https://expo.dev/blog/simplifying-auth-flows-with-protected-routes - **ADOPT**.
- **Modals / sheets**: `presentation: "formSheet"` with `sheetAllowedDetents: [0.25, 0.5, 1]` or `'fitToContents'`; native stack headers are NOT supported inside form sheets; `"modal"` is iOS-only (plain screen on Android). https://docs.expo.dev/router/advanced/modals/ - **ADOPT** for approval/plan sheets that must be route-addressable (deep links from push); use @gorhom for non-route sheets.
- **Split View** (`expo-router/unstable-split-view`, SDK 55+): native `UISplitViewController` on iPad, collapses to single column on iPhone (`topColumnForCollapsing`), falls back to Slot elsewhere; root-level only, no header customization yet. https://docs.expo.dev/versions/latest/sdk/router/split-view/ - **CONSIDER** for iPad (sessions sidebar | session).
- **Toolbars**: `Stack.Toolbar` (Android experimental in SDK 56) and `Stack.Toolbar.Badge` in headers (SDK 57). https://expo.dev/changelog/sdk-57
- **Android predictive back**: with `android.predictiveBackGestureEnabled: true` (default in new SDK 54+ projects) back-gesture can exit to home instead of popping; react-native-screens v4 will not implement fragment-level predictive back. Set `predictiveBackGestureEnabled: false` until fixed. https://github.com/expo/expo/issues/39092 , https://github.com/software-mansion/react-native-screens/discussions/2540
- **iOS swipe-back**: `fullScreenGestureEnabled` is iOS-only; leave default edge gesture on; be careful with horizontal pane swipes fighting it (see 3.4). https://reactnavigation.org/docs/native-stack-navigator/

### 2.2 Animation & gestures

- **Reanimated 4.5 + react-native-worklets 0.10** (SDK 57 pins). New-arch only; CSS-style `animation`/`transition` props for simple cases, worklets for gesture-driven. Babel plugin is now `react-native-worklets/plugin`. https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/ , https://blog.swmansion.com/reanimated-4-stable-release-the-future-of-react-native-animations-ba68210c3713 - **ADOPT** (already implied by SDK).
- **react-native-gesture-handler 2.32**: `ReanimatedSwipeable` for swipe-to-archive rows (friction, overshoot, `renderRightActions`). https://docs.swmansion.com/react-native-gesture-handler/docs/components/reanimated_swipeable/ - **ADOPT**.
- **Worklets Bundle Mode** (worklets >= 0.10) lets whole modules run off the JS thread; react-native-streamdown uses it for markdown parsing. https://github.com/software-mansion-labs/react-native-streamdown - **CONSIDER** for markdown/diff tokenization.

### 2.3 Lists for the chat timeline

- **@legendapp/list v3 (beta)**: dynamic sizes with no estimates, `initialScrollAtEnd`, `maintainScrollAtEnd`, `maintainVisibleContentPosition`, `anchoredEndSpace` ("a just-sent message should ride to the top and hold there while the reply streams in below"), `KeyboardAwareLegendList` + `useKeyboardChatComposerInset` + `useKeyboardScrollToEnd` integrating react-native-keyboard-controller, `AnimatedLegendList` with shared values, optional recycling, lower CPU/memory than FlashList in their benchmarks. Chat "without inverted lists or crazy hacks." https://legendapp.com/open-source/list/v3/overview/ , https://legendapp.com/open-source/list/v3/react-native/keyboard-and-animated/ - **ADOPT** for the timeline. Margelo's production LLM chat app uses exactly this. https://margelo.com/blog/building-native-llm-chat-app-with-rag
- **FlashList v2**: JS-only rewrite, no size estimates, `maintainVisibleContentPosition` on by default, `startRenderingFromBottom`; but multiple open chat regressions (#1844 scroll direction w/ pagination, #1872 render-from-bottom, #2050 mVCP when data does not fill screen). https://shopify.github.io/flash-list/docs/v2-changes/ , https://github.com/Shopify/flash-list/issues/1844 - **CONSIDER** as fallback; fine for non-chat lists (sessions, runs).
- **FlatList**: keep only for tiny lists; `inverted` chat lists are the classic source of jank and are what both libraries above are replacing. **AVOID** for the timeline.

### 2.4 Sheets

- **@gorhom/bottom-sheet v5.1.8+** supports Reanimated 4 (earlier 5.x depended on v3 APIs and broke). https://github.com/gorhom/react-native-bottom-sheet/issues/2613 , https://www.npmjs.com/package/@gorhom/bottom-sheet - **ADOPT >= 5.1.8** for in-screen sheets (tool details, quick actions); use router formSheet for route-addressable sheets. Expo UI (SDK 56) advertises a native drop-in replacement for @gorhom (SwiftUI sheet) - **CONSIDER** on iOS 26 for Liquid Glass parity. https://expo.dev/changelog/sdk-56

### 2.5 Styling

- **Unistyles 3**: C++ core writes to the Fabric Shadow Tree via JSI, theme/breakpoint/orientation changes with no React re-render; requires RN >= 0.78 + new arch (you have both). https://expo.dev/blog/unistyles-3-0-beyond-react-native-stylesheet , https://www.unistyl.es/v3/start/new-features/ - **ADOPT** if the team is StyleSheet-native; best fit for a dark/light + accent-token design system driven from a server theme.
- **NativeWind v4**: build-time Tailwind -> StyleSheet, ~2 ms JS overhead per benchmark, largest ecosystem; **CONSIDER** if the web app already uses Tailwind tokens and you want token parity. https://medium.com/react-native-journal/nativewind-vs-tamagui-vs-unistyles-which-styling-library-should-you-use-in-2026-cf4f4d78b76f , https://github.com/efstathiosntonas/react-native-style-libraries-benchmark
- **Tamagui**: compiler + full component kit; heavy and opinionated. **AVOID** unless you also ship a Tamagui web app.

### 2.6 Graphics

- **react-native-skia**: use for a canvas (dashboard charts with 5k+ points, shader/blur effects, custom progress rings); Reanimated drives Skia values on the UI thread. Not a replacement for Views; "a typical screen is still 90% standard React Native with one Skia canvas." https://medium.com/@expertappdevs/skia-game-changer-for-react-native-in-2026-f23cb9b85841 , https://www.pkgpulse.com/guides/react-native-reanimated-vs-moti-vs-skia-animation-2026 - **CONSIDER** only for dashboard charts and the voice waveform; **AVOID** for text/diff rendering.

### 2.7 Audio: STT input and TTS output

- **expo-audio `useAudioStream`** (SDK 56+): native PCM mic capture; `onBuffer` gives `{data (float32|int16), channels, sampleRate, timestamp}`; default 48 kHz (hardware may differ), so resample to 16 kHz before sending to a server STT. Needs `RECORD_AUDIO` + `requestRecordingPermissionsAsync()`. https://docs.expo.dev/versions/latest/sdk/audio/ - **ADOPT** for streaming STT to your server (Whisper/Parakeet). Before SDK 56 people wrote custom Swift/Kotlin modules for this (Expo blog Tuneo case study). https://expo.dev/blog/real-time-audio-processing-with-expo-and-native-code
- **expo-speech-recognition (jamsch)**: on-device/cloud SFSpeechRecognizer + Android SpeechRecognizer with `interimResults` (recommended true on iOS, false on Android unless model installed) and `requiresOnDeviceRecognition`. https://github.com/jamsch/expo-speech-recognition - **CONSIDER** as a zero-server fallback / offline dictation. On iOS 17+/26, `expo-speech-transcriber` wraps the newer SFSpeechAnalyzer with better punctuation. https://satisfies.dev/p/speech-to-text-in-expo-in-2026-sfspeechrecognize
- **TTS**: `expo-speech` = system voices, offline, no streaming, adequate for short status read-outs. For quality/streamed TTS from the server, play chunks via expo-audio; enable background playback (`enableBackgroundPlayback`, iOS `shouldPlayInBackground`; Android needs `setActiveForLockScreen` or audio stops after ~3 min). https://docs.expo.dev/versions/latest/sdk/speech/ , https://docs.expo.dev/versions/latest/sdk/audio/ , https://www.netguru.com/blog/react-native-text-to-speech - **ADOPT expo-speech for short utterances; server TTS via expo-audio for long-form.**

### 2.8 Storage

- **react-native-mmkv v4**: Nitro-module rewrite (`react-native-nitro-modules` peer), synchronous JSI, `createMMKV()`/`.remove()` renamed API, built-in encryption; ~30x faster than AsyncStorage. https://github.com/mrousavy/react-native-mmkv/blob/main/docs/V4_UPGRADE_GUIDE.md - **ADOPT** for session cache, drafts, UI state; keep secrets in `expo-secure-store`. Watch for the Nitro double-install error when another lib bundles an older nitro (#937).

### 2.9 Terminal rendering

- **WebView + xterm.js** (`@fressh/react-native-xtermjs-webview`): quickest path; caveats are RN-WebView keyboard focus bugs (#3816 Android, #2285 iOS) and memory: xterm's buffer is ~34 MB for 160x24 with 5000 scrollback, and a 10 000 default is common in production. Fressh (an RN SSH client) later replaced its WebView terminal with a native Alacritty-based renderer for exactly these reasons. https://www.npmjs.com/package/@fressh/react-native-xtermjs-webview , https://github.com/EthanShoeDev/fressh , https://github.com/xtermjs/xterm.js/issues/791
- **ghostty-web**: xterm.js-API-compatible VT implementation (built for Mux's agentic-dev app); drop-in for the WebView route. https://www.npmjs.com/package/ghostty-web
- **react-term**: canvas/WebGL/worker terminal for React/RN; early. https://github.com/rahulpandita/react-term
- Recommendation: **ADOPT a two-tier approach**: (1) a native RN "log view" (Legend List of ANSI-parsed lines, monospace `Text`, capped ring buffer) for the 90% case of reading agent stdout; (2) a WebView xterm/ghostty-web pane only when an interactive PTY is attached, with scrollback capped at ~2000 and the WebView unmounted when the pane is hidden. **AVOID** a full-time xterm WebView.

### 2.10 Keyboard and composer

- **react-native-keyboard-controller**: `KeyboardStickyView` for the composer, `KeyboardGestureArea` + `keyboardDismissMode="interactive"` for finger-tracked dismissal, `KeyboardToolbar`, `OverKeyboardView` for menus above the keyboard. Legend List's keyboard hooks depend on it. https://kirillzyusko.github.io/react-native-keyboard-controller/docs/guides/building-chat-app , https://kirillzyusko.github.io/react-native-keyboard-controller/docs/guides/interactive-keyboard - **ADOPT**.
- Native tabs: `tabBarRespectsIMEInsets` on Android 11+ so the tab bar does not float above the keyboard. https://docs.expo.dev/router/advanced/native-tabs/

### 2.11 Notifications, Live Activities, Android Live Updates

- **expo-notifications categories**: `setNotificationCategoryAsync('approval', [{identifier:'approve', buttonTitle:'Approve'}, {identifier:'deny', ..., options:{opensAppToForeground:false}}])` and set `categoryIdentifier` on the push payload. iOS works well (including text-input actions). Android action buttons are historically flaky: open issue #36282 reports buttons rendering in foreground but not in background/killed state; older issue #10962 tracked docs gaps. https://docs.expo.dev/versions/latest/sdk/notifications/ , https://github.com/expo/expo/issues/36282 - **ADOPT on iOS; on Android verify on a device and fall back to tap-through deep link to the approval sheet.** Handling a background action requires a headless task (`expo-task-manager`) that POSTs the decision to the server; make approvals idempotent server-side.
- **Live Activities (iOS 16.2+)**: options are `expo-widgets` (Expo's own, stable in SDK 56; Live Activities via Expo UI, push-to-start tokens, Dynamic Island compact/minimal/expanded; alpha limitations were "no image support, no timeline readback, no refresh policy") or the community `software-mansion-labs/expo-live-activity` (start/update/stop from JS, push token listener, iOS-only). https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo , https://expo.dev/changelog/sdk-56 , https://github.com/software-mansion-labs/expo-live-activity - **ADOPT expo-widgets** for "Run in progress: step 3/7, waiting for approval" with APNs updates from the server; Cursor made this an expectation.
- **Android 16 Live Updates**: `Notification.ProgressStyle` + `POST_PROMOTED_NOTIFICATIONS` permission + `setRequestPromotedOngoing(true)` + ongoing flag; must have `contentTitle`, no custom RemoteViews, not a group summary, not colorized. Shows as status-bar chip, top of shade and lock screen. https://developer.android.com/develop/ui/views/notifications/live-update , https://developer.android.com/about/versions/16/features - **CONSIDER** via a small Expo Module (no RN lib exposes this yet; Notifee foreground service is the pre-16 equivalent). https://notifee.app/react-native/docs/android/foreground-service/
- **Background execution**: iOS `BGAppRefreshTask` ~30 s budget, scheduling is a hint (expect 30 min to hours); Android uses WorkManager. `expo-background-task` wraps both. Do not rely on it for approvals: use push (silent + visible) to wake the app. https://docs.expo.dev/versions/latest/sdk/background-task/ , https://www.72technologies.com/blog/react-native-background-tasks-ios-android-2026

### 2.12 Platform design changes (iOS 26, Android 16)

- **iOS 26 Liquid Glass**: floating translucent tab bar that minimizes on scroll to a pill; search as a dedicated tab or a toolbar field; toolbars gain glass backing; bottom accessory view above the tab bar (perfect for a "1 approval pending" strip). Native tabs in expo-router inherit all of this; `expo-glass-effect` and Expo UI for custom glass. https://developer.apple.com/videos/play/wwdc2025/284/ , https://www.donnywals.com/exploring-tab-bars-on-ios-26-with-liquid-glass/ , https://codewithbeto.dev/blog/expo-router-feats-ios-26 . Known issue: glass header buttons flicker on tab switch in dark mode. Design advice: do not put dense controls on glass ("Don't design junk in the new iOS 26 tab bar"). https://medium.com/design-bootcamp/dont-design-junk-in-the-new-ios-26-tab-bar-4de8e842da89
- **Android 16 / Material 3 Expressive**: spring-physics motion, 35-shape library with shape morph, richer dynamic color; shipped on Pixel with Android 16 QPR1 (Sept 2025). https://www.androidauthority.com/google-material-3-expressive-features-changes-availability-supported-devices-3556392/ . For RN: use Reanimated springs (`withSpring`) for M3E-feel, Expo UI Compose components where you want native M3E widgets.
- **Edge-to-edge**: mandatory for targetSdk 36; use `react-native-safe-area-context` insets everywhere, `expo-navigation-bar` for bar style; SDK 57 shipped edge-to-edge fixes and `setStyle`/`setHidden` now apply to RN `<Modal>`. https://developer.android.com/about/versions/16/behavior-changes-16 , https://expo.dev/changelog/sdk-57
- **Large screens / foldables**: prefer `onLayout`-driven breakpoints (Dimensions lies in iPad Split View); Unistyles breakpoints handle this without re-render; expo-router SplitView for iPad. Android 16 ignores orientation/resizability restrictions on large screens, so do not lock orientation. https://dev.to/craftzdog/how-to-support-split-view-on-ipad-with-react-native-1b0n , https://developer.android.com/about/versions/16/behavior-changes-16

---

## 3. Mobile UX patterns for the specific surfaces

### 3.1 Markdown + code at streaming speed

- Native-text markdown is the 2026 answer: **react-native-enriched-markdown** (Software Mansion) parses with md4c in C and renders `NSAttributedString` / `SpannableString` (new arch required; CommonMark + GFM). Margelo measured 57-60 fps on both threads at ~15 % CPU / 225 MB while scrolling a long conversation, ~45-55 % CPU while generating, on iPhone 16. https://github.com/software-mansion/react-native-enriched-markdown , https://margelo.com/blog/building-native-llm-chat-app-with-rag - **ADOPT**.
- **react-native-streamdown** layers `remend` (auto-closes unterminated `**`, fences, LaTeX) and runs parsing on a worklet thread via Bundle Mode (requires worklets >= 0.10, i.e. SDK 57). https://github.com/software-mansion-labs/react-native-streamdown - **ADOPT** for the in-flight assistant block only; finished blocks render via plain enriched-markdown.
- **Block-level memoization**: split accumulated text on blank lines/fence markers; closed blocks are `React.memo`'d; only the last open block re-renders per token; `useTransition` for token updates so keystrokes stay urgent. https://iocombats.com/blogs/streaming-ai-chat-ui-react-architecture
- **Code highlighting**: `react-native-shiki-engine` (JSI Oniguruma, sync, new arch, WASM fallback on web, no built-in renderer, keep one highlighter instance). https://github.com/skiniks/react-native-shiki-engine - **CONSIDER**; but highlight only *closed* fences, lazily, and cap at N lines with "Open full file". **AVOID** highlight.js/Prism-on-JS-thread per token.
- Stream Chat's `@stream-io/chat-react-native-ai` shows the expected component set: markdown, code, tables, thinking indicator, typewriter `StreamingMessageView`. https://www.npmjs.com/package/@stream-io/chat-react-native-ai

### 3.2 Diff viewing on a narrow screen

- No mature RN diff component exists; web libs (`react-diff-view`, `react-diff-viewer-continued`, `git-diff-view`) are DOM-only. https://github.com/otakustay/react-diff-view , https://mrwangjusttodo.github.io/git-diff-view/ - **AVOID** wrapping them in a WebView for the primary view.
- Build it as a virtualized list of hunks/lines (Legend List `SectionList` with sticky file headers): unified view default on phones (Claude, Codex, GitHub Mobile all default to unified); split view only >= 700 pt width (iPad/foldable). Word-wrap on by default with a per-file "no-wrap + horizontal scroll" toggle; horizontal scroll must live in a nested `ScrollView horizontal` inside the row so vertical list scrolling still works. Word-level intra-line diff via `diff` package computed off-thread (worklet or server-side; your server already has ChangeSummaryService).
- Per-file collapse with `+N -M` stats chips; long-press a line -> context menu "Comment", "Copy", "Open file at line"; inline comments feed the next message (Claude web pattern).
- Cap rendered lines per file (e.g. 500) with "Load more" to bound memory; huge diffs come from the server pre-hunked, not as whole file contents.

### 3.3 Terminal

See 2.9. UX: monospace Text rows in a Legend List with `maintainScrollAtEnd`, "jump to bottom" pill, pinch-to-zoom font (Termius/Blink convention), a hotkey bar (Esc, Tab, Ctrl, arrows, `/`, `-`, `|`) in a `KeyboardStickyView`, hardware-keyboard detection to hide it. https://docs.termius.com/terminal/mobile-terminal

### 3.4 Swipe gestures

- Swipe-back: native edge gesture on iOS; Android back button/predictive back (disable predictive until screens v5). https://github.com/expo/expo/issues/39092
- Swipe-to-archive on session rows: `ReanimatedSwipeable` (gesture-handler 2.32). https://docs.swmansion.com/react-native-gesture-handler/docs/components/reanimated_swipeable/
- Swipe between Chat / Changes / Terminal panes: `react-native-pager-view` v7 (new-arch only) with `expo-router/ui` TabTrigger as the header, or react-native-tab-view which wraps pager-view. Conflict rules: the pager must not start from the left 20 pt (leave the iOS back gesture edge); inside the diff pane, horizontal line scrolling should use `simultaneousHandlers`/`blocksExternalGesture` so the pager only takes the gesture when the inner ScrollView is at its edge. https://github.com/callstack/react-native-pager-view , https://reactnavigation.org/docs/tab-view/

### 3.5 Pull-to-refresh, skeletons, optimistic UI, offline

- Pull-to-refresh on session list / runs list only (never on the streaming timeline).
- Skeletons: Reanimated-driven shimmer (`react-native-reanimated-skeleton`, `react-native-auto-skeleton` which derives placeholders from the real layout) or Callstack's approach. https://www.callstack.com/blog/performant-and-cross-platform-shimmers-in-react-native-apps , https://github.com/pioner92/react-native-auto-skeleton - **CONSIDER** auto-skeleton; keep skeletons for the first paint only, then optimistic rows.
- Optimistic UI: TanStack Query v5 mutations with snapshot/rollback for send-message, approve/deny, archive; `onlineManager.setEventListener` wired to `@react-native-community/netinfo`; `networkMode` so mutations pause offline. https://tanstack.com/query/latest/docs/framework/react/react-native , https://www.faisalkhawaj.com/blog/offline-first-react-native
- Reconnect banner: single slim banner above the composer with three states (offline / reconnecting to LAN / relay fallback), mirrored from the Claude CLI behaviour of queueing prompts and status while rebuilding the link.

### 3.6 Haptics

`expo-haptics`: `selectionAsync` on picker/tab changes, `impactAsync(Light)` on swipe thresholds and sheet snaps, `notificationAsync(Success|Warning|Error)` on run finished / approval needed / failure; never as decoration; no-ops in Low Power Mode. https://docs.expo.dev/versions/latest/sdk/haptics/ , https://codewithbeto.dev/blog/haptic-feedback-expo-router-native-tabs

### 3.7 Context menus, share sheets

- **zeego 3**: one API for iOS `UIContextMenu` (via react-native-ios-context-menu), Android native menu (@react-native-menu/menu) and web; new arch OK; needs a dev client (not Expo Go). https://zeego.dev/ , https://github.com/nandorojo/zeego - **ADOPT** for long-press on messages, tool cards, files, sessions (Copy / Share / Retry / Archive / Open in terminal).
- Share: `expo-sharing` for files (diff as .patch, logs), `Share.share` for text/links; Cursor/Claude both surface artifacts (screenshots, recordings) as shareable items.

### 3.8 Deep links & universal links

- Expo Router auto-routes every screen; still needs `scheme`, `associatedDomains`, Android `intentFilters` with `autoVerify`, and `/.well-known/apple-app-site-association` + `assetlinks.json` on a hosted domain; requires a real signed build (no Expo Go/simulator). For a self-hosted server, universal links are only feasible for the relay domain; LAN servers use the custom scheme (`genai://session/<id>?approval=<id>`), and the QR encodes the same URL so pairing and deep links share one parser. https://docs.expo.dev/linking/overview/ , https://expo.dev/blog/universal-and-app-links , https://docs.expo.dev/router/advanced/native-intent/
- Push payloads should carry the route (`/sessions/[id]/approvals/[approvalId]`) and open the formSheet route directly.

### 3.9 Biometric lock

`expo-local-authentication` as a local gate over the SecureStore-held device credential (not server auth); lock on `AppState` -> background after a grace period; render a blur/privacy overlay while inactive so the app switcher snapshot does not leak code. https://docs.expo.dev/versions/latest/sdk/local-authentication/ , https://blog.logrocket.com/implementing-react-native-biometric-authentication-expo/

### 3.10 Accessibility

- Dynamic Type: keep `allowFontScaling` on for prose; use `maxFontSizeMultiplier` (1.3-1.5) only on chrome (tab labels, chips, monospace code where wrapping breaks meaning); appt.org guidance warns against blanket disabling. https://github.com/appt-org/accessibility-code-examples/blob/main/text-scale/react-native.md
- Reduce motion: Reanimated `useReducedMotion()` (sync) and `<ReducedMotionConfig mode="system">`; disable typewriter/shimmer and use crossfades. https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility/
- VoiceOver/TalkBack: tool cards as `accessibilityRole="button"` with `accessibilityState={{expanded}}`; live region (`accessibilityLiveRegion="polite"` on Android, `AccessibilityInfo.announceForAccessibility` on iOS) for "approval needed"; diff lines with `accessibilityLabel` prefixes "added"/"removed". RN 0.86 fixed promise-based `AccessibilityInfo` queries (high contrast, cross-fade). https://github.com/react/react-native/releases/tag/v0.86.0

---

## 4. Performance patterns for streaming chat in RN

1. **Keep the JS thread to state only.** Margelo's split: UI thread = Reanimated; native threads = WebSocket decode, markdown parse, HTTP; JS = receive delta, update store, re-render. Result 57-60 fps, 225 MB. https://margelo.com/blog/building-native-llm-chat-app-with-rag
2. **Batch tokens per frame, not per event.** Coalesce deltas in a ref and flush once per animation frame (or ~33 ms) into the store; the DZone piece and the React streaming-architecture post both stress that per-token `setState` is the primary jank source; `useTransition` keeps input responsive. https://dzone.com/articles/streaming-llm-tokens-into-react-native , https://iocombats.com/blogs/streaming-ai-chat-ui-react-architecture . Your web client-core reducer already batches; keep the same reducer and only change the flush cadence on mobile.
3. **Never re-render the list for a token.** Store the in-flight message in a separate slice keyed by id; the timeline row for the streaming message subscribes via a selector (Zustand/Legend-State) so only that row updates; closed messages are memoized with stable ids. https://reactnativerelay.com/article/modern-state-management-react-native-zustand-tanstack-query
4. **Native text for the growing block** (enriched-markdown / streamdown) so per-token re-layout happens in `NSAttributedString`/`Spannable`, not in JS tree diffs.
5. **Worklet-driven motion**: typing indicator, scroll-to-bottom pill, sheet snaps and the voice waveform on the UI thread; Legend List `sharedValues` expose scroll state to worklets without JS round-trips. https://legendapp.com/open-source/list/v3/react-native/keyboard-and-animated/
6. **JSI storage**: MMKV v4 (Nitro) for synchronous reads on cold start (last session, drafts, pairing metadata) so the first frame is not blocked on async storage. https://github.com/mrousavy/react-native-mmkv/blob/main/docs/V4_UPGRADE_GUIDE.md
7. **Hermes V1 + Fabric constraints**: Hermes V1 is default from RN 0.84 (rewritten compiler, Hades concurrent GC); SDK 56/57 had a worklets memory regression, so measure memory after every SDK patch. Fabric: avoid `measure` in render loops; `Text` with tens of thousands of characters is slow to lay out, so paginate long code/diff bodies. https://www.tothenew.com/blog/hermes-v1-by-default-in-react-native-0-84-the-biggest-performance-win-of-2026/ , https://expo.dev/changelog/sdk-57
8. **Memory budgets for big diffs / scrollback**: xterm at 10k scrollback is tens of MB per terminal; keep terminal ring buffers at 2-5k lines native-side, diff files capped and hunk-virtualized, images downsampled (expo-image cache APIs `writeToCacheAsync`/`readFromCacheAsync` in SDK 57). Unmount hidden panes (WebView especially). https://github.com/xtermjs/xterm.js/issues/791
9. **Native tabs render eagerly**: defer heavy tab bodies with `useIsFocused`. https://docs.expo.dev/router/advanced/native-tabs/
10. **Lists**: Legend List with `recycleItems` for uniform rows (sessions, runs) and without recycling for the heterogeneous timeline (recycling + rich native text can leak state between rows).

---

## 5. Recommended stack & patterns

| Concern | Choice | Version / note |
|---|---|---|
| Runtime | Expo SDK 57 (>= 57.0.17), RN 0.86.3, Hermes V1, New Arch only | https://expo.dev/changelog/sdk-57 |
| Router | expo-router (SDK 57), NativeTabs for shell (alpha, keep JS fallback), `expo-router/ui` for session panes, `Stack.Protected` for pairing/lock gates, formSheet routes for approvals/plans, SplitView on iPad | https://docs.expo.dev/router/advanced/native-tabs/ |
| Motion | Reanimated 4.5 + worklets 0.10 + gesture-handler 2.32 | SDK pins |
| Timeline list | @legendapp/list v3 (`initialScrollAtEnd`, `maintainScrollAtEnd`, `anchoredEndSpace`, `KeyboardAwareLegendList`) | FlashList v2 for simple lists |
| Markdown | react-native-enriched-markdown (closed blocks) + react-native-streamdown (in-flight block) | new arch required |
| Code highlight | react-native-shiki-engine, lazy, closed fences only, line cap | https://github.com/skiniks/react-native-shiki-engine |
| Diff | custom virtualized unified view; split only >= 700 pt; server-hunked | no viable RN lib |
| Terminal | native log list by default; xterm/ghostty-web WebView only for interactive PTY, 2k scrollback, unmount when hidden | https://www.npmjs.com/package/ghostty-web |
| Sheets | @gorhom/bottom-sheet >= 5.1.8 (Reanimated 4) or Expo UI sheet on iOS 26 | https://github.com/gorhom/react-native-bottom-sheet/issues/2613 |
| Styling | Unistyles 3 (no-re-render theming, breakpoints) | NativeWind v4 if Tailwind tokens shared with web |
| State | Zustand (client) + TanStack Query v5 (server, optimistic, onlineManager via NetInfo); per-message selectors | https://tanstack.com/query/latest/docs/framework/react/react-native |
| Storage | react-native-mmkv v4 (Nitro) + expo-secure-store | https://github.com/mrousavy/react-native-mmkv |
| Keyboard | react-native-keyboard-controller (`KeyboardStickyView`, interactive dismiss) | |
| Voice in | expo-audio `useAudioStream` -> resample 16 kHz -> WebSocket to server STT; expo-speech-recognition as offline fallback | https://docs.expo.dev/versions/latest/sdk/audio/ |
| Voice out | expo-speech for short status; server TTS chunks via expo-audio with background playback | |
| Notifications | expo-notifications categories (Approve/Deny; verify Android), route-carrying payloads, headless task for background actions | https://github.com/expo/expo/issues/36282 |
| Long-running runs | expo-widgets Live Activities (push-updated) on iOS; Android 16 ProgressStyle Live Update via small Expo Module, foreground-service fallback | https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo |
| Menus | zeego 3 | dev client required |
| Haptics | expo-haptics mapped to semantic events | |
| Lock | expo-local-authentication + privacy overlay on background | |
| Links | scheme for LAN, universal/app links for relay domain, same URL grammar as QR | https://expo.dev/blog/universal-and-app-links |
| Android | targetSdk 36, edge-to-edge insets everywhere, predictive back off until screens v5, M3E springs | |
| iOS | iOS 16.4+ min (SDK 56), Liquid Glass via native tabs / expo-glass-effect, bottom accessory for "pending approvals" | |

Patterns to copy from competitors:

1. One session UI, three transports (Claude): LAN, relay, cloud as a badge and a device card list; QR encodes the same deep-link grammar used by push.
2. "Live state on connect" snapshot (Codex): threads + pending approvals + plan awaiting review, before any streaming resumes.
3. Approvals are a first-class list (Codex, Cursor "needs input"), reachable from a Liquid Glass bottom accessory / Android Live Update chip, with held-open semantics and idempotent server decisions (Claude).
4. Collapsible tool cards with a `+N -M` chip that opens the diff (Claude); grouped consecutive tool rows; subagent progress as nested cards.
5. Plan review as a formSheet with Approve / Edit-and-resend (Jules/Pievra, Claude Plan mode).
6. Background runs list distinct from chat (GitHub Agents under My Work, Cursor agent list), with Live Activities for up to N concurrent runs (Cursor: 8).
7. Artifacts over logs on the phone: screenshots, recordings, test summaries, severity-coded review findings (Devin red/yellow/gray).
8. Two-toggle notification preferences ("when the agent decides" / "when action required") plus prompt-driven notifications (Claude).
9. Terminal ergonomics from Termius/Blink: sticky hotkey bar, gesture arrows, pinch zoom, hardware keyboard detection, snippets.
10. Voice: dictation mic in the composer plus an optional hands-free mode; push-to-talk for noisy rooms (Claude app).

Risks to track:

- Native Tabs and Split View are alpha; keep a feature flag to swap to JS tabs.
- expo-notifications Android action buttons in killed state (issue #36282) - verify on Android 14/15/16 devices before relying on lock-screen approve.
- Predictive back on Android breaks expo-router stacks (expo #39092).
- Hermes V1 + worklets memory: re-measure after each SDK patch.
- Streamdown / enriched-markdown are young (hundreds of stars); pin versions and keep a JS markdown fallback (`react-native-markdown-display`) behind a flag.
