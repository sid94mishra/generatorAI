# Mobile boards: workspace pane, automations, scripts (26 boards)

Source: `docs/redesign/boards/mobile/project/*.dc.html` (sizes, radii, tokens, labels) and `docs/redesign/boards/png/mobile/*.{dark,light}.png`. Vocabulary from MPrinciples, MFoundations, MComponents and MGestures; tablet behaviour from MTabletIOS and MTabletAndroid. Cross-checked against `research/mobile-design-analysis.md`, `04-screen-map.md`, `03-component-inventory-domain.md` §2.2, §3.3, §6, `01-decisions.md` (D-18, D-27, D-28, D-35, D-36, D-40, D-55), `05-gap-matrix.md` and `08-mobile-readiness.md`.

Read-only analysis. The boards are treated as design data. None of the 26 boards contains text addressed to an agent or reader; all copy is product UI copy.

**Conventions**
- Every board pairs an **iPhone 402 × 874 pt** (`.phone.ios`, radius 56) with a **Pixel 412 × 915 dp** (`.phone.and`, radius 36) in the same state.
- Safe areas: iOS 62 top / 34 bottom; Android 40 top / 24 bottom.
- Catalogue names (MComponents) are written in *italics*. Composites that the catalogue does not contain are marked **NEW**.
- iOS classes: `gbtn` (44 glass circle), `gcap` (glass capsule), `mbtn` (44 capsule, r22), `mbtn-p` (ink filled), `mchip` (32, r16), `igroup` (raised, r22), `sheet-i` (inset 8, r38), `grab` (36×5), `pane-i`, `ptab-i`.
- Android classes: `atop` (64 app bar), `aib` (48 icon button), `abtn` (40, r20), `abtn-p`, `achip` (32, r8), `afab` (56, r16), `sheet-a` (edge sheet, r28 top), `agrab` (32×4), `pane-a`, `ptab-a`.

---

## Part 1 — Workspace pane (16 boards)

### MPaneOpen — "Chat · workspace pane open (Changes)"

1. **Purpose and presentation**
   - The default entry state: the right pane slides over a chat and shows the Changes tab.
   - Presentation: **right pane over a scrim**. The chat behind it is drawn as skeleton blocks and stays full-width ("the screen never shrinks").
   - iOS `pane-i`: 356 wide (89 %), `--surface` fill, `border-left --line-soft`, radius 28 0 0 28, shadow −12 0 40.
   - Android `pane-a`: 364 wide, `--overlay` fill (a tonal layer), radius 16 0 0 16.
2. **Header**
   - iOS (52 tall, padding 0 8 0 20):
     - Title block: "Workspace" at 16/600, with the chat title "Fix flaky checkout test" at 12, `--fg-3`, truncated.
     - Two **non-glass** `gbtn` at **40×40**: "Open full screen" (maximize-2) and "Close pane" (x).
   - Android (**52 tall, not the 64 top app bar**):
     - Title at 18/600 + 12 subtitle.
     - `aib` 48: "Open full screen", "Close pane".
   - Tab row:
     - iOS `ptab-i`: 32 h, r16 pill, 14/500, icon 16; selected = `--selected` wash.
     - Android `ptab-a`: 48 h, underline = `inset 0 −3px 0 var(--fg)`.
     - Both scroll sideways with an 88 % fade mask (`mask-image` on the row). There is no overflow menu.
     - Seven tabs, always shown: Changes (count "2"), Files, Terminal, Browser, Tasks, Plan, Computer.
3. **Components**
   - *Right pane shell*, *segmented control* / *connected button group*, *Buttons* (secondary `mbtn`/`abtn`, Prominent `mbtn-p`/`abtn-p`).
   - **NEW**: DiffStat line (`+18 −8 · 2 files` + branch chip `fix/checkout-flake`), CompareSegment ("This turn / This chat / Branch vs main"), CheckpointScrubber, PendingCommentsBar, ChangeFileRow, grouped file lists ("Changed in this chat 2" / "Also changed in the workspace 3"), CommitFooter ("2 files ready · into fix/checkout-flake" + "Commit…").
4. **iOS vs Android**
   - Compare control:
     - iOS: segmented control, 32 h, track `--selected` r9, selected segment `--overlay` r7 with shadow, 13/600.
     - Android: connected group, 40 h, r20 outline `--line-strong`, selected `--selected` + check icon, 14/500. "Branch vs main" wraps to two lines on Android at 364 dp.
   - Cards: iOS r14 on `--raised`; Android r12.
   - File lists:
     - iOS: filled `--raised` r14 group (a tile behind the group), rows `min-height` 44.
     - Android: outlined r12 `--line-soft`, rows 56.
   - Row action button: iOS `gbtn` 36 "⋯"; Android `aib` 40 "⋮".
   - Commit button: iOS `mbtn-p` 44; Android `abtn-p` 48 r24.
5. **Native features / engines**
   - Checkpoint scrubber: a draggable slider with 5 snap stops ("start, 14:00, 14:01, 14:02, 14:05"); the thumb is 20 px `--fg`. It implies selection-tick haptics per stop (MFoundations haptic "Segment, picker, pane tab").
   - Comment preview (eye button).
6. **States and gestures**
   - Scrubber stops:
     - selected turn 3 of 4 ("14:02", bold);
     - past stops filled `--fg-2`;
     - future stop hollow (`--surface` fill, `--line-strong` ring). "14:05" is ambiguous: the current state, or a later turn.
   - Pane gestures:
     - close by dragging toward the right edge or tapping the scrim (MGestures);
     - no edge gesture opens the pane — only the pane toggle does;
     - tab switch by tap or sideways swipe of the pane body (MPaneTabsOverview).
   - Button equivalents: "Close pane", system back.
7. **Server data**
   - Workspace diff summary per compare base: `+/−`, file count, head branch.
   - Checkpoint list: turn index, timestamp, prompt excerpt "You: “Also cover the zero-discount case…”", per-turn `+14 −6 · 2 files`.
   - Pending review comments: count, first anchor "applyCoupon.ts · L20 · Fix".
   - Per-file:
     - status letter M/A/R/D (R shows old → new path);
     - `±` counts;
     - comment count;
     - group ("changed in this chat" vs "also in the workspace" = files not attributed to the chat).
   - Commit readiness: "2 files ready", target branch.
8. **Issues**
   - **Keep / Keep all / Undo all are missing.** This conflicts with D-28 / MD-7. There is no "Kept (N)" group.
   - All seven tabs show in a non-orchestrator, no-plan chat. This contradicts D-27 (Tasks only in orchestrator chats; Plan and Computer only when relevant) and MPaneTabsOverview's own "Tasks … Only on those chats".
   - The CommitFooter says "2 files ready" while the pane lists 5 changed files (2 + 3). It is unclear whether workspace-only files get committed; MPaneCommit says "Commits all 2 files".
   - Touch targets: header buttons 40 (< 44), row actions 36 (iOS) / 40 (Android, < 48), iOS rows 44 (< the 52 row rule), Android rows 56 (< 64).
   - Mono type below the 12 minimum: scrubber labels are 11 px (MFoundations: "mono never below 12").
   - The Android pane header is 52 tall, not the 64 of the header rules.
   - "Rewind to here" has no scope choice. Desktop has a rewind menu (all / conversation / code) and writes a `pre_restore` checkpoint.

### MPaneTabsOverview — "Workspace pane · the seven tabs" (1600 × 1000)

1. **Purpose**
   - A reference sheet: seven iOS pane thumbnails at 50 % scale, one per tab, each with a caption:
     - Changes "What changed in this chat or branch; rewind a turn; commit and open a PR."
     - Files "Browse the mounted sources; open a file or mention it in chat."
     - Terminal "Shared shell sessions and the commands the agent ran."
     - Browser "The page the agent drives: comment, capture, device preset."
     - Tasks "Background workers of an orchestrating chat. Only on those chats."
     - Plan "Plan revisions to comment on, then approve or request changes."
     - Computer "Live screen, pause or take over, replay, and grants."
   - Also: the tab row at 100 % for iOS (pill) and Android (underline), both with "Tasks 4" active on "Upgrade React Flow to v12".
   - Four rules:
     - **Open** — "The pane toggle at the top right of a chat opens the pane over it; its badge is the Changes count."
     - **Switch** — "Tap a tab, or swipe the pane body sideways to the neighbouring tab. The row scrolls to keep the active tab in view."
     - **Full screen** — "Open full screen keeps the same tab; minimize returns to the pane over the chat."
     - **Counts and dots** — "Numbers are counts (Changes 23, Tasks 4). An amber dot means the tab needs you: a plan to approve, a control request."
2. **Chrome**: as in MPaneOpen.
3. **Components**: thumbnails of every pane panel (detailed below). The Terminal thumbnail shows a "Clear" and "Kill" toolbar, and the chips "Terminal · Terminal 2 · Agent commands 4". The Browser thumbnail shows the page chips "Checkout / Coupon admin" and "+".
4. **iOS vs Android**: only the tab row differs: pill `--selected` vs a 3 px underline, 32 vs 48 tall.
5. **Native features**: a horizontal pager (swipe between tabs) plus an auto-scrolling tab strip.
6. **States**:
   - Count badges: mono 12 `--fg-3` inside the tab.
   - Attention dot: 6 px `--warn` (Plan, and a Computer "control request").
7. **Server data**: Changes count, Tasks count, a needs-you flag per tab (plan awaiting decision, computer consent / control request).
8. **Issues**
   - **Gesture conflicts.**
     - "Swipe the pane body sideways" contradicts MGestures ("Drag the pane toward the right edge… to close it. Sideways drags on the tab row scroll the tabs instead"). A right-swipe on the body cannot both go to the previous tab and close the pane.
     - It also collides with every horizontally scrolling body: the unwrapped diff and file preview, the terminal, the browser and computer streams, and the scrubbers.
   - Tabs always visible (seven) vs "Only on those chats" — the board contradicts itself.
   - The badge counts the Changes tab only, so needs-you dots (Plan, Computer) never reach the chat header's pane toggle. The user cannot see from the chat that the pane needs them, except through the transcript gate card.
   - No overflow menu or "+" menu. Desktop has "+" for extra Browser ≤ 5, Terminal ≤ 4, file tabs ≤ 8, widgets ≤ 6 (D-27). There is no Widget tab or file-tab concept on mobile.

### MPaneChanges — "Workspace · Changes full screen (row menu open)"

1. **Purpose and presentation**
   - The Changes tab in **full-screen mode**: `position:absolute` over the whole phone, `--surface`, 100 % width.
   - A file-row menu is open on `tests/checkout.spec.ts`.
2. **Header**
   - iOS 52 tall:
     - `gbtn` 40 "Back to chat" (chevron-left);
     - title "Workspace" + chat subtitle;
     - `gbtn` 40 "Exit full screen" (minimize-2).
   - Android 52 tall: `aib` "Back to chat" (arrow-left), title, `aib` "Exit full screen".
   - The tab row persists in full screen.
3. **Components**
   - Same as MPaneOpen.
   - *Menus*: iOS "Long-press context menu with preview"; Android "M3 overflow menu".
4. **iOS vs Android**
   - iOS:
     - The scene dims (`color-mix(--ground 50%)` + blur) and a lifted row preview (`--overlay`, r14, shadow) appears.
     - A **glass** menu (250 wide, r14) with 44-tall rows, 16 pt text, **trailing** icons: Open diff, Mention in chat, Copy path, and a separated destructive "Discard changes" in `--err`.
   - Android:
     - No scrim, no preview. The anchored M3 menu is 240 wide, r12, `--overlay`, border `--line-soft`, 48-tall rows at 15 sp, **leading** 20 px icons.
     - The source row stays highlighted (`--selected`).
   - Android list rows are 56 (outline group) vs iOS 44 (filled group).
5. **Native features**
   - UIContextMenu with preview (iOS) and an M3 DropdownMenu (Android).
   - Clipboard ("Copy path").
   - Long-press haptic (impact medium / `LONG_PRESS`).
   - "Mention in chat" inserts a file mention into the composer.
6. **States / gestures**
   - The menu opens by long-press on the row *or* the "⋯" button (MGestures rule).
   - Selected-row state.
7. **Server data**: as MPaneOpen. "Discard" calls the file revert (`changes/discard`).
8. **Issues**
   - "Discard changes" shows no confirmation. Desktop has an inline "Confirm discard"; the MComponents Confirmation is for destructive actions.
   - Keep / Unkeep is missing from the row menu (D-28).
   - "Open in editor" (desktop row action) is absent, which is reasonable on mobile. It could become a "Share" or "Open on server" action.
   - The glass on the iOS context menu is system material (acceptable). The MFoundations glass rule lists only header buttons, composer, New and "↓ Latest", so glass on menus should be written down as a system exception.
   - The Android full-screen header is still 52, not 64.

### MPaneDiff — "Workspace · file diff with inline comment"

1. **Purpose and presentation**
   - A single-file unified diff with the inline comment composer open on line 20.
   - Presentation: a **pushed screen** from Changes. The breadcrumb is `Changes › src › cart`; there is no tab row.
2. **Header**
   - iOS 52:
     - glass `gbtn` 44 "Back";
     - centred breadcrumb (12, `--fg-3`) over the file name (mono 15/600);
     - glass `gcap` holding one 40 button "More".
   - Android `atop` 64: `aib` Back, left-aligned breadcrumb + file name (mono 17/600), `aib` "More options".
   - Sub-toolbar (iOS 44 / Android 48):
     - status letter M;
     - `+14 −6`;
     - comment count "1";
     - toggle chip "Wrap" (on, with a check): iOS `mchip.on`, Android `achip.on`.
3. **Components**
   - **NEW** DiffView (unified):
     - hunk header rows on `--sunken`, 12 px, `--fg-3`;
     - a 40-wide line-number column and a 16-wide sign column (`−` in `--err`, `+` in `--ok`);
     - `--del-bg` / `--add-bg` row fills;
     - the selected line ringed with `inset 0 0 0 1.5px --fg-2`, r4.
   - **NEW** InlineCommentComposer card (iOS r18, Android r16, `--raised`, border `--line`):
     - "Comment for Bug Fixer" + "L20" + Cancel (x);
     - intent chips "Fix" (on) / "Question" / "Note";
     - a text area on `--sunken` (iOS r12, Android r8) with mixed prose and mono runs;
     - actions "Add to review" (secondary) and "Send to agent" (Prominent).
   - **NEW** FileNavigatorFooter: "Prev" (disabled, `--fg-3`), "File 1 of 2", Next `checkout.spec.ts ›`.
4. **iOS vs Android**
   - Header geometry.
   - Chips (r16 pill vs r8).
   - Footer buttons: iOS 44 capsules, Android 40 pills.
   - Composer field radius.
5. **Native features / engines**
   - A virtualised diff renderer with soft wrap (Wrap on).
   - Line selection → an inline, keyboard-avoiding editor inserted *between* diff lines.
   - Long-press on a line opens a line menu. MGestures (Android frame) shows "Comment for agent / Copy line" with haptic `LONG_PRESS`.
   - No syntax highlighting: code is plain `--fg`.
   - Word-level highlighting is not drawn.
6. **States / gestures**
   - Drawn: composer open, text typed with a caret, Prev disabled at file 1.
   - Not drawn:
     - existing threads displayed inline (sent / addressed / resolved);
     - range selection;
     - loading, binary, too-large and deleted-file states;
     - split view (reasonably not offered on a phone).
   - Button equivalent for the long-press: MGestures says "Comment in the file toolbar of the pane", but the diff toolbar here has only "Wrap". **The button equivalent is missing.**
7. **Server data**
   - File diff hunks: old/new line numbers, add/del.
   - The review thread model: intent, anchor line or range, state (draft/pending/sent), author agent name "Bug Fixer".
   - The file index within the compare set ("File 1 of 2").
8. **Issues**
   - Intents: 3 on mobile (Fix / Question / Note) vs desktop's 5 (fix / question / refactor / test / note). The shared enum (`packages/shared/src/review.ts`) must decide.
   - One line-number column mixes old numbers (19–21 on deleted lines) and new ones (19–20 on added lines) with no old/new distinction. This is ambiguous for screen readers and humans.
   - The trigger for comment mode is not specified: tap vs long-press (desktop: click on the gutter).
   - "Send to agent" is filled ink, but principle 6 reserves ink for Send / Approve / Run. It is arguably "Send", but the "Commit…", "Open in browser" and "Mention in chat" buttons elsewhere show ink use is looser than the principle.
   - "More" contents are not specified.
   - The diff does not show which mount the file belongs to (2 mounts exist in MPaneFiles).

### MPaneCommit — "Workspace · Commit & pull request sheet"

1. **Purpose and presentation**
   - Commit the workspace changes and optionally open a PR.
   - Presentation: a **sheet with detents** over the full-screen Changes tab (visible, dimmed):
     - iOS `sheet-i` at the large detent (`top:96`), inset 8, r38, grabber 36×5;
     - Android `sheet-a`, edge-attached, r28 top, handle 32×4.
2. **Header**
   - iOS: "Commit & pull request" 20/600 + a **glass** `gbtn` 40 "Close".
   - Android: 22/600 + `aib` Close.
3. **Components**
   - Section "Commit":
     - "into `fix/checkout-flake`";
     - Message field (iOS form row on `--raised` r12, min 44; Android outlined field, floating label, r4, 56);
     - helper "Commits all 2 files. Empty uses “Workspace snapshot at 14:05”.";
     - secondary "Commit" button.
   - Section "Pull request":
     - "base" `main ⌄` chip ← `fix/checkout-flake` chip (32 h, r16, `--line`);
     - Title field;
     - Description (min 96, prose with mono runs);
     - "Open as draft" *switch* with the sub-label "Reviewers aren't requested until it's ready.";
     - full-width Prominent "Create pull request" (iOS 50 h, r25).
   - **NEW** CommitPRSheet.
4. **iOS vs Android**
   - Field styles: filled form rows vs M3 outlined.
   - Switch: iOS 51×31; Android 52×32 with a check thumb.
   - Sheet shape.
5. **Native features**
   - Detent sheet (TrueSheet / form sheet).
   - Native text inputs with multiline growth.
   - Branch picker (the base chip's chevron).
   - Keyboard avoidance with a sticky bottom action.
6. **States**
   - Drawn: idle, form filled.
   - Missing:
     - validation (empty title);
     - working / progress (committing, pushing, creating PR);
     - errors: no remote, not signed in to the git host (code has `ConnectGitHubSheet`), push rejected, pre-commit hook failure, PR already exists;
     - a dirty-sheet close confirm (MGestures: "A dirty sheet asks first").
7. **Server data**
   - SCM readiness: head branch, remote, provider, base-branch list.
   - Staged file count.
   - Default commit message and default PR title/body (desktop has "Generate").
   - Draft support.
8. **Issues**
   - Desktop CommitBar has **Generate** (commit message), **push** / **PR** toggles and a **mount picker** for multi-mount workspaces (`scm-mount-picker`). Mobile has none of them, although MPaneFiles shows 2 mounts (a `payments-api` worktree + `checkout-web` in place). The commit target is ambiguous with more than one mount.
   - "Create pull request" when nothing is committed yet: does it commit + push implicitly? The done state shows "Committed / Pushed / PR opened", which implies one flow (desktop `scm/flow`), but the sheet has a separate "Commit" button too. The two paths need defining.
   - The head branch chip is not editable. Branch creation (committing to a new branch) is not offered.
   - Glass on a sheet header button is outside the glass rule's list.

### MPaneCommitDone — "Workspace · Commit & PR done"

1. **Purpose and presentation**: the result state of the same sheet, at a smaller detent (`top:auto`, content height) over a Changes tab that is now empty.
2. **Header**: as MPaneCommit.
3. **Components**
   - Result list (iOS `igroup` r14; Android outlined r12), each item with a check icon in `--ok`:
     - "Committed 2 files · `3f9a1c2 · Fix coupon/total race in checkout`";
     - "Pushed · `origin/fix/checkout-flake`".
   - **NEW** PRResultCard (outlined r14/r12):
     - "PR #1182 opened" + `.bdg.s-idle` "Draft";
     - title;
     - "main ← fix/checkout-flake · 1 commit";
     - URL `github.com/acme/payments-api/pull/1182`.
   - Actions: "Copy link" (secondary) and "Open in browser" (Prominent), 50/48 tall.
   - The background is an *Empty state*: "No uncommitted changes · Committed `3f9a1c2` to `fix/checkout-flake`". The Changes tab count disappears.
4. **iOS vs Android**: sheet shape and button heights only.
5. **Native features**
   - Clipboard.
   - External browser (SFSafariViewController / Custom Tabs, or system browser — unspecified).
   - Success haptic, fired only on server confirmation (MFoundations).
6. **States**: success only. Partial success is missing: committed but push failed; pushed but PR creation failed.
7. **Server data**: commit sha + message, push ref, PR number / title / base / head / commit count / URL / draft flag.
8. **Issues**
   - Status icons use `--ok`, which matches the map.
   - "Draft" uses a neutral badge, while the status map has no "Draft" state. That is fine as a label, but it should be recorded as not being a status.

### MPaneFiles — "Workspace · Files full screen (long-press menu)"

1. **Purpose and presentation**: the Files tab in full-screen mode, with a long-press menu on `applyCoupon.ts`.
2. **Header**: the full-screen pane header ("Back to chat", "Exit full screen") and the tab row, with Files active.
3. **Components**
   - **NEW** SourcesCard (header "Sources · 2 mounts" + link "Edit sources"). Mount rows, min 64:
     - alias in mono 14/500;
     - badge "Worktree" / "In place" (`.bdg.s-idle`);
     - branch + 6 px `--warn` dirty dot;
     - path `C:\gai\wt\payments-api` (Windows server);
     - "Copy path" button.
   - **NEW** FileFilterBar:
     - search field "Filter files…" (iOS 40 h, r12, `--selected`; Android pill);
     - chip "All sources 2 ⌄" (source filter).
   - **NEW** FileTree:
     - per-mount section header (alias, "Worktree · fix/checkout-flake" at mono 11, "214 files");
     - 44-tall rows with 16-px indents, chevrons, folder icons, dirty dots on folders, status letters M/R/A on files;
     - the selected row in `--selected`.
   - *Menus*: Open, Mention in chat, Copy path, Share.
4. **iOS vs Android**
   - iOS: lifted preview + glass menu (trailing icons).
   - Android: anchored M3 menu (leading icons), no scrim.
   - Android draws the sources group outlined; iOS filled.
5. **Native features**
   - Long-press context menu.
   - Clipboard.
   - **Share sheet** ("Share": the path as text, or the file content? It needs a download-to-temp step to share the file itself).
   - A large virtualised tree (214 + 96 files).
6. **States**
   - Drawn: tree expanded, menu open.
   - Missing: loading, empty mount, no filter match (desktop B-08 has all three), stale / deleted file.
7. **Server data**
   - Workspace mounts: alias, mode worktree / in-place, branch, dirty, absolute path, file count.
   - File index per mount.
   - Change status per path.
   - Directory dirty rollup.
8. **Issues**
   - Mono 11 in the section subtitle is below the 12 minimum.
   - "Edit sources" has no destination drawn. It probably reuses New-chat mounts.
   - Tapping a file (not long-pressing) opens MPaneFilePreview; this is implied, not stated.
   - Desktop has file-viewer *tabs* (≤ 8); mobile pushes a screen instead. Fine, but the tab registry contract (`PaneTabType`) must not require file tabs on mobile.
   - The iOS row height 44 is below the 52 rule. The Android tree also uses 44 (< 64 list items) — defensible for dense trees, but it should be decided explicitly.

### MPaneFilePreview — "Workspace · file preview full screen"

1. **Purpose and presentation**: a read-only file viewer, as a **pushed screen** with breadcrumb `Files › payments-api › src › cart` and title `applyCoupon.ts`.
2. **Header**
   - iOS: glass Back + glass `gcap` holding two actions (Copy path, More).
   - Android: `atop` with Back, Copy path and More options.
   - Meta bar: `M · 71 lines · 2.1 KB · TypeScript` + a "Wrap" chip (off).
3. **Components**
   - **NEW** FileViewer:
     - a 44-wide line-number gutter;
     - monochrome code (only comments in `--fg-3`);
     - changed lines marked with a left `--ok` bar and `--add-bg` fill (lines 13–14 and 20–21);
     - a horizontal scroll with a visible scrollbar thumb.
   - Footer: "View diff" (secondary) and "Mention in chat" (**Prominent**).
4. **iOS vs Android**: header layout, chips, footer heights (44 vs 48).
5. **Native features / engines**
   - A large-text code viewer with horizontal scroll plus wrap toggle, and line virtualisation.
   - Syntax highlighting is **not drawn**. Desktop B-09 uses Shiki (D-33).
6. **States**
   - Missing: loading, binary, image preview, markdown render toggle, too large, file deleted — all of which desktop B-09 has.
7. **Server data**: file content, size, line count, language, change status, and changed-line ranges vs the compare base.
8. **Issues**
   - Monochrome vs desktop Shiki: decide whether mobile highlights (JS Shiki / TextMate grammar) or keeps plain.
   - "Mention in chat" as the single filled action is not Send / Approve / Run, which conflicts with principle 6.
   - There is no line-selection affordance (select lines → mention or comment).
   - Copy path appears both in the header and in the Files menu. That is fine.

### MPaneTerminal — "Chat · workspace pane open (Terminal)"

1. **Purpose and presentation**: the Terminal tab inside the **overlay pane**, with an agent command running and no keyboard.
2. **Chrome**: pane header; tab row with Terminal active.
3. **Components**
   - **NEW** TerminalInstanceChips (`hscroll`):
     - "Terminal" (on, with close ×), "Terminal 2", "Agent commands 4";
     - a "New terminal" button (32×32 bordered on iOS; `aib` 40 on Android).
   - **NEW** TerminalToolbar (36 tall):
     - badge "pty" (`s-idle`, mono 11);
     - badge "Agent working" (`s-run`, spinner);
     - Find (search icon);
     - "Kill" (`--err` text + power icon).
   - **NEW** TerminalView:
     - `--sunken` r14 (Android r12), border `--line-soft`, mono 12;
     - token-coloured output (prompt `c-2`, hashes `c-warn`, RUN `c-run`, ✓ `c-ok`, durations `c-3`);
     - a block cursor 8×15 `--fg`.
   - **NEW** TerminalStatusFooter (40): spinner "node running · pwsh 7.5 · pid 18244 · 44×31".
4. **iOS vs Android**: container radius; control sizes (32/36 vs 40); the Android header is 18/600.
5. **Native features / engines**
   - A real PTY terminal emulator (ANSI colours, cursor, scrollback) streamed over WebSocket.
   - Cols × rows reported to the server ("44×31" is a resize contract).
   - Find in scrollback.
6. **States**
   - Drawn: running command, agent working.
   - Not drawn:
     - connecting;
     - exited ("Process exited — code 1");
     - connection lost / reattach;
     - fallback host (no node-pty);
     - workspace not ready;
     - terminal cap reached (desktop ≤ 4);
     - the **Agent commands** view itself (read-only command blocks).
7. **Server data**: terminal sessions list (name, shell, pid, pty/fallback, cwd), agent-busy flag, the running foreground process ("node running"), output stream, agent command history count (4).
8. **Issues**
   - **The model conflicts with D-27.** Desktop makes each shell its own dock tab and explicitly supersedes the in-panel "pwsh 1 · pwsh 2" segment. Mobile uses in-panel instance chips. Mobile's model is reasonable on a phone, but the shared `PaneTabType` contract must allow instances inside the Terminal tab.
   - Naming: "Terminal / Terminal 2" (phone) vs "pwsh" (Android tablet) vs "pwsh 1" (desktop).
   - **"Kill" has no confirmation.** Desktop added a confirm popover: "Kill pwsh 1? Stops `pnpm test` mid-run…".
   - Both phones show the same "44×31" although their widths differ. The value must be computed.
   - The iOS "New terminal" button is 32 px (below target) and is hidden off-screen past the fade.
   - Mono 11 in the badge and footer.

### MPaneTerminalFull — "Workspace · Terminal full screen (key row + selection)"

1. **Purpose and presentation**
   - The Terminal tab in full screen with the software keyboard up, the key row above it, and a 3-line selection with a selection menu.
   - The tab row and instance chips persist; the status footer is hidden by the keyboard.
2. **Header**: the full-screen pane header.
3. **Components**
   - Toolbar (40):
     - **"Attach 3 lines"** chip (on; appears with a selection);
     - "pty";
     - Find ("Find in output");
     - **"Clear"** (only in full screen);
     - "Kill".
   - Selection: 3 rows tinted `color-mix(--run 28%)`, r3 at the ends.
   - Selection menu:
     - iOS: **glass** capsule 40 h, r20 — "Copy | Attach to chat | Select all".
     - Android: `--overlay` r8, 44 h, shadow — the same items.
   - **NEW** TerminalKeyRow on `color-mix(--fg 5%, --surface)`, 48 tall:
     - keys 36 tall, r8, `color-mix(--fg 10%)`;
     - Esc (34 wide), Tab (34), **Ctrl** (36, latched: inverted `--fg` fill / `--surface` text), a 4-px gap, ↑ ↓ ← → (28 each), gap, ⇧Tab (42), gap, `|` `~` `/` (26 each).
   - The drawn system keyboard is the OS keyboard, drawn for context.
4. **iOS vs Android**
   - The selection menu: glass capsule vs M3 floating toolbar.
   - The keyboard drawing (iOS "return" vs Android "→" / "," / ".").
   - The key row is identical on both.
5. **Native features / engines**
   - Custom input accessory view: iOS `inputAccessoryView`; Android a keyboard-sticky view.
   - Sticky modifier state machine.
   - Native text selection with handles over a canvas terminal, plus a custom edit menu with app actions ("Attach to chat").
   - Hardware-keyboard passthrough (not drawn, required).
   - Pinch to set the font size 10–20 with a `SEGMENT_TICK` per step (MGestures).
   - Clipboard.
6. **States / gestures**
   - Drawn: selection active, Ctrl latched.
   - Gestures (MGestures): pinch → font size, with the button equivalent "A− / A+ in terminal settings". The Android tablet puts a "Font size" button in the terminal toolbar instead.
7. **Server data**: PTY input and output; resize on keyboard show and hide (rows shrink); selection → attachment ("3 lines" of text with the terminal name as provenance).
8. **Issues**
   - **The key rows disagree across boards.**
     - Phone: Esc, Tab, Ctrl, ↑ ↓ ← →, ⇧Tab, |, ~, /.
     - MGestures: esc, tab, ctrl, ←, ↑, ↓, →, plus "^C" in its caption.
     - Android tablet: Esc, Tab, Ctrl, ^C, Up, Down, "More keys".
     - **^C is missing on the phone** although MGestures promises it. Pick one set and a "More keys" overflow.
   - Keys are 26–42 × 36: below 44 pt / 48 dp.
   - Pinch minimum font 10 conflicts with "mono never below 12" (MFoundations).
   - The glass selection menu on iOS is outside the glass allow-list (as noted for menus).
   - The Find UI is not drawn.
   - What the key row does when a hardware keyboard is attached is not drawn (hide it, or keep it for Esc and Ctrl?).

### MPaneBrowser — "Browser · full screen · comment + capture"

1. **Purpose and presentation**
   - The Browser tab in full screen. The agent is driving the page; the user has placed one element comment, has a capture queued for the next message, and has the "More" menu open.
2. **Header**: the full-screen pane header; tab row with Browser active (scrolled so Files is first).
3. **Components**
   - **NEW** BrowserPageChips: "Checkout" (spinner = loading, close ×), "Coupon admin" (globe, ×), "+" New page.
   - **NEW** BrowserNavBar: Back, Forward (disabled `--fg-3`), Reload, and a URL pill (40 h, r20, `--raised`, mono 13 `localhost:5173/checkout`).
   - **NEW** AgentBrowsingStrip (36, r10, `--run-bg`): spinner, "Bug Fixer is browsing", and mono "click · button “Apply”".
   - Toolbar:
     - chip "Comment" (on);
     - "Capture screenshot" (camera chip);
     - "Device preset" chip "Responsive ⌄";
     - "More" (`gbtn` 40 on `--selected`).
   - **NEW** BrowserLiveView (`--sunken`, r14, border `--line`):
     - the rendered page at small scale (11 px text);
     - a numbered pin "1" on `.total`, drawn with a dashed outline;
     - the agent's click ring (26 px, `--run` 2 px) on "Apply";
     - a bottom strip (30): "View only · tap an element to comment" + `390 × 844`.
   - **NEW** BrowserCommentCard (r18): pin "1", selector `div.summary › .total`, author "You", body "Total doesn’t update after coupon", "Delete" (`--err` text), "Send to chat" (Prominent).
   - **NEW** NextMessageAttachments: "In your next message" + chip `element-total.png` ×.
   - *Menus* ("More"):
     - "Stop sharing" (eye);
     - "Zoom 100%";
     - a section "Desktop app only" with a disabled "DevTools — Network, Console, Inspect".
     - iOS: glass (86 % overlay), r14. Android: M3 menu.
4. **iOS vs Android**
   - Menu material.
   - The Android frame is taller, so "Pay 100.00" is visible.
   - Chips are r8 on Android.
5. **Native features / engines**
   - A **remote browser stream**, not a local WebView. The page is `localhost:5173` on the *server's* machine, which a phone cannot reach, and the footer says "View only".
   - Requires a frame stream (JPEG / H.264 / VP8) decoded and drawn in native, with tap → server-side element hit-testing that returns a CSS selector.
   - Capture → image attachment.
   - Device preset → server viewport resize (390 × 844).
6. **States**
   - Drawn: loading tab, agent acting, comment mode, one pinned comment, one queued capture.
   - Not drawn: region-capture drag, zoom interaction, multi-comment "Send all", interactive (non-view-only) mode, pinch-zoom on the stream.
7. **Server data**
   - Browser descriptor: tabs, URL, title, loading, back/forward availability, viewport size.
   - Agent activity: last browser tool action ("click · button “Apply”").
   - Annotations: id, selector, author, text.
   - Capture artifacts.
   - Share state; zoom.
8. **Issues**
   - "Stop sharing" wording vs desktop's "Shared" toggle. It needs to say what stops: the agent's access, or attaching the page to the chat.
   - Desktop's strip says "Your clicks still work"; mobile is "View only", so no remote interaction is offered on mobile. Decide deliberately.
   - Page tabs are dock tabs on desktop (≤ 5) but in-panel chips on mobile (same D-27 issue as Terminal).
   - Interactive content drawn at 11 px inside the stream is unreadable at 1×. Zoom exists only as a menu item.
   - `--run-bg` fills a status strip, against the MFoundations rule "Status colour never tints a bar".
   - The "Desktop app only" disabled group shows an unreachable feature. Acceptable as an explanation, but it adds noise.

### MPaneBrowserStates — "Browser · session limit, load failure, empty"

1. **Purpose**: three Browser states stacked in one full-screen Browser tab. Each has a label ("Session limit", "Page failed to load", "Empty") and a card (r18, `--raised`, border `--line-soft`).
2. **Chrome**: the full-screen pane header and tab row.
3. **Components**
   - URL pill (36, r18, `--sunken`, with a reload icon).
   - **NEW** BrowserStateCard:
     - Session limit — `--err-bg` r12: x-circle "All 5 browser sessions are in use", "Up to 5 run at once, one per chat.", "Retry" + mono "max concurrent (5) reached".
     - Page failed to load — `--warn-bg`: triangle "This page didn’t load", "Nothing is listening on `localhost:5173`. Start the dev server, then retry.", "Retry" + "Open Terminal", and mono `net::ERR_CONNECTION_REFUSED` below.
     - Empty — the pill becomes the input "Search or enter address" with a Prominent "Start"; globe "No page open", "The agent opens pages here, or enter a URL above and press Start."
4. **iOS vs Android**: buttons (capsule vs outlined pill); the Android state cards are r12 too.
5. **Native features**: the URL input with keyboard "Go"; "Open Terminal" switches tab (a cross-tab link).
6. **States**
   - Drawn: 3.
   - Missing vs desktop F-dock-04: **access denied (401/403)**, degraded (HTTP polling), starting / connecting.
7. **Server data**: pool size and in-use count, a load-error code, whether the target port is listening.
8. **Issues**
   - The copy "Up to 5 run at once, **one per chat**" contradicts MPaneBrowser, which shows two page tabs in one chat, and desktop's ≤ 5 browser tabs per chat.
   - Error and warning cards use tinted fills (a status tint on a surface; MFoundations says status never tints a bar). This is a panel, not a bar, but it deserves a ruling.
   - "Start" is filled ink (not Send / Approve / Run).
   - Mono 11 in the error codes.

### MPaneTasks — "Background tasks · full screen"

1. **Purpose**: the Tasks tab of an orchestrator chat ("Upgrade React Flow to v12"), full screen, with Tasks 4 and Changes 23.
2. **Chrome**: the full-screen pane header; the tab row scrolled to Terminal.
3. **Components**
   - **NEW** TasksSummaryCard (iOS r22 / Android r16, `--raised`):
     - "4 of 4 workers" 17/600 · "wave 1" · "4 tasks";
     - a 4-segment 6 px bar (`--run`, `--fg-2`, `--ok`, `--line-strong`);
     - a legend with 6 px dots: "1 running · 1 in review · 1 completed · 1 starting".
   - Filter: iOS *segmented control* / Android *connected group* "All 4 / Active 3 / Done 1" (counts mono 11).
   - **NEW** TaskRow (iOS `igroup`, Android flat with dividers):
     - title 16/600 (wraps);
     - elapsed mono "1:36";
     - agent + model (mono) "Bug Fixer sonnet-5";
     - status badge ("Running" `s-run`, "In review" `s-idle` + eye, "Completed" `s-ok`, "Starting" `s-idle`);
     - a live step line (spinner + mono "pnpm typecheck --filter web") or a note ("Orchestrator is reading its result", "Accepted after 1 review round", "Opening its task chat");
     - a chevron.
   - **NEW** OrchestratorNote: "Orchestrator · Claude Opus 5.5 · 1 of 4 settled" + "Reviews each result, then consolidates when the wave settles. Workers share this chat’s workspace, so their edits land together in Changes."
4. **iOS vs Android**
   - Segmented vs connected group (r20/8).
   - Grouped card vs flat list.
   - The Orchestrator note is not in a card on Android.
5. **Native features**: live-updating list (SSE); elapsed timers.
6. **States**
   - Drawn: a mixed wave.
   - Missing (desktop F-dock-06 has them):
     - empty ("No background tasks");
     - failed task (mono error, "Ask Orchestrator to retry");
     - cancelling / cancelled "by you at 14:09";
     - the pinned **asks card** (a worker asking a question, with Answer).
   - Swipe / long-press on rows is not specified; there is no row "Cancel" (desktop has one with an inline confirm).
7. **Server data**
   - Background tasks: title, agent, model, status, elapsed, current step, review outcome, wave number, worker limit ("4 of 4"), settled count.
   - Orchestrator agent and model.
   - `05-gap-matrix` row "wave / maxWorkers / reviewRounds / brief" still applies.
8. **Issues**
   - **The status words are outside the 8-state map** (D-18): "Starting", "In review", "Completed" vs Queued / Running / Waiting / Succeeded ("Done" in chats). Map them: Starting → Queued, In review → Waiting, Completed → Succeeded. Otherwise the shared map needs task-specific labels.
   - "4 of 4 workers" reads as all running, while only one runs. The desktop copy "4 of 4 workers" has the same ambiguity (it means the worker limit).
   - Tapping a row pushes the task detail *inside* the pane (MPaneTaskDetail). This is nested navigation within a tab, and the back behaviour vs system back needs defining.

### MPaneTaskDetail — "Background task · detail"

1. **Purpose and presentation**: one worker's detail, **in-tab nested navigation**. The pane header stays; a sub-header "‹ All tasks" sits over "1 of 4" with Previous / Next task (chevron up / down).
2. **Chrome**: as MPaneTasks.
3. **Components**
   - Title 18/600 "Migrate node renderers to NodeProps v12" + badge "Running" + "Bug Fixer · sonnet-5 · 1:36".
   - **NEW** ReviewRoundCard (r14, `--raised`): "Orchestrator requested changes · GroupNode was missed; port it too. · round 2 of 3".
   - **NEW** BriefCard ("Brief · from the orchestrator", `--sunken`): the prompt with a mono run and "Out of scope: imports and edge routing."
   - *Tool block* (expanded, from the transcript kit):
     - "Running a command… 4 so far · 1:36";
     - rows (min 34): ✓ Searched `NodeProps in src/flow/` 0.3s; ✓ Edited `6 files` +88 −71 3.2s; ✓ Edited `nodes/GroupNode.tsx` +14 −12 0.4s; spinner Running `pnpm typecheck --filter web` 0:21 (in `--run`).
   - **NEW** FilesReported: "Files reported 7" + link "See in Changes"; rows with path and ±; "5 more files".
   - Footer: "Cancel task" (secondary, `--err` text + x) and "Open task chat" (Prominent).
4. **iOS vs Android**: button shapes; the Android files list is flat.
5. **Native features**: live tool-block updates; pager-like next / previous between tasks.
6. **States**
   - Drawn: running, round 2 of 3.
   - Missing: completed with result digest (desktop F-dock-06 shows Result: summary, findings, artifacts, risks, open questions), failed, cancelled.
   - The "Cancel task" confirm is not drawn.
7. **Server data**
   - Task brief (spawn prompt).
   - Review rounds: current, max, outcome, reviewer comment.
   - Live steps.
   - Files reported with ±.
   - Worker chat id.
   - Cancel (G-20: `cancelledBy` / `cancelledAt`).
8. **Issues**
   - "Cancel task" is destructive with no confirm drawn.
   - Tool rows are 34 tall, so they are not tappable at target size. Tapping a step presumably opens step detail (MChatStepDetail), but that is not specified here.
   - "See in Changes" switches tab. It should filter Changes to this task's files, which is unspecified.

### MPanePlan — "Plan · full screen · review revision 3"

1. **Purpose**: a plan awaiting approval in the Plan tab, at revision 3 of 3, with one step comment. The Plan tab shows the amber attention dot.
2. **Chrome**: the full-screen pane header; the tab row scrolled so Plan is visible.
3. **Components**
   - **NEW** PlanRevisionBar:
     - iOS: a mono *segmented control* v1 / v2 / v3 (132 wide).
     - Android: a *connected group* (v3 selected with a check).
     - "Revision 3 of 3 · 14:08" + mono path `plans/refactor-pricing.md`.
     - Icon buttons "Edit as a new revision" (pencil) and "More: Discard plan".
   - Title 20/600 "Refactor pricing module" + `s-warn` "Needs you" (hand).
   - Summary with mono runs.
   - **NEW** PlanSteps: numbered, mono 13 numerals, prose 15, file refs (mono 12, `--fg-3`, with "new" in `--ok`). Step 3 is highlighted `--warn-bg` (r10 / r8) because it carries a comment.
   - **NEW** StepComment card (r14, `--raised`): "You · 14:09 · v3 · Edit" + "Keep old export names as deprecated re-exports."
   - Risks list.
   - **NEW** PlanDecisionFooter: notes field "Notes for Bug Fixer (optional)" (iOS `.inp` 40 r12; Android 48 r4), "Request changes" with a comment-count "1", and Prominent "Approve plan" with a check.
4. **iOS vs Android**: segmented vs connected; field geometry; button shapes.
5. **Native features**
   - Text selection or tap on a step to add an anchored comment (the interaction is not drawn).
   - Keyboard avoidance for the notes field in a sticky footer.
6. **States**
   - Drawn: awaiting review, latest revision, one comment.
   - Missing (desktop F-dock-07):
     - old-revision stale banner (deciding disabled);
     - changes requested;
     - approved;
     - superseded;
     - expired;
     - edit conflict "Plan changed while you were editing.";
     - empty (no plan).
7. **Server data**: plan revisions (content, time, path), status, anchored comments (author, time, revision, anchor), agent name for the notes placeholder, decide endpoint. Revisions and anchored comments exist today (D-36 note).
8. **Issues**
   - **How a step comment is created is not drawn.**
   - "Save to workspace" (desktop) is absent.
   - "Discard plan" is hidden in More, while desktop puts it in the footer. Acceptable.
   - Using `--warn-bg` for the "has a comment" highlight overloads the warning colour: warn = "needs you" in the status map.
   - Principles say approvals are taps, and risky ones ask for Face ID. Plan approval is not marked as risky. Fine, but confirm.

### MPaneComputer — "Computer use · full screen · live"

1. **Purpose**: watching the agent drive a desktop app ("Queue Inspector — payments-worker"), with replay and grants.
2. **Chrome**: the full-screen pane header; the tab row scrolled to the end, Computer active.
3. **Components**
   - Title row: window title (truncated) + a "Now / Replay" segmented control (iOS) / connected group (Android).
   - **NEW** ComputerLiveFrame (236 h iOS / 244 Android, r14, `--sunken`, border `--line`):
     - the remote window drawn at small scale, with the agent cursor ring (22 px, `--run`);
     - top-left pill "● Live 12 fps" (translucent `--surface` 80 %);
     - top-right pill `--run-bg` "Bug Fixer · typing" (spinner);
     - a fake taskbar with a clock "14:06".
   - Controls: "Pause agent", "Take over" (secondary), and a square icon button (camera) with aria-label "Screen video".
   - **NEW** ReplayCard (r22 / r16):
     - "Replay · 6 actions · 4:06 / 4:06";
     - a scrubber with 6 tick marks and a 16 px thumb at the end;
     - an action log (rows min 28): time mono, verb, target mono — "2:07 Focus window Queue Inspector", "3:52 You allowed keyboard & mouse · this chat", "4:05 Click “Max jobs” field", "4:06 Type 32" (current, verb in `--run`).
   - **NEW** GrantsList: "Grants 2 · Watching since 14:02"; rows "Screen — Allowed for this chat — Revoke" and "Keyboard & mouse — Queue Inspector only · this chat — Revoke" (`--err` text buttons, 44 h).
4. **iOS vs Android**: segment style; the Android grants are a flat list with dividers.
5. **Native features / engines**
   - A **live frame stream** (≈ 12 fps) rendered natively.
   - A replay video player with chapter ticks (desktop: cast video with chapter markers).
   - Scrubber haptics.
   - "Take over" implies remote input (touch → mouse, soft keyboard → keystrokes) — a significant engine that is **not designed**.
6. **States**
   - Drawn: live, agent typing, 2 grants.
   - Missing:
     - consent pending (consent card);
     - paused (after "Pause agent");
     - taken over / user control;
     - runtime not ready (Start/Restart banner);
     - no workspace;
     - Replay-mode view;
     - multi-monitor.
7. **Server data**
   - Live frames plus the cursor point.
   - Recording and replay index: actions with timestamps and targets.
   - Grants: scope, app, duration.
   - Control state `agent | paused | user` (built in G-07/D-55: `GET|POST /workspaces/:id/computer/control`, SSE `computer.control_changed`).
   - Agent activity label ("typing").
8. **Issues**
   - The camera icon labelled "Screen video" is ambiguous: screenshot, start recording, or download the video? Desktop has "+screen video" only when not recording.
   - The take-over interaction model is undefined on touch.
   - The remote UI is drawn at 11 px with no pinch-zoom specified.
   - "Revoke" has no confirm (it is reversible by re-granting, so acceptable).
   - The `--run-bg` status pill is fine (a chip, not a bar).

---

## Part 2 — Automations and scripts (10 boards)

### MAutomations — "Automations · list (long-press menu)"

1. **Purpose and presentation**
   - A top-level module list with a long-press menu open on "Triage flaky tests".
   - Presentation: top-level screen (sidebar module).
2. **Header**
   - iOS:
     - glass `gbtn` "Open sidebar";
     - a glass `gcap` with "Search automations" and "Filter by trigger, project, permission, last result; sort";
     - large title "Automations" (`i-lt` 32/600) + count "6" (mono 15, `--fg-3`).
   - Android: `atop` with sidebar toggle, title 22/600 + "6", `aib` Search and Filter.
   - Filter: iOS *segmented control* "All 6 / Enabled 5 / Disabled 1"; Android *connected group*.
   - Info line: "America/New_York · schedules need `local:3100` running".
3. **Components**
   - **NEW** AutomationRow (iOS `igroup`; Android flat):
     - name 17/600 + scope ("All projects" / project);
     - a *switch*;
     - trigger line: "Daily 02:00 · Nightly dependency audit", "Webhook · POST · PR review pipeline", "Weekdays 07:30", "Fridays 16:00", "Manual · Flaky test triage", "Webhook · POST · Release notes generator, PR review pipeline";
     - dataset · permission: "3 rows / One run / 14 rows · Accept edits";
     - last result (status-coloured word + glyph) + age + next run (mono): "Needs you 12m ago · Sep 24 02:00", "Running 1m · On trigger", "Succeeded 6h ago · Sep 24 07:30", "2 of 14 failed 2d ago · On trigger", "Cancelled Sep 12 · Disabled".
   - The disabled row is at `opacity .62`.
   - *Menus*: "Run now", "Run with dataset…" | "Edit", "Duplicate", "Disable" | "Delete…" (destructive).
   - *Floating New*: the iOS glass capsule "New automation" (52 h, r26); the Android extended FAB.
4. **iOS vs Android**
   - iOS: scrim `.75` + the lifted row (`--overlay`, r22, `--shadow-pop`) + glass menu (250 wide, 17 pt items, trailing icons, 8 px group separators).
   - Android: an anchored M3 menu (232, r12, leading icons), no scrim, the row highlighted.
   - Switch: iOS 51×31; Android 52×32 with a check thumb (off: outlined 2 px `--fg-3` with a 16 px thumb).
5. **Native features**: context menu with preview; native switches (optimistic toggle + server confirm); pull to refresh (implied by MGestures for non-live lists).
6. **States**
   - Drawn: enabled / disabled, each last-result variant, menu open.
   - Missing: empty ("No automations"), loading skeleton, server-down warning (the info line hints at it), search results.
7. **Server data**
   - Automation: name, scope, enabled, trigger kind + schedule text / webhook method, workflow names (one or several), dataset row count, permission mode.
   - Last execution: status, `n of m failed`, age.
   - `nextRunAt`.
   - Server timezone and host (`local:3100`).
8. **Issues**
   - "Cancelled" and "2 of 14 failed" are outside the status map (D-18: Cancelled is not a state).
   - `opacity .62` on `--fg-3` text drops below the 4.5:1 contrast rule.
   - **The switch inside a tappable row** needs a separate hit target and a screen-reader action.
   - Date inconsistency: "Nightly audit … 12m ago" next run "Sep 24 02:00" alongside "Weekly release notes 5d ago · Sep 25 16:00". This is sample data, but "next" dates must come from the server in the server's timezone.

### MAutomationDetail — "Automation detail · Nightly audit"

1. **Purpose and presentation**: a pushed detail screen.
2. **Header**
   - iOS: glass Back; breadcrumb "Automations" over "Nightly audit" (16/600, centred); glass `gcap` with "Edit" (pencil) and "More: Run with dataset, Duplicate, Disable, Delete".
   - Android: `atop` Back, left title, `aib` Edit and More.
3. **Components**
   - **NEW** AutomationStatusHeader: *switch* "Enabled" + "Schedule · All projects · created Aug 30" + badge `s-warn` "Needs you".
   - Actions: Prominent "Run now" + secondary "Run with dataset…".
   - **NEW** StatsStrip (r18, 4 cells): "30 Executions · 30d", "93% Success", "11m Avg duration", "02:00 Next · in 12h".
   - **NEW** ConfigRow list "Configuration" (`igroup` / Android r16). Label (74 wide), value 15/600, secondary line, chevron:
     - Trigger "Daily at 02:00" + cron chip `0 2 * * *` / "America/New_York · missed: skip · overlap: skip";
     - Workflow "Nightly dependency audit" / "6 stages · worktree per codebase";
     - Permission "Accept edits" + badge "Required" / "Every run uses this mode";
     - Dataset "3 rows · concurrency 3" / `codebase: string` · on error continue;
     - Variables "3 base variables" / `target_branch=main · max_major_bumps=3 · dry_run=false`;
     - Retry "Up to 3 attempts" / "Backoff 1s × 2, max 60s · workflow_failed, timeout".
   - **NEW** ExecutionRow ("Executions 31 · See all"):
     - `#31` + hand "Running · needs you" (`--warn`) + "Manual · 2 of 3 rows · 12m 40s" + "Today 14:01"; the row fill is `--warn-bg`;
     - `#30` ✓ "Succeeded" + "Schedule · 3 of 3 finalized · 10m 52s" + "Today 02:00".
4. **iOS vs Android**: header alignment; group card vs Android r16 cards; switch style.
5. **Native features**: native switch; each config row pushes an editor (not drawn).
6. **States**: needs-you. Missing: never run, disabled, failed last run, server off.
7. **Server data**: automation config (all rows), stats (G-10 built), executions list (status, trigger source, rows progress, duration, start time), next run.
8. **Issues**
   - The execution row is tinted `--warn-bg`, against "Status colour never tints a bar".
   - "Running · needs you" combines two states, where the map has one visual state.
   - "Run with dataset…" appears both in the actions and in More (redundant, but fine).
   - The per-section editors behind the chevrons are undesigned. Does editing reuse the wizard steps?

### MAutomationExecution — "Automation execution #31"

1. **Purpose**: a pushed execution detail. Breadcrumb "Automations › Nightly audit", title "Execution #31", More ("copy execution ID").
2. **Header**: iOS glass Back + centred title + glass More; Android `atop`.
3. **Components**
   - **NEW** ExecutionSummaryCard:
     - `s-warn` "Needs you" · "waiting 3m" · "12m 40s";
     - a 3-segment progress bar (`--ok`, `--ok`, `--warn`);
     - "Manual · started Today 14:01 · 2 of 3 finalized";
     - "Accept edits · Dataset · 3 rows · concurrency 3".
   - **NEW** IterationRow ("Iterations 3 · one run per dataset row"):
     - index, mono `codebase = web-dashboard`, ±;
     - "Run #246" link + status + duration.
     - Row 3 is `--warn-bg` with an inline Prominent "Review" (34 h) and "Run #248 · Needs you · Apply upgrades · 3m".
   - **NEW** ChangesSummaryList: "Changes +54 −27 · 5 files · from #246, #247"; rows (min 44) with status letter (mono **11**), path, ±, chevron; "2 more files · Review all".
   - Footer: "Event log" (secondary) and "Cancel execution" (`--err` text).
4. **iOS vs Android**: group card (`igroup`) vs r16 raised cards; button shapes.
5. **Native features**: live progress (SSE); deep navigation to runs (MWorkflowRun) and the approval (MRunApproval).
6. **States**: needs-you. Missing: running (no gate), succeeded, failed iteration with error, cancelled; event log screen.
7. **Server data**: execution (status, waiting-since, duration, trigger source, start, finalized count), per-row input values, linked run ids and states, pending gate name ("Apply upgrades"), aggregated changes across runs.
8. **Issues**
   - The iteration row tint again.
   - "Review" is a filled ink button that is not Approve.
   - "Event log" has no board.
   - "Cancel execution" has no confirm drawn.
   - Changes rows open which diff viewer? The mobile diff is chat-workspace scoped (MPaneDiff); the run workspaces differ.

### MAutomationWebhook — "Automation detail · webhook credentials"

1. **Purpose**: the detail of a webhook automation ("Review every PR"), focused on the credentials section.
2. **Header**: as MAutomationDetail. The status header is "Enabled · Webhook · payments-service · PR review pipeline" + `s-run` "Running".
3. **Components**
   - "Run now" / "Run with dataset…".
   - **NEW** WebhookCredentialsCard ("Webhook credentials" + text button "Rotate token & secret"):
     - notice (`--warn-bg`, shield): "Shown once at creation. Rotate to get a new pair; the old one stops working.";
     - row "Webhook URL · token part hidden": mono `https://build-box:3100/api/automations/webhooks/••••••••` + "Copy URL";
     - row "Token · `X-Webhook-Token`" `••••` + a lock button (aria "Hidden after creation");
     - row "Signing secret · HMAC-SHA256" `••••` + a lock button;
     - code block (`--sunken`) "Sample request · unsigned requests are rejected" + Copy: `curl -X POST "$WEBHOOK_URL" -H "X-Signature-256: sha256=$SIG" -d '{"pr_number": 1182}'`;
     - note (database icon): "Payloads must match the dataset schema (`pr_number: number`); unknown fields are rejected."
   - **NEW** DeliveryRow ("Recent deliveries 112 · 97% succeeded · See all"): `#112` Running "POST · 1 row · 1m" "Today 14:12"; `#110` Failed "Stage Review timed out after 3 attempts" "Today 09:05".
4. **iOS vs Android**: card shapes (`igroup` vs r16 + r8 inner); switch style.
5. **Native features**
   - Clipboard (URL, sample).
   - **Rotate** implies confirm + biometric step-up + a one-time reveal sheet with copy (none drawn).
6. **States**
   - Drawn: masked, post-creation.
   - Missing: the **one-time reveal** (at creation and after rotation), rotate confirmation, revealed-copy feedback, bypass-permission admin opt-in state.
7. **Server data**: webhook URL base (host as seen by external callers), token header name, signature algorithm, dataset schema, delivery stats and list.
8. **Issues**
   - "Copy URL" with the token part hidden: does the copy include the token? If yes, the UI misleads; if no, the copied URL is useless.
   - Lock icons rendered as buttons that do nothing are a11y noise. Make them non-interactive icons, or "Rotate to reveal".
   - The host `build-box:3100` is the server's LAN name. Reachability from the internet is not addressed.
   - The create wizard (MAutomationCreate2 with Webhook chosen) does not show the reveal-once step, which desktop has (`WebhookCredentialsDialog`).

### MAutomationCreate1 — "New automation · 1 Basics"

1. **Purpose and presentation**
   - Step 1 of the creation wizard.
   - Presentation: a **full-screen modal** — Cancel (x) plus "Save draft", no swipe to dismiss (MPrinciples "Full-screen modal: Cancel and Save in the header").
2. **Header**
   - iOS: glass `gbtn` "Cancel", breadcrumb "Automations" over "New automation" (centred), glass `gcap` text button "Save draft".
   - Android: `atop` `aib` "Close", left title, text button "Save draft".
   - **NEW** WizardStepper: 6 nodes (26 px circles, mono 12) joined by 1 px lines — Basics, Trigger, Workflow, Dataset, Variables, Review.
     - current: `--accent` fill, label 11/600 `--fg`;
     - done: check on `--selected`;
     - future: outline `--line-strong`, label 11/500 `--fg-3`.
3. **Components**
   - Step title 22/600 + subtitle.
   - Name field; Description (multiline).
   - **NEW** ProjectScopePicker: "Project scope · Only this project’s workflows will be offered".
     - Options: "All projects — Global · any workflow" (selected), and "payments-service 3 codebases · 12 workflows", "web-dashboard 2 · 5", "docs-site 1 · 3", "infra-terraform 1 · 2".
   - **NEW** WizardFooter: "Back" (disabled, opacity .4), status text "Draft saved 14:02", Prominent "Continue →".
4. **iOS vs Android**
   - iOS: filled form rows; selection = trailing checkmark in an inset group.
   - Android: outlined fields (56, r4, floating label); selection = leading radio (20 px).
5. **Native features**: keyboard handling; autosave.
6. **States**: filled. Missing: validation error (empty name), duplicate name.
7. **Server data**: projects with codebase and workflow counts; **server-side automation drafts** ("Save draft", "Draft saved 14:02") — no such API is known; it needs a gap entry.
8. **Issues**
   - The stepper labels are 11 px: below the Android 12 sp minimum.
   - Are the stepper nodes tappable? They are drawn at 26 px.
   - Draft persistence is unspecified: server or device.

### MAutomationCreate2 — "New automation · 2 Trigger"

1. **Purpose**: step 2, with Schedule selected.
2. **Header**: as Create1; Basics shows as done.
3. **Components**
   - Subtitle "Schedules run while the server is up."
   - **NEW** TriggerKindCards (3 across, r18 iOS / r12 Android): Manual (hand), Schedule (clock, selected: `--selected` fill + 2 px `--fg` border + check / radio), Webhook.
   - "Repeats": iOS *segmented control* / Android *connected group* — Every day / Weekdays / Weekly / Cron.
   - Time field "02:00" (clock icon, 118 wide) + Timezone field "America/New_York ⌄".
   - **NEW** CronPreviewCard: "Cron `0 2 * * *` · generated"; "Next 3 runs · Daily 02:00 · America/New_York"; rows (27 h) with calendar icon, "Thu Sep 24 · 02:00 EDT · in 12h", "Fri Sep 25 … in 1d 12h", "Sat Sep 26 … in 2d 12h".
   - **NEW** PolicySegments: "Server was off" Skip / Run once on start; "Previous run still going" Skip / Queue.
   - Footer: "Back", "Next: workflow", "Continue".
4. **iOS vs Android**: card radius; segmented vs connected; radio vs check-circle in the cards; outlined fields.
5. **Native features**
   - **Native time picker** (UIDatePicker compact / M3 TimePicker).
   - Searchable timezone list (IANA).
   - DST-aware preview ("EDT").
6. **States**
   - Drawn: Schedule / Every day.
   - Not drawn:
     - Weekly (day picker);
     - Cron (free-text editor + validation error);
     - **Manual** and **Webhook** variants (webhook settings, dataset mapping);
     - invalid cron.
7. **Server data**: `POST /automations/schedule-preview { cron, timezone, count }` (G-26), server timezone default, the missed / overlap policy enums.
8. **Issues**
   - The Webhook variant is missing from the wizard entirely: credentials reveal and payload schema.
   - "Queue" for overlap: D-29 says no message queue. That concerns chat messages, but the wording may confuse; confirm the engine supports run queuing.

### MAutomationCreate3 — "New automation · 3–4 Workflow, permission and dataset"

1. **Purpose**: steps 3 **and** 4 on one screen. The stepper marks both Workflow and Dataset as current (two accent nodes).
2. **Header**: as before.
3. **Components**
   - **NEW** WorkflowPickList: "Workflows · Several run one after another" + "Add"; row "1 · Nightly dependency audit · Published · v7 · 6 stages · 1 approval" + Remove (x).
   - **NEW** PermissionModeSegment: "Permission mode · Required · every run uses it" — Plan / Default / Accept edits (selected) / **Bypass** (lock icon); note "Bypass on a webhook automation needs an admin opt-in."
   - **NEW** DatasetEditor ("Dataset · One run per row · no rows = one run"):
     - "Data schema 1 field" + "Add field"; field row (40, r10): mono `codebase`, type `string ⌄`, "Required" check;
     - "Default rows 3" + "CSV or JSON" (upload);
     - row chips (32, r16, `--sunken`, mono) `web-dashboard ×`, `checkout-web ×`, `payments-api ×`, and a dashed "+ Add row";
     - "Concurrency" stepper (− 3 +, 36 px round buttons);
     - "On error" Continue / Stop;
     - note "Run with dataset… passes other rows at run time."
4. **iOS vs Android**: segmented vs connected (Android shows "Accept edits" with a check); card shapes.
5. **Native features**
   - **Document picker** (CSV / JSON import) and parsing.
   - Type picker menu.
   - Stepper.
6. **States**
   - Drawn: one workflow, one field, three rows.
   - Missing: the workflow picker sheet (Add), multi-field rows (a row chip only fits a single-field schema), CSV parse errors, "Bypass" locked / admin state, no-workflows-in-scope empty state.
7. **Server data**: workflows in scope with status, version, stage count, approval count; permission modes; admin opt-in flag for bypass on webhooks; dataset schema types.
8. **Issues**
   - **The step numbering is broken**: a 6-node stepper, but 4 screens, with two nodes "current" at once. Either merge nodes or split screens.
   - Workflow order ("one after another") has no reorder affordance (drag handle or Move up / down).
   - Row chips cannot represent multi-field rows.
   - The concurrency stepper buttons are 36 px (below target).

### MAutomationCreate4 — "New automation · 5–6 Variables and review"

1. **Purpose**: steps 5 **and** 6 on one screen. Variables and Review are both current; 1–4 are done.
2. **Header**: as before. The footer is "Back" + Prominent "Create automation ✓" (no status text).
3. **Components**
   - **NEW** VariablesEditor: "Base variables · Every run gets these; dataset fields override". Key / value rows (min 38, mono 13, key column 132 wide, remove ×): `target_branch main`, `max_major_bumps 3`, `dry_run false`; "+ Add variable".
   - **NEW** RetryToggleRow: "Retry failed executions · 3 attempts · 1s × 2, max 60s · workflow_failed, timeout, network" + *switch*.
   - **NEW** ReviewSummaryList (rows min 32): Basics, Trigger, Workflow, Permission, Dataset, Variables, Retry.
4. **iOS vs Android**: group shapes; switch.
5. **Native features**: keyboard for key / value editing.
6. **States**
   - Drawn: filled.
   - Missing: the retry detail editor (attempts, backoff, error classes: validation needs attempts ≥ 2 and ≥ 1 error class), variable type / validation, create in progress, create error, webhook credentials reveal on success.
7. **Server data**: workflow variable definitions (to suggest keys and types), retry error-class enum.
8. **Issues**
   - Review rows are not tappable to jump back to a step.
   - The remove × targets are tiny.
   - Variables are untyped (`false` and `3` as strings?).
   - Rows at 32–38 are below the target size where tappable.

### MScripts — "Scripts · list"

1. **Purpose**: a top-level module list of workflow scripts.
2. **Header**
   - iOS: glass "Open sidebar"; a glass `gcap` with "Filter scripts" (search icon) and "Reload scripts from disk"; large title "Scripts 3".
   - Android: `atop` equivalents.
   - Info: mono `templates/scripts · loaded 14:01` + "1 error" (`--err`, x-circle).
3. **Components**
   - **NEW** ScriptRow (`igroup` / Android r16): file icon, mono 14/500 filename, title 15, meta "6 stages · 3 profiles" + last run "✓ Last run #17 · Sep 22" / "◌ Never run" / "Not loaded · ⊗ Load error", then an error block (`--sunken`, mono 12, `--err`) "SyntaxError: Unexpected token (14:9)"; chevron.
   - **NEW** InfoCard:
     - Scripts are `.workflow.mjs` files in `templates/scripts` on the server. They compile to the same graph as the builder, and Materialize saves one as a Draft workflow. There is no editor on mobile: the user edits them in their own editor, then taps Reload.
     - A lock note: scripts run with the server's privileges, so they stay off unless `GENERATORAI_ALLOW_WORKFLOW_SCRIPTS` is set on the server. Running one needs the `write:workflows` scope.
   - A "Pull down to reload" hint.
   - **No floating New** (justified: there is no editor).
4. **iOS vs Android**: header; card radius.
5. **Native features**: pull to refresh (on iOS too; MGestures draws it on Android).
6. **States**
   - Drawn: ok, never run, load error.
   - Missing: scripts disabled on the server (flag off), missing `write:workflows` scope (should link to MScopeRequest), empty folder, loading.
7. **Server data**: script files (name, title, stage count, profile count, load status and error, last run id and date), folder path, loaded-at time, the server flag, device scopes.
8. **Issues**
   - The aria-label "Filter scripts" is on a search icon.
   - The info card repeats on every visit. A one-time explanation or an empty-state treatment would be lighter.

### MScriptDetail — "Script detail · nightly-audit.workflow.mjs"

1. **Purpose**: a pushed script detail with a run profile and the compiled graph outline.
2. **Header**
   - iOS: glass Back; breadcrumb "Scripts" over the mono title `nightly-audit.workflow.mjs` (14/600 — smaller than the 16 detail title); glass More ("Copy path, Reload").
   - Android: `atop`.
3. **Components**
   - Title 22/600 + description.
   - Tag chips (24 h, r12) "deps / security / nightly".
   - "✓ Last run #17" (link).
   - **NEW** RunProfileSegment: "Run profile · used by Run script · Loaded 14:01"; iOS *segmented control* / Android *connected group* "nightly / dry-run / thorough"; summary "Accept edits · `base_branch=main · max_upgrades=10`".
   - Actions: Prominent "Run script" + secondary "Materialize as draft".
   - **NEW** StageOutline ("Stages 6 · 1 loop"; rows min 46):
     - number, name 15/600 + mono key, agent;
     - the loop row "Fix until green `fix_until_green` · Loop · max 3 · until tests pass" with nested children indented behind a 2 px rail: "Apply upgrades `apply` · Bug Fixer" + badge "Approval", "Run test suite `test` · Test Writer";
     - "Open PR `open_pr` · Release Scribe".
   - **NEW** EdgeChips ("Edges 4 · all on success · no back-edges"): mono chip `scan → assess_risk → fix_until_green → open_pr`, and `apply → test` "inside fix_until_green".
4. **iOS vs Android**: segment style; card radius.
5. **Native features**: none special. Run presumably needs a confirm / step-up because the script has server privileges (not drawn).
6. **States**: loaded. Missing: running, disabled flag, missing scope, load error detail, materialize result (navigates to the draft workflow?).
7. **Server data**: compiled script graph (stages, keys, agents, loop config, approval flags, edges), profiles (permission + variables), tags, last run (G-27: `POST /workflow-scripts/:id/materialize` and `/run`).
8. **Issues**
   - "Stages 6" counts the loop container as a stage (4 top-level + 2 nested). That is confusing next to the "1 loop" label.
   - The edge-chip layout wraps poorly for larger graphs; no graph view is offered here (MBuilderGraph exists for workflows).

---

## A. The workspace pane model (consolidated)

| Aspect | iOS 27 (iPhone 402 pt) | Android 17 (Pixel 412 dp) | iPad (1194 × 834 landscape) | Android tablet (1280 × 800) |
|---|---|---|---|---|
| Presentation | Overlay over the chat + `--scrim`; the chat never shrinks | same | **Persistent third column** beside sidebar 312 + chat; inset card (r22, `--raised`, border `--line-soft`) | Persistent column beside a permanent drawer 300 + chat, flush right, `--overlay` |
| Width | 356 (89 %) | 364 (88 %) | 410 | 400 |
| Surface / radius | `--surface`, r 28 0 0 28, border-left `--line-soft`, shadow −12 0 40 .35 | `--overlay` (tonal), r 16 0 0 16 | `--raised` r22 | `--overlay` |
| Header | 52: title 16/600 + chat title 12 `--fg-3`; `gbtn` 40 (non-glass) Full screen, Close | 52 (**not 64**): 18/600; `aib` 48 | same as phone, with Full screen + Close | same |
| Tab strip | `ptab-i` pills, 32 h, r16, 14/500, icon 16, selected `--selected` | `ptab-a`, 48 h, 3 px `--fg` underline | pills | underline |
| Tab overflow | horizontal scroll with an 88 % fade mask; the active tab auto-scrolls into view; no overflow menu | same | same | same |
| Tabs | Changes, Files, Terminal, Browser, Tasks, Plan, Computer (always 7 in every board) | same | same | same |
| Badges | count (mono 12 `--fg-3`) on Changes and Tasks; 6 px `--warn` dot for "needs you" (Plan, Computer control request) | same | same | same |
| Chat-header toggle | pane icon with a count badge (Changes count), trailing in a glass capsule with ⋯ | icon button with badge, then ⋮ | toggle rendered **selected** while open; aria "Hide workspace pane, 2 changes" | same |
| Open | the toggle only (no edge gesture; the left edge = back or sidebar) | the toggle only (edges are system back) | toggle | toggle |
| Close | Close button; tap the scrim; drag toward the right edge; system back | same; predictive back | toggle / Close | same |
| Switch tab | tap; swipe the body sideways (MPaneTabsOverview) — **conflicts** with MGestures | same | — | — |
| Full screen | "Open full screen" keeps the tab; 100 % width, absolute over the chat; header becomes "‹ Back to chat" + title + "Exit full screen" (minimize-2); the tab row stays | ← "Back to chat" + "Exit full screen" | Full-screen button still present (target undefined) | same |
| Minimise | "Exit full screen" returns to the overlay pane over the chat | same | — | — |
| Pushed from the pane | Diff (`Changes › src › cart`), File preview (`Files › mount › …`) leave the pane chrome (no tab row) | same | undefined (push inside the column, or over the chat?) | undefined |
| In-tab navigation | Tasks → Task detail ("‹ All tasks", 1 of 4, ↑/↓) | same | — | — |
| Sheets from the pane | Commit & PR (`sheet-i` r38, large detent; done state at the content detent) | `sheet-a` r28 | undefined (form sheet?) | undefined |

**Per-tab toolbars**

| Tab | Toolbar | Footer |
|---|---|---|
| Changes | DiffStat + branch chip; Compare segment (This turn / This chat / Branch vs main); checkpoint card; pending-comments bar | "N files ready · into <branch>" + "Commit…" |
| Diff (pushed) | status letter, ±, comment count, Wrap chip | Prev · File i of n · Next (file name) |
| Files | Sources card (mounts, Edit sources); Filter field + "All sources" chip | — |
| File preview (pushed) | status, lines, size, language, Wrap chip | View diff · Mention in chat |
| Terminal | instance chips (+ New terminal); pty, Agent working, (Attach N lines), Find, (Clear in full screen), Kill | status footer: process, shell, pid, cols × rows; key row when the keyboard is up |
| Browser | page chips + "+"; Back / Forward / Reload + URL pill; agent strip; Comment, Capture, Device preset, More (Stop sharing, Zoom, DevTools desktop-only) | "View only · tap an element to comment · 390 × 844" inside the view; comment card; "In your next message" attachments |
| Tasks | summary card (workers, wave, segmented bar, legend); All / Active / Done | orchestrator note |
| Task detail | ‹ All tasks · i of n · ↑ ↓ | Cancel task · Open task chat |
| Plan | v1 / v2 / v3 + revision meta + Edit as new revision + More (Discard plan) | notes field + Request changes (n) + Approve plan |
| Computer | window title + Now / Replay | Pause agent · Take over · Screen video; Replay card; Grants |

**Tablet specifics**
- The pane becomes a docked column.
- The Android tablet terminal uses a compact toolbar: cwd mono, pty, Agent working, and icon buttons Attach, Find, Clear scrollback, **Font size** (T), Kill.
- The Android tablet key row: Esc, Tab, Ctrl, ^C, ↑, ↓, "More keys", on `achip` 40 h.
- The status footer reads "48×32".
- Not drawn: portrait, Split View / Stage Manager compact widths, resizable pane width. Desktop resizes 380–60 %.

---

## B. New / domain composites required

Legend — **Draw**: N = native platform control, J = JS/RN-drawn, S = stream/canvas surface, W = WebView.

| Composite | Props sketch | iOS vs Android | Draw |
|---|---|---|---|
| **WorkspacePane** (shell) | `{open, mode:'overlay'\|'fullscreen'\|'docked', tab, tabs:PaneTab[], onClose, onToggleFullscreen, title, subtitle}` | overlay width 356/364; surface vs overlay; radius 28/16; docked 410/400 | J (+ gesture-handler for drag-to-close, Reanimated spring) |
| **PaneTabStrip** | `{tabs:{id,label,icon,count?,attention?}[], active, onSelect}` | pill 32 vs underline 48 | J |
| **CompareSegment** | `{value:'turn'\|'chat'\|'branch', onChange, mounts?}` (desktop adds a mount Select) | segmented vs connected group | N (UISegmentedControl / M3 SegmentedButton via Expo UI) or J |
| **CheckpointScrubber** | `{checkpoints:{id,label,time,prompt,diffStat}[], selected, onSelect, onCompare, onRewind}` | same; thumb 20 | J (gesture slider + haptic ticks) |
| **PendingCommentsBar** | `{count, firstAnchor, onPreview, onSendAll}` | card r14 / r12 | J |
| **ChangeFileRow** | `{status:'M'\|'A'\|'D'\|'R', path, oldPath?, add, del, comments, kept?, onOpen, onMenu}` + menu items Open diff, Mention, Copy path, Keep / Unkeep (D-28), Discard (confirm) | 44 filled vs 56 outlined; menu with preview vs M3 | J + N menu |
| **CommitFooter** | `{readyCount, branch, onCommit}` | 44 vs 48 | J |
| **CommitPRSheet** | `{branch, bases[], mounts?, message, generate?, pr:{title,body,base,draft}, phase:'form'\|'working'\|'done'\|'error', result?}` | inset glass sheet vs edge sheet; fields filled vs outlined | N sheet (TrueSheet / form sheet) + J content |
| **PRResultCard** | `{number, title, base, head, commits, url, draft}` | — | J |
| **DiffView** (mobile) | `{hunks, wrap, selectedLine?, threads[], onLinePress, onLineLongPress}` + **InlineCommentComposer** `{agentName, line, intent:'fix'\|'question'\|'note'…, onAddToReview, onSend, onCancel}` | chip radius, field radius | J (virtualised list of mono Text rows; no WebView) |
| **FileNavigatorFooter** | `{index, total, prevLabel?, nextLabel?}` | 44 vs 40 | J |
| **SourcesCard** | `{mounts:{alias, mode:'worktree'\|'in-place', branch, dirty, path}[], onEdit, onCopyPath}` | filled vs outlined | J |
| **FileTree** (mobile) | `{sections:{alias,mode,branch,count,nodes}[], statuses, filter, sourceFilter, onOpen, onMenu}` | same rows 44 | J (FlashList / Legend List) |
| **FileViewer** | `{content, language, size, lines, changedRanges[], wrap, highlight?}` | header layout | J (+ optional Shiki tokens) |
| **TerminalView** | `{session, fontSize, onSelection, onResize}` | container radius 14 / 12 | W (xterm.js) or N (SwiftTerm) — see §C |
| **TerminalInstanceChips** | `{instances:{id,name,closable}[], agentCommandsCount, active, onNew}` | chip radius | J |
| **TerminalToolbar** | `{pty:boolean, agentBusy, selectionLines?, onAttach, onFind, onClear?, onKill}` | — | J |
| **TerminalKeyRow** | `{keys: KeySpec[], sticky:{ctrl,alt?}, onKey}` (Esc, Tab, Ctrl, ^C, arrows, ⇧Tab, \| ~ /, More) | identical (tablet uses `achip`) | N-hosted accessory (InputAccessoryView / keyboard-sticky view) + J keys |
| **TerminalSelectionMenu** | `{onCopy, onAttach, onSelectAll}` | glass capsule vs M3 floating toolbar | N edit menu (UIEditMenuInteraction / ActionMode) if the terminal is native; J if the terminal is a WebView |
| **TerminalStatusFooter** | `{process?, shell, pid, cols, rows}` | — | J |
| **BrowserPageChips** | `{pages:{id,title,loading}[], active, onNew, onClose}` | chip radius | J |
| **BrowserNavBar** | `{canBack, canForward, url, onReload, onSubmitUrl}` | — | J |
| **AgentBrowsingStrip** | `{agentName, action}` | — | J |
| **BrowserLiveView** | `{frameSource, viewport:{w,h}, mode:'view'\|'comment'\|'capture', pins[], agentCursor?, onTapPoint}` | — | S (native image / Skia / video surface) |
| **BrowserCommentCard** / **NextMessageAttachments** | `{pin, selector, author, text}` / `{items[]}` | — | J |
| **BrowserStateCard** | `{kind:'poolFull'\|'loadFailed'\|'empty'\|'denied'\|'degraded'\|'starting', detail?}` | — | J |
| **TasksSummaryCard** | `{workers, maxWorkers, wave, counts:{running,review,done,starting}}` | r22 vs r16 | J |
| **TaskRow** / **TaskDetail** | `{title, agent, model, status, elapsed, step?, note?}` / `{brief, reviewRound:{n,max,comment}, steps:ToolBlock, files[], onCancel, onOpenChat}` | grouped vs flat | J (reuses *Tool block*) |
| **PlanRevisionBar** / **PlanDocument** / **StepComment** / **PlanDecisionFooter** | `{revisions, selected, path, time}` / `{title, status, summary, steps[], risks[]}` / `{author, time, rev, text}` / `{notes, commentCount, onRequest, onApprove}` | segmented vs connected; field shapes | J |
| **ComputerLiveFrame** | `{frames, fps, cursor, agentActivity, control:'agent'\|'paused'\|'user'}` | 236 vs 244 tall | S |
| **ComputerControls** | `{onPause, onTakeOver, onScreenVideo}` | — | J |
| **ReplayCard** | `{duration, position, markers[], actions[]}` + video | — | N video (expo-video) + J scrubber |
| **GrantsList** | `{grants:{kind,scope,app?}[], since, onRevoke}` | grouped vs flat | J |
| **AutomationRow** | `{name, scope, enabled, trigger, workflows[], rows, permission, last:{status,label,age}, next}` | switch style; grouped vs flat | J + N switch |
| **AutomationStatusHeader** / **RunActions** / **StatsStrip** / **ConfigRow** | `{enabled, summary, status}` / `{onRun, onRunWithDataset}` / `{cells[4]}` / `{label, value, sub?, chip?, badge?, onPress}` | — | J |
| **ExecutionRow** / **ExecutionSummaryCard** / **IterationRow** | `{id, status, sub, time}` / `{status, waiting, duration, segments[], trigger, started, finalized}` / `{index, values, add, del, runId, runStatus, gate?, onReview}` | — | J |
| **WebhookCredentialsCard** | `{urlMasked, tokenHeader, signatureAlg, sample, schema, revealOnce?:{token,secret}, onRotate, onCopy}` | — | J (+ step-up biometric, clipboard) |
| **DeliveryRow** | `{id, status, sub, time}` | — | J |
| **WizardHeader + WizardStepper + WizardFooter** | `{steps[], current:number\|number[], done[]}` / `{canBack, status, primaryLabel}` | Cancel glass vs Close; stepper identical | J |
| **ProjectScopePicker** | `{options:{id,label,sub}[], value}` | trailing check vs leading radio | J |
| **TriggerKindCards** | `{value:'manual'\|'schedule'\|'webhook'}` | radius 18 vs 12; radio | J |
| **ScheduleEditor** | `{repeat, time, timezone, cron, preview:{when,relative}[], missed, overlap}` | native time picker | N pickers + J |
| **WorkflowPickList** | `{items:{id,name,status,version,stages,approvals}[], onAdd, onRemove, onMove}` | — | J (reorder via gesture + Move up / down) |
| **PermissionModeSegment** | `{value, locked:['bypass'], note}` | segmented vs connected | N / J |
| **DatasetEditor** | `{schema:{name,type,required}[], rows[], concurrency, onError, onImport}` | — | J + document picker |
| **VariablesEditor** / **RetryToggleRow** / **ReviewSummaryList** | `{vars[]}` / `{enabled, summary}` / `{rows[], onJump?}` | — | J |
| **ScriptRow** / **ScriptsInfoCard** / **RunProfileSegment** / **StageOutline** / **EdgeChips** | `{file, title, stages, profiles, last?, error?}` / — / `{profiles[], value, summary}` / `{stages tree, loops, approvals}` / `{chains[]}` | — | J |

---

## C. Engine choices implied by the design

| Surface | What the boards require | Recommendation | Why (evidence on the boards) |
|---|---|---|---|
| **Terminal** | ANSI colour output; block cursor; scrollback; find; **native-feeling selection** with a custom menu (Copy / Attach to chat / Select all); "Attach N lines"; key row with sticky Ctrl; pinch font 10–20; hardware keyboard; cols × rows reporting | **xterm.js in a WebView** (react-native-webview), with a **native RN key row** in the keyboard accessory (iOS `InputAccessoryView`; Android via react-native-keyboard-controller's sticky view). Keep selection inside xterm and render the app menu in RN from a `selectionchange` bridge. Alternative for iOS polish: SwiftTerm (MIT) behind a native module; Android has no equally clean permissive option (Termux's terminal-view is GPL-3.0 — check before use) | D-40 already notes xterm is DOM-only. One emulator on web, desktop and mobile gives identical ANSI and theme mapping (`resolveTerminalPalette`). The board's terminal is themed by tokens (light and dark), which xterm themes support. Selection menu and key row are the only parts that must feel native |
| **Diff** | Unified diff; wrap toggle; add/del fills; line ring; **inline composer inserted between lines**; long-press line menu; no syntax colour | **RN-drawn virtualised list** (Legend List / FlashList) of mono `Text` rows, diff computed server-side or in client-core | A WebView (`@pierre/diffs`) would fight the native keyboard, context menu and text-input avoidance the composer needs. Monochrome text makes RN rendering cheap |
| **File preview** | Line numbers; changed-line gutter; horizontal scroll + wrap; monochrome in the design | RN virtualised rows; optional Shiki tokens (JS engine) off the UI thread | The same renderer as Diff. Highlighting is a product decision (desktop uses Shiki) |
| **Browser** | The server's page (`localhost:5173` on the server machine), "View only", tap-to-comment returning a CSS selector, capture, device preset, agent click ring | **Remote stream rendered natively** (frames decoded to an image / Skia surface; JPEG or H.264 mode requested from the server). Taps are sent as viewport coordinates to the server's element picker | A local WebView cannot reach the server's `localhost`. The design never lets the user drive the page. WebCodecs / VP8 (desktop's path) is not available in RN, so the server must offer a mobile-friendly codec or MJPEG |
| **Computer** | Live frames ~12 fps + cursor ring; replay video with markers; Pause / Take over | The same native frame surface; `expo-video` for replay. Take-over needs a touch → pointer model and keyboard bridging (undesigned) | Stream and replay already exist server-side (G-07); control-state API built (D-55) |
| **Menus** | iOS context menu **with lifted preview**; Android anchored M3 menu | Native: UIContextMenuInteraction (via Expo UI / zeego / react-native-ios-context-menu) and M3 DropdownMenu | Previews, blur and system haptics are platform behaviour |
| **Sheets** | iOS inset sheet r38 with detents (large / content); Android edge sheet r28 | TrueSheet or expo-router form sheets (per 08-mobile-readiness M1) | Detent-driven Commit → Done height change |
| **Segmented controls, switches** | iOS UISegmentedControl look; M3 connected button group with check; 51×31 / 52×32 check-thumb switch | Expo UI native controls, or J clones where native styling can't take tokens | The boards draw platform-exact geometry |
| **Pickers** | Time (02:00), timezone, base branch, field type, device preset | Native time picker (Expo UI DateTimePicker); searchable lists in sheets for the rest | — |
| **Pager / tab swipe** | Swipe the body between tabs (if kept) | react-native-pager-view; must yield to horizontally scrolling children | MPaneTabsOverview "Switch" |
| **Scrubbers** | Checkpoint (snap stops), Replay (ticks) | J gesture slider + selection haptics | MFoundations haptics |
| **Clipboard / share / external browser** | Copy path, link, URL, sample; Share file; Open PR in browser | expo-clipboard; RN Share / expo-sharing (file needs download); expo-web-browser | MPaneFiles, MPaneCommitDone, MAutomationWebhook |
| **Document picker** | "CSV or JSON" import | expo-document-picker + JS parse | MAutomationCreate3 |
| **Biometric step-up** | Principles: "Risky ones ask for Face ID"; `stepUp.ts` exists | expo-local-authentication before Rotate secret, Kill?, Run script, Bypass permission | Not drawn on these boards; needs a ruling per action |
| **Live data** | Terminal WS; browser and computer frames; tasks, automations and executions via SSE | client-core multiplexed streams; background tear-down when the tab is hidden (desktop pins "visible === false tears the socket down") | — |

---

## D. Open questions and conflicts for the owner

1. **Tab visibility.** Always seven tabs (every mobile board) vs contextual Tasks / Plan / Computer (D-27, and the overview's own "Only on those chats"). Recommend: follow D-27 on mobile too.
2. **Tab instances.** Mobile keeps Terminal instances and Browser pages as chips *inside* one tab. Desktop (D-27) makes each shell / page its own dock tab and supersedes the in-panel segment. Accept the divergence on phones? The shared `PaneTabType` contract must model instances.
3. **Swipe semantics.** A body swipe switches tabs (MPaneTabsOverview) vs a right-drag closes the pane (MGestures), and both collide with horizontally scrolling content. Recommend: tap-only tab switching, drag-to-close from the pane edge or header only.
4. **Keep / Keep all / Undo all** (D-28 / MD-7) are absent from Changes, and the per-file **Discard** and terminal **Kill** have no confirmation although desktop added confirms.
5. **Commit flow.** No Generate, no push toggle, no mount picker (Files shows 2 mounts). The meaning of "Create pull request" before "Commit" is undefined. Progress and error states are missing.
6. **Status vocabulary** (D-18). Starting / In review / Completed (tasks), Cancelled and "2 of 14 failed" (automations), "Running · needs you" and "Draft" all need mapping or explicit label-only status.
7. **Ink rule** (principle 6: only Send / Approve / Run are filled). Violated by Commit…, Create pull request, Open in browser, Mention in chat, Send to chat, Start, Open task chat, Review, Continue, Create automation. Restate it as "one filled action per screen"?
8. **Status tints** ("Status colour never tints a bar"). Execution and iteration rows (`--warn-bg`), browser error and warning cards, the agent-browsing strip (`--run-bg`), the plan step highlight (`--warn-bg` for "has a comment"), the webhook notice. Allow panel and row tints, or remove them?
9. **Touch targets and minimum type.** Pane header buttons 40; row actions 36 / 40; pane tabs 32; key-row keys 26–42 × 36; concurrency ± 36; remove × tiny; iOS rows 44 (< 52), Android rows 56 (< 64). Mono 11 appears in scrubber labels, badges, footers, mount subtitles, execution letters and stepper labels (Android min 12). Terminal pinch goes down to 10. Expand hit areas and fix sizes, or amend the foundations?
10. **Android pane header height.** 52 on every pane board vs the 64 dp top app bar rule. Intentional compact chrome?
11. **Terminal key row.** Three different sets (phone, MGestures, Android tablet); ^C missing on the phone. Hardware-keyboard behaviour is undrawn.
12. **Browser model.** Mobile is view-only; desktop says "Your clicks still work". "Stop sharing" meaning. The "one per chat" copy contradicts the multi-page chips. Denied and degraded states are missing.
13. **Computer.** How does Take over work on touch? What is "Screen video"? Consent, paused and taken-over states are undrawn.
14. **Diff comments.** 3 intents vs desktop 5. Trigger (tap vs long-press) and the "Comment" toolbar button promised by MGestures are missing. Threads and resolved states are undrawn. Old/new line numbers are ambiguous.
15. **Syntax highlighting.** The mobile file preview and diff are monochrome vs desktop Shiki. Intentional?
16. **Plan comments.** The creation interaction is undrawn. Stale-revision, approved and edit-conflict states are missing.
17. **Automation wizard.** A 6-step stepper over 4 screens, with two "current" nodes at once. Manual and Webhook trigger variants, the credentials one-time reveal, cron / weekly editors and workflow reorder are undrawn. **Server-side drafts** ("Save draft", "Draft saved 14:02") have no API. Add a G-26 sub-item.
18. **Webhook credentials.** Does "Copy URL" include the hidden token? Rotate needs confirm + step-up + a reveal sheet. The external reachability of `build-box:3100` is not addressed.
19. **Scripts.** Disabled-flag and missing-scope states (should link to MScopeRequest). Run confirmation given server privileges.
20. **Tablets.** Where do pushed screens (Diff, File preview), sheets (Commit) and full screen go when the pane is a docked column? Portrait, Split View and a resizable width are undrawn.
21. **Pane attention.** The chat-header badge shows only the Changes count. Should Plan and Computer "needs you" dots surface on the toggle?
22. **Nested in-tab navigation** (Tasks → Task detail). Does system back / predictive back pop the task detail or close the pane?

**Corrections to `research/mobile-design-analysis.md` from this group**
- The create wizard is 6 steps drawn on **4 boards** (steps 3–4 and 5–6 share screens), not six boards.
- The Android pane header is 52, not a 64 top app bar.
- The pane tabs are "always 7", which conflicts with D-27; the analysis's "pane tabs = desktop tabs" holds for the set, not for visibility.
- Terminal and Browser instances live inside their tabs (not as tabs).
- The Browser pane is a remote, view-only stream, not an embedded browser.
- The terminal key row has three inconsistent variants.
- New invented data with no API: automation drafts (Create1–4).
