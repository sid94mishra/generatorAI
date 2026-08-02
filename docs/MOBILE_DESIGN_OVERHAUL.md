# Mobile design overhaul — research, architecture, and build plan

Supersedes the phased catalogue in `MOBILE_FEATURE_PARITY_PLAN.md`, which
answered *"what is missing"*. This answers *"what the app should be"*.

---

## 1. How modern mobile apps of this class are built

The reference set is the current generation of agent/dev clients that ship a
phone app against a desktop-class product: Linear, Height, Vercel, Raycast
iOS, GitHub Mobile, Claude, ChatGPT, Warp. Every one of them converges on the
same seven moves, and none of them try to shrink the desktop layout.

**1. The desktop side-panel becomes a bottom sheet, never a second column.**
A phone has one column. Linear's issue properties, GitHub's PR file tree, and
ChatGPT's canvas are all bottom sheets with detents. The sheet is the *entire*
answer to "where does the right pane go".

**2. Detents, not open/closed.** A sheet rests at ~28% (peek), ~60% (half) and
~92% (full). A grabber shows it is resizable, and tapping it cycles detents
(HIG). Peek lets a user keep the transcript visible while scanning changes.

**3. Controls collapse into a single overflow surface.** The web composer has
13 controls in a row. On a phone you show the two highest-frequency ones
inline (model, mode) and put everything else behind one control that opens a
sheet. Nothing is deleted — it is re-homed.

**4. Motion is the information architecture.** Spring-based scale on press
(0.96–0.97), layout animations on list insert, shared timing tokens. Static
mobile UI reads as a website. All of it runs on the UI thread via Reanimated
worklets; anything driven from JS stutters during a token stream.

**5. Skeletons, not spinners.** A spinner says "wait"; a skeleton says "here
is the shape of what is coming". Every list gets a skeleton matching its row
geometry.

**6. Haptics as confirmation.** Light impact on selection, medium on commit,
success/warning notification on terminal outcomes. This is what makes taps
feel "native" more than any visual.

**7. Density is earned, not assumed.** Minimum 44×44pt targets (HIG). Content
rows get 56–64pt. Lists breathe; sheets are dense.

### What we take, concretely

| Pattern | Source | Applied to |
|---|---|---|
| Detented sheet + grabber | HIG *Sheets* | Workbench, all pickers |
| Modal sheet capped at 50% initially | M3 *Bottom sheets* | Composer options |
| ≤5 tab destinations, never disabled | HIG *Tab bars* | 4 tabs + settings |
| Badge on tab for critical state only | HIG *Tab bars* | Activity "needs attention" |
| Drag handle cycles preset heights | M3 *Behavior* | Workbench |
| Scrim tap always closes | M3 *Visibility* | All sheets |
| Segmented control for peer views | iOS standard | Activity, Workbench, Runs |

---

## 2. Design language

Tokens are **not** re-invented — they come from `@generatorai/design-tokens`,
identical to web and desktop. What changes is the *composition*.

```
Surface ladder     background → card → raised → overlay
Radius             rows 12, cards 16, sheets 24 (top only), pills 999
Elevation          shadow only on floating things (FAB, sheet, toast)
Type scale         11 / 12 / 14 / 15 / 17 / 20 / 24 / 30
Touch target       44 minimum, 56 for list rows, 64 for cards
Motion             press 120ms · enter 180ms · sheet spring(damping 50)
Haptics            selection · impactLight · impactMedium · notification
```

**Screen scaffold.** Every screen is `<Screen>`: safe-area aware, large
title that collapses into the nav bar on scroll, optional search field,
optional trailing action, pull-to-refresh, and a consistent empty/error/
skeleton triad.

---

## 3. Information architecture

```
Tab bar (4)          Activity · Chats · Work · Projects
                     Settings via header button (HIG: tabs are navigation,
                     settings is not a peer destination)

Activity             stat rail → segmented feed (Today / Running / Attention)
Chats                search + list → chat detail
Work                 segmented (Workflows / Runs / Automations)
Projects             list → project → codebases

Chat detail          transcript + composer + Workbench sheet
Workbench sheet      Changes · Files · Terminal · Tasks · Plan · Browser
Settings             10 sections, each its own screen
```

The web right pane is **one sheet with a segmented header**, not six tabs —
six tabs do not fit a phone width, and the segmented control scrolls.

---

## 4. Component inventory to build

### `src/components/ui/` — design system

| Component | Purpose |
|---|---|
| `motion.ts` | spring/timing tokens, shared |
| `Pressable` | scale-on-press + haptics, one primitive for every tap |
| `Screen` | safe area + large title + refresh + states |
| `Card` / `Surface` | the surface ladder |
| `Chip` | composer pills, filters |
| `Button` | primary / secondary / ghost / danger, 3 sizes |
| `IconButton` | 44pt circular |
| `SegmentedControl` | animated indicator |
| `ListRow` | icon + title + subtitle + trailing + chevron |
| `SectionHeader` | grouped-list header |
| `Badge` / `StatusDot` | status colouring, one source of truth |
| `Skeleton` | shimmer, sized to the row it replaces |
| `ProgressRing` | context gauge |
| `Sheet` | **`@gorhom/bottom-sheet`** — detents, grabber, springs |
| `Toast` | transient confirmation |
| `Switch` | themed |
| `EmptyState` / `ErrorState` | illustration + message + action |
| `Fab` | new-chat affordance |

`Sheet` is rebuilt on `@gorhom/bottom-sheet` (already a dependency, provider
already mounted). This replaces the RN `Modal` implementation and removes the
theme-variable workaround entirely, because the sheet renders inside the
provider — i.e. inside the themed subtree.

### Chat

| Component | Replaces / adds |
|---|---|
| `Composer` | rebuilt: model, mode, effort, context tier, gauge, attach, mention, slash, voice, codebases, stop/send |
| `ComposerSheet` | every secondary control, one surface |
| `Transcript` | LegendList + block renderer |
| `blocks/TextBlock` | markdown |
| `blocks/ThinkingBlock` | collapsible, live shimmer |
| `blocks/ToolCallBlock` | icon per tool, status, duration, args/result |
| `blocks/PlanBlock` | inline card → opens Plan in Workbench |
| `blocks/QuestionBlock` | radio / checkbox / freeform, submit |
| `blocks/SystemBlock` | system / subagent / error tones |
| `blocks/WidgetBlock` | explicit "not supported on mobile" placeholder |
| `UsageFooter` | model, tokens, cost, duration |
| `Workbench` | the sheet, with segmented sections |

### Screens

Activity, Chats, Work (workflows/runs/automations), Projects, Chat, Run,
Automation, Project, Changes, Diff, Settings ×10.

---

## 5. Explicitly NOT feasible on mobile — called out

| Web feature | Status | Why |
|---|---|---|
| Widget canvas (sandboxed agent UI) | **Not supported.** Renders an explicit placeholder with a "open on desktop" note. | Widgets are served from a separate origin and executed in an iframe sandbox. RN has no iframe; a WebView cannot enforce the origin isolation the security model depends on. |
| Workflow DAG authoring | **Deferred** (user-agreed). Read-only stage list instead. | Node-graph editing needs a canvas with pan/zoom/edge routing; no React Flow equivalent, and it is unusable at 393pt wide. |
| Automation creation | **Deferred** (user-agreed). Detail + history is present. | Multi-step form over trigger/schema/loop/retry config. |
| Run start / pause / cancel / retry | **Blocked by scope.** Buttons are absent, and the reason is shown in-place. | Requires `write:workflows`; the mobile device is deliberately not granted it. Granting it would let a lost phone mutate pipelines. Answering HITL gates *is* available (`exec:agent`). |
| Browser preview interaction | **View-only.** Screenshot + URL + navigation state; no touch forwarding. | The remote page is laid out for a desktop viewport. Forwarding phone touches to it produces mis-targeted clicks; a read-only view is honest and useful. |
| File editing | **Read-only.** | No `write:workspace` scope on mobile. |
| Commit / open PR | **Not present.** | Same scope reason; also a decision that should not be made on a phone. |
| Full syntax highlighting | **Degraded.** Mono + diff tinting + language badge. | No Shiki/TextMate on RN. Tree-sitter via JSI is possible but is a project of its own. |
| Inline review comments on diffs | **Read-only threads.** | Anchor selection needs precise text selection; RN text selection cannot report ranges reliably. |

Everything else in the web app is implemented.

---

## 6. Build order

1. Design system + motion + `Sheet` on gorhom.
2. Chat: composer, transcript blocks, Workbench.
3. New-chat flow.
4. Activity.
5. Settings (all sections).
6. Work: workflows / runs / automations.
7. Verify: typecheck, lint, unit tests, live device sweep of every screen in
   both light and dark.
