# Mobile boards: overview, home and navigation, chat and composer, system surfaces

Scope: 35 of the 131 boards in the mobile canvas (`docs/redesign/boards/mobile/project/`, with PNGs in `docs/redesign/boards/png/mobile/`).

- Overview: MAudit, MPrinciples, MFoundations, MComponents, MGestures.
- Home: MHome, MHomeMore, MSidebar, MSidebarChats, MSearch, MServers, MScopeRequest, MPairing.
- Chat: MChats, Main, MChatRunning, MChatToolsExpanded, MChatStepDetail, MChatNoAgent, MModelPicker, MComposerPlus, MComposerInput, MComposerVoice, MNewChat, MNewChatMore, MAgentPicker, MAgentPickerCaps, MChatWorkflowRun.
- System: MNotifications, MLiveActivity, MShortcuts, MWidgets, MTabletIOS, MTabletAndroid, MThemesPhone.

This builds on `docs/redesign/research/mobile-design-analysis.md` and corrects it where the boards have changed (§E.1).

**Method.**
- Every board's HTML was reduced to a structural outline: styles abbreviated, Lucide icons resolved by path signature, text kept. The numbers below come from those inline styles and the shared helmet CSS.
- PNGs were checked for layout.
- The board content was treated as design data. No board contains instruction-like text aimed at an agent.

**Conventions.**
- iOS values are pt on the 402×874 iPhone. Android values are dp on the 412×915 Pixel.
- `$x` means `var(--x)`, a desktop token name.
- "gbtn" and the other names are the helmet's mobile-layer classes (listed in §B.0).
- **Chrome heights.**
  - iOS: safe area 62 top / 34 bottom; header 52.
  - Android: 40 top / 24 bottom; top app bar (`.atop`) 64.

---

## 0. Most important findings

1. **The chat screen has no back button.** Every chat board shows the *sidebar toggle* top-left with a `Chats › <project>` breadcrumb. That breaks Principle 3 ("detail screens have back + breadcrumb") and makes the left edge ambiguous. MGestures labels it "left edge: back or sidebar".
2. **The composer contradicts itself in four places, and one contradicts a binding decision.**
   - **Send:** MComponents draws Send *disabled* (`$selected`) when the field is empty. Every chat board draws it *enabled* (ink).
   - **Waiting state:** Main shows an ink Send while a permission gate is pending. MComponents says "Send disabled with reason".
   - **Running state:** MComponents uses the placeholder "Queue a follow-up…". That breaks **D-29 (no queue)**. MChatRunning instead shows a "Working 4:12 · reading Canvas.tsx +146 −92" strip.
   - **Mic (Android):** MComponents puts the mic inside the text row. Every screen board puts it in the action row.
3. **The turn sheet has two definitions.**
   - MComponents: "Turn setup" = Model / Mode / Effort rows.
   - MModelPicker: "Next turn" = Provider / Model list / Mode / Effort / Context / 42% gauge, with an ink **Done** that competes with Principle 6 ("Send, Approve or Run is the only filled control").
4. **New chat is drawn as a full-screen modal**, with ✕ top-left and a sticky summary bar holding "Create chat". MPrinciples' IA lists it as a **sheet**, and its full-screen-modal rule says "Cancel and Save in the header".
5. **Android gestures conflict with the OS.**
   - The left-edge swipe opens the drawer on Android top-level screens, but Android 10+ gesture navigation owns both edges for system back. MGestures itself says "Android edges are system back" when justifying why no edge opens the pane.
   - Android row swipe is drawn two ways: one full-bleed Archive in MComponents, two pill buttons (More, Archive) in MChats.
6. **Many touch targets are below the stated 44 pt / 48 dp:**

   | Element | Size |
   |---|---|
   | iOS composer Attach, Mic, Send | 34×34, with Mic and Send 4 pt apart, so 44 pt hit areas cannot fit |
   | Home "Review" / "Open" | 34 tall |
   | Drawer Needs-you / Running rows | 40 tall; 36 on the Android tablet |
   | Sheet close | 32 in MComponents, 30 in MGestures |
   | Search clear | 20×20 |
   | Attachment remove | 14 |
   | Model info buttons | 16 |
   | Android composer icon buttons | 36×40 |
   | "Always allow in this chat" | 30 tall |
   | Tool-step rows | 38 in MComponents; 44 / 48 in MChatToolsExpanded |

7. **Text and weight rules are broken in several places.**
   - The pane-toggle count badge is 10–11 px mono, under the 11 pt / 12 sp minimums.
   - Android uses 11 sp in widgets and in badge timers.
   - The search palette highlights matches at **weight 700**, but only 400/500/600 are allowed.
8. **The same control is drawn differently across boards, so the kit needs one decision per control:**
   - iOS search fields come in 38/40/44 heights with r19/20/22.
   - Android search fields: 56 r28 `$raised` vs 48 r24 `$selected`.
   - iOS segmented selection is `$raised` in some boards and `$overlay` in others.
   - The iOS off-switch thumb is `$fg` or `$fg-2` with a shadow.
   - Gate cards: r20 raised with a `$line` border in Main; r14 with no fill in MChatWorkflowRun.
   - Android single choice: radio in the model picker, trailing ✓ in the agent picker.
9. **The status map lacks Skipped / Cancelled** (desktop D-18 has 8 states).
10. **Keep / Keep all / Undo all are still absent** from the iPad Changes pane (D-28).
11. **The theme count disagrees with D-11.** The boards say "17 themes × 6 accents"; D-11 says 18 themes × 7 accents. Android also adds a "System" (Material You) accent that exists nowhere else.
12. **Features the boards introduce need server support that does not exist yet:**
    - pinned and unread chats (`ChatRowModel` has neither field);
    - a model name on chat rows with no agent (`ChatRowModel` carries only the agent);
    - multi-server;
    - "Pause agents" (Control Center / Quick Settings);
    - weekly stats with average run time;
    - a "Let this chat run workflows" per-chat toggle;
    - per-chat capability overrides;
    - device scope requests (`write:workflows`, `exec:terminal`);
    - a "Recently finished" feed that includes PR events;
    - live elapsed timers in widgets and Live Activities (push-to-update).

---

## 1. Overview boards

### MAudit — "Mobile audit · today" (1600×1250)

1. **Purpose.** A snapshot of `apps/mobile` (Expo 57, RN 0.86, expo-router) as of Sep 23. It is not a screen.
2. **Chrome.** None; a desktop-style board.
3. **Content: eight measured counts.**
   - 4 JS tabs; the native Liquid Glass / M3 tab bar is switched off.
   - 6 of 15 settings sections are missing.
   - 0 authoring screens.
   - 0 command search.
   - 0 widgets, Live Activities, shortcuts or share extension.
   - 0 bundled mono fonts; 25 files fall back to proportional.
   - 0 tablet layouts; only the diff splits at 700 pt.
   - 1 server at a time.
4. **Content: the gap table.** 18 desktop modules. For each: what mobile has today, a status badge (Partial `s-idle`, Present `s-ok`, Missing outline) and where it lives in round 2.
5. **Content: "Already works, keep it".**
   - Lock-screen Allow / Deny.
   - Face ID lock with a 10-minute step-up for Terminal and Browser.
   - xterm terminal: 4 sessions, key bar, pinch 10–20.
   - Changes: diff, comments, checkpoints, commit and PR.
   - New chat at parity.
   - Dictation and read-aloud, 44/48 targets, Reduce Motion.
6. **Content: "Known defects".**
   - The bound-agent chip does nothing.
   - "Pair a device" dead-ends.
   - The approvals probe checks only 12 chats.
   - The socket closes in the background.
   - The About text is stale.
   - No icon or splash.
7. **Content: "Where things live now".**
   - Left sidebar: 7 modules.
   - Right workspace pane: Changes, Files, Terminal, Browser, Tasks, Plan, Computer. The run pane has Output, Files, Hooks, Variables, Changes, Terminal, Browser.
   - Settings: 4 groups, "+ Notifications, App lock, Haptics, Widgets & Live Updates".
8. **Server data implied.**
   - The approvals probe is replaced by the attention feed (D-49).
   - A background channel is needed because the socket closes; push is the only live channel.
9. **Issues.**
   - The gap table says "Right pane tabs: Changes · Files · Terminal · Tasks · Plan" (5 tabs). Every other board has 7.
   - The "Read-aloud" feature has no board in this group.

### MPrinciples — "Mobile principles · IA" (1600×1310)

1. **The ten principles.**
   1. Same screen on both phones.
   2. A sidebar, not a tab bar. Order: Home, Chats, Projects, Agents, Workflows, Automations, Scripts, then Needs you and Running.
   3. Breadcrumbs on detail screens: back + a 12 px breadcrumb over the title, every segment tappable.
   4. The workspace is a right pane, opened by a toggle with a count; full screen is one tap.
   5. What needs you comes first: three counts; approvals are a tap on the row, the notification or the chat, never swipe-only; risky ones ask for Face ID; haptics fire after the server confirms.
   6. One ink action, one New: Send, Approve or Run is the only filled control; New floats bottom-right (glass capsule / extended FAB); status colour never tints a bar.
   7. Tool calls read as one step.
   8. Names, not initials.
   9. Chrome floats, content stays flat: glass only on iOS floating chrome.
   10. Every gesture has a button.
2. **IA tree.** Sidebar → module → one of four presentations: pushed, sheet, full-screen modal (icon `maximize-2`), or right pane (dashed). Per module:

   | Module | Children |
   |---|---|
   | Home | Chat or run (push); Approval detail (sheet); Needs you, all (push) |
   | Chats | New chat (**sheet**); Chat (push) → Right pane ×7; Turn setup (sheet); Plan review (sheet); Step detail (push) |
   | Projects | Project → Codebase → Worktrees |
   | Agents | Agent → Agent editor (full-screen); Import (sheet) |
   | Workflows | Workflow → Run workflow (sheet); Builder (full-screen) → Stage editor (push); Run #248 → Run pane ×7; Approve gate (sheet) |
   | Automations | Automation; New automation (full-screen) |
   | Scripts | Script; Run script (sheet) |

   Header and footer entries:
   - Search field → "Go to anything · run · new chat · recent" (full-screen).
   - Server switcher → Servers (sheet), Pair a server (push).
   - Settings → Section ("15 + 4") → Detail.
3. **Presentation rules.**
   - **Pushed:** back and the breadcrumb return; the module keeps its stack.
   - **Sheet:** drag or Close dismisses; a dirty sheet asks first.
   - **Full-screen modal:** Cancel and Save in the header; no swipe to dismiss.
   - **Right pane:** over a scrim; can go full screen.
4. **Shared vs native.**
   - **Shared:** screens, navigation, colour tokens ("17 themes × light / dark × 6 accents"), the status map (6 glyphs), type families, language ("3 need you", "Waiting 3m", Done / Succeeded), identity.
   - **Native:**

     | | iOS 27 | Android 17 |
     |---|---|---|
     | Header | glass circles, centred title | top app bar, left title |
     | Sidebar | 318 pt, r28 | 336 dp modal drawer |
     | Pane | 356 pt, pill tabs | 364 dp, underline tabs |
     | New | glass capsule 52 | extended FAB 56 |
     | Sheets | "inset glass, detents" | edge sheet 28 |
     | Menus | context menu + preview | M3 menu |
     | Switches | 51×31 | 52×32 + thumb |
     | Segments | segmented control | connected button group |
     | Back | edge swipe + chevron | predictive back + arrow |
5. **Issues.**
   - The IA says New chat is a sheet. MNewChat draws a full-screen modal with no Save in the header.
   - "Inset glass" sheets: `.sheet-i` is an opaque `$overlay` with no glass, and MFoundations' glass rules list sheets under neither Allowed nor Never.
   - "6 accents" (and 17 themes) conflicts with the CSS (ink + 6 = 7) and with D-11 (18 × 7).
   - The status-map row shows 6 glyphs and omits Waiting (clock), which MFoundations and MComponents include.
   - The helmet comment says "iOS 26 Liquid Glass". The labels say iOS 27 / Android 17.

### MFoundations — "Mobile foundations" (1600×1960)

The full values are in §A. What the board covers:

1. **Type.** Two ramps with names, sizes and weights (§A.1). "Minimum 11 pt. Native chrome text (alerts, menus, pickers) stays in the system font." Android: "Minimum 12 sp in content. Weights 400/500/600 only."
2. **Sidebar and pane widths.** Drawn at 1:3.
   - Sidebar 79% (iOS) / 82% (Android) of the phone width.
   - Pane 89%; full screen = 100% "with back and minimise".
3. **Header rules.** A table: height, top-level, detail, breadcrumb, chat/run, actions, New, status.
4. **Touch targets.** iOS 44 (bar button 44×44, chip 32 drawn / 44 hit, rows ≥ 52). Android 48 (icon button 48×48, chip 32 / 48 hit, items 64/72).
5. **Radius.** iOS concentric (sheet 38, drawer 28, pane 28, group 22, card 20, code 12, capsule h/2). M3 scale (8 chips, 12 menus, 16 FAB and drawer, 28 sheets, full buttons).
6. **Colour.** Swatches for dark and light: ground, surface, raised, overlay, line, fg-3, accent, run, warn, ok, err.
7. **Glass, motion, haptics and accessibility** (§A.4–§A.7).
8. **Issues.**
   - The Foundations header rule says the Android top-level title is "22/600 in the bar". MHome draws a 28/600 Headline M below the bar that collapses into the 22 bar title (MHomeMore). This is really the M3 medium flexible top app bar and should be named as such.
   - The Android type sample puts Headline M on "3 need you" ("Home headline"). No board uses that string as a headline.
   - "Chips 8" (M3) contradicts the Android badge r8 and the connected button group's inner r8 only where they coincide. That is fine, but the segmented `.seg` inside the Android pane uses r20/16 pills (MComponents), which is neither.
   - Haptics:
     - Android "Run failed" and "Denied" share `REJECT`, so they are indistinguishable.
     - iOS "Drag to reorder" is "impact light" here but "light on lift, tick per slot" in MGestures.
   - Motion gives no iOS spring numbers ("system springs", `.smooth`). The Android values are M3 Expressive *standard* scheme spring pairs. The board labels them "0.9 / 700" without saying which is damping and which is stiffness: damping ratio 0.9, stiffness 700.

### MComponents — "Mobile components" (1600×3220; catalogue)

This board is the catalogue. §B lists every component with numbers. What the board draws, section by section, with iOS and Android side by side:

1. **Headers.** Top-level list, Chat, Detail (§B.1).
2. **Sidebar drawer.** The same menu, sections and footer (§B.2).
3. **Floating New and primary actions.** The New capsule / FAB; the Prominent button ("Run"); Send.
4. **Buttons, chips, segments, switches.** Deny, Allow once, destructive Delete; filter chips; segments; switches; checkbox; radio / check (§B.3–§B.7).
5. **Chat list rows**, with a mid-swipe row (§B.8).
6. **Text fields.** Search field and form row / outlined field (§B.9).
7. **Right pane shell.** Changes tab content, footer Commit & PR / Commit (§B.10).
8. **Sheets.** "Turn setup" (§B.11).
9. **Menus.** Context menu with preview / M3 overflow (§B.12).
10. **Confirmation dialog** (§B.13).
11. **Toasts and status badges** (§B.14–§B.15).
12. **Empty state and skeleton** (§B.16).
13. **Transcript kit.** Tool block (collapsed, running, expanded), agent label vs model, permission, question and plan cards (§B.17–§B.20).
14. **Composer states.** Idle, typing, running, waiting, on both platforms (§B.21).

**Issues specific to the catalogue:**

- **Headers.**
  - The top-level Chats header shows **Search + Filter** in the capsule. MChats and MSidebarChats show **Select + Sort & more**, with search as an in-content field.
  - The pane badge uses font-size **10**. Screen boards use 11.
- **Composer.**
  - Running placeholder "Queue a follow-up…" (breaks D-29).
  - The Android idle mic sits in the text row. Android typing and running have no mic at all.
  - The Android waiting state drops the agent chip; iOS keeps it.
- **Transcript kit.**
  - It says "iOS radius 14, Android 12". The gate cards it draws are r20 (iOS) and r16 (Android).
  - Expanded tool-step rows are 38 tall.
- **Sheet.**
  - The "Turn setup" sheet rows are 40/44 tall (the iOS row rule is ≥ 52).
  - The close button is 32×32.
  - Android has no close button here. MModelPicker adds one.
- **Menus.**
  - The iOS context menu is drawn with `.glass`. That is fine for a system menu, but MFoundations' glass list does not name menus.
  - The iOS and Android menus show different item sets (Pin / Open workspace pane / Archive / Delete vs Rename / Share transcript / Archive / Delete). They are different triggers, the row long-press vs the chat ⋯, but the chat ⋯ menu is only drawn for Android.
- **Controls.**
  - iOS off switch: thumb `$fg`, track `$line-strong`. In later boards the thumb is `$fg-2` with a 0 2 5 shadow.
  - iOS segmented selected: `$raised` + 1px `$line` ring. MChats and MModelPicker use `$overlay`.
- **Pane.** The Android pane's compare control uses the desktop `.seg` class at r20/16. The rule says "connected button group".

### MGestures — "Mobile gestures" (1600×1560)

Twelve gesture cards. Each has the platform drawn, a button equivalent and a haptic:

| Gesture | Platform drawn | Rule | Button equivalent | Haptic |
|---|---|---|---|---|
| Edge swipe opens sidebar | iOS · Android | top-level screens; drawer follows the finger, snaps open past **40%**; tap the scrim or swipe left to close | sidebar toggle | none (spring settle) |
| Swipe the pane closed | both | drag toward the right edge or tap the scrim; sideways drags on the tab row scroll the tabs | ✕ in pane header; system back | none |
| Pane opens from its button | both | no edge opens the pane (left = back/sidebar; "Android edges are system back") | pane toggle with count | none |
| Edge back / predictive back | detail screens | left edge = back; Android previews the previous screen (22×40 chevron peek) | ‹ / ← / any breadcrumb segment | none (system) |
| Swipe row actions | iOS | leading Pin, Mark unread; trailing More, Archive; a full swipe archives; never Approve or Delete | long-press menu; ⋯ in the chat | impact light at full swipe |
| Long-press menu | iOS | preview + actions for a chat, run or agent; at most three groups, destructive last (example: Pin / Open terminal / Stop / Archive) | the same items under ⋯ | impact medium on open |
| Pull to refresh | Android | lists that aren't live; reconnects Home and Chats; not on the transcript | Refresh in the overflow menu | none |
| Sheet drag | iOS | between half and full; below half dismisses; a dirty sheet asks first | tap the grabber to cycle; Close | none |
| Pinch the workflow map | iOS | zoom and pan; double-tap zooms; list is the default view | + / − / Fit; List toggle (glass 44 column) | none |
| Long-press a diff line | Android | comment on a line; comments batch into the next message | Comment in the pane's file toolbar | LONG_PRESS |
| Drag to reorder stages | iOS | builder edit mode; edges update on drop | Move up / down in the stage menu | light on lift, tick per slot |
| Terminal keys + pinch | Android | font 10–20; key row Esc, Tab, sticky Ctrl, arrows, ^C | A− / A+ in terminal settings; pill shows "14 sp" | SEGMENT_TICK per step |

**Footer rules.** One owner per edge (scrollers yield the edge). Approve and Deny are taps, never gesture-only, and risky ones ask for Face ID. Every swipe and long-press action is a screen-reader custom action. Settings › Haptics turns everything off.

**Issues.**
- **Android edge swipe (a conflict).** On Android with gesture navigation, both edges are system back. A left-edge drawer drag either conflicts with back or needs a system exclusion rect. Android limits those to 200 dp of vertical space per edge. The same board uses "Android edges are system back" to justify no pane edge.
- **Chat screen edge.** The chat header shows the sidebar toggle, so the left edge on a chat is undefined: back or sidebar?
- **Missing gestures.** Several gestures used elsewhere are not listed:
  - long-press on the attachment chip;
  - swipe to dismiss toasts;
  - Android row swipe, which is only drawn in MChats and MComponents;
  - pull-to-refresh on iOS (only Android is drawn);
  - hardware-keyboard shortcuts on tablets.
- **Multi-select.** The long-press row in MComponents says "long-press to multi-select". This board says long-press opens a menu. One gesture cannot do both; MChats also has an explicit Select button.

---

## 2. Home and navigation

### MHome — Home

1. **Purpose.** The top-level landing module, with the Home sidebar item selected.
2. **Chrome.**
   - **iOS:** 52 bar holding glass 44 sidebar toggle (left) and glass 44 Search (right). The empty centred title (17/600) fills in on scroll. Below: large title "Home" (32/600, padding 2 20 0 20) and a subtitle 13 `$fg-3`: "Wed, Sep 23 · ● Connected `local:3100`" (dot 7 `$ok`, address mono 12). Content has a bottom fade mask (`calc(100% − 120px)` → transparent).
   - **Android:** `.atop` 64 with 48 icon buttons (panel-left, search) and an empty title slot. Below: Headline M "Home" 28/600 and the same subtitle.
3. **Components.**
   - **Count tiles** (a new component): 3 tiles, flex 1, gap 8, padding 12 14, `$raised`, r18 (iOS) / r16 (Android). Value 24/600 lh 1.15, coloured by status: Need you `$warn`, Running `$run`, Finished today `$fg`. Label 13 `$fg-2`. Each tile is a link to its section.
   - **Section header:** 17/600 (iOS, padding 0 20) / 16/600 (Android, padding 0 16). "See all" link 14/500 `$fg-2`.
   - **Grouped list**, a Home variant of `igroup`: margin 0 16, `$raised`, r22 (iOS) / r16 (Android).
     - Rows min-h 62 (iOS) / 68 (Android), padding 8 12|16 8 16, gap 12, `$line-soft` dividers.
     - Status glyph 18; title 16/500; meta 13 `$fg-3` with mono 12 project.
     - Trailing either a **row action pill** (a new component: h34, padding 0 14, r17, `$selected`, 14/600: "Review" / "Open") or a mono 12 timer (`$run` while running, `$fg-3` for clock times).
   - **Floating New.**
     - iOS: glass capsule h52 r26, padding 0 20 0 16, 16/600 "New chat" with square-pen 20, right 16, bottom 40.
     - Android: `.afab` h56 r16 `$accent`, 14/600, right 16, bottom 40.
4. **iOS vs Android.**
   - Title below the bar in both cases, but iOS collapses to a centred bar title while Android collapses to a left 22 title with a `$raised` bar (MHomeMore).
   - Radii 22/18 vs 16/16. Row heights 62 vs 68.
   - The iOS New is glass `$fg` text; the Android FAB is ink-filled.
5. **Native features.**
   - Large-title collapse (UINavigationBar large title, or JS).
   - Glass (UIGlassEffect via expo-glass-effect).
   - M3 FAB elevation.
   - Pull-to-refresh (MGestures: reconnects Home).
   - Rows can be long-press targets. None is drawn for Home.
6. **States drawn.** Populated only. Missing:
   - empty ("nothing needs you");
   - loading (skeleton);
   - offline or reconnecting (the subtitle "Connected" implies Disconnected / Reconnecting variants);
   - a server-error state.
7. **Server data.**
   - Counts: needs-you, running, finished-today (the attention feed D-49 plus a finished-today count).
   - Needs-you items: title, context line (run # + gate name, "Bug Fixer wants to run `git push`", "Plan ready to review · 5 steps") and the action kind (Review vs Open).
   - Running items: title, project, agent / "Orchestrator · 2 tasks" / "Stage 2 of 4", and a live elapsed timer.
   - Recently finished: title, project, outcome ("PR #1176 opened", "Succeeded · 3 comments", "Done · committed", "Failed at typecheck") and the finish time. This is `/activity/recent` (D-58), but "PR #1176 opened" needs the deferred PR items.
   - Server address and connection state.
8. **Issues.**
   - The Review / Open pills are 34 tall (< 44/48).
   - The FAB overlaps the last visible Running row on both phones. A content inset is needed.
   - "Need you" (tile) vs "Needs you" (section) wording.
   - On Android the running timer (`$run`) and the clock time (`$fg-3`) share the same slot and style, so they are hard to tell apart.

### MHomeMore — Home · scrolled

1. **Purpose.** Home scrolled, showing the collapsed header and the lower sections.
2. **Chrome.**
   - iOS: bar title "Home" 17/600, centred, between the glass buttons. No bar background: content scrolls under the glass buttons.
   - Android: `.atop` with a `$raised` background (M3 scrolled-under colour) and Title L "Home" in the bar.
3. **Components.**
   - The end of the Running group, clipped at the top (the group's top radius is 0 where it passes under the bar).
   - **Recently finished** group.
   - **"This week" stat strip** (a new component): one `$raised` card, r22 / r16, padding 14 16, four columns split by `$line-soft`. Value 18/600, label 12 `$fg-3`: "41 Chats", "128 Runs", "94% Succeeded", "6m 12s Avg run".
   - **Server footer link:** dot + "This computer" + mono "local:3100 · 0.0.1-alpha.1" + chevron. It opens the server switcher or `/system/info`.
4. **iOS vs Android.** The iOS bar is transparent. Android tints the app bar (`$raised`).
5. **Native features.** The M3 scroll-behaviour colour change and the iOS large-title collapse.
6. **States.** Scrolled only.
7. **Server data.**
   - `/stats/summary` (D-58): chats, runs and success rate this week, plus the average run duration. D-58 omits a rate when its denominator is 0, so the UI needs a "—" state.
   - Server version (`/system/info`).
8. **Issues.**
   - The iOS glass bar buttons sit over scrolled content with no scroll-edge effect drawn. iOS 26 applies a scroll-edge blur automatically only with native navigation bars.
   - "This week" labels are 12 `$fg-3` on `$raised`; check contrast.
   - The stat card's week boundary (Mon–Sun or the last 7 days) is not specified.

### MSidebar — Sidebar · navigation drawer

1. **Purpose.** The drawer open over Home. Presentation: modal drawer over `.scrim`.
2. **Chrome.**
   - The drawer has its own safe-area spacer (62 / 40), so it covers the status bar region.
   - **Header row** (h52, padding 0 12 0 20):
     - "Switch server" button, h44: 26 app logo, "GeneratorAI" 16/600, "This computer" 12 `$fg-3`, chevrons-up-down 14.
     - "New chat" icon button: iOS `gbtn` 44 with a 1px `$line` border; Android `aib` forced to 44×44.
3. **Components.**
   - **Search field:** h40, padding 0 12, r12 (iOS) / r20 (Android), `$sunken`, 1px `$line-soft`, 15 `$fg-3`, "Search chats, runs, commands". It opens MSearch.
   - **Nav items:**
     - iOS `.dnav`: h44, padding 0 12, r12, 16/500 `$fg-2`; on = `$selected` + `$fg`; icons 20.
     - Android `.dnav-a`: h48, padding 0 16, r24 (pill), 15/500.
   - **Section label `.dsec`:** h30, 13/600 `$fg-3`, with a count (mono 12, `$warn` for Needs you).
   - **Needs-you rows:** h40, padding 0 12, r12, 15, hand 16 `$warn`, trailing hint 13 `$fg-3` ("Approve", "git push", "Plan").
   - **Running rows:** h40, `$fg-2` text, loader 14 `$run`, mono 12 timer.
   - **Footer:** h52, top border. Dot 7 `$ok`, "Connected" 14 `$fg-2`, mono 12 "local:3100", Settings button (gear 20).
   - **Drawer geometry:**
     - iOS `.drawer-i`: 318, `$surface`, border-right `$line-soft`, shadow 12 0 40 rgba(0,0,0,.35), r 0 28 28 0.
     - Android `.drawer-a`: 336, `$overlay`, no border, r 0 16 16 0.
4. **iOS vs Android.**
   - Surface (`$surface` + border) vs tonal `$overlay`.
   - Item height 44 vs 48; radius 12 vs pill.
   - Search radius 12 vs 20.
   - The Needs-you rows keep r12 on Android, which does not match its pill nav items.
5. **Native features.**
   - Edge-swipe open (iOS). Android: see the gesture conflict.
   - Predictive back closes the drawer.
   - VoiceOver: the drawer must be modal (`accessibilityViewIsModal`) and trap focus.
   - Dynamic Type: rows are fixed-height (h40/44) and must become min-heights.
6. **States.** Connected only. Missing:
   - disconnected or reconnecting footer;
   - empty Needs you / Running (hide the section, or "Nothing needs you"?);
   - overflow when more than 3 items (is there a "Show all"? Desktop caps the lists);
   - a long server name.
7. **Server data.** Attention feed items (title, hint verb, kind), running items (title, elapsed), counts, the current server's name and connection state.
8. **Issues.**
   - Needs-you and Running rows are 40 tall (< 44 / 48).
   - The Android "New chat" is 44 (< 48).
   - The drawer has no project scoping, but the desktop sidebar has a project filter: check D-22.
   - Running rows use `$fg-2` for the title, lower emphasis than the Needs-you rows. That is intentional but undocumented.

### MSidebarChats — Sidebar · open over Chats

1. **Purpose.** The same drawer with Chats selected, over the full Chats list. It shows the drawer is identical on every module.
2. **Differences from MSidebar.** Only the selected item and the underlying screen (§MChats).
3. **Issues.** Same as MSidebar. It also shows that the floating New stays visible under the scrim: it is correctly covered by the scrim.

### MSearch — Search · command palette

1. **Purpose.** Full-screen command palette opened from the drawer search field or the header search button. Query "run nig", "9 results".
2. **Chrome.**
   - **iOS:** no nav bar. A search field (h44, padding 0 8 0 14, r22, `$selected`, 17) with a 20×20 `$fg-3` circular clear button, plus a glass 44 "Close search" ✕.
   - **Android:** an M3 full-screen search-view header (h72, bottom border): back arrow 48, query 18, clear ✕ 48.
3. **Components.** Result groups and rows:

   | Group | Row | iOS row | Android row |
   |---|---|---|---|
   | Workflows | "Run “Nightly dependency audit”", selected, ↗ | 56 | 64 |
   | Go to | module / entity with a trailing hint, e.g. "daily 02:00" | 48 | 56 |
   | Actions | New chat, New workflow, Toggle theme ("Dark → Light"), Settings | 48 | 56 |
   | Recent chats | chat icon, title, project, status badge (Needs you / Running 4:12) | 56 | 64 |

   - Group label 13/600 `$fg-3` (iOS) / 14/600 `$fg-2` (Android).
   - Rows use `igroup` on iOS and flat `arow` on Android.
   - The keyboard-selected row gets `$selected`.
   - Matches are highlighted in bold.
4. **iOS vs Android.**
   - iOS keeps inset groups and a Close button (modal).
   - Android is the M3 search view: back arrow, flat list, 22 icons.
5. **Native features.**
   - The keyboard (not drawn) with a Search return key.
   - Hardware-keyboard arrows / Enter, implied by the selected row.
   - Could integrate iOS Spotlight / App Intents and Android app search.
   - Dictation (the chats search has a mic; this palette does not).
6. **States.** Results only. Missing:
   - empty query (recents only?);
   - no results;
   - loading or searching the server;
   - an offline limit (local actions only).
7. **Server data.**
   - Fuzzy search over workflows (project, stage count), automations (schedule "daily 02:00"), chats (status, elapsed) and, per the IA, runs and projects.
   - The result count.
   - Actions come from the shared command registry (D-24 / D-60).
8. **Issues.**
   - The match highlight uses **weight 700**; only 400/500/600 are allowed.
   - The iOS clear button is 20×20.
   - Recent-chat rows lead with a chat icon, not the status glyph (Principle 8: "chat rows lead with a status glyph").
   - "Toggle theme Dark → Light": mobile theme follows the system appearance (Settings has a mode), so the effect of a toggle needs a decision.
   - The `.bdg` badges here use the desktop default size, not the mobile h24 / h26 badge.

### MServers — Server switcher

1. **Purpose.** Servers sheet opened from the drawer's server button. The stacking is Home → drawer → scrim → sheet (two scrims).
2. **Chrome.**
   - **iOS:** `.sheet-i` h396, inset 8, r38, grabber 36×5. Header h52: 44 spacer, centred "Servers" 17/600, glass ✕ 44.
   - **Android:** `.sheet-a` h452, r28 top, handle 32×4. Title "Servers" 22/600, left-aligned. ✕ `aib` 48.
3. **Components.** Server rows:
   - Current server: row with a `$selected` background; monitor 20 icon; "This computer" 17/600 (iOS) / 16/600 (Android); dot + "Connected · local:3100"; trailing ✓.
   - Offline server: server icon `$fg-3`; "build-box"; hollow dot + "Offline · 10.0.4.12:3100"; trailing "Retry" text button (44 / 40 tall).
   - Rows min-h 64 (iOS) / 72 (Android).
   - A second group: "Add server…" ("Scan or enter code" → MPairing) and "Manage servers" ("Security & devices").
   - Footnote: "Each server has its own pairing. Switching reconnects Home, chats and live runs to that server."
4. **iOS vs Android.**
   - The iOS groups use a `$selected` fill at r22, not `$raised` `igroup`: an inconsistency.
   - Android uses flat rows with a divider and puts the selected row's fill full-bleed.
5. **Native features.**
   - Sheet detents (medium).
   - Per-server Keychain / Keystore keys (the existing `generatorai-device-key` module).
   - Local-network permission (iOS NSLocalNetworkUsageDescription) for LAN servers.
6. **States.** Connected, Offline + Retry. Missing:
   - switching in progress;
   - pairing revoked;
   - an auth error (revoked key; `app/revoked.tsx` exists in code with no board);
   - a single server (is the sheet still shown?).
7. **Server data.**
   - The list of paired servers is client-side.
   - Reachability per server: a probe of each server's health.
   - Server display name (`/system/info` name).
8. **Issues.**
   - **Multi-server is new.** MAudit: "1 server at a time; re-pairing replaces it".
   - Every deep link, notification, widget and Live Activity must carry a server id. No board shows which server a notification came from.
   - The iOS sheet header uses a 44 spacer left and ✕ right. Other sheets put ✕ left (MModelPicker, MAgentPicker), so ✕ placement is inconsistent across iOS sheets.

### MScopeRequest — Workflow · request edit access

1. **Purpose.** The workflow detail ("Nightly dependency audit") on a device without the `write:workflows` scope. It shows a permission-limited banner card and the request flow. Presentation: pushed detail.
2. **Chrome.**
   - **iOS:** glass back chevron; centred breadcrumb "Workflows › payments-service" over "Nightly dependency audit" 16/600; glass ⋯.
   - **Android:** back arrow; left breadcrumb over 18/600; ⋮.
   - **Meta line:** mono "v7 · last run #248", a Needs you badge, "· daily 02:00".
3. **Components.**
   - **Scope-request card** (a new component): 1px `$line`, r22 / r16, `$raised`.
     - Header h44 / h48, `$selected`: lock 18 + "This device can't edit workflows" 16/600.
     - Body 15 / 14 `$fg-2`.
     - **Scope checklist:** rows h44 / h48. iOS: 22 circle check. Android: 18 r3 checkbox. Label, mono scope id (`write:workflows`, `exec:terminal`). "Sensitive" in `$warn` with file-warning 12.
     - "Reason (optional)" field: iOS h44 r12 `$sunken`; Android outlined h56 r4 with a floating label.
     - A 3-step inline stepper: "1 Request → 2 Admin approves → 3 Edit".
     - "Check again" text button and "Request access" primary button (arrow-up).
   - **Stage list:** "Stages 6". Links: lock "Edit" (disabled, aria "needs write:workflows") and "Graph".
     - Rows h44 (iOS, `igroup`) / h48 (Android, flat).
     - 24 circled mono index, 16 / 15 name, mono stage id; a hand 14 marks the approval stage.
   - **Floating primary "Run":** iOS glass capsule with play 20; Android ink FAB.
4. **iOS vs Android.** Circle vs square checkboxes; filled vs outlined text field; glass vs ink Run.
5. **Native features.**
   - Push to the admin device; the approval arrives as a notification on the admin device (not drawn).
   - Biometric step-up for `exec:terminal` (MAudit's step-up).
6. **States.** Not requested. Missing: request pending ("Waiting for admin"), approved, denied or expired, and the admin-side approval screen.
7. **Server data.**
   - The device's current scopes.
   - A requestable-scope catalogue: id, label, sensitive flag.
   - `POST` scope request with a reason; request status.
   - Workflow meta: version, last run, schedule, stages (name, id, gate flag).
8. **Issues.**
   - The canvas title says "Workflow · request edit access". This board belongs to Workflows (and to Settings › Security for scopes), not Home.
   - The iOS stage rows are 44 tall (< 52).
   - The iOS "Run" is **glass**, but MPrinciples says Run is the one ink action, and Android draws it ink. Pick one.
   - Two prominent actions are on screen at once ("Request access" filled + the Run FAB on Android).
   - The Android checkbox is inset 2px (18 in a 22 box) to align with iOS; fine.

### MPairing — Pairing · first run

1. **Purpose.** First-run full screen: connect to a server. It has no header or back, since it is the root before pairing.
2. **Layout.**
   - **iOS:** padding 8 24.
     - 36 app logo.
     - Title "Connect to a GeneratorAI server" **24/600** ls −0.01em (not in the iOS ramp).
     - Body 15 `$fg-2`.
     - **QR viewfinder:** h220, r28, `$sunken`, 148 frame with 34 L-corners (4px `$fg`, r16) and a scan line.
     - Caption "Point at the QR code on your computer".
     - Glass 40 **Torch** button (zap icon), top-right.
   - Then an "or enter the code" divider, then a **6-cell code**: 3 + dash + 3, mono 22/500.
     - iOS cells 44×52, r12, `$raised`.
     - Android cells 46×56, r8, transparent. Android title 28/600 (Headline M), body 14.
   - **Error state drawn:** every cell has a 2px `$err` border, plus "⊗ That code expired — ask for a new one".
   - **Server address:**
     - iOS: label + h48 r12 `$raised` field with mono "http://192.168.1.24:3100" and "● Reachable".
     - Android: outlined field h56 r4 with floating label.
   - **Connect:** full-width primary. iOS h50 r25 17/600; Android h48 r24.
   - Helper text: "Next you choose what this iPhone may do." "Find the code … Settings › Security & devices › Pair a new device, or run `generatorai device invite` on the server."
3. **iOS vs Android.**
   - Viewfinder r28 vs r20.
   - Torch: glass button vs `aib` on `$overlay`.
   - Cells: filled vs outlined.
4. **Native features.**
   - Camera QR scan (expo-camera barcode) and torch.
   - Camera permission prompt.
   - Deep link `generatorai://pair?code=X` (D-55): an OS camera scan should open the app pre-filled.
   - One-time-code autofill: `textContentType="oneTimeCode"` / `autofillHints`.
   - Paste detection.
   - Local-network permission (iOS).
   - Haptic on success (server confirmed).
7. **Server data.**
   - Invite code validation with expiry.
   - A server reachability probe for the address.
   - The next step, choosing scopes, is not drawn: the scope list comes from the server.
8. **Issues.**
   - The iOS title 24 is off-ramp; use Title 20 or Large title 32.
   - Missing states:
     - camera permission denied / no camera (simulator, some Android tablets);
     - scanning success;
     - connecting;
     - wrong server (TLS / cleartext; `withCleartextTraffic` exists);
     - the scope-selection step ("Next you choose…").
   - The address field has no edit affordance, so how the address is set is unclear. Presumably it comes from the QR payload.

---

## 3. Chat and composer

**Shared chat-screen anatomy** (used by Main, MChatRunning, MChatToolsExpanded, MChatNoAgent, MModelPicker, MComposer*, MChatWorkflowRun and the tablets):

- **Header.**
  - **iOS:** glass 44 sidebar toggle; centred two-line title (breadcrumb 12 `$fg-3` "Chats › <project>" over 16/600 title); glass capsule `.gcap` with pane toggle 40 + count badge, and ⋯ 40.
  - **Android:** `.atop` with panel-left 48; left title block (breadcrumb 12 over 18/600); pane toggle 48 + badge; ⋮ 48.
- **Status line** under the header: one `.bdg`. iOS centres it (padding 2 16 8); Android left-aligns it at 56 to match the title. Examples: "Needs you · Bug Fixer", "Running 4:12 · Orchestrator", "Done · Claude Sonnet 5".
- **Pane-toggle count badge:** min-w 16, h16, padding 0 4, r8, `$fg` background with `$surface` text, mono 11 (10 in MComponents). It turns `$run` when counting running background tasks. Position: iOS top 4 / right 2; Android top 8 / right 6.
- **Transcript.**
  - **User bubble:** right-aligned, max-w 320 (iOS) / 330 (Android), `$raised`, 1px `$line-soft`, 16/1.45. iOS padding 11 14, r 20 20 6 20. Android padding 12 16, r 20 20 4 20.
  - **Message meta:** bot 14/16, name 600 `$fg-2`, model `$fg-3`, mono 12 time at the right. 13 on iOS, 14 on Android.
  - **Assistant prose:** 16/1.5.
  - **Tool block, gate cards, resolved-gate row:** "✓ Allowed once `git push …`", min-h 40, r14 / r12, 1px `$line-soft`.
- **Composer.**
  - **iOS:** `.glass`, r28, padding 12 12 8 16, margin 8 12 0.
  - **Android:** `$raised` + 1px `$line-soft`, r28, padding 12 8 8 18, margin 8 12 8.
  - **Placeholder:** "Reply to <agent>…" / "Message <model>…". 16 `$fg-3`, h24.
  - **Action row:**
    - Attach ("Add"): iOS 34 with a 1px `$line` ring; Android 40 or 36×40.
    - Agent chip (bot + name + lock 12): `mchip` / `achip` with transparent border, padding 0 8 / 0 6.
    - Model chip (name + chevron-down).
    - Spacer.
    - Dictate: 34 / 40 or 36×40.
    - Send: iOS 34 circle; Android 48 r16.

### MChats — Chats · list (row mid-swipe)

1. **Purpose.** The Chats module, top-level. One row is mid-swipe, showing its trailing actions.
2. **Chrome.**
   - **iOS:** glass sidebar toggle; glass capsule with "Select chats" (list-checks) and "Sort and more" (⋯). Large title "Chats" 32/600 + mono count "48" 15 `$fg-3`.
   - **Android:** `.atop` with panel-left, "Chats" 22/600 + mono count 14, Select (list-checks 48), ⋮ "Sort and more".
3. **Components.**
   - **Search field.**
     - iOS: h38, r19, `$selected`, 17, search 18, mic 18 at the right.
     - Android: M3 search bar h56, r28, `$raised`, search 22, mic 22.
   - **Filter segments** "All 48 · Active 41 · Archived 7".
     - iOS segmented control: h32, padding 2, r9, `$selected` track; selected segment `$overlay` + 1px `$line` ring, r7, 13/600.
     - Android connected button group: h40; outer ends r20, inner r8; selected `$selected` + ✓ 16, 14/600; unselected 1px `$line-strong`.
   - **Section labels:** "📌 Pinned", "Recent". iOS 13/600 `$fg-3`; Android 14/600 `$fg-2`.
   - **Chat row** (2-line):
     - Height: iOS 68 in `igroup`, padding 12 16; Android 72 flat, padding 12 16, gap 16.
     - Status glyph 18 / 20.
     - Title 16/600. A pin 14 appears when pinned. Relative time mono 12 ("3m", "now", "1h").
     - Meta: mono 12 project · agent (bot 12/14 + name, `$fg-2`) or model name (no icon). Right-aligned ±lines mono 12 (`$ok` / `$err`).
   - **Swipe actions, iOS:** trailing 148 wide: "More" (⋯ 20, `$line-strong` fill) and "Archive" (archive 20, `$fg-2` fill with `$surface` text), each 74 wide, 13/600, full-height.
   - **Swipe actions, Android:** two **pill buttons** (76 wide, r16, top and bottom inset 4, right 8). The row surface slides left with r 0 16 16 0 and a 1px `$line-soft` ring.
   - Floating New.
4. **iOS vs Android.** Grouped inset vs flat rows. Segmented vs connected group. Search 38 vs 56. Swipe-action shapes differ.
5. **Native features.**
   - Swipe actions: `Swipeable` / RNGH; iOS UIContextualAction look.
   - Long-press context menu with preview (MComponents / MGestures).
   - Multi-select mode ("Select chats") with a bulk bar (not drawn).
   - Pull-to-refresh.
   - VoiceOver custom actions for Pin / Unread / More / Archive.
   - Haptic `impact light` at the full-swipe threshold.
   - Dictation in search.
6. **States.** Populated with a swipe revealed. Missing:
   - empty (no chats, no archived);
   - search results and no results;
   - selection mode with the bulk action bar (Archive / Delete, D-52's bulk endpoints);
   - loading and pagination;
   - the unread indicator (the gesture exists; no unread visual is drawn);
   - archived-row appearance.
7. **Server data.** `GET /chats` (D-52):
   - `counts {all, active, archived}` and `total`;
   - per row: status (the attention-derived state), title, project name, agent name *or model name*, `changes {added, removed}`, `lastActivityAt`;
   - **pinned** and **unread** flags (not in `ChatRowModel`);
   - `chat.updated` SSE for live updates.
8. **Issues.**
   - Android swipe does not match MComponents: one full-bleed Archive there, two pills here.
   - The header actions don't match MComponents (Search + Filter).
   - The Pinned group is not in the desktop design, and D-59 has no pinning.
   - "Mark unread" needs a server field.
   - Model-only rows need a model field in `ChatRowModel`.
   - The iOS search field is 38 with 17 text; the catalogue says 40 / 16.

### Main — "Chat · permission request"

1. **Purpose.** The chat waiting on a permission gate. Canvas title "Chat · permission request". The primary chat state.
2. **Chrome.** The shared chat header. Badge "Needs you · Bug Fixer". Pane toggle aria "Open workspace pane, 2 changes".
3. **Components.**
   - User bubble; meta "Bug Fixer · Sonnet 5 · 14:02".
   - **Collapsed tool block:**
     - Border 1px `$line-soft`, r14 / r12, padding 11 12 (iOS) / 12 12 12 14.
     - Layers 18 `$fg-2`.
     - Title "Read 3 files, ran 2 commands, edited 1 file" 15/600.
     - Sub: "1 failed" `$err` · mono "6 steps · 2m 44s". Sub is 13 on iOS, 14 on Android.
     - Chevron-down.
   - Assistant prose.
   - **Permission gate card:**
     - Border 1px `$line`, r20 (iOS) / r16 (Android), `$raised`.
     - Header h40 / h44, `$warn-bg`: hand 16 / 18, "Allow this command?" 15/600 / 16/600, category "Network" 12 `$fg-3` at the right.
     - Body: mono code block (padding 10 12, r12 / r8, `$sunken`, 13) "git push -u origin fix/checkout-flake"; explanation 13 / 14 `$fg-3`.
     - Actions: "Always allow" text button (h44 / 40, `$fg-2`) · spacer · "Deny" (secondary) · "Allow once" (primary).
   - Composer, idle (Send ink).
4. **iOS vs Android.** Card radius 20 vs 16. Button heights 44 vs 40. Font steps +1 on Android.
5. **Native features.**
   - Face ID / biometric on "Allow once" for risky categories (Principle 5, MNotifications).
   - Success haptic only after the server confirms.
   - Keyboard avoidance for the composer.
   - VoiceOver: announce "Needs you".
6. **States.** Gate pending. Resolved is shown in MModelPicker ("Allowed once" row). Missing: denied, expired, and "answered on another device".
7. **Server data.**
   - Gate: kind (permission), category ("Network"), the command, an explanation, and available decisions (once / always-in-chat / deny).
   - Tool-block summary: counts by verb, failures, step count, duration.
   - Chat status, bound agent and model.
   - Pane count (changes).
8. **Issues.**
   - **Send is ink while the gate blocks.** MComponents' waiting state disables Send and shows "Answer the permission above to send" / "Cancel and send".
   - "Always allow" here vs "Always allow in this chat" (a separate 30-tall link below the buttons) in MComponents. The scope wording matters.
   - Header: sidebar toggle rather than back.
   - The right side of the user bubble renders clipped in the PNG, apparently overflowing the 16 gutter: a board defect.

### MChatRunning — Chat · orchestrator running

1. **Purpose.** An orchestrator chat mid-turn with delegated background tasks.
2. **Chrome.**
   - Badge `s-run` "⟳ Running 4:12 · Orchestrator".
   - Pane badge `$run` "2", aria "Open workspace pane, 2 background tasks running". The count now means tasks, not changes.
3. **Components.**
   - **Running tool block:**
     - Border `$line`.
     - Header "Delegated 2 tasks, reading files… 3 so far", "5 steps · 1m 12s", with a loader.
     - A **current-step sub-row** (h40, indented 28 / 30, top border): loader 14, "Reading" `$fg-2`, mono path 13, mono timer `$run`.
   - **Background tasks card** (a new component), r14 / r12, 1px `$line-soft`:
     - Header link h40: list-tree 16, "Background tasks" 13/600, count, "Open ›" (opens the pane's Tasks tab).
     - Task rows min-h 44 (iOS) / 48 (Android): status glyph 16 (loader `$run` / circle-dashed `$fg-3`), title 14, "bot 12 + worker agent" 12 `$fg-3`, mono elapsed or "Queued".
   - A **streaming caret** (2×18 `$fg`) at the end of the prose.
   - **"↓ Latest" jump pill:**
     - iOS: glass h40 r20, bottom 166.
     - Android: `$overlay` + `$shadow-pop`, bottom 176.
   - **Composer running state:**
     - A status strip on top: loader, "Working", mono `$run` "4:12", "· reading Canvas.tsx", ±lines, with a bottom divider.
     - Placeholder "Reply to Orchestrator…".
     - Send becomes **Stop** (filled square) in ink.
4. **iOS vs Android.** Glass vs tonal "Latest" pill. Android composer icon buttons are 36×40.
5. **Native features.**
   - A Live Activity / Live Update starts for a long-running turn (MLiveActivity).
   - Reduce Motion stops the spinning loaders (MFoundations).
   - Background execution continues server-side.
   - Haptic `error` if the run fails.
6. **States.** Running with tasks (running + queued). Missing:
   - Stop pressed ("Stopping…", D-29's force reset after 15 s);
   - a task failed;
   - a turn error;
   - reconnecting while streaming.
7. **Server data.**
   - Live turn state: current step verb + target, per-step timer, step count, elapsed.
   - Delegated tasks: id, title, worker agent, status, elapsed.
   - Changes ±.
   - SSE stream.
   - Task cancel (D-55 G-20) belongs in the pane.
8. **Issues.**
   - The running composer is not the MComponents running composer (placeholder "Queue a follow-up…" + timer), and D-29 forbids a queue.
   - The pane-badge meaning changes by context (changes, tasks, background tasks). Define one rule, e.g. "attention count of the most relevant tab", or show the count per tab.

### MChatToolsExpanded — Chat · tool block expanded in place

1. **Purpose.** The collapsed tool block from Main, expanded in place.
2. **Components.**
   - **Expanded step list:** a `$raised` background under the header, rows min-h 44 (iOS) / 48 (Android), padding 4 12 4 14.
     - Step glyph 16 (circle-check `$ok` / circle-x `$err`).
     - Verb 15/600 ("Read", "Ran", "Edited"), then a mono 13 target `$fg-2`.
     - Optional second line: "3 of 20 failed" `$err`, "50 of 50 passed" `$ok`, or ±lines.
     - Mono duration 12 `$fg-3`; chevron-right 14 (opens step detail).
   - **Inline failure excerpt:** mono 12/18, padding 10 12, r10 / r8, `$sunken`, 1px `$line-soft`, indented 38 / 40. Contents: "✕ applies coupon › total reflects discount", Expected / Received, a stack location.
   - Header chevron-up.
3. **iOS vs Android.** Row 44 vs 48; radius 14 vs 12.
4. **Native features.** None specific. Expansion animation (`.smooth` / M3 spatial).
5. **Server data.** Per step: verb, target, status, duration, outcome summary (test counts), diff ±, and a failure excerpt for failed steps.
6. **Issues.**
   - Rows are 44 here but 38 in MComponents; this board is correct.
   - The step data contradicts MComponents ("4 of 20" vs "3 of 20"). That is demo data only, but the numbers should be consistent before VRT goldens.
   - With ±lines, the Edited row lacks the "✓ Edited" colour semantics for partial failures.

### MChatStepDetail — Chat · step detail (failed command)

1. **Purpose.** A pushed screen for one step: "Fix flaky checkout test › Step 4 of 6" / "Command".
2. **Chrome.**
   - **iOS:** glass back chevron; centred breadcrumb; glass ⋯ (aria "More: copy command, copy output, share").
   - **Android:** back arrow; left title; ⋮.
3. **Components.**
   - **Step heading:** circle-x 20 `$err`, "Ran" 17/600 (iOS) / 16/600, mono 14 command.
   - **Fact strip** (a new component): `$raised` r16, padding 12 0, 3 columns split by `$line-soft`. Status badge "Failed"; "1 Exit code" (mono 16/500); "48.2s Duration". Labels 12 `$fg-3`.
   - **Context line:** clock 14 + mono time "14:03:12" · git-branch 14 + mono "payments-api · fix/checkout-flake".
   - **"Input" section:** mono block `$sunken` r12 / r8, "$ pnpm test …".
   - **Error callout:** padding 10 12, r12 / r8, 1px `$line`, `$err-bg`. "Process exited with code 1" 600; "3 of 20 runs failed: <mono test id>".
   - **"Output" section:** "last 11 of 214 lines" at the right; a mono 12/19 log with coloured ✓ / ✕ lines.
   - **Bottom toolbar.**
     - **iOS:** floating. A glass capsule with ↑ / ↓ step navigation (38×40 each), aria "Previous step: Read recalculate.ts" / "Next step: Edited". Then a glass `mbtn` "Copy" and a primary "Open in Terminal".
     - **Android:** an M3 **bottom app bar** h80, `$raised`: ↑ / ↓ `aib` 48, "Copy" `abtn`, and "Open in Terminal" as a 48 r16 primary (FAB-like).
4. **iOS vs Android.** Floating glass toolbar vs docked bottom app bar. Section labels 13/600 `$fg-3` (iOS) vs 14/600 `$fg-2` (Android).
5. **Native features.**
   - Copy to the clipboard (with a toast?).
   - A share sheet (⋯).
   - "Open in Terminal" jumps to the pane's Terminal tab, which needs the 10-minute Face ID step-up (MAudit).
   - Selectable mono text (long-press select).
6. **States.** A failed command. Missing: running (live output tail), succeeded, other step kinds (Read / Edited, with file preview or diff).
7. **Server data.** Per step: status, exit code, duration, start timestamp, workspace + branch, input, output tail with the total line count (full-output fetch), a failure summary, and previous / next step ids.
8. **Issues.**
   - The iOS step-nav buttons are 38 wide (< 44).
   - The "Open in Terminal" primary competes with Principle 6: it is an ink button that is not Send, Approve or Run.
   - "Step 4 of 6" is a breadcrumb segment but not a real ancestor. Tapping it has no destination.
   - The workspace is shown as "payments-api", while the chat breadcrumb says "payments-service" (project vs codebase). Label the level.

### MChatNoAgent — Chat · no agent (model only)

1. **Purpose.** A chat with no bound agent. The model is the identity.
2. **Differences from Main.**
   - Badge "✓ Done · Claude Sonnet 5".
   - Meta shows "Claude Sonnet 5" with no icon.
   - A turn-end footer line: "✓ Done · mono 1m 06s".
   - Placeholder "Message Claude Sonnet 5…".
   - **No agent chip**; only the model chip.
3. **Composer "changes" strip** (a new component state): git-compare 16, "1 file changed", ±, and a "Review" link (opens the pane's Changes tab).
4. **Server data.** The model display name for a chat with no agent; the turn duration; changes for the chat.
5. **Issues.**
   - The changes strip appears only here. Does it also appear in agent chats that finished with changes (Main has 2 changes and no strip)? Define when it shows.
   - The Send button is ink with an empty field.

### MModelPicker — Composer · model & turn sheet

1. **Purpose.** The **"Next turn"** sheet, opened from the model chip.
   - iOS: `.sheet-i`, top 76 (large detent).
   - Android: `.sheet-a`, top 64 (full height).
2. **Header.**
   - **iOS:** glass ✕ 44 (left), centred "Next turn" 17/600, primary "Done" (`mbtn-p`) right.
   - **Android:** ✕ 48, "Next turn" 22/600, primary "Done" (`abtn-p`).
3. **Components.**
   - **Provider:** a segmented control with "Claude Code" and "🔒 GitHub Copilot" (locked). Note: "GitHub Copilot isn't signed in on This computer. Sign in from Settings, then refresh."
   - **Model:** section label + a "Search" link. A bordered list r16:
     - Tier headers 12 `$fg-3`: Fast / Balanced / Powerful.
     - Rows h42 (iOS) / h46 (Android): selection indicator 20 (iOS ✓; Android radio 20 with a 2px ring and a 10 dot), name 16/500 (600 when selected, row `$selected`), mono context "200K" / "200K · 1M", and an info 16 button (aria "Model details").
     - Models: Claude Haiku 4.5; Sonnet 5; Sonnet 4.6; Opus 5.5; Opus 4.
   - **Mode:** segmented "✦ Auto" (sparkles) / "Plan". Help text "Works autonomously and applies changes directly."
   - **Effort:** inline label 64 wide + segmented Low / **Medium** / High.
   - **Context:** Standard 200K / Long 1M.
   - **Context usage row** (a new component): a 32 ring gauge (SVG, 4px `$line-strong` track), "42% of context used" 15/600, mono "84.2K / 200K tokens", "Breakdown ›". It is a link, min-h 56, r16, 1px `$line-soft`.
4. **iOS vs Android.** Segmented control vs connected button groups, with ✓ in the selected segment. ✓ vs radio for single choice. Row heights 42 vs 46.
5. **Native features.**
   - Sheet detents; the sheet grows to large.
   - Selection haptic on segment changes (MFoundations).
   - Could use native `UISegmentedControl` / M3 `SingleChoiceSegmentedButtonRow`.
6. **States.** A locked provider. Missing: loading the model catalogue, a model unavailable for a provider, no models, and a dirty-close confirmation.
7. **Server data.**
   - Harness catalogue (D-55 `buildModelPickerCatalog`): providers with ready / sign-in state; models with tier, context sizes and details.
   - Modes and effort levels per model.
   - Context usage (tokens used / window) plus a breakdown.
8. **Issues.**
   - This conflicts with MComponents' "Turn setup" (title, rows vs full controls, no Done).
   - "Done" is a second ink action in a chat screen.
   - Model rows are 42 (< 44 iOS / 52 rule); info targets are 16.
   - Changing the Provider mid-chat: is that allowed? The desktop composer locks the agent, not the provider. Clarify what "Next turn" allows to change.
   - Effort and Context use left labels while Provider, Model and Mode use section headers: two layouts in one sheet.

### MComposerPlus — Composer · + menu open

1. **Purpose.** The composer's "+" menu.
   - iOS: a glass popover menu, w332, r22, `$shadow-pop`, left 14, bottom 150, no scrim.
   - Android: an M3 menu, w332, padding 8 0, r16, `$overlay`, `$shadow-pop`.
2. **Items.**
   - **iOS:** rows h46, padding 0 18, 17 text, trailing icon 20. Group separators are 8px `color-mix(fg 6%)` bands.
   - **Android:** rows h48, padding 0 16, 16 text, leading icon 22 `$fg-2`, 1px dividers with 8 margins.
   - Groups:
     1. Attach file · Photo library · Camera.
     2. Screenshot of browser · Paste from clipboard.
     3. Skills & commands · Mention file.
     4. A **switch row** (`role=switch`, min-h 64): "Workflows" / "Let this chat run workflows" / "Off by default · on for orchestrators".
   - Off switch: iOS `$line-strong` track + `$fg-2` thumb with shadow; Android `$sunken` + 2px `$fg-3` outline, thumb 16.
   - The "+" button shows an active state (`$selected`) while the menu is open.
3. **iOS vs Android.** Trailing vs leading icons; banded vs line separators.
4. **Native features.**
   - Document picker (UIDocumentPicker / SAF).
   - Photo picker (PHPicker / Android Photo Picker, no permission).
   - Camera.
   - Clipboard read: iOS 16+ shows a paste permission prompt; `UIPasteControl` avoids it.
   - The browser screenshot comes from the server-side browser.
5. **Server data.** Attachment upload; a browser capture endpoint; the per-chat "can run workflows" flag (default by agent type).
6. **Issues.**
   - A native iOS `UIMenu` cannot host a switch row. Either draw a custom JS popover (and lose system menu behaviour) or model the toggle as a stateful menu item (✓ "Let this chat run workflows"). Android `DropdownMenu` can host a custom row.
   - The iOS menu is glass. It is floating chrome, so this is acceptable, but it is not in the glass list.
   - No dismiss scrim is drawn; tap-outside behaviour is needed.
   - A permission toggle inside an attach menu is hard to discover. The same capability appears as "Orchestration" in MAgentPickerCaps and "Orchestrate mode" in MNewChat: three names for related concepts.

### MComposerInput — Composer · / suggestions & attachments

1. **Purpose.** The slash-command popup above the composer, with two attachments queued.
2. **Components.**
   - **Suggestion popover:**
     - iOS: glass, r24, left and right 12, bottom 196, `$shadow-pop`.
     - Android: `$overlay`, r16.
     - Header "Commands & skills" 13/600 with count "5".
     - Groups: Tools, Skills, Prompts, with 12 `$fg-3` labels.
     - Rows min-h 52 / 56: icon 20, mono 14/500 "/browser", description 13 `$fg-3`, trailing type tag 12 ("tool" / "skill" / "prompt"). The first row is highlighted (`$selected`).
   - **Attachment chips** (in the composer, above the text):
     - iOS h36, r12; Android h40, r8. 1px `$line`, `$sunken`.
     - Image: 28 / 32 thumbnail tile with `$selected` background. File: file-text icon.
     - Filename 14; remove ✕ 14.
   - Text "/" with caret.
3. **iOS vs Android.** Glass vs tonal popover; row heights 52 vs 56; chip 36 r12 vs 40 r8.
4. **Native features.**
   - The software keyboard (not drawn): the popover must sit above it, which needs keyboard-aware layout.
   - Hardware keyboard ↑ / ↓ / Enter / Tab.
   - Drag-and-drop of files and images into the composer (iPad, Android tablets).
   - Image paste.
5. **Server data.** Slash-command catalogue (tools, skills, prompts with descriptions, filtered by the agent's capabilities); upload progress and size limits.
6. **Issues.**
   - The ✕ remove target is 14. Upload progress, upload failure and oversize states are missing.
   - "@" mention suggestions are not drawn (the + menu has "Mention file").
   - "Commands & skills" (popover) vs "Skills & commands" (menu) are worded inconsistently.

### MComposerVoice — Composer · dictation

1. **Purpose.** In-composer dictation.
2. **Components.**
   - Live transcript text: committed text in `$fg`, the pending word ("code") in `$fg-3`.
   - A **dictation pill** replacing the chips:
     - iOS h36 r18 / Android h40 r20, `$selected`.
     - A 22-bar waveform (3 wide, heights 3–24, recent bars `$fg`, tail `$fg-3`), "Listening…" 14 `$fg-2`, mono timer "0:07".
   - "Discard dictation" ✕ (34 / 40).
   - "Stop dictation and keep text": ink filled square (iOS 34 / Android 48 r16).
3. **iOS vs Android.** Sizes only.
4. **Native features.**
   - On-device speech recognition (SFSpeechRecognizer / Android `SpeechRecognizer`), with mic and speech permissions.
   - Audio-session interruptions.
   - The waveform must stop under Reduce Motion.
   - VoiceOver focus on the "Listening" live region.
   - MAudit: dictation already exists.
5. **States.** Listening. Missing: permission denied, recognition error, no speech, offline recogniser.
6. **Server data.** None, unless server-side transcription is used (Settings › Audio).
7. **Issues.**
   - The "Stop dictation" icon (filled square, ink) is identical to the agent **Stop** button. That is confusing when an agent is also running. Use a checkmark or "Done".
   - The 34 targets on iOS.

### MNewChat — New chat · task, who works, model

1. **Purpose.** Create a chat. Drawn as a **full-screen modal**.
2. **Chrome.**
   - **iOS:** glass ✕ "Cancel" (left), centred "New chat" **16/600**, 44 spacer.
   - **Android:** ✕ 48 + "New chat" 22/600.
   - **Bottom action bar:**
     - iOS: floating glass, left and right 12, bottom 30, h64, r32. Summary "bot Bug Fixer · Sonnet 5" 14/600 over "1 worktree and 1 branch will be created" 12 `$fg-3`; primary "Create chat" h48 r24.
     - Android: a docked `$raised` bar h76, top border; `abtn-p` h48 **r16**.
3. **Components.**
   - **Task field:**
     - iOS: `$raised` r16, padding 12 16, 16/1.45 text.
     - Android: outlined r4 with floating label "Task".
     - An inline toolbar: paperclip 18, "@ Files", "/ Skills" (13 `$fg-2`).
     - Hint "Sent as the first message".
   - **Name / Description:**
     - iOS: form rows in `igroup`, label 96 wide, placeholder `$fg-3`: "Named from the task", "Shown in the list (optional)".
     - Android: outlined fields.
   - **"Who works on this":** a 3-way segment "Just a model / **An agent** / An orchestrator". Hint "Fixed once the chat starts". Help "Reusable instructions with their own skills and MCP servers."
   - **Agent row:** bot 20, "Bug Fixer" 16/600 + "Project" scope tag 12, mono "3 skills · 1 MCP · claude-sonnet-5", chevron (opens MAgentPicker).
   - **"Orchestrate mode"** switch row: "Split across background agents".
   - **Model:** "Claude Sonnet 5" 16/600 + "Balanced · 200K · Claude Code", chevron. Effort segmented L / **M** / H in a 210 / 230 box.
   - **Android grouped rows use the M3 expressive "segmented list":** items separated by 2px, first r 20 20 4 4, last r 4 4 20 20, `$raised`, min-h 56, gap 16.
4. **iOS vs Android.** Inset grouped form vs outlined fields + segmented list. Glass floating action bar vs docked bar. Title 16 vs 22.
5. **Native features.**
   - Keyboard with an accessory (Files / Skills); the bottom bar must ride above the keyboard.
   - Dirty-dismiss confirmation.
   - Dictation into the task field.
6. **States.** Filled, with the agent selected. Missing: model-only and orchestrator variants of the form, validation (empty task), creating (progress), and a failure such as worktree creation failing.
7. **Server data.** Agents (scope, skills and MCP counts, default model), the default model from Settings, harness catalogue, effort levels, and the worktree / branch plan preview.
8. **Issues.**
   - Full-screen with ✕ only, while the IA says a sheet and the modal rule says Cancel + Save in the header. The sticky bottom CTA is a third pattern.
   - The iOS title is 16/600, the detail-title size, but this is a modal: iOS modal titles are 17/600 (Headline).
   - The iOS primary is h48 r24, while `mbtn` is 44 (MPairing uses h50): three primary heights.
   - The "Orchestrate mode" switch duplicates the "An orchestrator" segment.

### MNewChatMore — New chat · where, capabilities, more (scrolled)

1. **Purpose.** The same modal, scrolled.
2. **Components.**
   - **Where** ("Starts in the working directory"):
     - Project row: folder 20, mono "payments-service" 15/500, "2 codebases", chevron.
     - **Codebase card** (a new component), r20 (iOS) / r16 + border (Android), `$raised`:
       - git-branch 16, "payments-api" 16/600, mono branch chip "main" (h22, r6 / r4, `$selected`);
       - "✓ Working dir" marker (iOS ✓; Android radio);
       - mono remote "github.com/acme/payments-api";
       - two segments: Worktree / In place, and New branch / Existing branch;
       - a branch-name mono field (h34 r10 / h40 r4, `$sunken`) "generatorai/fix-flaky-checkout-test" + "from main".
     - Second codebase row "checkout-web": "In place · stay on main · C:\src\checkout-web".
     - Secondary buttons "+ Add codebase", "📁 Add local folder" (h38 / h40).
   - **Capabilities** ("Added to Bug Fixer's own"): shield-check row "5 skills · 2 MCP · Shell on" / "3 from agent + 2 added" + a "Customize" text button (opens MAgentPickerCaps).
   - **More (optional).**
     - Tag chips "checkout" ✕, "flaky-test" ✕, and a dashed "+ Tag".
     - Browser: segmented Headless / Visible / Off. Help "Runs invisibly. Fast, safe, recommended default."
3. **iOS vs Android.** Segments vs connected groups; radio for the working-directory choice; tag chips `mchip` vs `achip`.
4. **Native features.** None beyond forms. "Add local folder" refers to a folder on the **server**, not the phone.
5. **Server data.** Project codebases (remote, default branch, local path), worktree settings, branch naming, tags, browser modes and capability counts.
6. **Issues.**
   - "Add local folder" is ambiguous on a phone; it needs a server-side folder browser. The path "C:\src\checkout-web" also shows a Windows server path, which is correct for cross-platform.
   - The iOS buttons are 38 tall. The tag ✕ is 14.
   - The Browser row uses a 236 / 250 wide segmented control, which will not fit at large Dynamic Type.

### MAgentPicker — Agent picker sheet

1. **Purpose.** The sheet over New chat to pick an agent.
   - iOS: `.sheet-i`, top 70.
   - Android: `.sheet-a`, top 60.
2. **Header.**
   - **iOS:** glass ✕; centred "Agent" 17/600 over "Fixed for the life of the chat" 12; "Manage" text button (44).
   - **Android:** ✕ 48; "Agent" 22/600 + subtitle; "Manage" (h40).
3. **Components.**
   - **Search:** iOS h38 r19 `$selected`; Android h48 r24 `$selected`.
   - **Scope filter:** All 6 · Global 3 · Project 1 · Built-in 2 (segmented / 4-part connected group).
   - **"No agent — just a model" row:** cpu 20, 16/600, description 13.
   - Sections "Orchestrators" and "Workers".
   - **Agent row** (padding 10 14 / 12 16, r14 / r16; selected `$selected`):
     - bot 20; name 16/600 + scope tag 12 `$fg-3`;
     - description 13 `$fg-2`;
     - the team line ("users" 14 + "Bug Fixer, Code Reviewer, Test Writer") for orchestrators;
     - mono "claude-opus-5-5 · 2 skills · 1 MCP";
     - trailing ✓ 18.
   - **Footer:** secondary "⚙ Customize capabilities" + primary "Use Bug Fixer".
4. **iOS vs Android.** Search 38 vs 48. Android uses a trailing ✓ where MModelPicker uses radios.
5. **Native features.** Sheet detents; search keyboard.
6. **States.** List. Missing: empty search, no agents, loading.
7. **Server data.** Agents with scope (global / project / built-in), description, team members, model, skill and MCP counts; counts per scope.
8. **Issues.**
   - "No agent — just a model" duplicates the New chat "Who works on this" segment.
   - The segment "An orchestrator" vs the "Orchestrators" section and the "Orchestrate mode" switch: pick one model.
   - The Android search style differs from the catalogue.
   - "Manage" leaves the modal stack. Where does it go (Agents module), and is the New chat draft kept?

### MAgentPickerCaps — Agent picker · customize capabilities

1. **Purpose.** The second page of the agent sheet.
   - iOS: pushed *inside* the sheet (back chevron "Back to agents").
   - Android: a second sheet over the first. **Two stacked scrims**, `.sheet-a` top 40.
2. **Header.** "Customize capabilities" / "For Bug Fixer in this chat" plus a "Reset" text button.
3. **Components.**
   - Help text "Adds to Bug Fixer's own, for this chat only."
   - **Nav rows:**
     - Skills (book-open) "triage-flake, write-tests, git-hygiene from agent + 2 added", mono "5/9".
     - MCP servers (plug) "github from agent + playwright", "2/4".
     - Extra instructions (file-text) "Appended after Bug Fixer's own", "None".
   - **Capabilities list** "5 of 8 on", switch rows min-h 52 / 56: Read files, Write files, Run shell commands, Integrated browser, Web fetch & search, Widgets & canvas, Extension authoring, Orchestration.
   - Changed rows show a "**Changed** ↶" chip (aria "Changed for this chat. Reset to Bug Fixer's setting").
   - **Switches:**
     - iOS 51×31, on `$accent`, thumb 27 `$on-accent` with a shadow.
     - Android 52×32, on `$accent` with a 24 thumb containing a ✓ 14. Off: 2px `$fg-3` outline + 16 thumb.
   - **Footer:** summary "5 skills · 2 MCP · 5 of 8 capabilities" + primary "Done".
4. **iOS vs Android.** In-sheet navigation vs a stacked sheet. Android switches carry a thumb icon (M3).
5. **Native features.** Native switches (UISwitch / M3 Switch via Expo UI). Selection haptic on toggle.
6. **Server data.** Agent defaults per capability; per-chat overrides (new); the skills and MCP catalogue with the agent's own set; extra instructions.
7. **Issues.**
   - The Android sheet-on-sheet with a double scrim darkens the page. M3 recommends replacing the content or using full-screen.
   - Capabilities "Orchestration" vs "Workflows · Let this chat run workflows" (+ menu) overlap.
   - Can a *disabled* capability be re-enabled beyond the agent's own? "Adds to" implies additive only, but the switches allow turning off.
   - A 60 × 8 row list inside a sheet needs the large detent.

### MChatWorkflowRun — Chat · workflow run, approval and draft cards

1. **Purpose.** An orchestrator chat that runs workflows. It shows in-transcript workflow tool cards.
2. **Chrome.**
   - Title "Stabilise checkout".
   - Badge "Needs you · Orchestrator".
   - Pane badge "3" (aria "3 tasks").
3. **Components.**
   - **Tool-call line** (a new compact form): circle-check 16, mono tool name (`run_workflow`, `check_workflow_run`, `create_workflow_draft`) in `$fg-2`, the target, mono duration. Min-h 24.
   - **Run card** (r14 / r12, 1px `$line-soft`):
     - workflow 18, "Nightly dependency audit" 15/600, mono "#249", `s-run` badge;
     - "Stage 2 of 6 · Assess risk" … "v7 · 3m 12s";
     - a **6-segment stage progress bar** (4px, r2; `$ok` / `$run` / `$line-strong`) + mono "2/6";
     - an "Open run" secondary (h40, external-link).
   - **Review / approval card:**
     - Header h40, `$warn-bg`: "Review Apply upgrades", mono "round 1 of 3".
     - Body 15 with a "View in run" underlined link.
     - Actions: "Reject" (`$err` text button), "Request changes" (secondary), "Approve" (primary).
   - **Draft card:**
     - "Checkout flake hunter" + `s-idle` badge "✦ Agent draft".
     - "4 stages · risk" + outline tags "Writes files", "Opens a PR" (h24, r12 / r6).
     - "Not published" + "✎ Open in builder" + "Publish" (secondary).
4. **iOS vs Android.** Radii (14 vs 12, tags r12 vs r6); button heights.
5. **Native features.** Approve may require Face ID (Principle 5). Success haptic after the server confirms.
6. **Server data.**
   - Workflow run: id, number, version, status, current stage index and name, stage statuses (for the segments), elapsed.
   - Review gate: stage, round n of max, summary.
   - Drafts: name, stage count, risk flags, published state.
   - Orchestrator tool calls with durations.
7. **Issues.**
   - The approval card here (r14, no fill, `$line-soft`) differs from the permission card in Main (r20, `$raised`, `$line`). Gate cards should share one shell.
   - "Reject" in `$err` next to "Request changes" and "Approve" makes three decision buttons; on a 402 phone they may wrap.
   - The stage bar tints segments with status colours. Principle 6 says status colour never tints a *bar*; clarify that this means the header bar.
   - The Publish button is not a primary, although publishing is the decisive action.

---

## 4. System surfaces

### MNotifications — Notifications

1. **Purpose.** How GeneratorAI notifications look on the iOS Lock Screen and in the Android notification shade.
2. **iOS Lock Screen.**
   - **Expanded permission notification** (long-pressed), glass r24, padding 14:
     - 38 app icon.
     - Header "⏱ Time Sensitive · Needs you", "now".
     - Title "Bug Fixer needs permission" 15/600; body "Fix flaky checkout test · payments-service".
     - A mono code block, r12 `$sunken`.
     - A footnote "Network · publishes the branch for a PR".
   - **Action list** below it (glass w268 r20):
     - "Allow once" + "🔒 Face ID required" (min-h 58), ✓.
     - "Deny" ✕.
     - "Open" ↗.
   - **Question** notification: "Orchestrator asks: migrate all 9 custom edge types now, or keep a v11 shim for this PR?" with an **inline reply field** (h40 r20 `$sunken`) + an ink send 40.
   - **Needs-you approval** notification: "Nightly dependency audit #248 / Approve Apply upgrades · 14 packages, 3 majors".
   - A **stacked group:** "✓ Done · 2 chats done · Draft release notes 2.4 · Audit IAM policies" (a summary with two ghost cards behind it).
3. **Android shade.**
   - **Quick Settings row:** 4 tiles, h56 r20: Internet (on, `$accent`), DND, Dark theme (on), **"Pause agents"** (off, circle-pause).
   - **Grouped notification cards:** `$raised`, group radii 28 28 8 8 / 8 / 8 8 28 28, gap 3.
     - Header "GeneratorAI · Needs you · now" + an expand chevron chip (28×22 r11).
     - Title 16/600, body 14 `$fg-2`, code block r8.
     - "🖐 Allow once: fingerprint required".
     - Tonal action buttons "Allow once", "Deny", "Open" (`abtn` + `$selected`).
   - **Question** with a RemoteInput field (h48 r24) + a send `aib` in ink.
   - **Silent section:** "2 chats done".
   - "Clear all".
4. **Categories and actions implied.**

   | Category | Interruption | Actions |
   |---|---|---|
   | Permission (Needs you) | iOS Time Sensitive; Android high-importance heads-up | Allow once (auth required), Deny, Open |
   | Question | Time Sensitive / high | text reply, Open |
   | Approval (run gate) | Needs you | Review / Open (no inline approve drawn) |
   | Done | passive; Android "Silent" | grouped summary |

5. **Native features.**
   - `UNNotificationCategory` with `UNNotificationAction` options `.authenticationRequired` and `.foreground`.
   - `UNTextInputNotificationAction`.
   - `interruptionLevel .timeSensitive` (the Time Sensitive entitlement).
   - `threadIdentifier` / summary grouping.
   - Android: channels (Needs you = high, Done = low / silent), `setGroup` + summary, `RemoteInput`, and `Action.Builder.setAuthenticationRequired(true)` (API 31+, device unlock, not fingerprint specifically).
   - Quick Settings `TileService`.
6. **Server data.** Push payloads per event: chat / run id, **server id**, gate id, category, command text, explanation, question text and options. Action endpoints must work from background (authenticated) with an idempotent answer.
7. **Issues.**
   - "Face ID required" / "fingerprint required" is not literally supported. `authenticationRequired` asks for device unlock (passcode or biometric). A true biometric check means opening the app (a `foreground` action), or accepting unlock as the bar. Owner decision.
   - The iOS "Deny" is not styled destructive.
   - Question options are free text only. The in-app question card has radio options ("With the other fixtures…"), so the push loses them. Consider an action per option (maximum 4 on iOS).
   - Showing command text on the Lock Screen conflicts with the "hide notification previews" privacy setting (MSetAppLock).
   - The Quick Settings row mixes system tiles with ours. Only "Pause agents" is ours, and the "New chat" tile appears in MWidgets.

### MLiveActivity — Live Activity (canvas 1000×1370)

1. **Purpose.** An iOS Dynamic Island and Lock Screen Live Activity, and an Android 16/17 Live Update, for a run waiting on approval (and a running chat).
2. **iOS Dynamic Island** (drawn on black `#000`, forced `t-dark`).
   - **Compact:** 250×37, r19. App glyph 22, "Needs you" 13/600 `$warn`, mono "3/6" 14/500.
   - **Minimal:** a 37 circle with the glyph.
   - **Expanded:** 371 wide, r44, padding 14 22 16.
     - Glyph 24, "Nightly dependency audit" 14/600, mono "#248", mono "12:40" 15/500 at the right.
     - "🖐 Apply upgrades" 16/600 over "Needs you · 14 packages, 3 majors" 13/500 `$fg-2`.
     - Primary "Review" h40.
     - A 6-segment bar (6px, r3; `$ok` ×2, `$warn`, `$line-strong` ×3).
     - Footer "Stage 3 of 6 · approval gate" … "Next: Run test suite" 12/500 `$fg-3`.
3. **iOS Lock Screen.**
   - The same content on a glass card, r24.
   - A second compact Live Activity for the chat: "Upgrade React Flow to v12 / ⟳ Reading `src/builder/Canvas.tsx` / 4:12".
4. **Android.**
   - **Status-bar chip:** h26 r13 `$warn-bg`: glyph 16, "Needs you" 12/600, mono "3/6".
   - **Expanded Live Update notification:** `$raised` r28, header "GeneratorAI · Run #248 · 12:40", title "🖐 Apply upgrades", body.
   - A **segmented ProgressStyle bar:** 8px segments, r4, gap 3, with a **24 tracker icon** (hand on a `$warn` circle, 3px `$raised` ring) at 41.6%.
   - Stage text and a primary "Review" `abtn-p`.
   - Lock-screen version with the grouped chat Live Update below (mono 4:12).
5. **Native features.**
   - ActivityKit: widget extension, `ActivityAttributes` with ContentState, compact / minimal / expanded regions.
   - Push-to-start and push-to-update tokens (APNs `liveactivity`).
   - "Review" as a deep link (widgetURL / `Link`) or an App Intent button.
   - Android 16+: `Notification.ProgressStyle` (segments + tracker icon) with `requestPromotedOngoing(true)` / `setShortCriticalText("3/6")` for the status-bar chip.
   - An FGS or a push-updated notification.
6. **States.** Needs you (gate) and Running. Missing: succeeded or failed end state (dismissal policy), stale / offline, several concurrent runs (iOS shows one in the island), and paused.
7. **Server data.**
   - Run: name, number, stage index and count, per-stage status, gate name and summary, next stage, elapsed.
   - Chat: current step verb + target, elapsed.
   - The server must send APNs Live Activity pushes (or FCM for Android) on every stage change. A **new server capability**: the server holds activity push tokens per device.
8. **Issues.**
   - "12:40" is ambiguous (a clock time, or elapsed 12 min 40 s?). The chat uses "4:12" as elapsed.
   - The expanded island has a `mbtn-p` (ink) Review. On a black island, `$accent` ink = `$fg` (white) is fine in dark, but the island ignores the app theme: always dark.
   - The compact leading uses `$warn` text; there must be a Reduce Transparency / tint consideration for the Lock Screen (iOS 26 tinted / clear Lock Screen styles).
   - The Android chip's `$warn-bg` fill is not controllable (the system tints the chip). Colour will be dropped.

### MShortcuts — App shortcuts and share (canvas 1920×1040)

1. **iOS Home Screen quick actions.**
   - App icon with a red badge "3" (22 `$err`, 13/600).
   - Glass menu w262 r24, rows h50 / 58, 17 text, trailing icons:
     - New chat (square-pen);
     - Home "3 need you" (house);
     - Run workflow… (play);
     - Search (search);
     - system items: Share App, Edit Home Screen, Remove App (red).
2. **Android app shortcuts.**
   - Launcher icon with a notification dot.
   - A shortcut list, w268, grouped rows (h56 / 64, `$overlay`, r 24 24 6 6 … 6 6 24 24).
   - A 36 icon circle `$selected`; label 16; the Home subtitle "3 need you"; drag handles (pinnable).
   - Chips "App info", "Widgets".
3. **iOS share extension "Send to agent"** (a sheet over the host app):
   - Header: ✕ Cancel, "Send to agent", primary "↑ Send".
   - Attachment preview row: file-text in a 44×52 tile; mono "ci-log-4412.txt"; "Plain text · 48 KB".
   - Segmented **Existing chat / New chat**.
   - "Recent chats" `igroup` rows (min-h 60) with a status indicator: `$warn` **dot** for Needs you, loader for running. Title 17, "payments-service · Needs you". ✓ on the selected row.
   - "Agent" row: "Bug Fixer 🔒" + note "Set when the chat was created. Start a new chat to pick another agent."
   - "Note (optional)" multi-line field (min-h 92).
   - Footer: "● This computer local:3100".
4. **Android share target.** The same content as an M3 bottom sheet:
   - title 20/600;
   - a connected group for Existing / New;
   - radio selection rows (the selected row `$selected`);
   - a **filled** text field for Agent (h56, r 4 4 0 0, bottom border);
   - an **outlined focused** Note field (2px `$fg`, label 12/500).
5. **Native features.**
   - `UIApplicationShortcutItem`, dynamic (badge count in the subtitle), via `expo-quick-actions`.
   - Android `ShortcutManager` dynamic shortcuts.
   - An iOS Share Extension target (with App Group + keychain sharing for the device key).
   - An Android `ACTION_SEND` / `ACTION_SEND_MULTIPLE` intent filter; Direct Share targets (recent chats as sharing shortcuts).
   - The app icon badge (the attention count).
6. **Server data.** Recent chats with status; upload of the shared file into a chat; create a chat from a share. Shortcut subtitles need the current attention count (background refresh or push).
7. **Issues.**
   - The share extension's server is fixed (footer only) although multi-server exists. It needs a picker or a "last used" rule.
   - The share list uses a coloured **dot** for Needs you. Principle: status = glyph + word, and elsewhere Needs you is the hand glyph.
   - Android mixes filled (Agent) and outlined (Note) fields in one form; M3 advises one style per form.
   - "New chat" from share: which agent, model and project? It is not drawn.
   - The quick action "Run workflow…" presumably opens a picker sheet, which is not drawn. `generatorai://command/<id>` allowlists only `chat.new` and `workflow.new` (D-60).

### MWidgets — Widgets and controls (canvas 1000×1070)

1. **iOS Home Screen widgets.**
   - **Medium "Needs you"** (364×170, r22, `$surface`, 1px `$line-soft`, padding 14 16):
     - header app glyph 16, "Needs you" 13/600, `$warn` count, "Updated 14:06" 11 `$fg-3`;
     - 3 rows h39: hand 14, title 13/600, sub 11 `$fg-3`;
     - a **"Review" button** h26 r13 `$selected` 12/600.
   - **Medium "Running":** loader header; rows with the title, project or stage, and a mono elapsed.
   - **Small summary** (170×170): three dot rows (Needs you 3 / Running 3 / Done today 4, mono 17/600) + "Updated".
   - **Small empty state:** ✓ "Nothing needs you" / "3 running · 4 done today".
2. **iOS Control Center controls** (2×1, 176×64, r32, `color-mix(fg 12%)`):
   - "New chat · GeneratorAI".
   - "Pause agents · 3 running" (off).
   - "Agents paused · Tap to resume": ink filled, icon circle-pause.
   - "Pause agents · Server offline": opacity .45, unavailable.
3. **Android Glance widgets.**
   - **4×2 "Needs you"** (380×248, r24, padding 12): header app glyph 24 + 16/600; rows h56 in a segmented list (r16 / 6), title 14/600, sub 12 `$fg-2`, "Review" `abtn` h36.
   - **4×2 "Running."**
   - **2×2 summary** (184×184).
   - **2×2 empty.**
4. **Android Quick Settings tiles** (184×72, r24): New chat; Pause agents (off); Agents paused (ink); Server offline (.45).
5. **Native features.**
   - WidgetKit (TimelineProvider + App Group shared store; interactive `Button(intent:)` for Review, or `Link`).
   - `ControlWidgetButton` ("New chat" → OpenIntent) and `ControlWidgetToggle` ("Pause agents") on iOS 18+.
   - Jetpack Glance (`GlanceAppWidget`, `actionStartActivity` / `actionRunCallback`).
   - Android `TileService` (STATE_ACTIVE / INACTIVE / UNAVAILABLE map 1:1 to the drawn states).
   - Widget refresh via push (WidgetCenter `reloadTimelines`; Glance update on FCM).
6. **Server data.** The attention feed (items with gate verb), running items with elapsed (widgets cannot tick live, so use `Text(timerInterval:)` on iOS and Chronometer on Android), counts, "done today", and **Pause agents / resume** (a new global server state and endpoint). Offline detection.
7. **Issues.**
   - Widget typography is 11 (iOS min OK; **Android 11 < 12 sp**).
   - Review buttons are 26 (iOS) / 36 (Android) tall, below target sizes (widget buttons are system-constrained; acceptable but noted).
   - Widgets use `$surface` + border. iOS 18+ tinted / clear widget modes and Android dynamic colour need a variant; status colours must survive tinting (use glyphs).
   - "Pause agents" is a **new product feature**: server semantics (pause all running agents? block new starts?) are undefined, and there is no desktop counterpart.
   - The small widget uses coloured dots only. Words accompany them, so this is acceptable.

### MTabletIOS — iPad landscape

1. **Layout** (iPad Air 11″ landscape, 1194×834):
   - **Sidebar, persistent:** 312 wide, drawn as an **inset floating card** (margin 8 0 8 8, r22, `$raised`, 1px `$line-soft`). The same content as the phone drawer.
   - **Chat column (flex).** Top spacer 24, header h60:
     - glass "Hide sidebar" toggle;
     - centred breadcrumb title;
     - glass capsule with the **pane toggle in its selected state** (`$selected`, aria "Hide workspace pane, 2 changes") and ⋯.
     - Transcript padding 6 24, bubble max-w 380.
     - Composer margin 10 16 16.
   - **Workspace pane, docked:** 410 wide, inset card (margin 8 8 8 0, r22, `$raised`).
     - Header "Workspace" + maximize + ✕.
     - Pill tabs `ptab-i` (Changes 2 selected).
2. **Changes tab content** (richer than the phone catalogue):
   - "+18 −8 · 2 files" + git-branch "fix/checkout-flake".
   - A **3-way compare** segmented control: This turn / **This chat** / Branch vs main.
   - **Checkpoint scrubber card:**
     - history 18, "Turn 3 of 4", mono 14:02, "Compare";
     - a track with 5 checkpoints (a 20 thumb at 75%);
     - time labels start / 14:00 / 14:01 / **14:02** / 14:05;
     - the turn's prompt excerpt, ±, and "↶ Rewind to here" (h36).
   - **Pending comments row:** "1 pending comment · applyCoupon.ts · L20 · Fix", an eye preview 36, "↑ Send all" (h36).
   - **"Changed in this chat" (2)** and **"Also changed in the workspace" (3)** lists. Rows min-h 44: mono status letter (M `$warn`, R `$run`, A `$ok`, D `$err`), path, comment count, ±, a ⋯ file-actions button 36.
   - **Footer:** "2 files ready / into fix/checkout-flake" + primary "Commit…".
3. **Native features.**
   - `UISplitViewController`-like three columns (JS layout is fine).
   - Hardware keyboard (⌘K palette, ⌘N, ⌘\ toggles): not drawn.
   - iPadOS 26 menu bar and window resizing (Stage Manager, windowed apps): not drawn.
   - Pointer hover states.
   - Drag-and-drop files into the composer.
   - Multiple windows (scenes).
4. **Server data.** Checkpoints per turn (time, prompt, ±); compare scopes (turn, chat, branch vs base); pending comments; workspace-wide changes outside the chat; file status letters including renames.
5. **Issues.**
   - **Keep / Keep all / Undo all are absent** (D-28: they stay in Changes). Only Rewind, the file-actions ⋯ and Commit are shown.
   - The phone compare is 2-way (This chat / Branch); the iPad is 3-way (This turn / This chat / Branch vs main). Align the phone.
   - The sidebar and pane are floating inset cards on iPad but edge-attached sheets on the phone: a deliberate iPadOS 26 look, but it needs a rule.
   - Missing layouts:
     - no portrait;
     - no compact width (Slide Over or a narrow window) or split-screen state;
     - no rule for when the pane overlays vs docks (a breakpoint);
     - the tablet Home and lists are not drawn.

### MTabletAndroid — Android tablet landscape

1. **Layout** (Pixel Tablet landscape, 1280×800):
   - **Permanent navigation drawer:** 300 wide, `$raised`, edge-attached. Nav items `.dnav-a` forced to **h44**; Needs-you and Running rows **h36 r18**.
   - **Chat column:** top 24, `.atop` h64 with "Hide navigation drawer", the title block, the pane toggle selected (`$selected` background), ⋮.
   - **Pane:** 400 wide, `$overlay`, left border. Header "Workspace" 18/600 + maximize + ✕. Underline tabs, **Terminal** selected.
2. **Terminal tab content.**
   - Instance chips: "pwsh" (on) and "Agent commands 4"; "+" New terminal 40.
   - Path mono "C:\gai\wt\payments-api" + a "pty" badge + an `s-run` "Agent working" badge.
   - **Toolbar** h48: "Attach" `abtn`, Find, Clear scrollback, Font size, spacer, "Kill" (`$err`).
   - Terminal body: mono 12/19 on `$sunken`, block cursor 7×14.
   - **Key row:** `achip` h40 Esc, Tab, **Ctrl** (sticky, on), ^C, ↑, ↓, ⋯ "More keys".
   - Status footer: "node running · pwsh 7.5 · pid 18244" + "48×32".
3. **Native features.**
   - Hardware keyboard: the terminal must own keys (`data-gai-keys="own"` equivalent). Ctrl stickiness only for the soft keyboard.
   - Android large-screen: resizable windows, desktop windowing, drag-and-drop.
   - Stylus: n/a.
4. **Server data.** Terminal instances (user shells + agent command sessions), cwd, pty kind, process status (pid, running command), size, agent-working flag.
5. **Issues.**
   - The permanent drawer items are 44 and 36, below 48 dp.
   - "Attach" in the terminal toolbar is ambiguous: attach to a session, or attach a file?
   - Only the Terminal tab is drawn for Android and only Changes for iOS, so neither platform has both.
   - Same missing portrait, compact and foldable (half-open) states. Android foldables and window-size classes (Compact / Medium / Expanded) need rules.

### MThemesPhone — Themes on the phone (1600×1100)

1. **Purpose.** 8 theme previews, iOS chat screen (Main) only, at 0.5 scale:
   - Instrument Dark and Light (tokens);
   - inline overrides: GitHub Dark, Nord Light, Rosé Pine Dark, Solarized Light, High Contrast Dark, Catppuccin Light.
   - Each has a swatch column (ground, surface, raised, line, fg, fg-2, accent, run, ok, warn, err) and badges Running / Needs you / Succeeded / Failed / Queued.
2. **Override values** (dark themes use `selected` rgba(255,255,255,.08); light themes rgba(0,0,0,.06); scrim .5 in all):

   | Theme | ground | surface | raised | overlay | fg | fg-2 = fg-3 | accent / on-accent | run | ok | warn | err | line |
   |---|---|---|---|---|---|---|---|---|---|---|---|---|
   | GitHub Dark | #0d1117 | #161b22 | #21262d | #1c2129 | #e6edf3 | #8b949e | #1f6feb / #fff | #4493f8 | #3fb950 | #d29922 | #f85149 | #30363d |
   | Nord Light | #e5e9f0 | #eceff4 | #e5e9f0 | #fff | #2e3440 | #4c566a | #3a6b6a / #fff | #3b5f87 | #4a6b3c | #8a6516 | #a4262f | #c7d0de |
   | Rosé Pine Dark | #191724 | #1f1d2e | #21202e | #26233a | #e0def4 | #908caa | #c4a7e7 / #191724 | #6ea9c4 | #9ccfae | #f6c177 | #eb6f92 | #403d52 |
   | Solarized Light | #eee8d5 | #fdf6e3 | #eee8d5 | #fdf6e3 | #073642 | #4a6068 | #20729f / #fdf6e3 | #20729f | #4d7a1f | #96730b | #c0272b | #c9c1a8 |
   | High Contrast Dark | #000 | #0f0f0f | #141414 | #1a1a1a | #fff | #c9c9c9 | #9dc0ff / #000 | #9dc0ff | #7bff9e | #ffe066 | #ff8a80 | #6e6e6e |
   | Catppuccin Light | #e6e9ef | #eff1f5 | #e6e9ef | #fff | #4c4f69 | #5c5f77 | #8839ef / #fff | #1e66f5 | #3c9528 | #b37115 | #d20f39 | #bcc0cc |

3. **Observations.**
   - Each non-Instrument theme brings its **own accent**, not ink. Send and Allow once become blue, teal, violet or purple.
   - Fonts never change.
   - Native chrome follows light / dark only.
4. **Issues.**
   - `fg-3 = fg-2` everywhere (simplified; desktop derives fg-3).
   - In light themes `raised = ground`, so cards merge into the page.
   - Solarized: `accent = run`; High Contrast: `accent = run`. The primary button and the Running status share a colour, which weakens Principle 6.
   - Only iOS is previewed. Android dynamic colour ("System" accent) is not shown with any theme.
   - These values are illustrations. The token emitter is the source of truth (D-11 / D-12).

---

## A. Design-system summary

### A.1 Type ramps (Instrument Sans; JetBrains Mono for machine text)

**iOS 27 (pt; mapped to Dynamic Type, default Large):**

| Step | Size / weight / line-height | Class | Used for |
|---|---|---|---|
| Large title | 32 / 600 / 1.15, ls −0.02em | `i-lt` | top-level screen title below the bar |
| Title | 20 / 600, ls −0.01em | `i-t2` | section titles, sheet big titles |
| Detail title | 12 (breadcrumb, `$fg-3`) + 16 / 600, centred | inline | detail and chat headers |
| Headline | 17 / 600 | `i-hd` | bar title (collapsed), sheet titles, section headers (Home) |
| Body | 17 / 400 / 1.4 | `i-bd` | form rows, menus, lists (Search, Servers) |
| Transcript | 16 / 400 / 1.5 | `i-cb` | chat prose, bubbles (1.45) |
| Subhead | 15 / 400 | `i-sub` | secondary lines, tool-block titles (600) |
| Footnote | 13 / 400 | `i-fn` | meta lines, section labels (600) |
| Caption | 12 / 500 | `i-cap` (class has no weight; 500 inline) | captions, breadcrumbs, timestamps |
| Mono | 14 · 13 · 12 (never < 12) | `.mono` | commands, paths, counts, timers |

Rules: minimum 11 pt; native chrome text (alerts, menus, pickers) stays in the system font.

**Android 17 (sp; M3 scale, follows font scale):**

| Step | Size / weight / line-height | Class |
|---|---|---|
| Headline M | 28 / 600 / 1.2, ls −0.01em | `a-hl` |
| Title L | 22 / 600 | `a-tl` |
| Detail title | 12 + 18 / 600, left | inline |
| Title M | 16 / 600 | `a-tm` |
| Body L | 16 / 400 / 1.5 | `a-bl` |
| Body M | 14 / 400 / 1.45 | `a-bm` |
| Label | 12 / 500 | `a-lb` |
| Mono | 14 · 13 · 12 | `.mono` |

Rules: minimum 12 sp in content; weights 400 / 500 / 600 only (both platforms). "Desktop's 13 px UI default becomes 16–17 on a phone."

**Measured in the 29 screen boards** (font-size px → count): 11→60, 12→691, 13→422, 14→277, 15→147, 16→347, 17→60, 18→25, 20→1, 22→20, 24→13, 28→3.

- Weights: 600→449, 500→205, **700→6** (the search highlight), 400→4.
- Off-ramp sizes in use:
  - 24: iOS Pairing title and Home count values;
  - 18: Android sheet or pane titles, stats;
  - 11: widgets, badge timers, pane-badge count;
  - 10: the MComponents pane badge.

### A.2 Geometry

| Item | iOS | Android |
|---|---|---|
| Device frame | 402×874, r56 | 412×915, r36 |
| Safe area | 62 top / 34 bottom | 40 top / 24 bottom |
| Header | 52 (chat 52–56; iPad 60) | 64 (`.atop`; detail variants 56–60 in catalogue) |
| Header buttons | 44 glass circle `gbtn`; `gcap` capsule h44 r22 padding 0 4 gap 2 holding 40×40 buttons; max 3 trailing | 48 `aib` r24; max 2 + overflow |
| Side gutter | 16 (titles 20) | 16 |
| Drawer | 318, `$surface` + 1px `$line-soft` right, r 0 28 28 0, shadow 12 0 40 .35 | 336 modal, `$overlay`, r 0 16 16 0 |
| Drawer nav item | h44, padding 0 12, r12, 16/500 | h48, padding 0 16, r24 (pill), 15/500 |
| Pane | 356 (89%), `$surface`, r 28 0 0 28 | 364, `$overlay`, r 16 0 0 16 |
| Pane tabs | pill `ptab-i` h32, padding 0 12, r16, 14/500 | underline `ptab-a` h48, inset 3px `$fg` bottom |
| Sheet | `.sheet-i` inset 8, r38, `$overlay`, grabber 36×5 r3 | `.sheet-a` edge-attached, r 28 28 0 0, handle 32×4 r2 (`$fg-3` .6) |
| New | glass capsule h52 r26, padding 0 20 0 16, 16/600, right 16, bottom 40 | extended FAB h56 r16, padding 0 20 0 16, `$accent`, 14/600, shadow 0 6 16 .3 |
| Buttons | `mbtn` h44, padding 0 18, r22, 15/600, `$raised` + `$line` | `abtn` h40, padding 0 20, r20, 14/600, transparent + `$line-strong` |
| Chips | `mchip` h32, padding 0 12, r16, 13/500, `$line` | `achip` h32, padding 0 12, r8, 14/500, `$line-strong` |
| Switch | 51×31, thumb 27 | 52×32, thumb 24 on (with ✓) / 16 off, 2px outline off |
| Segmented | h32 track r9 `$selected`, segments r7 | connected group h40, ends r20, inner r8, 2px gaps |
| List rows | `irow` min-h 52, padding 10 16; grouped `igroup` `$raised` r22 | `arow` min-h 64, padding 10 16, gap 16; items 64/72 |
| Touch target | 44 (chips 32 drawn / 44 hit; rows ≥ 52) | 48 (chips 32 / 48 hit; items 64/72) |
| Composer | glass r28 | `$raised` r28 |
| Tablet | sidebar 312 + pane 410 as inset cards (r22, 8 margin) | permanent drawer 300 + pane 400, edge-attached |

**Radii.**
- **iOS** ("concentric: inner = outer − inset"): sheet 38, drawer 28, pane 28, group 22, card 20, code 12, capsule = h/2. Also used: transcript cards 14, Home tiles 18, iPad cards 22.
- **Android M3:** chips 8, menus 12, FAB and drawer 16, sheets 28, buttons full. Also used: transcript cards 12, notification group 28/8, segmented-list items 20/4.

**Spacing.** No declared scale. In practice 2, 4, 6, 8, 10, 12, 14, 16, 20, 24.

### A.3 Header rules (MFoundations)

| Rule | iOS | Android |
|---|---|---|
| Height | 52 under 62 safe area | 64 under 40 |
| Top-level | sidebar toggle glass 44; large title 32/600 below the bar | toggle 48; title 22/600 in the bar (Home actually uses Headline M 28 below, collapsing) |
| Detail | ‹ back; breadcrumb 12 over title 16/600, centred | ← back; breadcrumb 12 over 18/600, left |
| Breadcrumb | 12 `$fg-3`, chevron-right 12 separators, every segment tappable; long paths collapse the middle to "…" | same |
| Chat / run | pane toggle with count, trailing, in the glass capsule with ⋯ | pane toggle with count, then ⋮ |
| Status | one badge under the title, never tints the bar | same, left-aligned |

### A.4 Glass

- **iOS floating chrome only:** header buttons and capsules, composer, the New capsule, "↓ Latest".
- **Also used in the boards:** context menu, + menu, slash popover, toasts, step-detail toolbar, workflow-map zoom column, iOS notifications and Live Activity cards (system material).
- **Never:** cards, rows, transcript, diffs, sidebar and pane content. Android: nowhere.
- **Recipe:** `color-mix(--overlay 68%)`, `blur(22px) saturate(1.6)`, 1px `color-mix(--fg 12%)`, shadow 0 8 28 rgba(0,0,0,.28).
- **Fallback:** Reduce Transparency or the iOS tint slider → opaque `--overlay` + `--line`.
- **Implementation:** `expo-glass-effect` (UIGlassEffect); fallback `View` + overlay.

### A.5 Motion

- **iOS:** system springs for push, sheets and menus; sidebar and pane slide "on the same spring as a push"; content uses `.smooth`; press-scale on buttons only. No numbers are given; use the SwiftUI `.smooth` equivalent (response 0.5, damping 1.0) or Reanimated defaults.
- **Android, M3 standard scheme** (damping ratio / stiffness): default spatial 0.9 / 700; fast spatial 0.9 / 1400; slow spatial 0.9 / 300; default effects 1.0 / 1600.
- **Reduce Motion:** springs become cross-fades; running glyphs stop turning; the waveform must freeze.
- **Drawer:** snaps open past 40% drag.

### A.6 Haptics

| Event | iOS | Android (`HapticFeedbackConstants`) |
|---|---|---|
| Segment, picker, pane tab | selection | SEGMENT_TICK |
| Swipe threshold, pin | impact light | TOGGLE_ON |
| Long-press menu | impact medium | LONG_PRESS |
| Drag to reorder | impact light (+ tick per slot, MGestures) | GESTURE_START |
| Server confirmed | notification success | CONFIRM |
| Denied, rejected | notification warning | REJECT |
| Run failed | notification error | REJECT |
| Terminal font step | — | SEGMENT_TICK |

Success fires when the server confirms, not on tap. Settings › Haptics turns all off. Several Android constants need API 30+ (TOGGLE_ON 34+), so older versions need fallbacks.

### A.7 Accessibility rules

- **Dynamic Type / font scale:** content scales fully; dense chrome rows cap at 1.6×; rows grow and never clip. Many boards use fixed `height` on rows, which must become min-height.
- **Contrast:** text 4.5:1, glyphs 3:1; status is always glyph + word.
- **Reduce Motion, Reduce Transparency:** see above.
- **VoiceOver / TalkBack:** swipe and long-press actions are custom actions; the sidebar and pane are reachable from header buttons; aria labels are drawn ("Open workspace pane, 2 changes", "Model details", "Stop dictation and keep text").

### A.8 Theme and accent model

- **Axes:** theme × mode × accent.
  - The boards say "17 themes × light / dark × 6 accents".
  - The CSS has ink + 6 = 7 accents (ink, blue, violet, green, orange, rose, teal).
  - D-11 says 18 × 2 × 7.
- **Defaults:** theme Instrument, accent **ink** (`--accent: var(--fg)`, `--on-accent` = surface).
- **Recolouring:** themes recolour content only; fonts never change on mobile. Native chrome (alerts, menus, keyboard) follows light / dark only.
- **Android "System" accent:** Material You, from the wallpaper. "Never touches status colours." Needs a runtime `PlatformColor` / `dynamicDarkColorScheme` path.
- **Theme preview accents** are per-theme hues (MThemesPhone), so "accent" is a theme default that the accent setting overrides.

### A.9 Status map

| State | Glyph (Lucide) | Colour | Badge class | Mobile label |
|---|---|---|---|---|
| Queued | circle-dashed | `$fg-3` | `s-idle` | Queued |
| Running | loader-circle (spins) | `$run` | `s-run` | Running (+ mono elapsed) |
| Waiting | clock | neutral (`$fg-2`) | `s-idle` | Waiting (e.g. "Waiting 3m") |
| Needs you | hand | `$warn` | `s-warn` | Needs you (+ " · <agent>") |
| Paused | circle-pause | `$fg-2` | `s-idle` | Paused |
| Succeeded / Done | circle-check | `$ok` | `s-ok` | Succeeded (runs) / Done (chats) |
| Failed | circle-x | `$err` | `s-err` | Failed |
| Skipped / Cancelled | circle-minus (desktop) | `$fg-3` | — | **absent on mobile** |

- **Badge geometry:** iOS h24, padding 0 9, r12 (pill), 12, icon 14. Android h26, r8. Status-line badges use the default `.bdg` with icon 12.
- **Dots:** used in dense places (widgets, share list, server rows, connection footer).
- **Terminal-like letters:** M `$warn`, A `$ok`, D `$err`, R `$run` (not part of the status map).

---

## B. Component catalogue

### B.0 Helmet classes (the mobile layer, shared by every board)

`.phone.ios` / `.and`, `.safe-top-*` / `.safe-bot-*`, `.glass`, `.gbtn`, `.gcap`, `.atop`, `.aib`, `.afab`, `.igroup`, `.irow`, `.arow`, `.sheet-i` / `.sheet-a`, `.grab` / `.agrab`, `.scrim`, `.mbtn(-p)`, `.abtn(-p)`, `.mchip` / `.achip` (+ `.on`), `.hscroll`, `.drawer-i` / `.drawer-a`, `.dnav` / `.dnav-a`, `.dsec`, `.pane-i` / `.pane-a`, `.ptab-i` / `.ptab-a`.

Dead CSS: `.itab`, `.isearch` (the iOS floating tab bar) and `.anav` (the M3 nav bar). Desktop primitives reused: `.bdg` + `s-*`, `.dot`, `.mono`, `.trunc`, `.seg`, `.i*` icon sizes.

**Native vs JS key.**
- **N:** implement with the platform control (SwiftUI / UIKit or Compose, via Expo UI or a library).
- **JS:** draw in RN with tokens.
- **N+:** native container, JS content.

### B.1 Header / top app bar — JS

| Variant | iOS | Android |
|---|---|---|
| Top-level | glass 44 sidebar toggle; trailing glass 44 buttons or `gcap` (≤ 3); large title below; collapses to a centred 17/600 bar title; transparent bar | `.atop` 64: toggle 48, Title L 22 in the bar (or Headline M 28 below, collapsing); ≤ 2 icons + ⋮; bar turns `$raised` on scroll |
| Chat | toggle + centred breadcrumb / title (12 + 16/600) + `gcap` [pane toggle with badge, ⋯]; status badge centred below | toggle + left breadcrumb / title (12 + 18/600) + pane toggle + ⋮; badge left at 56 |
| Detail | glass ‹ back (22 chevron) instead of the toggle | ← arrow 22–24 |
| Modal | glass ✕ Cancel + centred title 16–17/600 (+ optional primary right) | ✕ + 22/600 title (+ primary) |
| Tablet | 60 tall; toggles become "Hide …" with a `$selected` state | 64; the same |

- **States:** scrolled or collapsed; pane-open (selected toggle); count badge (neutral `$fg` or `$run`).
- **Notes:** the breadcrumb above the title is not available in native UINavigationBar (iOS 26 adds a subtitle *below*), so the header is JS. Glass buttons use `GlassView`.

### B.2 Sidebar drawer — JS container (RNGH drawer), content JS

- **Parts:** server switcher button; New chat icon button; search field (opens the palette); 7 nav items; Needs you section (count, rows with hint verb); Running section (count, rows with elapsed); connection footer (dot, state, address, Settings).
- **Variants:** phone modal (iOS 318 surface / Android 336 overlay); iPad inset card 312; Android tablet permanent 300 on `$raised`.
- **States:** selected item, connection state, counts; needs empty, overflow and disconnected states.

### B.3 Buttons — JS (native feel via press-scale / ripple)

| Variant | iOS (`mbtn`) | Android (`abtn`) | Notes |
|---|---|---|---|
| Secondary | h44 r22, `$raised` + `$line`, 15/600 | h40 r20, transparent + `$line-strong`, 14/600 | M3 outlined |
| Primary / "Prominent" | `mbtn-p`: `$accent` / `$on-accent`, no border | `abtn-p` | the one ink action |
| Destructive | secondary with `$err` text + trash icon | same | Delete |
| Text button | h44 (or 30–40), transparent, `$fg-2` / `$fg`, 14–15/600 | h40 | "Always allow", "Manage", "Reset", "Retry", "Check again", "Reject" (`$err`) |
| Row action pill | h34 r17, `$selected`, 14/600 | same | Home and widgets "Review" / "Open" (below target size) |
| Tonal (Android) | — | `abtn` + `$selected`, no border | notification actions, widget Review |
| Large CTA | h48–50 r24–25 | h48 r24 or r16 | Connect, Create chat; three heights exist |
| Icon button | `gbtn` 44 (glass or plain; 34–40 inside composer and capsules) | `aib` 48 (36–44 variants) | |
| FAB-like primary | — | h48 r16 ink ("Open in Terminal", composer Send / Stop) | |

### B.4 Floating New — JS (glass) / FAB

- iOS glass capsule h52, icon 20 + label 16/600.
- Android extended FAB h56 r16, ink.
- Label per module: "New chat" (and "Run" on the workflow detail).
- It should shrink to an icon-only FAB or capsule on scroll (not drawn).

### B.5 Chips — JS

| Variant | iOS | Android |
|---|---|---|
| Filter | `mchip` h32 r16, `.on` = `$selected` | `achip` h32 r8, `.on` = `$selected` + ✓ |
| Dropdown | label + chevron-down 12 / 14 | same |
| Composer chip | `mchip` with transparent border, padding 0 8 / 0 6; agent (bot + name + lock 12) or model (+ chevron) | `achip` |
| Tag / input | `mchip` with ✕ 14; dashed "+ Tag" | `achip` with ✕ 16 |
| Attachment | h36 r12 `$sunken` + 1px `$line`, thumb 28, ✕ | h40 r8, thumb 32 |
| Scope / info tag | h24 r12, 1px `$line`, 12 | h24 r6 |
| Mono chip | h22 r6 `$selected` (branch "main") | r4 |

### B.6 Segmented control / connected button group — N recommended

- **iOS:** h32 track, padding 2, r9, `$selected`; selected segment `$raised` (catalogue) or `$overlay` (screens) + 1px `$line` ring (or shadow 0 1 3 .25), r7, 13/600; others 13/500 `$fg-2`. Optional mono count. 2–4 segments (All / Active / Archived; Provider; Auto / Plan; Low / Medium / High; Standard / Long; Worktree / In place; This turn / This chat / Branch vs main; Headless / Visible / Off; Existing / New chat).
- **Android:** M3 connected button group h40 (h32 inside the MComponents sheet), gap 2; outer r20 / inner r8 (sheet: 16 / 6); selected `$selected` + ✓ 16 + 14/600; unselected 1px `$line-strong`.
- **Native:** `UISegmentedControl` / SwiftUI `Picker(.segmented)`; Compose `SingleChoiceSegmentedButtonRow` or `ButtonGroup` (M3 Expressive). Native segmented cannot show the mono counts in a different style, so JS is needed there.

### B.7 Switch, checkbox, radio — N

- **Switch:**
  - iOS 51×31, on `$accent` with thumb 27 `$on-accent`; off `$line-strong` track + `$fg` / `$fg-2` thumb with shadow.
  - Android 52×32, on `$accent` + thumb 24 with ✓ 14; off 2px `$fg-3` outline, `$sunken`, thumb 16.
  - Native UISwitch cannot use `$fg` (white) as an off thumb on light themes; accept system styling with `onTintColor = accent`.
- **Checkbox:** iOS 22–24 circle (filled `$accent` + ✓ 14 / 1.5px `$line-strong` ring). Android 18 r3 (filled / 2px `$fg-2`).
- **Radio:** iOS trailing ✓ 18 on the selected row (no radio control). Android 20 circle, 2px ring (`$accent` or `$fg`) + 10 dot.

### B.8 List rows — JS

| Row | iOS | Android |
|---|---|---|
| Chat row | 68 in `igroup`, 20 glyph column, title 16/600 + pin + time; meta project · agent / model + ± | 72 flat, 24 glyph column, 16/600, meta 14 |
| Home row | 62, 18 glyph, 16/500 + 13 meta, trailing pill or timer | 68 |
| Drawer row | 40, 16 glyph, 15, hint 13 | same (36 on tablet) |
| Form row | `irow` 52: label 96 wide + value / placeholder | outlined field or segmented-list item 56 (r 20 / 4) |
| Nav row | icon 20 + title 16/600 + sub 12–13 + mono value + chevron | same, gap 16 |
| Switch row | 52 label + switch (+ "Changed ↶" chip) | 56 |
| Result row | 48 / 56, icon 20, 17 text, trailing hint or badge | 56 / 64, icon 22, 16 |
| Server row | 64, icon 20, 17/600 + status line, ✓ or Retry | 72 |
| Stage row | 44, circled mono index 24, name, mono id | 48 |

- **Swipe container:** iOS trailing More / Archive 74 each, leading Pin / Unread (MGestures 64 each). Android: see issues.
- **Selection state:** `$selected`. Every row has a long-press menu.

### B.9 Text fields — JS (TextInput)

| Variant | iOS | Android |
|---|---|---|
| Search field | h38–44, r19–22, `$selected`, icon 18, optional mic, clear 20 | M3 search bar h56 r28 `$raised`, icon 22, mic `aib` (or h48 r24 `$selected`) |
| Search view header | field h44 + glass ✕ | full-screen h72: ← + query 18 + ✕ |
| Drawer search (button) | h40 r12 `$sunken` + `$line-soft` | r20 |
| Form row | inline in `igroup` | outlined h56 r4, 1px `$line-strong`; focused 2px `$accent` / `$fg`, floating label 12 |
| Filled (Android) | — | h56 r 4 4 0 0, bottom border (share Agent) |
| Multi-line | `igroup` min-h 92 or `$raised` r16 (task) | outlined |
| Code cells | 44×52 r12 `$raised`, mono 22/500; error 2px `$err` | 46×56 r8 outlined |
| Mono field | h34 r10 `$sunken` (branch) | h40 r4 |

### B.10 Right pane shell — JS

- **Header:** h52: title "Workspace" 16/600 (iOS) / 18/600 (Android) + subtitle 12; maximize 40 / 48 + ✕.
- **Tab row:** horizontal scroll with a fade mask at 88%. iOS pill `ptab-i`; Android underline `ptab-a`. Chat set ×7 with a count on Changes; the run set is different.
- **Content:** a compare segmented control; file rows min-h 44 / 48 (status letter, path with a dimmed dir, ±, chevron); footer with Commit & PR (secondary) and Commit (primary).
- **Presentation:**
  - Phone: overlay from the right over a scrim; 356 / 364; full-screen = 100% "with back and minimise".
  - Tablet: docked 410 / 400.
- **States:** tabs, full screen, docked. The per-tab content lives in the pane boards (another group).

### B.11 Sheet — N+ (TrueSheet / expo-router formSheet; Android ModalBottomSheet)

- **iOS:** inset 8, r38, grabber, `$overlay`, `$shadow-pop`; header ✕ (glass 32–44) + centred 17/600 title (+ subtitle 12) + trailing action (Done primary, Manage, Reset); detents medium / large ("drag between half and full; below half dismisses; tap grabber to cycle").
- **Android:** edge, r28 top, handle; title 22/600 left (18/600 in the catalogue); optional ✕ `aib`; footer bar with a top border.
- **Nested:** iOS pushes inside the sheet; Android stacks a second sheet (two scrims).
- **Dirty sheets** ask before dismissing.

### B.12 Menus — N (iOS UIContextMenu / UIMenu; Android DropdownMenu)

- **iOS context menu:** preview card (r18 `$raised`, glyph + title + mono meta) over a blurred scrim (8px); glass list w214–240, r14, rows h44, 15–16 text, trailing icon 18, destructive in `$err` last; ≤ 3 groups.
- **iOS popover menu** (+): glass w332 r22, rows h46 17, trailing icons, 8px band separators.
- **Android overflow / anchored menu:** w214–332, r12–16, `$overlay`, `$shadow-pop`, rows h48, leading icon 20–22 `$fg-2`, 1px dividers, destructive `$err`; the selected or pressed row is `$selected`.
- **Menu items seen:**
  - chat row: Pin, Open workspace pane (or Open terminal), Stop, Archive, Delete;
  - chat ⋯: Rename, Share transcript, Archive, Delete;
  - diff line: Comment for agent, Copy line;
  - composer +: see MComposerPlus.

### B.13 Confirmation dialog — N (Alert / AlertDialog)

- iOS: w290, r30, `$overlay`; title 17/600; body 15; two `mbtn` side by side, the destructive one in `$err` text.
- Android: w300, r28, padding 22 24 14; title 22/600; body 14 / 1.45; right-aligned text buttons (Cancel, Delete in `$err`).
- **Rule:** only for destructive or irreversible actions.

### B.14 Toast / snackbar — JS

- iOS glass capsule h48 r24: icon 18 + text 15 + "Undo" (h38).
- Android snackbar h48 r8, **inverse** (`$fg` background, `$surface` text) + "Undo" 14/600.
- Example "Chat archived · Undo". D-30 limits desktop toasts to errors and background completions; mobile uses them for undo, so this needs alignment.

### B.15 Status badge — JS

See §A.9 for geometry. It is always glyph + sentence-case word, optionally with " · agent / model" or a mono timer.

### B.16 Empty state and skeleton — JS

- **Empty:** centred icon 22–24 `$fg-3`, title 17/600 (iOS) / 16/600, body 15 / 14 `$fg-3` (max-w 270), one secondary action ("▶ Run workflow").
- **Skeleton:** a `$selected` circle 20 / 24 + bars (60% × 10 r5, 36–38% × 8 r4); no shimmer.
- **Screen empty states drawn:** only the small widget ("Nothing needs you").

### B.17 Tool block — JS

- **Collapsed:** r14 / r12, 1px `$line-soft`; layers icon; title summary 15/600; sub "n failed" `$err` · mono "steps · duration"; chevron.
- **Running:** loader glyph, title "Reading files… 3 so far" (or "Delegated 2 tasks, reading files…"); sub is the current verb + mono target + a `$run` timer; an optional current-step sub-row (h40).
- **Expanded:** a `$raised` step list, rows min-h 44 / 48 (38 in the catalogue); step glyph; verb 15/600 + mono target; outcome line; duration; chevron to step detail; inline error excerpt (mono, `$sunken`).
- **Compact tool line** (MChatWorkflowRun): glyph 16 + mono tool name + target + duration, min-h 24.

### B.18 Message meta and bubbles — JS

- **User bubble:** right, `$raised` + `$line-soft`, tail corner 6 / 4.
- **Meta:** agent (bot icon + name 600) + model, or model only (no icon), or team ("Orchestrator · Bug Fixer, Code Reviewer, Test Writer"), or You (user icon); mono time right. No initials avatars.
- **Turn footer:** "✓ Done · 1m 06s". Resolved-gate row: "✓ Allowed once <mono cmd>". Streaming caret. "↓ Latest" pill.

### B.19 Gate cards — JS

| Gate | Shell | Header (`$warn-bg`) | Body | Actions |
|---|---|---|---|---|
| Permission | 1px `$line`, r20 / 16, `$raised` | hand + "Allow this command?" + category | mono command block, explanation | Always allow (text) · Deny · Allow once (primary); catalogue: "Always allow in this chat" link below |
| Question | r16 (Android sample) | hand + "<agent> has a question" + mono "1 of 1" | prompt 15 + radio options (40 rows, mono inline) | Skip (text) · Answer (primary) |
| Plan | r20 | list-checks + "Plan ready for review" + "5 steps" | plan title 15/600, numbered steps (mono index), "2 more steps" | Request changes · Approve (primary) |
| Review / approval (run) | r14, `$line-soft`, no fill (inconsistent) | hand + "Review <stage>" + mono "round 1 of 3" | summary + "View in run" link | Reject (`$err` text) · Request changes · Approve |

### B.20 Chat-embedded cards — JS

- **Background tasks card:** a header link to the Tasks pane, then task rows (glyph, title 14, worker agent 12, elapsed or Queued).
- **Workflow run card:** name, #, badge, stage line, version and elapsed, 6-segment bar, "Open run".
- **Workflow draft card:** "Agent draft" badge, stage count, risk tags, "Not published", Open in builder, Publish.
- **Composer strips:** Working status strip (running); changes strip ("1 file changed ± Review").

### B.21 Composer — JS (TextInput + keyboard controller)

- **Anatomy:** see §3 intro.
- **States:**

  | State | Rules |
  |---|---|
  | Idle | placeholder; Send disabled (`$selected` / `$fg-3`) per the catalogue, **ink in screens** |
  | Typing | multi-line 16/1.45, Send ink |
  | Running | Send → **Stop** (ink square); status strip or timer; placeholder "Reply…" (not "Queue…", D-29) |
  | Waiting for you | reason line (hand + "Answer the permission above to send"), "Cancel and send" text button, Send disabled |
  | Attachments | chips above the text |
  | Slash / mention | popover above |
  | Dictation | waveform pill replaces the chips; ✕ discard; stop-and-keep |
  | + menu open | + button `$selected` |
  | Done with changes | changes strip |

- **iOS:** glass r28; 34 controls (below target size).
- **Android:** `$raised` r28; 40 / 36×40 controls; Send / Stop 48 r16.

### B.22 Other new components found in this group

| Component | Boards | Notes |
|---|---|---|
| Count tiles (3-up) | MHome | tappable, scroll to a section |
| Weekly stat strip (4 columns) | MHomeMore | |
| Server row / server switcher sheet | MServers | Retry, ✓ |
| Command-palette result row + keyboard selection | MSearch | |
| Scope-request card + scope checklist + 3-step inline stepper | MScopeRequest | |
| QR viewfinder + torch, code-cell input | MPairing | |
| Fact strip (3 columns) | MChatStepDetail | |
| Floating step-nav toolbar / bottom app bar | MChatStepDetail | |
| Context-usage ring gauge row | MModelPicker | |
| Model list with tier headers + info | MModelPicker | |
| Agent row (rich) with scope tag and team line | MAgentPicker | |
| Codebase card (working dir, worktree, branch) | MNewChatMore | |
| "Changed ↶" reset chip | MAgentPickerCaps | |
| Dictation pill with waveform | MComposerVoice | |
| Slash-command popover | MComposerInput | |
| Stage progress segments (6) | MChatWorkflowRun, MLiveActivity | tracker icon on Android |
| Checkpoint scrubber | MTabletIOS | also a pane board |
| Terminal instance chips, toolbar, key row, status footer | MTabletAndroid, MGestures | |
| System-surface cards: Live Activity, widgets, controls, tiles, quick actions, share sheet | system boards | native targets |

---

## C. Navigation / IA model

1. **Root.**
   - **Unpaired:** MPairing (full-screen, no chrome).
   - **Paired:** a module stack inside a drawer shell. There is no tab bar. The default module is Home.
2. **Drawer (sidebar).**
   - Modules in desktop-redesign order: Home, Chats, Projects, Agents, Workflows, Automations, Scripts.
   - Live lists: Needs you, Running.
   - Header: server switcher, New chat, search.
   - Footer: connection + Settings.
   - **Opening:** toggle top-left on top-level screens, or a left-edge swipe (iOS; Android conflicts with system back).
   - **Closing:** scrim tap, swipe left, back.
3. **Per-module stacks.** Each module keeps its own stack; switching modules via the drawer preserves stacks (MPrinciples: "the module keeps its stack").
   - **Detail screens:** back plus a breadcrumb in which every segment is tappable (it pops to that level).
   - **Chats:** the list, then the chat. The chat shows the **sidebar toggle** (not back) with breadcrumb "Chats › project". Needs a decision: treat the chat as a top-level destination (the drawer's Needs-you and Running rows jump straight into chats), or as a pushed detail with back.
4. **Presentations.**

   | Type | Examples | Dismiss |
   |---|---|---|
   | Push | chat, step detail, workflow detail, run, Pair a server | back, edge, predictive back, breadcrumb |
   | Sheet (detents) | Servers, Next turn, Agent picker (→ capabilities), Plan review, Approval detail, Run workflow, Run script, Import, share extension | drag, ✕, scrim; dirty asks |
   | Full-screen modal | New chat (drawn), Agent editor, Builder, New automation, Search palette | ✕ / Cancel; no swipe |
   | Right pane | chat pane ×7, run pane ×7 | ✕, swipe right, scrim, back; maximize to full screen |
   | Popover / menu | + menu, slash popover, context menus, overflow | tap outside |
   | Dialog | destructive confirmations | buttons |

5. **Back behaviour.**
   - **iOS:** chevron + edge swipe (detail). Sheets: drag.
   - **Android:** predictive back peeks the previous screen. Back closes, in order: the open menu, then the sheet, then the pane, then the drawer, then pops the stack. On a top-level screen it exits, or goes to Home first? Not specified.
6. **Deep links implied.**

   | Source | Target |
   |---|---|
   | Pairing | `generatorai://pair?code=X` (exists, D-55) |
   | Notifications (Open) and Live Activity (Review) | chat by id, run by id + gate |
   | Widgets | gate review, chat / run |
   | Quick actions | New chat, Home, Run workflow…, Search |
   | Control / tile | New chat |
   | Share | chat by id or new chat |

   Every link needs a **server id**, because there are several servers. D-55 keeps only `pair`, `dock`, `tab`, `kind` and `run`, and D-60 allowlists `command/<id>` for `chat.new` and `workflow.new`. Chat-by-id and gate links are new.
7. **Tablets.**

   | Device | Sidebar | Chat | Pane | Toggles |
   |---|---|---|---|---|
   | iPad landscape 1194 | persistent 312 (inset card) | flexible | docked 410 (inset card), opened by the toggle | the sidebar and pane toggles become Hide / Show |
   | Android tablet 1280 | permanent drawer 300 | flexible | docked 400 | "Hide navigation drawer" |

   Not specified: breakpoints (the token `TWO_PANE_MIN_WIDTH = 768` exists), portrait, split view or compact windows, foldables, the pane overlaying vs docking at mid widths, and keyboard shortcuts.

---

## D. System-surface spec

### D.1 Notifications

| Category | iOS | Android | Actions | Grouping |
|---|---|---|---|---|
| Permission request | Time Sensitive; body with command block; long-press list | channel "Needs you" (high) | Allow once (auth required), Deny, Open | per chat thread |
| Question | Time Sensitive | high | text reply (RemoteInput / UNTextInputNotificationAction), Open; consider one action per option | per chat |
| Run approval / review | Needs you | high | Review / Open (approve in-app, with Face ID) | per run |
| Plan ready | Needs you | high | Open | per chat |
| Done / finished | passive, stacked summary ("2 chats done") | "Silent" section | tap opens | summary group |
| Failed | not drawn | — | Open | — |

Required settings, from MSetNotifications, which is outside this group: per-project levels, quiet hours with approvals let through, hide previews, morning digest.

### D.2 Live Activity / Live Update

- **Triggers:** a run or chat that is running, or waiting on you. Several at once: iOS shows the most urgent in the island.
- **iOS:**
  - Compact: leading app glyph + state word (warn for Needs you); trailing mono progress "3/6" (or the elapsed timer while running).
  - Minimal: the glyph.
  - Expanded: title, #, time; gate or step line; Review (primary); stage segments; "Stage n of N · kind" / "Next: …".
  - Lock Screen: the same as expanded (glass card), plus a compact chat activity row.
- **Android 16+:** status-bar chip (short critical text "Needs you 3/6") + a promoted ongoing notification with `ProgressStyle` segments and a tracker icon at the current stage; Review action.
- **End states** (not drawn): succeeded, failed, cancelled; the dismissal policy (e.g. 15 min after the end); stale-date handling when the server is unreachable.
- **Server work:** activity push tokens per device; server-sent updates on each stage and gate change; an end event.

### D.3 Widgets

| Widget | iOS | Android (Glance) | Content | Interaction |
|---|---|---|---|---|
| Needs you | medium 364×170 | 4×2 380×248 | up to 3 gates: title, sub, Review | Review → deep link to the gate |
| Running | medium | 4×2 | up to 3: title, project or stage, elapsed | row → chat / run |
| Summary | small 170 | 2×2 184 | Needs you / Running / Done today counts (dots) | open Home |
| Empty | small | 2×2 | "Nothing needs you" + running / done counts | open Home |

All show "Updated hh:mm". Needed: a tinted / clear (iOS) and dynamic-colour (Android) variant, and large or lock-screen accessory widgets (not drawn).

### D.4 Controls / tiles

- **iOS Control Center:**
  - "New chat" (ControlWidgetButton → open app, New chat).
  - "Pause agents" (ControlWidgetToggle), with states: off ("3 running"), on ("Agents paused · Tap to resume", ink), unavailable ("Server offline", 45% opacity).
- **Android Quick Settings:** the same two tiles (`TileService`: ACTIVE / INACTIVE / UNAVAILABLE).
- **Requires:** a server-wide pause / resume endpoint and state, plus a running count. Neither exists.

### D.5 App shortcuts

- **iOS quick actions:** New chat; Home (dynamic subtitle "3 need you"); Run workflow… (opens a picker, not drawn); Search. The app badge shows the attention count.
- **Android:** the same four as dynamic shortcuts (pinnable), plus a launcher dot.
- **Candidates:** App Intents / Shortcuts app / Siri, and Android App Actions. None is drawn, but they fit "New chat" and "Run workflow".

### D.6 Share-to-agent

- **iOS share extension / Android share target:**
  - file or text preview;
  - Existing chat / New chat;
  - recent chats with status;
  - the locked agent of the chosen chat;
  - an optional note;
  - server shown in the footer;
  - Send.
- **Needs:** App Group / shared keychain for credentials (iOS), upload from the extension (memory limits, around 120 MB), and a new-chat configuration.

---

## E. Open questions and conflicts for the owner

### E.1 Corrections to `research/mobile-design-analysis.md`

- **Chat header.** It says the header is "chat / run (pane toggle with count, ⋯)" with "detail (back …)". The boards give the **chat** the sidebar toggle, not back.
- **Composer states.** It lists "running (Send becomes Stop, 'Queue a follow-up')". The screen boards use a status strip, and D-29 forbids a queue.
- **Turn sheet.** It lists "Provider, Model, Mode, Effort, Context, gauge". The catalogue's "Turn setup" is only Model / Mode / Effort; the two sheets differ.
- **Android row swipe** is now drawn (MChats: More + Archive pills). The earlier note said it was iOS-only.
- **Measured values:**
  - Android Home rows are 68 (not the stated 64 / 72);
  - iOS Chats rows are 68;
  - the iOS search field varies between 38 and 44;
  - the pane badge uses mono 10–11.
- **New features to add to its list:**
  - Pinned + Mark unread;
  - multi-select;
  - weekly stats;
  - "Let this chat run workflows";
  - per-chat capability overrides;
  - device scope requests;
  - a composer changes strip;
  - background-tasks card;
  - workflow run, review and draft cards in chat.

### E.2 Decisions needed

1. **Chat screen navigation.** Sidebar toggle (top-level) or back (detail)? What does the left edge do on a chat?
2. **Android drawer edge swipe vs system back.** Drop the edge gesture on Android (toggle only), or reserve a gesture-exclusion zone?
3. **Composer.**
   - Send enabled when empty?
   - Send while a gate is pending (disabled with a reason, per D-29 "Cancel & send")?
   - Running placeholder (no queue)?
   - The Android mic position?
4. **Turn sheet.** One definition ("Next turn" full, or "Turn setup" rows). Is changing the provider mid-chat allowed? Should "Done" be ink?
5. **New chat presentation.** Sheet (IA) or full-screen modal (drawn)? Where does the primary sit?
6. **One style per control:**
   - search field sizes and fills;
   - iOS segmented selected colour;
   - iOS off-switch thumb;
   - Android single-choice indicator (radio vs ✓);
   - gate-card shell;
   - primary CTA heights (44 / 48 / 50);
   - Android row-swipe shape;
   - Chats header actions (Search + Filter vs Select + Sort).
7. **Primary action on iOS Run.** Glass (MScopeRequest) or ink (Principle 6)? Are "Done", "Open in Terminal", "Request access" and "Create chat" allowed as extra ink buttons?
8. **Pane-toggle count semantics.** Changes, tasks or background tasks? One rule.
9. **Status map.** Add Skipped / Cancelled (desktop D-18)? "Done" vs "Succeeded" is per object (chat vs run).
10. **Theme model.** 17 or 18 themes, 6 or 7 accents (D-11 says 18 × 7). Should the Android "System" (Material You) accent be added to tokens and to desktop parity? Does a per-theme default accent override ink?
11. **Selection and pills** vs the owner's earlier "blue-tinted controls, corner-rounded chips / tabs" memory. The boards use neutral `$selected` and pills (iOS chips r16, iOS pane tabs r16, Android buttons and nav pills). This is unchanged from the prior analysis and still open.
12. **Toasts.** Mobile uses undo toasts ("Chat archived · Undo"). D-30 allows only errors and background completions on desktop.
13. **New product features without a server:**

    | Feature | Server work needed |
    |---|---|
    | Pinned / unread chats | new fields |
    | Multi-server | client plus a server id in pushes and links |
    | Pause agents | global state and endpoint |
    | Weekly stats (average run time) | extend `/stats/summary` |
    | Finished feed with PR events | G-11's deferred PR items |
    | "Let this chat run workflows" and per-chat capability overrides | new |
    | Device scope requests with admin approval | new |
    | Live Activity push tokens | new |
    | Question options in push | new |
    | Share-to-agent upload | new |

    Each needs an API-first task (D-36), or the element must not be rendered.
14. **Keep / Keep all / Undo all** (D-28) must be added to the mobile Changes pane (not drawn on the iPad board).
15. **Biometric wording.** "Face ID required" / "fingerprint required" on notification actions is really device unlock. Accept that, or require opening the app for risky approvals?
16. **Tablet rules.** Breakpoints, portrait and split layouts, pane dock vs overlay, iPad inset-card chrome vs phone edge chrome, keyboard shortcuts and the iPadOS menu bar.
17. **Missing states across this group:**
    - empty, loading, offline and error for Home, Chats and Search;
    - the multi-select bulk bar;
    - camera permission denied;
    - pairing success and scopes;
    - scope request pending, approved or denied;
    - composer upload and dictation errors;
    - Live Activity end states;
    - revoked device.

    These should be designed or derived under D-32's recipes before the build.
18. **Accessibility fixes to require in the build:**
    - all targets ≥ 44 / 48 (list in §0.6);
    - no text below 11 pt / 12 sp (pane badge, Android widgets and badge timers);
    - no weight 700;
    - fixed row heights become min-heights for Dynamic Type;
    - coloured dots paired with words (share list).
