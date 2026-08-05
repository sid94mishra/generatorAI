# Mobile native redesign — audit, plan, and build order

Supersedes `MOBILE_DESIGN_OVERHAUL.md` (which answered *"what should the app
be"*). This answers *"what is actually wrong with what we shipped, and what
does a genuinely native version of it look like"*.

Scope decisions taken (user unavailable; recommended options applied):

1. **Keep the shared `@generatorai/design-tokens` identity.** Mobile gets an
   additive *native layer* — elevation, materials, motion, type scaling — not
   a different palette. Web / desktop / mobile stay one product.
2. **iOS and Android, platform-adaptive.** Both get first-class navigation,
   back gestures, materials, text scaling and edge-to-edge.
3. **Scope elevation is requested, never self-granted.** `DEFAULT_MOBILE_SCOPES`
   stays narrow. The app gains an explicit *Request access* flow that tells the
   user exactly what to do on a trusted device (`PUT /api/auth/devices/:id/scopes`
   requires `admin:devices`, which a phone deliberately never holds).
4. **Plan first, then one implementation pass.**

---

## 1. Audit — `/impeccable audit apps/mobile` (native)

Scored against [`reference/ios.md`](../.github/skills/impeccable/reference/ios.md)
and [`reference/android.md`](../.github/skills/impeccable/reference/android.md).

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | **1/4** | Zero `accessibilityHint`, zero live regions, zero `header` roles, every title announced twice, colour-only status, `Touchable` claims `role="button"` for cards/rows/scrims alike |
| 2 | Performance | **2/4** | Six primary surfaces render `.map()` inside a `ScrollView`; per-byte base64 loops on the JS thread every 2 s; N unsynchronised skeleton loops |
| 3 | Appearance & Theming | **3/4** | Tokens are excellent and near-universally applied; three screens bypass the system entirely; opacity modifiers silently dropped in two files; `shadowColor:'#000'` hard-coded |
| 4 | Platform Conformance | **1/4** | No swipe actions, no long-press menus, no Reduce Motion, no Dynamic Type adaptation, no edge-to-edge, no predictive back, no `softwareKeyboardLayoutMode`, keyboard offset hard-coded to 44 pt, sheet draggable only by its grabber |
| 5 | Adaptivity | **1/4** | No landscape layout, no tablet layout, sheet detents captured in a stale closure across rotation, fixed-height chrome everywhere |
| **Total** | | **8/20** | **Poor — major overhaul** |

### Platform conformance verdict — FAIL

It does not read as a ported website (the token system, the collapsing large
title, the detented sheet and the haptic vocabulary are real work). It reads as
**a competent single-platform prototype**: correct on a 393×852 iPhone at the
default text size with animations on, and progressively wrong outside that.
The three specific tells a fluent user hits within a minute:

- **Nothing swipes.** Archiving a chat means finding a 44 pt icon inside a row.
- **The sheet only drags by its grabber.** Every native sheet drags by its body.
- **Text size and Reduce Motion do nothing.** Both are top-of-Settings controls
  on both platforms; the app ignores them entirely.

### Findings by severity

**P0 — blocking**

| Issue | Location | Why it matters |
|---|---|---|
| Mic button is a visible, enabled no-op | [Composer.tsx](../apps/mobile/src/components/chat/Composer.tsx) ← `onVoice` never passed | The primary surface has a dead primary control |
| Reasoning effort and context tier are collected and discarded | [chats/[id].tsx](../apps/mobile/app/chats/%5Bid%5D.tsx) | The user changes a setting and nothing happens; `PATCH /api/chats/:id { harnessConfig }` exists and is not called |
| Send failure is silent and loses the draft | same | `send.isError` unused; `setDraft('')` runs before the mutation resolves |
| Transcript load failure renders as "Start the conversation" | same | An error masquerading as an empty chat |
| Six surfaces unvirtualized | Activity, Work ×3, Projects, Changes, ModelSheet | 137 operations / 300 files mount eagerly |
| Reduce Motion never queried | whole app | Vestibular-disorder accessibility failure on both platforms |
| Dynamic Type breaks layout | whole app | Every container is a fixed height; AX3+ clips |
| `Screen` back button strands deep links | [Screen.tsx](../apps/mobile/src/components/ui/Screen.tsx) | `router.back()` with no history is a no-op |

**P1 — major**

Keyboard offset hard-coded 44 pt and wrong on Android/landscape · no
`softwareKeyboardLayoutMode` · no edge-to-edge · no predictive back · `/pair`,
`/revoked`, `/settings/security` bypass the design system · no swipe actions ·
no long-press menus · sheet drags only by grabber · no stream-connection state ·
`FilesSection` drops repos 2..n · `ChangesSection` diff has no horizontal
scroll · plan cannot be decided from the Workbench · automation On/Off badge
with no toggle · `/settings/tools` lists six locked features with no way to
request any · no offline indicator · `ProgressRing` invisible to assistive tech.

**P2 / P3**

Three dead components · two competing sheet implementations plus an unused
`BottomSheetModalProvider` · `RunStatusPill` divergent · arbitrary values past
the token scale (`text-[11px]`, `h-[86px]`, `min-w-[110px]`) · three competing
section-header treatments · icon sizes drift across nine values · `?new=1`
never cleared · `prefs.lastRoute` declared and never used · 15 unused deps.

### Positive findings (preserve these)

- The token pipeline (`tokens.generated.ts` + `vars()` + `colors` bag) is the
  right architecture and is applied almost everywhere.
- The haptic vocabulary — five verbs, no raw `expo-haptics` at call sites.
- `Screen`'s collapsing large title, driven on the UI thread.
- `Sheet`'s velocity-aware settle and scrim tracking.
- The `SseClient` (ticket per connect, `afterSeq` resume, stall watchdog,
  jittered backoff, `AppState` detach) is better than the web's.
- Pure logic extracted for testability (`activityRanking`, `modelCatalogue`,
  `fileTree`, `composerMenu`, `toolPresentation`).

---

## 2. Feature parity — web/desktop vs mobile

Desktop embeds `apps/web` verbatim, so *desktop-only* means Electron shell
surfaces (menus, tray, native dialogs, deep links, auto-update) and the native
`WebContentsView` browser. **None of that is portable**, and nothing in it is a
mobile gap. The real reference is `apps/web`.

| Area | Web | Mobile now | After this pass |
|---|---|---|---|
| Model picker, agent mode | ✅ | ✅ | ✅ |
| Reasoning effort, context tier | ✅ persisted | ❌ discarded | ✅ persisted via `harnessConfig` |
| Context gauge | ✅ | ✅ static | ✅ animated + `progressbar` semantics |
| Voice input | ✅ live WS PCM | ❌ dead button | ✅ hold-to-dictate → `/api/stt/stream` |
| Slash commands | ✅ | menu only | ✅ `/browser` + `/terminal` open the Workbench; skills/prompts from `/api/system/artifacts` |
| `@`-mentions | ✅ attaches content | menu only | ✅ attaches file content |
| Attachments | ✅ | ❌ `write:files` | gated **with a stated reason and a request path** |
| Codebase context | ✅ | hardcoded `0` | ✅ real count + list |
| Per-message actions | ❌ (web has none) | ❌ | ✅ **exceeds web**: long-press copy / share / select |
| Jump to latest | ✅ | ❌ | ✅ |
| Load older messages | ✅ | ❌ capped 200 | ✅ paged |
| Stream connection state | ✅ | ❌ | ✅ banner |
| Right pane → Workbench | 8 tabs | 6 sections | ✅ + plan decisions, multi-repo files, scrollable diffs, zoomable browser, task cancel |
| Chats list actions | bulk delete | archive icon | ✅ swipe archive/unarchive/delete + rename + search |
| Run detail | full | read-only | ✅ + stage output, retry/cancel **gated with reason** |
| Automations | full | read-only | ✅ enable/disable + run now, **gated with reason** |
| Projects / codebases | full | list only | ✅ codebase detail + branches + worktrees |
| Settings | 10 sections | 9 read-mostly | ✅ + text size, motion, haptics, default model, skill/MCP toggles, scope requests |
| Workflow DAG authoring | ✅ | ❌ | **deferred** — node-graph editing at 393 pt is not a real workflow |
| Widget canvas | ✅ | ❌ | **not supported** — separate-origin iframe sandbox has no RN equivalent |
| Commit / open PR | ✅ | ❌ | **not planned** — high-risk, low-frequency, wrong device |
| File editing | ✅ | ❌ | **not planned** — no `write:files`, not a phone task |

---

## 3. The native layer being added

Research reference set: HIG *Sheets · Tab bars · Typography · Motion*, Material 3
*Bottom sheets · Predictive back · Gestures*, and the current generation of
phone clients for desktop-class dev products (Linear, GitHub Mobile, Vercel,
Raycast iOS, Claude, Warp).

```
Motion        every config carries ReduceMotion.System; `useReduceMotion()`
              gates entering/exiting animations and the press spring
Type          fontScale-aware sizing; maxFontSizeMultiplier caps on dense
              chrome; min-heights replace fixed heights; a Text size setting
Targets       44 pt iOS / 48 dp Android floor, enforced by the primitive
Gestures      swipe actions on rows, long-press context menus, drag-anywhere
              sheets, pinch-zoom on media, swipe between segments,
              interactive keyboard dismissal, double-tap-tab to top
Haptics       five verbs, now also on swipe threshold, sheet detent, refresh
Keyboard      Reanimated `useAnimatedKeyboard` — UI-thread tracking, correct
              on both platforms, no hard-coded header offsets
Materials     edge-to-edge, translucent tab bar + nav bar, elevation reserved
              for floating surfaces
A11y          roles, hints, live regions, progressbar values, selected state,
              modal semantics on sheets, single announcement per title
Perf          every list virtualized; base64 off the JS thread; one shared
              skeleton clock; queries paused when unfocused/backgrounded
```

---

## 4. Build order

1. **Foundation** — `accessibility.ts`, `motion.ts`, `Touchable`, `Button`,
   `Chip`, `SegmentedControl`, `ListRow`, `primitives`, `Skeleton`,
   `ProgressRing`, `States`, `Form`, `Sheet`, `Screen`.
2. **New primitives** — `Toast`, `SwipeableRow`, `ActionSheet`,
   `SearchField`, `KeyboardAvoider`, `ScrollToTop` registry, themed tab bar.
3. **Config** — edge-to-edge, predictive back, `softwareKeyboardLayoutMode`,
   status/navigation bar, tablet + landscape guards.
4. **Screens** — every route migrated; the three bypass screens rebuilt.
5. **Features** — composer completion, chat actions, Workbench completion,
   list actions, run/automation actions, settings additions, scope requests.
6. **Verify** — `typecheck`, `lint`, `test`.
