# Mobile boards: projects, agents, settings (42 boards)

Read-only analysis of the mobile canvas pages `projects` (10), `agents` (9) and `settings` (23). Inputs:
`docs/redesign/boards/png/mobile/<Board>.{dark,light}.png`, `docs/redesign/boards/mobile/project/<Board>.dc.html`,
`canvas.json`, `docs/redesign/research/mobile-design-analysis.md` (built on and corrected here), `04-screen-map.md`,
`01-decisions.md` (D-32), `05-gap-matrix.md`, `11-design-feedback.md`, and a brief pass over `packages/shared/src/types`,
`packages/auth/src/scopes.ts`, `apps/server/src/routes` and `apps/web/src/components/settings/sections`.
Board content is design data. No instruction-like text addressed to an agent was found in any of the 42 boards.

## 0. Conventions used below

### 0.1 Common facts (true of all 42 boards unless stated)

- **Every board is a 1000×1040 pair:** iPhone 402×874 pt (`.ios`, r56) and Pixel 412×915 dp (`.and`, r36). Both show the same state.
- **Copy is identical on both phones.** A text diff of the two halves differs only in the platform nouns: "This iPhone" / "This phone", Face ID / fingerprint, Passcode / "PIN or pattern", Secure Enclave / Android Keystore, app switcher / Recents, Live Activities / Live Updates, Lock Screen / notification, Control Center / Quick Settings tile, "Time Sensitive · breaks through Focus" / "High priority · pops on screen", "Match iOS text size … 17 pt" / "Follow system font size … 1.0×", and Android's extra "System (Material You)" accent and missing "Reduce transparency" row.
- **Chrome.**

  | | iOS | Android |
  |---|---|---|
  | Top-level screen | 52 pt row: glass sidebar-toggle circle `gbtn` 44 (+ trailing glass circles or a `gcap` capsule), then a 32/600 large title below the bar (`i-lt`) | 64 dp `atop`: `aib` 48 sidebar toggle, 22/600 title in the bar (`a-tl`), max 2 icons + overflow |
  | Detail screen | glass back circle, 12 px `--fg-3` breadcrumb over a 16/600 centred title; trailing actions in one glass capsule | back arrow `aib`, 12 px breadcrumb over an 18/600 left-aligned title; trailing icon buttons |
  | Modal form | glass ✕ circle, centred 17/600 title, ink "Create/Import/Continue" capsule `mbtn-p` 44 | ✕ `aib`, 22/600 title, ink `abtn-p` 40 |
- **Lists.**
  - iOS uses inset grouped cards (`igroup`: `--raised`, r22, `irow` dividers `--line-soft`). Group headers are 15/600 `--fg` in sentence case, not the iOS-native 13 pt `--fg-3`. Footers are 13 px `--fg-3`, inset 16.
  - Android uses flat full-bleed lists (`arow`, 16 dp gutters). Inset dividers start at 56 dp (`box-shadow: inset 56px -1px 0 -55px`). Section headers are 14/600 `--fg-2`, and full-bleed dividers separate sections on detail screens.
- **Row heights.**
  - Measured iOS min-heights are 44 (Settings root), 48, 56, 62 (two-line agent rows) and 72.
  - Measured Android heights are 52 (Settings root), 56, 64, 68 and 72.
  - Settings root rows (iOS 44, Android 52) and some iOS 48 rows fall below MFoundations' own targets (iOS rows ≥ 52; Android items 64/72).
- **Controls.**
  - Switch: iOS 51×31, r16, thumb 27 on `--on-accent`. Android 52×32, r16, thumb 24 with a ✓ glyph when on and an outlined track when off.
  - Segmented choice: on iOS a 32 track, r9, `--selected`, with segments r7 and the selected one `--overlay` plus a `--line-strong` ring. On Android a connected button group: 40 dp buttons, 2 dp gaps, outer radii `20px 8px 8px 20px` / `8px 20px 20px 8px`, the selected one fully rounded r20 on `--selected` with a ✓.
  - Stepper: iOS −|+ in a 92×32 r9 `--selected` pill. Android uses two separate 40 dp outlined circular icon buttons with the value between them.
  - Text field: iOS uses label-over-value rows inside a group. Android uses an M3 outlined field (56 dp, r8, floating label, 2 dp `--fg` border when focused).
  - Select: iOS shows a value with ⇅ (pop-up button/menu). Android uses an exposed dropdown (outlined field + chevron).
- **Overlays.**
  - Context menu: iOS 250 wide, r14, with a lifted preview of the row; groups are separated by thick separators. Android M3 menu: 232 wide, r12, dividers between groups.
  - Destructive alert: iOS `alertdialog` 314 wide, r34, centred title, two 48-tall capsule buttons on `--selected` with the destructive one in `--err` text. Android: 336 wide, r28, a centred trash icon, 22/600 title, and right-aligned text buttons.
  - Sheets: iOS `sheet-i` inset 8, r38, grabber 36×5, with a glass ✕. Android `sheet-a` is edge-attached, r28 top, with a 32×4 handle and a plain ✕.
- **New/primary floating action.** iOS uses a glass capsule 52 tall, r26, bottom-right. Android uses an extended FAB `afab`: 56 dp, r16, on `--accent`.
- **The designs draw no loading, error, offline or empty states** in these 42 boards, except for inline "Fetching", "Needs setup" and "Not signed in" row states. §D lists them as missing.
- **ARIA in the source is uneven.** Segmented choices use `role="tablist"/"tab"` even when they pick a value (Appearance uses `radiogroup`). Most switches have no `role="switch"`: only Customization, MCP, Skills, SkillDetail, Settings root and Appearance declare it. Implementation must use native switches and radio semantics.

### 0.2 API status legend

**exists** = route and type present · **partial** = some fields/route missing or client-local only · **missing** = no server source. Gap ids refer to `05-gap-matrix.md`.

### 0.3 Scope reality check (affects most settings boards)

Settings writes are admin-scoped in `packages/auth/src/routePolicy.ts`:
- `/system/*`, `/extensions` and `/security` writes need `admin:settings`; this covers MCP setup and secrets, audio, retention and computer use;
- `/harness` writes (provider login, default) need `admin:harnesses`;
- `/auth/pair` needs `admin:devices`;
- `/auth/devices` and `/auth/scope-requests` need `admin:devices` **even to read**, so a phone cannot list paired devices, list access requests or read its own scope count through these routes. Only `/auth/devices/me/scope-requests` is self-service.
- `/source-control` writes need only `write:projects`, which is in the standalone preset.

`DEFAULT_MOBILE_SCOPES` holds 12 scopes and `STANDALONE_MOBILE_SCOPES` 18. Neither holds any `admin:*` scope, and the auth comments say admin scopes are "never selected at pairing time". **The boards draw every settings control as editable and never draw a read-only or "needs permission" state.** See D-1.

---

## 1. Projects (canvas page `projects`)

### MProjects — "Projects · list with long-press menu"

1. **Purpose and presentation.** Top-level module list; the state shown is a long-press menu open on the first row. Content:
   - search;
   - Active 4 / Archived 1 filter;
   - 4 project rows: folder icon, name, time, description, "2 codebases · 3 chats · 1 needs you", and the last-run status badge + run name + #n;
   - footer "Sorted by last update. Archived projects keep their codebases and worktrees until deleted.";
   - New project.
2. **Chrome.**
   - iOS: glass sidebar toggle + a glass "Sort: last updated" circle, large title "Projects 4", a search bar, and a 32 segmented control. Rows sit in one `igroup`.
   - Android: top app bar with toggle, "Projects 4" and a sort icon (no overflow). A pill search field, a connected button group with ✓, and a flat list with 56-inset dividers.
3. **Components.** Header (top-level), search field, segmented control / connected group, list row with `bdg s-*` status badge, context menu, floating New. New: **ProjectRow** (see §B).
4. **iOS vs Android.**
   - Menu: iOS context menu with a lifted row preview (shadow `0 14px 40px`, r22) and 3 groups separated by thick bars. Android M3 menu, 232 wide, r12, anchored under the row; the pressed row is highlighted with `--selected`.
   - New: glass capsule vs extended FAB.
5. **Native.** Long-press haptic (`impact medium` / `LONG_PRESS`). Clipboard for "Copy root path". The iOS context-menu preview API.
6. **States.** Long-press menu (Open, New chat, Run workflow…, Add codebase… | Copy root path, Settings | Archive, Delete…). Every menu item has a visible equivalent: the detail header or the Settings tab. There are no swipe actions on this list. Missing: empty ("No projects yet"), no search results, loading, Archived tab contents.
7. **Data.**
   - project list: `GET /projects` — **exists**;
   - archived: `ProjectStatus 'active'|'archived'` — **exists**;
   - codebases / chats counts, last run, needs-you count: G-13 + G-01 — **built**;
   - sort: client-side;
   - archive: `PUT /projects/:id {status}` — **exists**; delete — **exists**.
8. **Issues.**
   - Desktop's list/grid view toggle and table columns (Worktrees, Last run) are not on mobile. That is acceptable as a layout difference.
   - "Delete…" needs the MProjectSettings confirmation. It is not shown from this menu, so assume it opens the same alert.
   - "Run workflow…" opens the legacy picker until PW.

### MProjectCreate — "Projects · new project"

1. **Purpose and presentation.** A full-screen modal form. Fields:
   - Name, Description;
   - Worktrees: retention (Immediate / 24 h / 72 h / Manual) with the helper "Completed worktrees are removed 72 h after…", and a Max codebases stepper;
   - Repositories · 2: rows showing name, URL (mono), "Git remote · branch main" and a ✕ remove button;
   - add chips: + Git remote, + Local git, + Local folder;
   - the footer about background clone.
2. **Chrome.** iOS: ✕ circle, centred "New project", and an ink "Create" capsule. Fields sit in `igroup` rows. Android: ✕, "New project" 22/600, and an ink "Create" pill. Name and Description are M3 outlined fields; Name is focused with a floating label.
3. **Components.** Text field, textarea, segmented control, stepper, chip (`mchip` r16 / `achip` r8), list row with remove. New: **RepositoryDraftRow**.
4. **iOS vs Android.**
   - Segmented: iOS 32 segmented control vs a 40 dp connected group with ✓.
   - Stepper: joined −|+ pill vs two circular 40 dp buttons.
   - Chips: capsule vs r8.
   - Fields: grouped rows vs outlined fields.
5. **Native.** Keyboard (the Name field is focused), with IME action "Next". No OS pickers: "Local git" and "Local folder" refer to **server** paths, so no device document picker applies. Note this in the design.
6. **States.** Filled form only. Missing: validation (empty name, duplicate name, max-codebases exceeded), what the add chips open, the dirty-cancel confirmation (MPrinciples: "a dirty sheet asks first"), the submitting state, and clone errors.
7. **Data.**
   - `POST /projects` + `POST /projects/:id/codebases` — **exists**;
   - `ProjectSettings.worktreeRetention ('immediate'|'hours-24'|'hours-72'|'manual')`, `maxCodebases` — **exists**;
   - `defaultModel`, `defaultSessionMode`, `autoFetchInterval` and `harnessConfig` exist in `ProjectSettings` but are **not designed**.
8. **Issues.**
   - D-32 names this board as the content reference for desktop CreateProjectPage. Fine.
   - The chips for Local git / Local folder imply a server-side path browser (`routes/fs.ts` exists), but none is drawn.
   - Presentation: MPrinciples does not list New project in the IA diagram. Treat it as a full-screen modal (Cancel + Create in the header, no swipe-dismiss).

### MProjectDetail — "Project · codebases"

1. **Purpose and presentation.** A pushed detail screen with a menu open on the 2nd codebase. Content:
   - description;
   - root path (mono, folder icon);
   - "created Aug 4 · retention 72 h · max 5 codebases";
   - an amber "2 need you" banner (Nightly dependency audit #248 · Fix flaky checkout test) with Review;
   - tabs Codebases 2 · Chats 6 · Runs 14 · Customization · Settings;
   - + Add codebase;
   - codebase rows: alias + status badge (Ready / Fetching), `url · branch`, "fetched 4m ago · 3 worktrees · 2 orphaned" (orphaned in `--warn`) or "Receiving objects 38% · no worktrees" with a 2 px progress bar;
   - footer.
2. **Chrome.** iOS: back circle, breadcrumb "Projects" over "payments-service", and a glass `gcap` holding New chat in project / Run workflow / More. Android: back, breadcrumb and title left, then New chat and Run workflow icons + overflow.
3. **Components.**
   - Detail header; Needs-you banner (the Home attention banner pattern); row menu (per-row `…` / ⋮ button: "Codebase actions");
   - project tabs reuse the **pane tab** styles: iOS `ptab-i` 32 pills, Android `ptab-a` 48 underline, horizontally scrolling with an 88% fade mask;
   - New: **CodebaseRow** with an inline progress bar.
4. **iOS vs Android.** Pill tabs vs underline tabs. Menu: iOS context menu from the `…` button (r14, 250) vs an M3 menu. iOS rows are grouped in a card; Android rows are flat.
5. **Native.** Clipboard ("Copy path"). Haptics on menu open.
6. **States.** Ready and Fetching (live progress) codebase rows; menu open (Fetch, Logs, Worktrees, Copy path | Remove codebase…). Missing:
   - clone error / stale status (the server has `error`, `stale`);
   - the Remove codebase confirmation;
   - empty project (0 codebases);
   - Chats and Runs tab contents (not drawn in this group).
7. **Data.**
   - project + codebases — **exists**;
   - tab counts (G-13) and banner (G-01) — **built**;
   - codebase status: server `CodebaseStatus = pending|cloning|ready|error|stale`, so the board's "Fetching" + % progress needs **G-16 — missing**;
   - "3 worktrees · 2 orphaned": `GET …/worktrees` — **exists** (counted on the client);
   - fetch `POST …/fetch` — **exists**; remove codebase `DELETE` — **exists**.
8. **Issues.**
   - **The desktop has a "Pull requests" tab** (D-31, screen-map R-3: Codebases · Chats · Runs · Pull requests · Customization · Settings). The mobile tabs omit it, although current mobile code has PR screens. This is a feature-set gap against the owner rule.
   - The breadcrumb shows only "Projects", which is correct.
   - The iOS header uses 3 glass actions (the maximum).

### MAddCodebase — "Project · add codebase"

1. **Purpose and presentation.** A sheet over MProjectDetail with a scrim. Content:
   - the intro copy;
   - Source: Git remote / Local git / Local folder, with the helper "Cloned into the project root; Fetch keeps it current.";
   - Alias, Repository URL (mono, focused), Default branch (select, "main"), Subdirectory (optional);
   - an info callout "Cloning runs in the background; progress shows in the codebase's Logs.";
   - a full-width ink "Add codebase" button.
2. **Chrome.** iOS: inset sheet r38 with a grabber, glass ✕ at left and a centred title. Android: edge sheet r28 with a handle, a left 22/600 title and a ✕ at right.
3. **Components.** Sheet, segmented control, text fields, select, callout (info tint), primary button.
4. **iOS vs Android.**
   - iOS puts fields inside one `igroup` and Default branch uses ⇅.
   - Android uses outlined fields, with Default branch (exposed dropdown) and Subdirectory side by side in 2 columns.
   - Close: ✕ left on iOS, right on Android.
5. **Native.** Keyboard type URL for Repository URL (no autocorrect/autocapitalise), sheet detent (large). The branch list is not local.
6. **States.** Only the Git remote variant is drawn. Missing: the Local git / Local folder variants (server path input or browser), branch loading, invalid URL, auth-required remote, max-codebases reached, and dirty-dismiss.
7. **Data.**
   - `POST /projects/:id/codebases {alias,url|localPath,branch,subdirectory}` — **exists** (`subdirectory` and `alias` are in the type).
   - Default-branch **options before cloning** need remote ref listing (`ls-remote`). `GET …/branches` exists only for an existing codebase — **partial**.
8. **Issues.**
   - The primary action sits in the sheet footer. MProjectCreate puts it in the header. Pick one rule for forms in sheets.
   - "Add codebase" filled ink conflicts with MPrinciples 6 ("Send, Approve or Run is the only filled control"); the same applies to Create, Import, Save, Continue and Edit (see D-4).

### MProjectSettings — "Project · settings and delete"

1. **Purpose and presentation.** The Settings tab of the project detail, with the destructive confirmation open. Content:
   - Worktrees: Retention (select, "Keep for 72 hours") and Max codebases (stepper), plus a footer;
   - Location: Root path (with copy) and Created "Aug 4, 2026, 09:12";
   - a "Save settings" button;
   - Project: "Archive project — Moves it to Archived; codebases and worktrees stay" and "Delete project… — Removes codebases, configs and worktrees" (in `--err`).
   - The alert reads: "Delete payments-service? This permanently deletes the project and all its codebases, configs and worktrees. It can't be undone." It carries an impact box ("2 codebases · 6 worktrees · 1.27 GB", "2 items in this project need you" in `--warn`) and Cancel / Delete project buttons.
2. **Chrome.** As MProjectDetail, scrolled so the tab row is at the top (Settings selected).
3. **Components.** Select row, stepper, info rows with a copy action, button, destructive list rows, **destructive confirmation with an impact summary** (new variant: an `ImpactSummary` box on `--sunken`, r14/r12).
4. **iOS vs Android.**
   - Retention is a select on both, but the retention control differs between screens: segmented in MProjectCreate, select here.
   - Alert: iOS r34 with capsule buttons vs M3 r28 with an icon and text buttons (see §0.1).
5. **Native.** Clipboard. The native alert (iOS `UIAlertController` cannot hold the impact box, so it is JS-drawn or a custom sheet); on Android the M3 `AlertDialog` also needs a custom view.
6. **States.** Destructive confirmation. Missing: an Archive confirmation (probably none needed, but give an Undo toast), a saving state, unsaved-changes state, and an archived-project variant (Unarchive).
7. **Data.**
   - settings — **exists**; delete — **exists**; archive (status) — **exists**;
   - impact counts: codebases and worktrees — **exists**; "1.27 GB" — **G-17 missing**; needs-you count — G-01 **built**.
8. **Issues.**
   - An explicit "Save settings" button inside a settings tab contradicts the other settings boards, which save immediately; MSetSourceControl uses a header Save. Pick one rule per form type (D-6).
   - `defaultModel`, `autoFetchInterval` and the other project settings are not shown.

### MCodebase — "Codebase · worktrees and clean-up"

1. **Purpose and presentation.** A pushed codebase detail (breadcrumb "Projects › payments-service") with a destructive confirmation sheet open. Content:
   - a meta card: Git remote + Ready badge, URL with copy, Default branch "main" ⇅ ("Change default branch"), Last fetched "4m ago 14:04", and Fetch;
   - Worktrees 6 / Files segment;
   - filter chips: All 6 / Active 3 / Orphaned 2 / Completed 1;
   - "1.27 GB on disk" and a "Clean up orphans 2" button;
   - worktree rows: branch (mono), status badge, a linked chat/run with a glyph and needs-you/running badge, and "13:41 · 214 MB" or "Sep 22 · 231 MB · removes in 26 h", each with a `…` menu.
   - The sheet: "Remove 2 orphaned worktrees? They have no live chat or run. Their folders are deleted; uncommitted changes in them are lost.", a list of each branch with its size, and Cancel / "Remove · frees 385 MB".
2. **Chrome.** iOS: back, breadcrumb, and a capsule with Logs + More. Android: back, then Logs + ⋮.
3. **Components.** Meta card (new: **CodebaseMetaCard**), segmented, filter chips, **WorktreeRow**, **destructive confirmation sheet** (a bottom sheet instead of an alert: icon in an `--err` tinted circle, list, and a filled red confirm button).
4. **iOS vs Android.** The segment is iOS segmented vs a connected group; chips are capsule vs r8. The confirmation sheet is the same content: iOS inset r38 with 44 capsule buttons, Android edge r28 with 40 pills.
5. **Native.** Clipboard. Haptic `warning`/`REJECT` on destructive confirmation is optional.
6. **States.** A mix of Active, Orphaned and Completed worktrees; destructive confirm. Missing: empty per filter, removal in progress, partial failure (a folder is locked), and the worktree row menu contents.
7. **Data.**
   - worktrees list, cleanup (`POST …/worktrees/cleanup`), single delete — **exists**;
   - `WorktreeInfo` has `runId`/`runType` only, so there is no chat link, size, "removes in 26 h" or reclaimable total — **G-17 missing**;
   - branches + change default branch (`PUT codebase`) — **exists**.
8. **Issues.**
   - **The status map is misused.** Worktree "Active" uses `s-run` (Running blue) and "Orphaned" uses `s-warn` (Needs-you amber). "Active" and "Orphaned" are not states in the 7-state map, and MFoundations says colour means status only. Use neutral badges (`s-idle`) and keep amber for "Needs you".
   - **The filled `--err` confirm button** ("Remove · frees 385 MB") is the only filled destructive control in the set. MComponents draws destructive buttons as outlined with `--err` text, and the alerts in MProjectSettings, MAgentDelete and MSetStorage use a `--selected` fill with `--err` text. Pick one (D-4).
   - The confirmation is a sheet here and an alert elsewhere, for the same class of action (see §A.6).

### MCodebaseFiles — "Codebase · files and preview"

1. **Purpose and presentation.** The same screen as MCodebase on the Files segment. It shows a file tree (disclosure chevrons, folder / file icons, mono names, sizes), a selected row on `--selected`, and a **file preview sheet** at a medium detent. The sheet has a header (file icon, "coupon.ts", "src/checkout · 2.4 KB", Copy contents, Open full screen, Close preview) and a code block with line numbers (JetBrains Mono, syntax-coloured string).
2. **Chrome.** As MCodebase.
3. **Components.** Tree row (shared with the pane Files tab), sheet at a medium detent, code viewer (read-only). New: none. Reuse the pane file preview (MPaneFilePreview) components.
4. **iOS vs Android.** Tree rows are identical; iOS sits in a card, Android is full-bleed. Sheet: inset r38 + glass circle buttons vs edge r28 + plain icons.
5. **Native.** Clipboard ("Copy contents"). Horizontal scroll or wrap in the code block (not specified). Pinch to zoom is not specified.
6. **States.** Tree expanded with a preview open. Missing: binary/large-file preview, a loading tree, an empty repository, a rendered Markdown vs source toggle (desktop has "rendered/source preview", parity item 51), and the Open full screen state.
7. **Data.** `GET …/files`, `…/files/content` — **exists**.
8. **Issues.** Desktop's rendered/source toggle for Markdown is missing. Sheet vs full-screen escalation is fine.

### MCodebaseLogs — "Codebase · fetch logs"

1. **Purpose and presentation.** A sheet over MProjectDetail. Content:
   - header "Logs" / "checkout-web · fetch", with Copy logs and Close;
   - status line: `Fetching` badge (s-run), "started 14:06:02 · 0:12", 38%, a progress bar (`--run`), and "Receiving objects · 694 / 1824 · branch main";
   - a terminal-style log on `--sunken`: timestamp column, `$ git fetch --prune origin`, remote lines, the current line in `--run`, and a caret;
   - footer "The fetch keeps running if you close this sheet. Failures also show here with the full git output."
2. **Chrome.** Sheet at a large detent.
3. **Components.** Sheet, status badge, progress bar, new **LogViewer** (timestamped mono lines, live tail, copy).
4. **iOS vs Android.** Only the sheet shape differs.
5. **Native.** Clipboard. The screen stays awake optionally (not specified).
6. **States.** Running. Missing: failed (with "full git output" and Retry), completed, and no logs yet.
7. **Data.** Live fetch/clone logs and progress: **G-16 — missing**.
8. **Issues.** It opens from the codebase menu "Logs" on the project screen, and also from the Logs icon in the MCodebase header. Both are fine. The live-updating log needs SSE, not polling.

### MProjectCustomization — "Project · customization"

1. **Purpose and presentation.** The project Customization tab. Content:
   - a sub-segment: Skills 8 / Prompts 2 / Agents 1 / MCP 4;
   - "5 of 8 enabled" + a Filter skills field;
   - skill rows: mono name, a scope badge ("Project" with a folder glyph, or "System" with a shield glyph), a one-line description, an enable switch, and a `…` actions button;
   - a floating "Upload skill" action in the New slot.
2. **Chrome.** As the project detail, with the tab row scrolled so Customization is selected.
3. **Components.** Segmented, search field, **SkillRow** (toggle row with scope badge + actions), floating action.
4. **iOS vs Android.** Segmented vs a connected group with ✓. Switches follow platform style (the Android thumb shows ✓). iOS rows in a card, Android flat.
5. **Native.** **Document picker** for "Upload skill" (`UIDocumentPickerViewController` / SAF `ACTION_OPEN_DOCUMENT`, accepting `.md` / a folder / `.zip` — undecided).
6. **States.** Mixed enabled/disabled. Missing: the Prompts, Agents and MCP sub-tabs, the per-row `…` menu, empty, upload progress/error, and the MCP add form. The desktop screen map moves "Add server" into this tab.
7. **Data.**
   - project configs (`/projects/:id/configs`, `/mcp-servers`, `/available-artifacts`) — **exists**;
   - **per-project enable/disable — G-19 missing**. The desktop store is device-local today (`projectCatalogPrefsStore`).
8. **Issues.**
   - System skills are listed per project with a switch, so enabling means "offered in this project". MSetSkills also has a global switch; the combined semantics (global off beats project on?) are undefined.
   - The floating New slot holds "Upload skill" and changes by sub-tab. Define the label per sub-tab.

### MSkillDetail — "Project · skill detail"

1. **Purpose and presentation.** A pushed detail with the breadcrumb "Projects › payments-service › Customization". Content:
   - title `checkout-e2e` (mono);
   - meta: Project badge, "Skill", "3 files · 2.1 KB · Sep 20", path `.generatorai/skills/checkout-e2e/SKILL.md`;
   - an "Enabled in this project" switch row;
   - file chips SKILL.md / run-e2e.sh / fixtures.md;
   - a rendered Markdown card with headings, a code block and a bullet list with inline code;
   - a bottom action bar: Delete (`--err`), View JSON, Edit (ink).
2. **Chrome.**
   - iOS: back and a 3-level breadcrumb; the title is mono 16/600. The action bar has 3 capsules.
   - Android: back, breadcrumb and title. The action bar is a bottom app bar with a top divider: a Delete text button on the left, View JSON outlined and Edit filled.
3. **Components.** Switch row, file chips (`mchip`/`achip`), Markdown renderer, bottom action bar. New: **FileChips**, **MarkdownCard**.
4. **iOS vs Android.** The action bar is a floating row of 3 capsules vs an M3 bottom app bar with a divider. Chips are capsule vs r8.
5. **Native.** None beyond an editor keyboard (Edit is not drawn).
6. **States.** The read view. Missing: the Edit screen (a multi-file editor on a phone?), the Delete confirmation, the non-SKILL.md file views, and the System-skill variant (read-only: no Delete/Edit).
7. **Data.**
   - project config get/put/delete — **exists**;
   - `ProjectConfig` has a single `filePath` + `metadata`, so a multi-file skill listing ("3 files · 2.1 KB") is **partial**. `available-artifacts` may cover it; verify.
8. **Issues.**
   - "Customization" is a tab, not a screen, yet it appears as a breadcrumb segment. That is acceptable only if tapping it deep-links to the tab (screen-map R-3 makes tabs path segments).
   - "View JSON" on a Markdown skill is a desktop carry-over; "View source" is clearer.
   - Edit filled ink (D-4).

---

## 2. Agents (canvas page `agents`)

### MAgents — "Agents · list, long-press menu"

1. **Purpose and presentation.** Top-level list. Content:
   - search;
   - scope filter All 6 / Built-in 2 / Global 3 / Project 1;
   - a "Role: Any ▾" chip, a "⇅ Name" sort and "6 agents";
   - rows: a 44 bot-icon tile (`--raised`), name + role badge (Worker / Orchestrator with a people glyph) + "Disabled", model `claude-sonnet-5 · medium` (mono), and scope line "🌐 Global · 2 skills · 1 MCP" / "🔒 Built-in · read-only …" / "📁 payments-service · 2 skills", with a chevron on iOS only;
   - New agent.
2. **Chrome.** iOS: toggle + a capsule with Sort and More ("More: Import .agent.md"), and a large title. Android: toggle, title, sort + ⋮.
3. **Components.** Header, search, segmented/connected group, chip with ▾ (menu), sort button, **AgentRow**, context menu, floating New.
4. **iOS vs Android.** The iOS background is blurred behind the context menu (preview + blur); Android uses a plain M3 menu with a row highlight. Otherwise §0.1.
5. **Native.** Long-press haptic. Share sheet for "Export .agent.md" (`UIActivityViewController` / `ACTION_SEND` with a file URI). Document picker for Import.
6. **States.** The menu is open (Edit, Duplicate, Export .agent.md | Delete). A disabled row is dimmed. Missing: empty, no results, and the built-in menu variant (no Edit/Delete; "Duplicate to change").
7. **Data.** `GET /agents` (scope, role, enabled, tags, version, model/effort in policy) — **exists**; import/export — **exists**.
8. **Issues.**
   - The menu offers "Edit" on built-in agents, which are read-only. The variant needs defining.
   - The iOS chevron vs no chevron on Android is correct native behaviour.

### MAgentDetail — "Agents · Bug Fixer detail"

1. **Purpose and presentation.** Pushed detail. Content:
   - identity: 56 bot tile, name 24/600, and badges Worker · 🌐 Global · v4 · `debugging` tag;
   - description;
   - actions: Start chat (ink, wide), Edit, Export (icon) and Delete (icon, `--err`);
   - "Effective capabilities · 2 skills · 1 MCP · ✓ No warnings";
   - a capability card: "Claude Code · Claude Sonnet 5", "effort medium · context 200K · 40 turns", a 2-column ✓/✕ grid of 8 capabilities, and skill/MCP chips;
   - "Used by · 2 workflows · 5 chats · See all 7", with rows (workflow glyph + name + stage; chat glyph + name + status badge).
2. **Chrome.** iOS: back ("Back to Agents"), breadcrumb "Agents" over "Bug Fixer", and a capsule with Duplicate + More. Android: back, then Duplicate + ⋮.
3. **Components.** Detail header, button row, new **CapabilitySummaryCard** (runtime line + capability grid + chips), **UsedByList**, status badges.
4. **iOS vs Android.** Button shapes (44 capsules vs 40 pills). Both platforms put the capability card on `--raised` r22/r16; **Android uses a card here although other Android screens are flat**. Used-by rows: iOS has chevrons, Android has none.
5. **Native.** Share sheet (export).
6. **States.** Normal. Missing: built-in (read-only: Edit hidden, Duplicate primary), disabled agent, warnings present (the "No warnings" variant only), and See all.
7. **Data.**
   - agent — **exists**; `GET /agents/:id/usage` — **exists**;
   - effective capabilities and warnings via `POST /agents/resolve-preview` — **exists**;
   - live status of the using chats (Needs you / Running) needs a join with G-01/G-02 — **partial** (client join).
8. **Issues.**
   - Desktop has no agent detail page; the editor has a "Used by" aside. The mobile read-only detail is a drill-down, not a new destination. Acceptable, but it must be listed as a mobile-only screen composition.
   - "Start chat" is filled ink (D-4).
   - Duplicate appears both in the header and in the MAgents menu. Fine.

### MAgentDetailOrch — "Agents · Orchestrator detail (team)"

1. **Purpose and presentation.** As MAgentDetail for an Orchestrator (v6, planning). The capability card is replaced by:
   - "Team · 3 agents · up to 3 at once": member rows (name, "Worker · model"), then "Max concurrent workers 3" and "Default worker model Claude Sonnet 5";
   - "Orchestration capability": a locked, on, dimmed switch ("Always on — it cannot delegate without it");
   - Used by (1 workflow · 1 chat, with a running badge "4:12").
2. **Chrome.** Same as MAgentDetail.
3. **Components.** Team member rows (new **TeamList**; a text list, not a graph), locked switch row.
4. **iOS vs Android.** Locked switch: iOS dimmed `--fg-3`; Android dimmed with a ✓ thumb.
5. **Native.** None.
6. **States.** Normal. Missing: "Any enabled agent" (empty team, which is the server default), and a team member that is disabled.
7. **Data.** `teamAgentRefs`, `maxWorkers`, `defaultWorkerModel` — **exists**. The "4:12" running timer comes from the chat state (G-02).
8. **Issues.**
   - A disabled switch as information is an a11y concern: announce it as "Orchestration, on, locked". A read-only row with a lock glyph is clearer.
   - The prompt suggested a "TeamGraph", but no graph is drawn: the team is a list.

### MAgentNew — "Agents · new agent — start from"

1. **Purpose and presentation.** A sheet (large detent) over MAgents. Content:
   - header: ✕, "New agent", and an ink Continue;
   - "Start from": Blank agent ("Write instructions, pick capabilities") as a radio row;
   - "Duplicate a built-in · built-ins are read-only": Code Reviewer (selected) and Security Auditor, each with model · effort · counts;
   - "Duplicate one of your agents… 4 ›" (pushes a picker);
   - Scope: Global / Project segment, with a project select "payments-service ⇅";
   - helper "Only available in payments-service. A project agent shadows a Global one with the same slug.";
   - a summary callout "Opens the editor as 'Code Reviewer copy', slug `code-reviewer-copy`".
2. **Chrome.** Sheet with a header action (Continue) rather than a footer button.
3. **Components.** Sheet, **radio rows** (iOS: a filled check circle; Android: M3 radio), navigation row, segmented, select, callout.
4. **iOS vs Android.** The selection indicator is a check-in-circle vs an M3 radio. The segment is iOS segmented vs a connected group with ✓.
5. **Native.** None.
6. **States.** Built-in selected. Missing: the Blank path, the "your agents" picker, and a slug collision.
7. **Data.** Create — **exists**; duplicate = GET + POST on the client; slug derivation on the client; project list — **exists**.
8. **Issues.**
   - A multi-step flow (sheet → full-screen editor). MPrinciples marks the Agent editor a full-screen modal, but MAgentEdit uses a back chevron (see below).
   - Radio rows use a check icon on iOS (native: a checkmark on the trailing side). The drawn iOS indicator is a filled circle with ✓, which is not a stock control.

### MAgentImport — "Agents · import .agent.md"

1. **Purpose and presentation.**
   - iOS: a page sheet (top 56, large detent). Android: a full-screen dialog.
   - Content:
     - a file card ("release-scribe.agent.md · 2.9 KB · Downloads · max 256 KB", Change);
     - "Parsed from the file": a key-value table of Name, Role badge, Model (mono), Instructions "2.4 KB · Add to default", Skills · MCP;
     - an instructions excerpt (mono, `--sunken`);
     - a warning callout "MCP server `jira` isn't in the registry — it will be skipped.";
     - "Import to": Global / Project;
     - a switch row with a warn icon: "Replace existing Release Scribe — `global:release-scribe` v3 becomes v4. Chats and stages bound to it keep their snapshot.";
     - footer "Export shares a credential-free .agent.md via the share sheet."
2. **Chrome.** ✕, "Import agent" and an ink Import on both.
3. **Components.** File card, **KeyValueTable** (new), callout (warn), segmented, switch row.
4. **iOS vs Android.** Page sheet vs full-screen dialog (both are native idioms for "long task with confirm").
5. **Native.** **Document picker** (UTType for `.md`; Android SAF with `text/markdown`); file size check before upload; share sheet for export.
6. **States.** Parsed with one warning and replace on. Missing: parse error, file too large (> 256 KB), no conflict (the switch is hidden), and importing.
7. **Data.**
   - `POST /agents/import {markdown, scope, projectId, overwrite}` — **exists**.
   - A **dry-run parse preview is missing**. The parser lives in `packages/core/src/services/agentMarkdown.ts` (server only), so the phone cannot show "Parsed from the file" or the registry warning without a preview endpoint, or without moving the parser to `packages/shared`.
8. **Issues.** "Downloads" is a device folder name. On Android SAF it is not always available (display name only). Fine.

### MAgentEdit1 — "Agents · editor — identity, instructions, role"

1. **Purpose and presentation.** The agent editor (one long scrolling form; the three MAgentEdit boards are three scroll positions of the same screen, not steps). Content:
   - an unsaved-changes bar: amber dot "3 unsaved changes" + Discard, on a warn-tinted bar;
   - Identity: Name + slug hint (mono), Description, Scope (select ⇅), Tags (chip input: "debugging ✕", "Add tag…"), and an Enabled switch ("Off hides it from pickers");
   - Instructions ("● edited · added to every turn"): a mono textarea and a size meter "3.2 KB / 32 KB · warns above 8 KB";
   - Built-in prompt: "Add to default" / "Replace default" ("Add is recommended");
   - Role: Worker / Orchestrator ("Orchestrators plan and delegate to a team of workers").
2. **Chrome.** iOS: a back circle ("Back to Bug Fixer"), breadcrumb "Agents › Bug Fixer" over "Edit agent", and an ink Save capsule. Android: back, breadcrumb/title, and a Save pill.
3. **Components.** **DirtyBar** (new), text fields, select, **TagInput**, switch row, **InstructionsEditor** (mono textarea with a size meter), segmented. New: **SizeMeter**.
4. **iOS vs Android.** Fields are grouped rows vs M3 fields inside a card (**Android uses `--raised` r16 cards here**, not flat). Segmented vs a connected group.
5. **Native.** Keyboard (multiline, monospaced). Keep the Save button visible above the keyboard (not specified).
6. **States.** Dirty. Missing: validation (duplicate slug, empty name), size > 8 KB warning, > 32 KB error, save error, the Discard confirmation, and the built-in read-only variant.
7. **Data.** `PUT /agents/:id` — **exists** (name, description, scope, tags, enabled, instructions + mode, role).
8. **Issues.**
   - **Presentation conflict.** MPrinciples lists "Agent editor" as a *full-screen modal* ("Cancel and Save in the header; no swipe to dismiss"), but the board draws a pushed screen with a back chevron and a separate Discard.
   - Back with 3 unsaved changes must confirm. The same pattern is used in MSetMcpAdd and MSetSourceControl.
   - Desktop AgentEditor has a StickyFooter for unsaved changes; on mobile it becomes a top DirtyBar. Consistent in content.

### MAgentEdit2 — "Agents · editor — runtime, team"

1. **Purpose and presentation.** The same editor scrolled. Content:
   - Runtime ("Inherit takes the value from the chat, stage or server default."): Provider (select, "Claude Code"), Model ("Claude Sonnet 5 `claude-sonnet-5` ›" pushes a picker), Reasoning effort ("● was Medium": Inherit / Low / Medium / High / Extra high), Context tier (Inherit / Default 200K / Long context), and Max turns (stepper 40, "Claude enforces it; Copilot ignores it");
   - Team ("orchestrators only"): an info row "Bug Fixer is a Worker. Set Role to Orchestrator to choose its team. Change role ↗", then dimmed rows: Team members "Any enabled agent", Max concurrent workers "Server default" and Default worker model "Inherit".
2. **Chrome.** As MAgentEdit1.
3. **Components.** Select, navigation row → model picker (reuse MModelPicker), 5-way segmented, 3-way segmented, stepper, disabled rows, inline "changed" marker (amber dot + "was X").
4. **iOS vs Android.** A **5-segment control** on iOS (tight at 342 pt) vs a 5-button connected group on Android (≈ 66 dp each, "Extra high" truncation risk at larger font scales).
5. **Native.** None.
6. **States.** One changed field, and the Team section disabled for a Worker. Missing: Orchestrator enabled Team (member multi-select), a provider without effort support, and model unavailable.
7. **Data.** `contextTier`, `maxTurns`, effort, provider/model, `teamAgentRefs`, `maxWorkers`, `defaultWorkerModel` — **exists**. Provider list — **exists** (5 provider ids; see MSetProviders).
8. **Issues.**
   - 5 segments do not fit at Dynamic Type XL / font scale 1.3+. Specify a fallback (a menu/select) per MFoundations "rows grow, never clip".
   - "Change role ↗" jumps up the same form. Use an anchor scroll, not an external-link glyph.

### MAgentEdit3 — "Agents · editor — skills, MCP, capabilities"

1. **Purpose and presentation.** The same editor scrolled. Content:
   - Skills ("2 of 5 · staged into the workspace at run time"): toggle chips (mono);
   - MCP servers ("1 of 4 · vetted registry entries only"): toggle chips, with "Web Search (Brave) 🔑 needs key";
   - Capabilities ("On or Off beats the chat or stage"): 8 switch rows, each with a provenance tag ("set here" plain, "inherits On" / "inherits Off" badge, or "● changed" with a ↺ "Reset to inherit" button). Inherited switches render dimmed.
   - An "Effective capabilities — 5 tools · 2 skills · 1 MCP · no warnings ›" row that pushes the resolve preview.
2. **Chrome.** As MAgentEdit1.
3. **Components.** Toggle chips (filter chip "on" = `--selected` + ✓), **TriStateSwitchRow** (new: switch + provenance badge + reset), navigation row.
4. **iOS vs Android.** Chips: capsule r16 vs r8 (M3 filter chip with ✓). Switch styles as §0.1; the Android inherited state keeps the ✓ thumb dimmed.
5. **Native.** None.
6. **States.** Set / inherited / changed. Missing: a chip for an MCP that needs a key being selected (does it block Save?), a warnings present state, and the pushed Effective capabilities screen.
7. **Data.** Skills catalog (`/system/artifacts`), MCP registry (`/system/mcp-servers` with enabled/needs-setup), capability policy tri-state, `resolve-preview` — **exists**.
8. **Issues.**
   - **A tri-state drawn as a 2-state switch** is ambiguous: an inherited switch looks disabled but is tappable. Desktop uses TriStateRow. Consider a 3-segment (Inherit / On / Off) or a menu. Accessibility: the provenance must be in the accessible value.
   - "vetted registry entries only" conflicts with MSetMcp showing a user "Custom" HTTP server. Are custom servers bindable to agents?

### MAgentDelete — "Agents · delete in use (force)"

1. **Purpose and presentation.** An alert over MAgents: "Delete 'Bug Fixer'? Bug Fixer is in use, so it will be disabled instead of erased. Those chats and stages keep a frozen snapshot and keep running; it disappears from pickers and new bindings." It includes an impact box ("2 workflows — Flaky test triage, Nightly…", "5 chats — 1 running, 1 needs you") and Cancel / Delete.
2. **Chrome.** Alert per §0.1 (iOS r34 capsules; Android r28, trash icon, text buttons).
3. **Components.** Destructive confirmation + ImpactSummary (the same variant as MProjectSettings).
4. **iOS vs Android.** As §0.1. The iOS destructive capsule gets an `--err`-tinted background here (vs `--selected` in MProjectSettings): an inconsistency inside iOS.
5. **Native.** Haptic warning.
6. **States.** In-use (soft delete). Missing: not-in-use (hard delete, simpler copy), built-in (not deletable), and failure.
7. **Data.** `DELETE /agents/:id` returns 409 when bound; `?force=1` soft-deletes — **exists**; `/usage` — **exists**.
8. **Issues.**
   - The canvas title says "(force)", but the copy never uses the word. Fine: it maps to `force=1`.
   - The button label "Delete" for an action that disables is misleading. The server calls it soft delete; consider "Disable agent".

---

## 3. Settings (canvas page `settings`)

### MSettings — "Settings · root"

1. **Purpose and presentation.** Top-level settings module, reached from the sidebar footer. Content:
   - a server card: monitor tile, "This computer", `local:3100` · ● Connected, and a Switch button;
   - Search settings;
   - **App**: General (Claude Sonnet 5), Appearance (Instrument), Notifications (Approvals, runs), App lock & privacy (Face ID / Fingerprint), Haptics (inline switch), with the footer "Notifications, App lock and Haptics are set per device.";
   - **Agents & models**: Model providers (1 of 2 connected), Agents (5 of 6), Skills (4 of 5), MCP servers (6 of 9), Templates (5).
2. **Chrome.** iOS: a sidebar toggle circle only, and a large title. Android: top app bar with toggle + "Settings", no actions.
3. **Components.** Server card (new: **ServerCard**, shared with the MServers switcher), search field, **SettingsNavRow** (icon + label + value + chevron on iOS), inline switch row, group footer.
4. **iOS vs Android.**
   - iOS uses grouped cards with chevrons.
   - Android is flat, without chevrons. Its **section headers and footers are indented 56 dp** to align with the label column (`padding: 16px 16px 4px 56px`), whereas every Android detail screen uses 16 dp headers: an inconsistency.
   - Row height iOS 44 / Android 52.
5. **Native.** Haptics toggle (`UIFeedbackGenerator` / `HapticFeedbackConstants` gated by the app setting). Biometry type detection for the "Face ID" / "Fingerprint" value (`LAContext.biometryType` / `BiometricManager`).
6. **States.** Connected. Missing: disconnected / reconnecting server, search results, a scope-limited device (D-1).
7. **Data.**
   - server list/status — client (G-03 **built** for desktop; mobile keeps it client-side);
   - counts: providers (`/harness/providers`), agents (`/agents`), skills (client prefs), MCP (`/system/mcp-servers`), templates (`/templates`) — **exists**;
   - Skills "4 of 5" is device-local (see MSetSkills).
8. **Issues.**
   - Haptics is a mobile-only per-device row. It is platform-native, so allowed.
   - The "Switch" button duplicates the drawer server switcher. Fine.

### MSettingsMore — "Settings · root, scrolled"

1. **Purpose and presentation.** The same root scrolled. Content:
   - **Integrations**: Source control (GitHub), Browser & terminal, Computer use (On), Audio (Automatic), Extensions (4);
   - **System**: Security & devices ("✋ 1 request" in `--warn`), Storage (30 days), Diagnostics (● Healthy), Widgets & Live Activities / Live Updates, with the footer "… apply to this iPhone / phone only.";
   - footer "GeneratorAI 0.0.1-alpha.1 · Connected to This computer · `local:3100`".
2. **Chrome.** As MSettings; iOS keeps the large title (no collapse to an inline title while scrolled). Native iOS would collapse it to a 17 pt inline title.
3. **Components.** As MSettings; value with status glyph (needs-you hand, ok dot).
4. **iOS vs Android.** Naming: Live Activities vs Live Updates. Otherwise as MSettings.
5. **Native.** None.
6. **States.** One access request pending. Missing: an unhealthy diagnostics value.
7. **Data.** Access requests: `GET /auth/scope-requests` — **exists**; retention days — **exists**; health — **exists**; extensions count — **exists**.
8. **Issues.**
   - The root has **15 server sections + 4 per-device rows** (Notifications, App lock & privacy, Haptics, Widgets). Desktop `SETTINGS_NAV` has 15 sections in the same 4 groups, and the per-device rows are the only additions. That is consistent with 04-screen-map §3.1.
   - Current mobile code has `accessibility` and `about` routes without a board. The design folds About into this footer and General; accessibility has no equivalent (Appearance holds text size / motion).
   - The iOS large title does not collapse (see 2).

### MSetGeneral — "Settings · General"

1. **Purpose and presentation.** Pushed section with a **Default model sheet** open. Content:
   - the description "Application-wide preferences for GeneratorAI.";
   - "Default model for new chats": a Model row ("From any connected provider", value, chevron) with the footer "Pre-selects this model when you create a chat. You can still change it per chat.";
   - About GeneratorAI: a paragraph, Version `0.0.1-alpha.1`, Runtime Node.js.
   - The sheet: "Default model", a provider segment (Claude Code / 🔒 GitHub Copilot), "Copilot isn't signed in, so its models are locked.", and model rows grouped as Powerful / Balanced / Fast (name, mono id, context · effort range), with the selected row on `--selected` + ✓.
2. **Chrome.** Detail header "Settings › General".
3. **Components.** Nav row, footer, info rows; sheet (iOS 440 tall / Android 480); provider segmented; **ModelOptionRow** (shared with MModelPicker).
4. **iOS vs Android.** Sheet shape; segmented vs connected group with a lock glyph on the disabled segment.
5. **Native.** Sheet detents (medium).
6. **States.** One locked provider. Missing: no provider connected, loading models.
7. **Data.**
   - models per provider: `/harness/models` — **exists**;
   - **the default chat model is client-local on web** (`lib/appPreferences.ts`, localStorage), so on mobile it would be per-device — **partial**. The board calls it "Application-wide" and does not list it among the per-device settings.
   - Version: `/system/info` (G-12) — **built**. "Runtime Node.js": `/system/info.platform` gives the OS, not the runtime — **partial**.
8. **Issues.**
   - **Only 2 providers are drawn.** The server has 5 harness provider ids (`copilot`, `claude-agent`, `codex`, `opencode`, `acp`) and the web Providers section already handles Codex. A 2-segment provider switcher does not scale: use a provider select or grouped list.
   - Decide whether the default model is per device or server-wide (D-7).

### MSetAppearance — "Settings · Appearance"

1. **Purpose and presentation.** Pushed section. Content:
   - Mode: System / Light / Dark ("System is dark now");
   - Theme: "Instrument + 17", a filter Product 5 / Editor 7 / Low glare 6, a 3-column grid of theme cards (mini UI preview + name + ✓; selected has a 2 px `--fg` ring), and a dashed category-description tile "Product — Interface-first palettes, made for app chrome";
   - caption "Instrument — the default. Colour means status only.";
   - Accent: 7 swatches (Ink, Blue, Violet, Green, Orange, Rose, Teal) + the current name;
   - Android only: "System (Material You) — Accent from your wallpaper. Status colours never change." as a radio row;
   - Text size: iOS "Match iOS text size" switch + a slider A–A "17 pt" (disabled while matching); Android "Follow system font size" switch + an M3 slider "1.0×";
   - Motion: Reduce motion (+ iOS-only Reduce transparency).
2. **Chrome.** Detail header.
3. **Components.** Segmented ×2, new **ThemeCard grid** (live mini previews), **AccentSwatchGroup** (`radiogroup`, 7 radios, 50% radius), switch rows, slider.
4. **iOS vs Android.**
   - Android adds the Material You accent.
   - iOS adds Reduce transparency (glass is iOS-only).
   - Slider: iOS thumb vs the M3 expressive slider (bar thumb).
   - Text size units: pt vs ×.
5. **Native.**
   - Dynamic Type / font scale (`UIContentSizeCategory`, `PixelRatio.getFontScale()`);
   - system appearance listener (`Appearance`);
   - **Material You dynamic colour** (`PlatformColor('@android:color/system_accent1_…')`, Android 12+);
   - OS Reduce Motion / Reduce Transparency flags (`AccessibilityInfo`).
6. **States.** Dark with the Product filter. Missing: the Editor / Low glare lists, and Material You on devices < Android 12 (hide the row).
7. **Data.** Client-only (tokens). No server. Stored per device, which matches desktop's per-origin storage.
8. **Issues.**
   - In the light PNG the theme previews stay dark: the preview should render the theme in the current mode.
   - The iOS switch **off-state thumb renders dark in light mode**: a board artefact (DF-22: thumb is `surface` off / `on-accent` on). Native switches avoid it.
   - Desktop has Density and 12/13/14 font size; mobile replaces them with OS text size (intentional).
   - The app-level "Reduce motion" / "Reduce transparency" duplicate OS accessibility settings. They should default to "follow system" and only add an override. Draw the "System" state.
   - MPrinciples says "17 themes × … × 6 accents"; this board and the token package have 18 themes (Instrument + 17) and 7 accents (ink + 6). Fix MPrinciples.

### MSetProviders — "Settings · Model providers"

1. **Purpose and presentation.** Pushed section. Content:
   - the description (every connected provider is available; the default only handles requests that don't pick a model);
   - "📶 1 of 2 connected" + "↻ Test all";
   - an expanded provider card: CPU tile, "Claude Code" + "☆ Default" badge, "📶 Connected" (`--ok`), description, "↻ Test connection", a 2-column key-value grid (Provider id `claude-agent`, SDK installed Yes, Client running Yes, Authenticated Yes), and "Available models 3" rows (name + mono id);
   - a collapsed card: "GitHub Copilot", "📶̸ Not signed in" (`--err`), description, and the hint "Sign in to this provider, then test the connection to load its catalog."
2. **Chrome.** Detail header.
3. **Components.** New **ProviderCard** (expandable, with status line, KV grid, model list), text-button action.
4. **iOS vs Android.** Card radii (iOS `--raised` r22 vs Android r16). Android also uses cards here, not flat rows.
5. **Native.** Opening a browser sign-in (`authUrl`) via `ASWebAuthenticationSession` / Custom Tabs. **The Sign in button is not drawn.**
6. **States.** Connected (expanded) and not signed in (collapsed). Missing: **Sign in / Sign out actions**, "Make default", testing in progress, SDK not installed (the web has per-provider install hints), and error.
7. **Data.** `GET /harness/providers` (`installed`, `authenticated`, …; `?refresh=1` = Test), `POST /providers/:type/login|logout`, default provider switch — **exists**. Login and logout need `admin:harnesses` (D-1).
8. **Issues.**
   - **Stale provider set**: 2 drawn vs 5 provider ids on the server (`codex`, `opencode`, `acp` missing).
   - No Sign in control on the "Not signed in" card, and no way to change the default.
   - Status uses a wifi glyph; the status map uses its own glyphs. Use a neutral connected/disconnected concept from the icon registry.

### MSetAgents — "Settings · Agents"

1. **Purpose and presentation.** Pushed section. Content:
   - the description "Reusable agents that bundle instructions…";
   - Search agents, "5 of 6 enabled";
   - rows: bot icon, name + scope badge (Global / Built-in / Project) + Disabled / Orchestrator badges, and a one-line description, with a chevron on iOS;
   - "↗ Manage agents — Edit instructions, capabilities and teams in Agents";
   - floating New agent.
2. **Chrome.** Detail header + floating New.
3. **Components.** Search, AgentRow (compact variant), navigation row with ↗, floating New.
4. **iOS vs Android.** As §0.1; Android row height 72.
5. **Native.** None.
6. **States.** Normal. Missing: empty.
7. **Data.** `GET /agents` — **exists**.
8. **Issues.**
   - **A duplicate destination.** This section repeats MAgents (the same list, same New agent) and then links to it. Desktop has a Settings › Agents section (`sections/Agents.tsx`), so parity holds, but on mobile the two lists should share one component, and "New agent" should open the same MAgentNew sheet.
   - The ↗ glyph means "leaves Settings for the Agents module". Fine.

### MSetSkills — "Settings · Skills"

1. **Purpose and presentation.** Pushed section. Content:
   - the description "Built-in skills extend what agents can do. Disabled skills are never offered or sent to models.";
   - search, "4 of 5 enabled";
   - skill rows: book icon, name + System badge, description (a disabled row is dimmed), and a switch;
   - one row expanded in place (extension-author): a Description box and a "👁 Preview full details" button;
   - "Upload a project skill — Project skills live in Projects › Customization" (chevron / →).
2. **Chrome.** Detail header.
3. **Components.** Search, **SkillRow** (expandable toggle row), outlined button, cross-link row.
4. **iOS vs Android.** The expanded row: iOS inside the card, Android on a `--selected` background band. Switch styles.
5. **Native.** None.
6. **States.** One expanded, one disabled. Missing: Preview full details (reuse MSkillDetail?), empty search.
7. **Data.**
   - `GET /system/artifacts` — **exists**;
   - **enable/disable is client-local** on web (`stores/catalogPrefsStore.ts` `disabledSkills`), yet the copy promises "never … sent to models", which is a server behaviour — **partial/missing**. Needs a server-side system skill preference (the analogue of `PUT /system/mcp-servers/system/:id`).
8. **Issues.**
   - Expand-in-place + a switch on the same row gives two tap targets. Define row tap = expand and switch = toggle, with accessibility actions.
   - The interaction with project-level enable (MProjectCustomization) is undefined.

### MSetMcp — "Settings · MCP servers"

1. **Purpose and presentation.** Pushed section. Content:
   - the description (disabled servers are hidden from the per-stage selector);
   - "6 of 9 enabled";
   - server rows: terminal icon, name + transport badge (STDIO / HTTP) + "Needs setup" (s-warn) / "Custom" (s-run), description, and a switch.
   - The first row is expanded: a mono KV block (Command `npx`, Args, Source `system`) and a dashed "Setup required" box with a Bot token field (placeholder `SLACK_BOT_TOKEN`), "0 of 1 required fields filled" and Save.
   - Floating "Add server".
2. **Chrome.** Detail header + floating Add server (it overlaps the list; needs bottom content inset).
3. **Components.** New **McpServerRow** (expandable, with inline setup form), secret field, dashed setup box, floating action.
4. **iOS vs Android.** Field: iOS filled field r12 inside the box vs an M3 outlined field. Android row height 68.
5. **Native.** Secure text entry (no autofill of passwords, `textContentType=none`, `secureTextEntry`). Paste from clipboard.
6. **States.** Needs setup (switch off, disabled until filled), enabled, custom. Missing: setup saving/error, custom server edit/delete (row menu), connection test, and remove.
7. **Data.** `GET /system/mcp-servers`, `PUT /system/mcp-servers/system/:id {enabled, inputs, env, headers}` (credential vault), custom CRUD `/mcp-servers/custom` — **exists**. Writes need `admin:settings` (D-1).
8. **Issues.**
   - "Custom" drawn with `s-run` (Running blue): status map misuse. Use neutral.
   - "Needs setup" as `s-warn` borrows the Needs-you colour; acceptable only if needs-setup counts as "needs you".
   - Command/Args of system servers are shown to the user (fine, read-only).

### MSetMcpAdd — "Settings · Add MCP server"

1. **Purpose and presentation.** A pushed form (breadcrumb "Settings › MCP servers", title "Add server", ink "Add" in the header). Content:
   - Server name;
   - Transport: Local / HTTP / SSE;
   - Local command: Command `npx`, Arguments (mono, truncated);
   - Environment variables: rows of Key / Value (masked •••) with ✕, and "+ Add variable", with the footer "Values are written to the secrets vault and never appear again in this form or in any response.";
   - Timeout: Seconds 180 ("Default: 180 seconds (3 minutes).").
2. **Chrome.**
   - iOS: back circle + an ink Add capsule.
   - Android: back + an Add pill. Env rows are side-by-side outlined fields with ✕; Timeout is a half-width outlined field.
3. **Components.** Text fields, segmented, **KeyValueEditor** (repeatable rows), numeric field.
4. **iOS vs Android.** Grouped rows vs outlined fields; env Key/Value on one row in both.
5. **Native.** Keyboard types (numeric for Seconds, ASCII-capable for command, no autocorrect); secure entry for values.
6. **States.** The Local transport filled. Missing: the HTTP/SSE variant (URL + headers), validation, and dirty back.
7. **Data.** `POST /system/mcp-servers/custom` — **exists** (verify the timeout field). The screen map moves this form to the project Customization tab on desktop; mobile keeps it global.
8. **Issues.**
   - A pushed screen with a header primary action and back: the same presentation question as the agent editor (full-screen modal vs push).
   - **Scope placement:** desktop 04-screen-map says "The MCP 'Add server' form moves into this [Customization] tab"; mobile puts it under global Settings. Decide whether custom servers are global, project-scoped, or both (the server has both `/system/mcp-servers/custom` and `/projects/:id/mcp-servers`).

### MSetTemplates — "Settings · Templates"

1. **Purpose and presentation.** Pushed section. Content:
   - "Start a new workflow from a ready-made template.";
   - search, "5 templates";
   - rows: template icon tile, name, 2-line description, `system` badge + "4 stages" (mono), and a "Use" outlined button;
   - "Import a workflow from JSON — Opens Workflows › Upload JSON".
2. **Chrome.** Detail header.
3. **Components.** New **TemplateRow** (row + trailing button), cross-link row.
4. **iOS vs Android.** "Use" is a 44/r22 outlined capsule vs a 40 outlined pill; otherwise §0.1.
5. **Native.** Document picker for the JSON import (on the Workflows side).
6. **States.** List. Missing: Use → what happens (it creates a workflow and navigates? the web `useCreateFromTemplate`), and empty.
7. **Data.** `GET /templates`, create from template — **exists**.
8. **Issues.**
   - The row has two targets (row tap? + Use). Define row tap = preview.
   - The G-24 "18 templates" will change the count (PW).

### MSetSourceControl — "Settings · Source control"

1. **Purpose and presentation.** Pushed form with an ink "Save" in the header. Content:
   - the description (tokens stored on the server, never sent back);
   - a provider card: GitHub, "Create & view pull requests on GitHub.", ✓ Connected;
   - Configuration: Active provider (select GitHub), GitHub token "configured" (masked placeholder "(leave blank to keep)" with an eye toggle), Enterprise host (optional) `https://ghe.example.com`;
   - footer "The token needs `repo` + `pull_request` scopes. When blank, the server falls back to the `gh` CLI.";
   - Commits and pull requests: "Auto-commit & auto-PR — Set per workflow in Workflow settings ›";
   - footer "Choose None as the provider to turn off source-control features."
2. **Chrome.** Detail header + Save.
3. **Components.** Status card, select, secret field with reveal, text field, cross-link row.
4. **iOS vs Android.** Select: ⇅ row vs exposed dropdown; outlined fields on Android.
5. **Native.** Secure entry with a reveal toggle; ASWebAuthenticationSession / Custom Tabs if device flow is used.
6. **States.** Connected. Missing: not connected, token invalid, and saving.
7. **Data.** `/source-control/settings|config|status|accounts` — **exists**, including **device-flow sign-in** (`POST /accounts/device/start`, `GET /accounts/device/:loginId`) and `host` for Enterprise.
8. **Issues.**
   - **Typing or pasting a PAT on a phone is a poor path when the server already supports the GitHub device flow.** The board should draw "Sign in with GitHub" (device code + open browser) as the primary action.
   - Mixed save models: header Save here vs immediate switches elsewhere (D-6).

### MSetBrowserTerminal — "Settings · Browser & terminal"

1. **Purpose and presentation.** Pushed section. Content:
   - Integrated browser: "Full browser interaction — Navigate, click and type yourself" (switch, off), footer;
   - Integrated terminal: Default shell ("Blank uses the platform default", value `pwsh.exe`, chevron), Load PowerShell profile ("Off spawns 1–2 s faster"), Inherit SSH & AWS tokens ("Trusted hosts only"), footer "Changes apply the next time a terminal tab opens.";
   - "What this iPhone can do": Terminal "✓ Granted", Browser control "🔒 Not granted", "Request browser control ›", footer "Granted per device in Security & devices."
2. **Chrome.** Detail header.
3. **Components.** Switch rows, value rows, **ScopeStatusRow** (new: capability + granted/not-granted), navigation row.
4. **iOS vs Android.** Android puts a → arrow on the request row (vs an iOS chevron) and full-bleed dividers between sections.
5. **Native.** None directly (the scope request is a server call).
6. **States.** Terminal granted, browser not granted. Missing: request pending, and non-Windows server (hide the PowerShell row; the web does this via `health.platform`).
7. **Data.**
   - **Terminal shell / profile / secrets and browser interactivity are browser-localStorage on web** (`BrowserTerminal.tsx`: `generatorai:terminal:*`, `generatorai:browser:webInteractivity`) — **partial**. On mobile they are per-device unless moved server-side.
   - Scope status: device scopes via `/auth/devices/:id` — **exists**; request: `POST /auth/devices/me/scope-requests` — **exists**.
8. **Issues.**
   - The `pwsh.exe` value is Windows-server specific. The row must adapt to the server OS (cross-platform rule).
   - "What this iPhone can do" duplicates part of Security & devices (acceptable as a contextual shortcut).

### MSetComputerUse — "Settings · Computer use"

1. **Purpose and presentation.** Pushed section. Content:
   - Desktop automation: "Enable Computer Use — Adds the computer_* tools" (on), "Take over the screen — Real keystrokes, scroll and drag" (off), and a footer;
   - Desktop driver: "Running — In the server process · no agent cursor", `v0.9.2`, green dot; footer "Start and restart it from a chat's Computer tab.";
   - App grants 3: Excel / Postman (payments-service · Always allow), Outlook (docs-site · Deny), each with a Revoke text button in `--err`; footer listing the 4 grant choices;
   - "Always blocked — Password managers, secure fields ›";
   - footer "Every action is written to the Computer Use audit log."
2. **Chrome.** Detail header.
3. **Components.** Switch rows, status row, **GrantRow** (new: app + project + decision + Revoke), navigation row.
4. **iOS vs Android.** As §0.1; Revoke as `--err` text on both.
5. **Native.** Step-up biometrics suggested for Enable / Take over (the App lock board covers "Terminal and browser control" but not Computer use). Not drawn.
6. **States.** Enabled. Missing: driver stopped / error, no grants, the Revoke confirmation, the "Always blocked" detail, and the kill switch engaged (the server has `killSwitchEngaged`).
7. **Data.** `GET/PUT /system/computer-use`, `/computer/grants` (+ DELETE), `/computer/runtime` — **exists**. Requires `exec:computer` / `admin:settings` (not in any mobile preset).
8. **Issues.**
   - Enabling Computer Use from a phone is high-risk. It is not covered by "Ask for Face ID before" in MSetAppLock; add it.
   - The audit log is mentioned but has no link.

### MSetAudio — "Settings · Audio"

1. **Purpose and presentation.** Pushed section. Content:
   - Speech recognition model: a card "Nemotron 3.5 ASR — 40 languages · streams words as you speak", a warning "Not downloaded. Dictation falls back to Moonshine: English only, no live streaming.", an ink "Download" button + "about 790 MB"; footer "Fetched once to the server, never automatically.";
   - Speech to text: Engine (Automatic), Spoken punctuation (On), Pause before committing (`800 ms`), Dictation language (Auto-detect); footer "Automatic prefers Nemotron, then Moonshine, then Whisper. Only Nemotron detects language.";
   - Text to speech: Voice output switch ("Read aloud on replies · Kokoro, 90 MB"), Voice `af_heart`, Speed `1.0×`.
2. **Chrome.** Detail header.
3. **Components.** A model card with a download action (new **ModelDownloadCard**: states not-downloaded / downloading % / ready / error), value rows → pickers, switch row.
4. **iOS vs Android.** Chevrons on iOS only; Android full-bleed section dividers.
5. **Native.** None: the model downloads **to the server**. Voice output plays on the phone? Undefined (server TTS audio streamed to the device vs on-device playback). iOS audio session category and Android audio focus are needed for read-aloud.
6. **States.** Not downloaded. Missing: downloading (progress polling exists), downloaded, failed, and the picker screens for each value.
7. **Data.**
   - `GET/PUT /system/audio` (`sttEngine`, `textFormatter`, `endpointSilenceMs`, `interimResults`, `ttsEnabled`, `ttsVoice`, `ttsSpeed`) and `GET/POST/DELETE /system/audio/model` — **exists**.
   - **"Dictation language" has no server field — missing.** "Spoken punctuation" presumably maps to `textFormatter`; verify.
8. **Issues.**
   - Download filled ink (D-4).
   - The "Engine / Pause / Language" values push pickers that are not drawn.
   - The download size and time need a Wi-Fi hint? The server downloads, so there is no phone data cost. Fine.

### MSetExtensions — "Settings · Extensions"

1. **Purpose and presentation.** Pushed section with a detail sheet open. Content:
   - Installed 4: rows (icon, name, "Built in · `genai.document-studio`" / "User · `acme.todo`", switch — built-ins are on and disabled);
   - footer "Extensions add widgets, tools, skills, prompts and hooks. Built-in ones can't be turned off. Changes hot-reload.";
   - header actions: "Install from path" (+) and "Reload all" (↻).
   - The sheet: "Todo", `acme.todo@1.0.0`, description, badges (User scope, 1 widget, Ready in s-ok), "Installed at" (mono path box), an Enabled switch, Uninstall (`--err`) / Reload, and the footer "Uninstall deletes the extension folder from its scope. You'll be asked to confirm."
2. **Chrome.** iOS: a capsule with + and ↻. Android: two icons.
3. **Components.** Switch rows, sheet, badges, **ExtensionDetailSheet**.
4. **iOS vs Android.** Sheet shape; button shapes.
5. **Native.** None ("Install from path" is a **server** path; no device picker).
6. **States.** Detail open. Missing: the Install from path form, load error (extension failed), the Uninstall confirmation, and reloading.
7. **Data.** `GET /extensions`, `POST /extensions` (install), `DELETE /:id`, `PATCH /:id` (enable), `POST /reload`, `POST /:id/reload` — **exists** (`admin:settings`).
8. **Issues.** Built-ins are drawn as disabled "on" switches: announce them as "On, can't be turned off" or show a lock instead.

### MSetSecurity — "Settings · Security & devices"

1. **Purpose and presentation.** Pushed section (upper part). Content:
   - **This iPhone / This phone**: App lock & privacy (Face ID ›), "Face ID for approvals — Approvals and risky permissions ask first" (switch), "What this iPhone can do `12 / 22` ›";
   - **Servers** (+ Add server): This computer `local:3100` ● Connected; build-box `10.0.4.12:3100` [Switch]; footer "Each server keeps its own credential, so switching back never needs pairing.";
   - **Network exposure**: Loopback only / LAN / Custom; a warn callout "Reachable on this network — Anything on this network can reach `192.168.1.24:3100`. Devices still need a pairing code. Takes effect after the server restarts." with "↻ Restart server"; footer "Custom uses the address in GENERATORAI_BIND_HOST.";
   - **Access requests** (✋ 1) begins.
2. **Chrome.** Detail header.
3. **Components.** Switch row, ServerRow (with Switch button), segmented, callout with action, new **AccessRequestCard** (continued in MSetSecurityMore).
4. **iOS vs Android.** Biometric wording and glyph (Face ID frame vs fingerprint). Segmented vs a connected group.
5. **Native.** Biometrics (`LocalAuthentication` / `BiometricPrompt`); keychain/keystore per-server credentials (multi-server storage); `Add server` → pairing (camera QR scanner, see MPairing).
6. **States.** LAN with restart pending. Missing: restart in progress, loopback (no callout), server unreachable, and pending restart already applied.
7. **Data.**
   - `GET/POST /security/network-access` (`mode: 'local-only'|'network-accessible'`, `pendingRestart`) — **exists**;
   - posture — **exists**; restart server — desktop IPC only;
   - multiple servers — **client-side** (mobile code keeps one server today);
   - device scopes — **exists**.
8. **Issues.**
   - **"Custom" exposure is not supported by the server** (DF-20: only the server-supported options are offered). The server enum has 2 modes. Drop Custom or add a server mode.
   - **"12 / 22"**: `SCOPES` has **25** entries; `DEFAULT_MOBILE_SCOPES` has 12. Use the live count.
   - **"Restart server" from a phone** has no endpoint (desktop restarts via `window.generatoraiDesktop.restartServer`), so it is **missing** for remote clients; show "Restart required on the server".
   - Changing exposure requires `admin:settings` (D-1).

### MSetSecurityMore — "Settings · Security & devices (lower)"

1. **Purpose and presentation.** The same section, lower. Content:
   - **Access requests**: an amber-headed card "Pixel 9 asks for 3 more — Mobile · holds 12 scopes · 3m ago", with checkable scope rows: Terminal `exec:terminal` ⚠ Sensitive (checked), Browser `exec:browser` (checked), ~~Write files~~ `write:files` (unchecked, struck through); Deny / "Face ID Approve 2" (ink, biometric glyph); footer "Untick anything you don't want to grant; the rest is refused.";
   - **Paired devices 3**: GeneratorAI Desktop (This computer · Full access · now), Pixel 9 (Mobile companion · 12 scopes · 3m, Revoke), Chrome on build-box (Can make changes · 18 scopes · 2h, Revoke), "+ Pair a new device ›"; footer "Each device holds its own key. Revoking one never affects the others. 1 revoked device is hidden.";
   - "Unpair this iPhone / phone" (full-width destructive outlined button).
2. **Chrome.** Detail header.
3. **Components.** **AccessRequestCard** (checkbox rows + sensitive tag + biometric approve), **DeviceRow** (icon by kind, preset name, scope count, age, Revoke), destructive button.
4. **iOS vs Android.** Checkboxes: iOS round check circles vs M3 square checkboxes. The biometric glyph on Approve (Face ID vs fingerprint).
5. **Native.** Biometric step-up before approve and revoke (per MSetAppLock "Pairing and revoking devices"); keychain/keystore wipe on "Unpair this iPhone".
6. **States.** One request pending. Missing: the Revoke confirmation, the Unpair confirmation (irreversible: it drops this device's credential), no requests, and the "1 revoked device" disclosure.
7. **Data.** `GET /auth/scope-requests`, `POST …/:id/approve {scopes}` (subset supported) and `/deny`; `GET /auth/devices`, `POST /devices/:id/revoke` — **exists**. **Approving requires `admin:devices`**, which a mobile device never holds (D-1). The phone that is asking cannot approve itself either. Who approves on mobile?
8. **Issues.**
   - The **self-referential example**: "Pixel 9" is both the device asking and a listed paired device, and this board is drawn on a Pixel. It is ambiguous whether this device is the requester.
   - Preset names ("Mobile companion", "Can make changes", "Full access") only partly match code (`DEFAULT_MOBILE_SCOPES`, `STANDALONE_MOBILE_SCOPES`, `DEFAULT_DEVICE_SCOPES`, `DEFAULT_CLI_SCOPES`). Define a shared preset table (see MSetPairDevice).

### MSetPairDevice — "Settings · Pair a new device"

1. **Purpose and presentation.** Pushed detail (breadcrumb "Settings › Security & devices") with a Share action in the header ("Share address and code"). Content:
   - a code card: "1 On the other device, open `http://192.168.1.24:3100`" [Copy]; "2 Enter this code `4F7-K2Q`" (36 px mono) [Copy]; a QR code (white tile, "Pairing QR code"); "⏱ Expires in 9:42 · 12 scopes · single use" + Cancel;
   - "Don't screenshot the code or paste it into a chat.";
   - Permissions ("Changing it issues a new code"): Recommended for platform / Read only / Mobile companion ✓ / Mobile standalone / Full workstation, each with a one-line description;
   - Device: "Pixel 9 — Name shown in Paired devices · Mobile ›".
2. **Chrome.** Detail header with a trailing Share.
3. **Components.** New **PairingCodeCard** (address + code + QR + countdown), radio list (iOS trailing ✓, Android leading M3 radio), navigation row.
4. **iOS vs Android.** Selection: trailing ✓ (native iOS) vs leading radio (native M3). This is the correct per-platform pattern and differs from MAgentNew's iOS check-circle.
5. **Native.**
   - QR rendering;
   - **screenshot/recording protection** (`FLAG_SECURE` on Android; iOS: detect `UIScreen.capturedDidChange` / hide the secure field — iOS cannot block screenshots);
   - share sheet; clipboard (with iOS expiring pasteboard items);
   - biometric step-up before showing (App lock "Pairing and revoking devices");
   - keep the screen awake during the countdown.
6. **States.** Active code. Missing: expired (regenerate), consumed (device joined → success), and generating.
7. **Data.**
   - `POST /auth/pair` (scopes) — **exists**, but **needs `admin:devices`** (D-1).
   - Code format: `PAIRING_CODE_LENGTH = 12` (3 groups of 4, DF-19), not the drawn 7-character `4F7-K2Q`.
   - Presets: 5 drawn; code has `DEFAULT_MOBILE_SCOPES` (12), `STANDALONE_MOBILE_SCOPES` (18), `DEFAULT_DEVICE_SCOPES` (13), `DEFAULT_CLI_SCOPES`. "Recommended for platform", "Read only" and "Full workstation" have no constants — **partial**.
8. **Issues.**
   - **Contradiction:** a "Share address and code" header action next to "Don't screenshot the code or paste it into a chat." Sharing sends the code through third-party apps. Either drop Share or share only the address plus the QR through a system share restricted to AirDrop / Nearby Share.
   - The device name field ("Pixel 9") pre-names the *other* device; its source is unclear.
   - The code length is wrong (DF-19).

### MSetStorage — "Settings · Storage"

1. **Purpose and presentation.** Pushed section with a cleanup alert open. Content:
   - Automatic cleanup: "Nightly cleanup — Runs after 3am, server time" (switch on), "Keep for — `30` days untouched" (stepper: Fewer days / More days); footer "Every chat and run gets its own workspace. Uncommitted changes are archived, not deleted.";
   - Disk: "182 / 476 GB used on the server's disk", an 8 px bar (GeneratorAI 2% `--fg`, other 36% `--fg-3` on `--selected`) with a legend "GeneratorAI 7.3 GB · Everything else";
   - Workspaces 142: payments-service 3.1 GB, docs-site 1.4 GB, infra-terraform 0.9 GB, "Orphaned — No chat or run points here 1.4 GB" (each ›);
   - a "🗑 Clean up now" button.
   - The alert: "Clean up 23 workspaces? Deletes workspaces untouched for 30 days, about 4.2 GB. Uncommitted changes are archived instead; anything in use is skipped." with Cancel / Delete.
2. **Chrome.** Detail header.
3. **Components.** Switch row, stepper row, new **StorageBar** (segmented usage bar + legend, neutral tones only), size rows, destructive alert.
4. **iOS vs Android.** Stepper styles; alert styles (§0.1).
5. **Native.** None. This is server disk, not device storage. The phone's own cache size is **not** shown; consider a per-device "Cached data" row.
6. **States.** Confirm open. Missing: cleanup running, the result ("Freed 4.1 GB"), nightly off, and the drill-in per project (›).
7. **Data.**
   - `GET/PUT /system/workspace-retention` (enabled, retention days), `POST …/run` — **exists**;
   - disk used/total: `/system/info.disk` (G-12) — **built**;
   - GeneratorAI total, per-project sizes, orphaned size, and the "23 workspaces · 4.2 GB" dry-run — **G-17 missing**;
   - workspace count — **exists** (`/workspaces`).
8. **Issues.**
   - The alert's "Delete" vs "Clean up now": use the same verb.
   - The drill-in (›) targets for project rows are undefined (project Settings? codebase worktrees?).

### MSetDiagnostics — "Settings · Diagnostics"

1. **Purpose and presentation.** Pushed section. Content:
   - "● Auto-refreshing every 5 s · updated `14:12:08`" + header Refresh;
   - **Server**: Status (Up 3d 4h · 3 chats, 1 run in flight — ● Healthy), Agent provider (`claude-agent` — ● Healthy), Database (SQLite (WAL) · 212 MB — ● OK), Version (Server and app up to date — `0.0.1-alpha.1`);
   - **This iPhone / phone**: Connection (Direct on this network — ● Connected), Key protection (Secure Enclave / Android Keystore — Hardware);
   - **Runtime**: Telemetry (OpenTelemetry — Off), Sandbox (Set by SANDBOX_ENABLED — Off · host CLI);
   - buttons: Server log, Export; footer "Exports JSON: no chat content, no keys."
2. **Chrome.** Detail header + Refresh.
3. **Components.** New **DiagnosticsRow** (icon, label, sub, status dot + word), buttons.
4. **iOS vs Android.** Key protection wording; as §0.1.
5. **Native.**
   - key attestation (`generatorai-device-key` module: Secure Enclave / StrongBox or TEE → "Hardware");
   - network type (`NWPathMonitor` / `ConnectivityManager`: "Direct on this network" vs relay);
   - share sheet / Files save for Export.
6. **States.** All healthy. Missing: degraded / unhealthy rows (status map: Failed), the relay connection, software-backed keys, and update available.
7. **Data.**
   - `/health`, `/health/config` (otel, sandbox) and `/system/info` (uptime, `agents.running`, database size) — **exists**;
   - "3 chats, 1 run in flight" — **partial** (`agents.running` only);
   - "Server and app up to date" — **missing** (no update-check API for the mobile app or server);
   - **Server log** — **missing endpoint**;
   - **Export** — **missing** as a server endpoint (the web builds it client-side? verify); key protection — client native.
8. **Issues.** The status words mix "Healthy / OK / Connected / Hardware"; the status map vocabulary does not include them. Accept these as neutral + ok-dot labels, not states.

### MSetNotifications — "Settings · Notifications" (per device)

1. **Purpose and presentation.** Pushed section. Content:
   - an ok-tinted banner "🔔 Notifications are on — This iPhone is woken for the categories below.";
   - **Wake me for**: Approvals and questions (iOS "Time Sensitive · breaks through Focus" / Android "High priority · pops on screen") on; Run outcomes on; Chat replies off; Morning digest ("What ran overnight, at 9:00") off;
   - **Quiet hours**: Quiet hours "22:00 – 07:00 · every day" (on), Let approvals through (on);
   - **Projects**: payments-service Everything, docs-site Approvals only, infra-terraform Muted (each ›);
   - footer "Saved on this iPhone only; another device can choose differently."
2. **Chrome.** Detail header.
3. **Components.** Status banner (ok tint), switch rows with icons, value rows → option pickers.
4. **iOS vs Android.** The Approvals subtitle maps to the platform mechanism: iOS `interruptionLevel = .timeSensitive` (+ the Time Sensitive entitlement) vs Android a high-importance **notification channel**.
5. **Native.**
   - **notification permission** (`UNUserNotificationCenter.requestAuthorization`, Android 13 `POST_NOTIFICATIONS`);
   - **Android notification channels** per category (approvals / runs / chat replies / digest), which the user can override in system settings;
   - **deep link to system notification settings** (`UIApplication.openNotificationSettingsURLString` / `Settings.ACTION_APP_NOTIFICATION_SETTINGS` or `ACTION_CHANNEL_NOTIFICATION_SETTINGS`);
   - Focus / DND awareness; a time picker for quiet hours.
6. **States.** On. **Missing: permission not determined / denied / provisional** (the most important state), a channel disabled in system settings (Android), and the quiet-hours time picker.
7. **Data.**
   - push token + global mute: `PUT /auth/push-token`, `PUT /push-token/mute {mutedUntil}` — **exists**;
   - the push policy covers gates, questions, plan review, run failed/completed and automations — **exists**;
   - **per-category opt-in, chat replies (turn completed), morning digest, quiet hours with approvals exempt, per-project levels — missing.** These must be server-side, because the server decides whether to wake the device.
8. **Issues.**
   - A mobile-only settings page (allowed per 04-screen-map §3.1), but it introduces **server features** (digest, quiet hours, per-project levels) that desktop lacks. This is 08-mobile-readiness MD-6: they need server counterparts, and desktop should get a notifications preference under General.
   - The "Chat replies" push kind does not exist in `notificationPolicy.ts`.

### MSetAppLock — "Settings · App lock & privacy" (per device)

1. **Purpose and presentation.** Pushed section. Content:
   - **Unlock**: Require Face ID ("Passcode as a fallback") / Require fingerprint ("PIN or pattern as a fallback"); Lock after leaving (1 minute ›);
   - **Ask for Face ID / fingerprint before**: Approvals and permissions ("Allow, approve and answer gates"), Terminal and browser control ("Opening either tab in the pane"), Pairing and revoking devices — all on;
   - **Privacy**: Hide content in app switcher / Recents ("Shows a blank screen instead", on), Hide notification previews ("Until the phone is unlocked", off);
   - footer "The signing key lives in the Secure Enclave / Android Keystore and can't leave this iPhone / phone."
2. **Chrome.** Detail header.
3. **Components.** Switch rows, a value row → interval picker.
4. **iOS vs Android.** All copy is platform-specific (§0.1); the Android value row has no chevron.
5. **Native.**
   - `LocalAuthentication` (`deviceOwnerAuthentication` for the passcode fallback) / `BiometricPrompt` (`BIOMETRIC_STRONG | DEVICE_CREDENTIAL`);
   - `NSFaceIDUsageDescription`;
   - **privacy screen**: iOS snapshot overlay on `sceneWillResignActive` (the `withSceneLifecycle` plugin), Android `FLAG_SECURE` (which also blocks screenshots — note the side effect) or `setRecentsScreenshotEnabled(false)` (API 33+);
   - **hide notification previews**: iOS per-app `showPreviews` is a system setting (the app can only send generic content via a server flag or a Notification Service Extension); Android `VISIBILITY_PRIVATE` / public version;
   - lock timer on app background.
6. **States.** All on. Missing: no biometrics enrolled (fall back to passcode / disable), biometrics changed (key invalidation), lockout.
7. **Data.** Device-local. "Hide notification previews" needs a **server-side flag** so that pushes carry no content — **missing** (or implement it client-side in a Notification Service Extension that redacts before display).
8. **Issues.**
   - The design omits Computer use from "Ask before" (see MSetComputerUse).
   - "Hide notification previews" duplicates an OS setting on iOS; clarify that it redacts at the source.

### MSetWidgets — "Settings · Widgets & Live Activities / Live Updates" (per device)

1. **Purpose and presentation.** Pushed section. Content:
   - a **preview card** (iOS "Preview · Lock Screen" / Android "Preview · status bar chip and notification"): "✋ Nightly dependency audit — Waiting on you · Apply upgrades — 12:40", a 6-segment stage progress (3 `--ok`, 1 `--warn`, 2 idle), and Review / "Face ID or fingerprint Approve" (ink);
   - **Live Activities / Live Updates**: Runs I start ("Stages as progress, gates as milestones"), Chats waiting on me ("Only while a permission is pending"), Approve from Lock Screen / notification ("Always asks for Face ID / fingerprint") — all on;
   - **Widgets**: Refresh ("On push + 15 min" ›), Needs you (Small · Medium — "2 placed"), Running (Medium · Large — "1 placed"); footer "Add or remove widgets from the home screen. Data comes from this iPhone's last sync.";
   - **Controls**: "Control Center: New chat" / "Quick Settings tile: New chat" (switch on).
2. **Chrome.** Detail header; the title is long ("Widgets & Live Activities") and fits at 16/600 centred.
3. **Components.** New **LiveActivityPreview** (a JS mock of the system surface), switch rows, value rows with mono counts.
4. **iOS vs Android.** iOS ActivityKit Live Activity on the Lock Screen / Dynamic Island vs Android 16+ Live Updates (promoted ongoing notification with ProgressStyle + status-bar chip). Control Center control vs Quick Settings tile.
5. **Native.**
   - ActivityKit (+ push-to-start / update tokens, `NSSupportsLiveActivities`);
   - Android `Notification.ProgressStyle` / promoted ongoing;
   - WidgetKit + App Group data (`WidgetCenter.getCurrentConfigurations` for "2 placed"); Glance + `GlanceAppWidgetManager.getGlanceIds` for the Android count;
   - background refresh (`BGAppRefreshTask` / WorkManager, "15 min");
   - ControlWidget / `TileService`;
   - `authenticationRequired` notification action options (iOS) / BiometricPrompt from the notification trampoline.
6. **States.** All on, widgets placed. Missing: Live Activities disabled in iOS Settings (`ActivityAuthorizationInfo`), Android < 16 fallback (a regular ongoing notification), no widgets placed (show "Add widget" guidance or `requestPinAppWidget` on Android), and a Control/tile not added.
7. **Data.**
   - Attention feed (G-01) and run stages — **exists**;
   - **Live Activity push tokens and server-driven updates** (APNs `liveactivity` push, FCM data for Live Updates) — **missing**;
   - widget refresh "on push" needs silent/background push — **missing**.
8. **Issues.**
   - **The "Control Center: New chat" switch cannot work as drawn.** iOS apps cannot add or remove Control Center controls; the user adds them in Control Center edit mode. Android can only *request* adding a tile (`StatusBarManager.requestAddTileService`, API 33+) and cannot remove one. Replace the switch with an info row + "How to add" / "Add tile" button.
   - The preview uses status-coloured progress segments on a bar. MPrinciples "Status colour never tints a bar" is about the header bar, but clarify it for progress bars.
   - Mobile-only destination: allowed as platform-native (04-screen-map §3.1).

---

## A. Settings architecture

### A.1 Root structure (MSettings + MSettingsMore)

| Group | Rows (value shown) | Kind | Desktop section id |
|---|---|---|---|
| (header) | Server card: name, address, connection, **Switch** | server switcher | Security › Servers / sidebar popover |
| (header) | Search settings | client index | modal nav search |
| App | General (default model) · Appearance (theme) · **Notifications** (categories) · **App lock & privacy** (biometry) · **Haptics** (inline switch) | 2 server/app + 3 per-device | general, appearance |
| Agents & models | Model providers (n of m connected) · Agents (enabled of total) · Skills · MCP servers · Templates (count) | server | providers, agents, skills, mcp, templates |
| Integrations | Source control (provider) · Browser & terminal · Computer use (On/Off) · Audio (engine) · Extensions (count) | server (+ some device-local, see A.5) | source-control, browser-terminal, computer-use, audio, extensions |
| System | Security & devices (requests) · Storage (retention) · Diagnostics (health) · **Widgets & Live Activities/Updates** | server + 1 per-device | security, storage, diagnostics |
| Footer | Version + connected server | — | — |

- The **15 desktop sections** appear with the same order and group names (DF-21: "Agents & models").
- The **4 per-device rows** are Notifications, App lock & privacy, Haptics and Widgets, each with a "per device" footer.
- Sub-screens: MSetMcpAdd (form), MSetPairDevice (detail of Security), and the Default model sheet (General).
- There are no desktop boards for 13 sections (D-32 makes these mobile boards the content reference).

### A.2 Detail patterns observed

1. **Pushed section.** Detail header with a breadcrumb "Settings", an optional description paragraph, then groups. 21 boards.
2. **Section + header action.** Save (Source control), Add (MCP add), Refresh (Diagnostics), + and ↻ (Extensions), Share (Pair device).
3. **Inline expansion inside a list.** Provider card, MCP setup, Skill description. This is a new pattern: a row that expands in place to show details and a small form.
4. **Sheet from a row.** Default model picker, Extension detail.
5. **Destructive alert** with an impact summary (Storage cleanup).
6. **Cross-links** to other modules ("Manage agents ↗", "Upload a project skill ›", "Import a workflow from JSON ›", "Auto-commit & auto-PR ›").
7. **Save model.** Most rows apply immediately (switches, steppers); forms with secrets use an explicit Save (Source control, MCP setup "Save"); Project settings uses a body "Save settings" button. D-6 asks for one rule.

### A.3 Form and list primitives needed

| Primitive | iOS rendering | Android rendering |
|---|---|---|
| **SettingsGroup** | `igroup`: `--raised`, r22, rows divided by `--line-soft` (full width inside the card, starting after the icon when there is one) | no container; rows full-bleed; inset divider from 56 dp; full-bleed divider between sections |
| **SectionHeader** | 15/600 `--fg`, padding 12 4 6 4 (sentence case; *not* iOS-native 13 pt uppercase `--fg-3`) | 14/600 `--fg-2`, padding 16 (root: indented 56 — inconsistent) |
| **SectionFooter** | 13 px `--fg-3`, padding 6 16 | 14 px `--fg-3`, padding 16 |
| **NavigationRow** (icon?, label, sub?, value, ›) | chevron `i14 --fg-3`; value 15 `--fg-3`; min-height 44/56 | no chevron (M3); value 14 `--fg-3`; 52/56/64 |
| **ToggleRow** (icon?, label, sub?, switch, provenance?) | 51×31 switch | 52×32 switch with ✓ thumb |
| **ValueRow / InfoRow** (label, value, mono?) | trailing value, no chevron | same |
| **PickerRow** → select menu or pushed list | ⇅ glyph opens a pop-up menu (UIMenu) | exposed dropdown field (outlined + ▾) |
| **SegmentedRow** (label over control) | 32 segmented control inside the row | 40 dp connected button group with ✓ |
| **StepperRow** | joined −/+ pill 92×32 | two 40 dp outlined icon buttons + value |
| **SliderRow** | iOS slider with A / A glyphs + value | M3 slider (bar thumb) + value |
| **TextFieldRow** / secret / multiline | label-over-value inside the group; eye toggle for secrets | outlined field with floating label; trailing eye |
| **KeyValueEditor** (repeatable) | Key / Value columns inside the group + ✕; "+ Add variable" row | two outlined fields + ✕; "+ Add variable" text button |
| **RadioListRow** | trailing ✓ (Pair device) — but MAgentNew draws a filled check circle | leading M3 radio |
| **CheckRow** (scope approval) | round check circle | M3 square checkbox |
| **DestructiveRow / DestructiveButton** | `--err` text row, or a full-width outlined button ("Unpair this iPhone") | same |
| **ScopeStatusRow** (Granted / Not granted) | trailing ✓ Granted in `--ok` / 🔒 Not granted | same |
| **Callout** (info / warn / ok) | tinted card r16 with icon + optional action | same, r12 |
| **Banner** (status: "Notifications are on") | ok-tint card | same |
| **Destructive alert** + ImpactSummary | r34, 314 wide, 48 capsules on `--selected`, destructive text `--err` (MAgentDelete tints the destructive capsule `--err-bg`: inconsistent) | r28, 336 wide, icon, 22/600 title, right-aligned text buttons |
| **Confirmation sheet** (list of affected items) | inset sheet with filled `--err` button | edge sheet with filled `--err` pill |

### A.4 Per-platform differences to encode once

- **Chevrons:** iOS only.
- **Card vs flat:** iOS always carded. Android is flat for lists, but uses `--raised` r16 cards for composite content: provider cards, the agent capability card, the agent editor field groups, MCP setup, the model card in Audio, and the widget preview. Make "flat list rows + carded composites" the Android rule and state it.
- **Header alignment:** centred (iOS) vs left (Android).
- **Primary action placement:** in the header on both.
- **Biometric wording and glyph** come from one platform noun table (Face ID / Touch ID / Optic ID vs Fingerprint / Face unlock). The design assumes Face ID and fingerprint only; iPhones with Touch ID and Android face unlock need the generic "biometrics" wording.
- **Device noun:** "This iPhone" / "This phone" (iPad: "This iPad").

### A.5 Where each setting is stored today (important for mobile)

| Setting | Storage today | Consequence on mobile |
|---|---|---|
| Default chat model (General) | web `localStorage` (`lib/appPreferences.ts`) | per device unless moved to the server |
| Appearance | client | per device (correct) |
| Skills enable | web `catalogPrefsStore` (localStorage) | per device, although the copy implies server behaviour |
| MCP enable + secrets | server (`/system/mcp-servers/system/:id`, vault) | shared |
| Browser interaction, terminal shell/profile/secrets | web `localStorage` | per device; a phone setting `pwsh.exe` for the server is odd |
| Project customization enable | web `projectCatalogPrefsStore` | per device until G-19 |
| Notifications, app lock, haptics, widgets | — | per device by design (and notifications need server prefs, see MSetNotifications) |

---

## B. Domain composites required

The props sketches are TypeScript-ish. "JS" means React Native drawn; "native" means a platform control or extension.

| Composite | Props sketch | Platform differences | Native vs JS |
|---|---|---|---|
| **ProjectRow** | `{project, lastRun?: {name, n, status}, counts: {codebases, chats, needsYou}, updatedAt, onOpen, menu}` | card vs flat; context menu with preview vs M3 menu | JS row; native menu (`react-native-ios-context-menu` / `@react-native-menu/menu`, or JS M3 menu) |
| **CodebaseRow** | `{alias, status: 'pending'\|'cloning'\|'ready'\|'error'\|'stale', url, branch, lastFetchedAt, worktrees: {total, orphaned}, progress?: {phase, pct}, menu}` | card vs flat; ⋯ vs ⋮ | JS |
| **CodebaseMetaCard** | `{remoteUrl, status, defaultBranch, onChangeBranch, lastFetchedAt, onFetch, fetching}` | radii | JS |
| **WorktreeRow** | `{branch, status: 'active'\|'orphaned'\|'completed', linked?: {kind:'chat'\|'run', title, state}, updatedAt, sizeBytes?, expiresIn?}` | — | JS; neutral badges (see MCodebase issue) |
| **CleanupConfirmSheet** | `{title, body, items: {label, sizeBytes}[], confirmLabel, onConfirm}` | inset vs edge sheet | JS sheet (`@gorhom/bottom-sheet` or native `formSheet`) |
| **RepositoryDraftRow** | `{name, url, kind: 'remote'\|'local-git'\|'local-folder', branch, onRemove}` | — | JS |
| **LogViewer** | `{lines: {ts, text, tone?}[], live, onCopy, status, progress?}` | — | JS (mono, virtualised); stream over SSE |
| **SkillRow** | `{name, scope: 'system'\|'project', description, enabled, onToggle, expandable?, onActions?}` | switch style | JS row + native switch |
| **MarkdownCard / FileChips** | `{files: {name}[], active, markdown}` | chip shape | JS (share the transcript Markdown renderer) |
| **AgentRow** | `{name, role, scope, disabled, model, effort, counts: {skills, mcp}, projectName?, team?}` | chevron iOS only | JS |
| **CapabilitySummaryCard** | `{provider, model, effort, contextTier, maxTurns, caps: Record<Cap, boolean>, skills, mcp, warnings}` | card radius | JS |
| **UsedByList** | `{items: {kind:'workflow'\|'chat', title, detail?, status?}[], total, onSeeAll}` | chevron | JS |
| **TeamList** (not a graph) | `{members: {ref, name, role, model}[], maxWorkers, defaultWorkerModel}` | — | JS |
| **AgentEditor** (single scroll form, 5 sections) | `{draft, dirtyCount, onSave, onDiscard}`; sections Identity, Instructions (+ SizeMeter, Add/Replace default), Role, Runtime (Provider, Model → picker, Effort 5-way, Context tier 3-way, Max turns), Team (orchestrator only), Skills chips, MCP chips, Capabilities (TriStateSwitchRow ×8), Effective capabilities → push | segmented vs connected group; the 5-way segment needs a font-scale fallback | JS; keyboard-aware scroll |
| **DirtyBar** | `{count, onDiscard}` | — | JS |
| **TriStateSwitchRow** | `{label, value: 'inherit'\|'on'\|'off', inherited: boolean, onChange, onReset}` | switch style | native switch + JS badge; screen-reader value must include provenance |
| **TagInput** | `{tags, onAdd, onRemove}` | chip shape | JS |
| **ImportPreview** | `{file: {name, size, source}, parsed: {name, role, model, instructionsSize, skills, mcp}, warnings[], scope, replace?: {ref, fromVersion}}` | page sheet vs full-screen dialog | JS + native document picker (`expo-document-picker`) |
| **ServerCard / ServerRow** | `{name, address, state, current, onSwitch}` | — | JS; credentials in Keychain / Keystore per server |
| **ThemePicker** | `{mode, themes: {id, name, group}[], selected, filter, previewTokens(themeId, mode)}` + **AccentSwatchGroup** `{accents[], selected, materialYou?}` | Material You row Android 12+ only; Reduce transparency iOS only | JS previews rendered from the token package (live, mode-aware) |
| **ModelOptionRow / DefaultModelSheet** | `{provider segments/list, groups: {label, models[]}[], locked providers}` | sheet | JS; reuse the chat model picker |
| **ProviderCard** + login flow | `{id, label, isDefault, status: {installed, running, authenticated}, models[], onTest, onSignIn, onSignOut, onMakeDefault}` | card radius | JS; `WebBrowser.openAuthSessionAsync` for `authUrl`, then re-probe |
| **McpServerRow / McpSetupForm** | `{server: {id, name, transport, source, command, args, needsSetup, requiredInputs[]}, enabled, onToggle, onSaveSetup}`; **McpServerForm** `{name, transport:'local'\|'http'\|'sse', command, args, url?, headers?, env: KV[], timeoutSec}` | field style | JS; secure text entry |
| **TemplateRow** | `{name, description, source, stageCount, onUse}` | button shape | JS |
| **ScopeStatusRow / AccessRequestCard** | `{device, heldCount, requested: {scope, label, sensitive}[], selected, onApprove(scopes), onDeny}` (step-up) | check circle vs checkbox; biometric glyph | JS + LocalAuthentication / BiometricPrompt |
| **DeviceRow** | `{name, kind, preset, scopeCount, lastSeen, isThis, onRevoke}` | — | JS |
| **PairingCodeCard (PairDevice)** | `{address, code (12 chars, 3×4), qrPayload, expiresAt, scopeCount, onCopy, onCancel, preset, deviceName}` | radio vs ✓ | JS QR (`react-native-qrcode-svg`); `FLAG_SECURE` / iOS capture detection; keep-awake |
| **StorageBar** | `{totalBytes, segments: {label, bytes, tone:'fg'\|'fg-3'}[]}` | — | JS (neutral tones only) |
| **DiagnosticsCard / Row** | `{label, sub, value, tone: 'ok'\|'warn'\|'err'\|'neutral'}`; auto-refresh interval | — | JS; device key info from `generatorai-device-key` |
| **ModelDownloadCard** | `{model, languages, downloaded, progress?, sizeBytes, fallbackNote, onDownload}` | — | JS (server download, polled) |
| **GrantRow** | `{app, project, decision, onRevoke}` | — | JS |
| **ExtensionDetailSheet** | `{id, version, description, scope, widgets, state, path, enabled, builtin, onUninstall, onReload}` | sheet | JS |
| **NotificationCategoryRow / QuietHoursRow / ProjectLevelRow** | `{category, enabled, platformHint}`; `{start, end, days, allowApprovals}`; `{project, level:'everything'\|'approvals'\|'muted'}` | subtitle per platform | native permission + channels (`expo-notifications`), time picker (native `DateTimePicker`) |
| **LiveActivityPreview** | `{title, state, progress: {tone}[], actions}` | Lock Screen vs status-bar chip + notification | JS mock; the real surfaces are native extensions (ActivityKit, Glance, TileService, ControlWidget) |

---

## C. API gaps (designed data without a server source)

| # | Board(s) | Designed data / action | Server today | Gap id |
|---|---|---|---|---|
| C-1 | MProjectDetail, MCodebaseLogs | Live fetch/clone progress ("Receiving objects 38%"), fetch logs, failure output | `CodebaseStatus` has no progress; no logs route | **G-16** |
| C-2 | MCodebase, MProjectSettings, MSetStorage | Worktree size, linked chat, "removes in 26 h", reclaimable total, project/orphaned sizes, cleanup dry-run ("23 workspaces · 4.2 GB") | `WorktreeInfo` has runId/runType only; `/system/info.disk` has totals only | **G-17** |
| C-3 | MProjectCustomization, MSkillDetail | Per-project enable of skills/prompts/agents/MCP | device-local store | **G-19** |
| C-4 | MSetSkills | Global skill enable honoured by the server ("never sent to models") | device-local `catalogPrefsStore` | new (like `PUT /system/mcp-servers/system/:id`) |
| C-5 | MSkillDetail | Multi-file skill listing (files, sizes) | `ProjectConfig.filePath` single file (verify `available-artifacts`) | new / partial |
| C-6 | MAddCodebase | Remote branch list before clone | branches only for existing codebases | new (`ls-remote`) |
| C-7 | MAgentImport | Parse preview + registry warnings before import | parser in `packages/core` only | new (`POST /agents/import?dryRun=1` or move the parser to shared) |
| C-8 | MSetGeneral | Server-wide default chat model | web localStorage | new or decide per-device |
| C-9 | MSetBrowserTerminal | Terminal shell/profile/secrets, browser interactivity as server settings | web localStorage | new or decide per-device |
| C-10 | MSetAudio | Dictation language | not in `audioSchema` | new |
| C-11 | MSetSecurity | "Custom" network exposure; "Restart server" from a remote client | 2 modes; restart is desktop IPC | DF-20; new |
| C-12 | MSetPairDevice | Named scope presets (Recommended / Read only / Companion / Standalone / Full workstation) | 4 constants, 2 matching | new shared preset table |
| C-13 | MSetDiagnostics | Server log view, diagnostics export, "up to date" check, chats-in-flight count | none / partial | new |
| C-14 | MSetNotifications | Per-device category opt-in, chat-reply pushes, morning digest, quiet hours with approvals exempt, per-project levels | only `mutedUntil`; no chat-reply kind | new (MD-6) |
| C-15 | MSetAppLock | "Hide notification previews" at the source | no redaction flag | new (or client NSE) |
| C-16 | MSetWidgets | Live Activity / Live Update push tokens and updates; silent push for widget refresh | none | new (M4) |
| C-17 | MAgentDetail | Live state of chats that use the agent | `/usage` + client join | partial (client) |
| C-18 | MSettings (all admin rows) | Admin actions from a phone | require `admin:*` scopes no mobile preset holds | policy decision (D-1) |

**Exists and is sufficient:**
- projects/codebases CRUD, fetch, worktree cleanup, files;
- agents CRUD/usage/import/export/resolve-preview/force-delete;
- MCP registry + setup + custom;
- templates; source control incl. device flow;
- computer-use settings/grants/runtime; audio settings/model download;
- extensions; network access; scope requests (subset approve); devices/revoke; pairing;
- retention settings/run; health/config; `/system/info`.

---

## D. Open questions and conflicts for the owner

1. **Admin from a phone (blocking for Settings).** Almost every settings write in these boards needs an `admin:*` scope (Source control is the exception: it needs `write:projects`). Listing paired devices and access requests needs `admin:devices` even to read. Mobile presets hold no admin scope, and the auth design says admin scopes are never granted at pairing.
   - Option A: Settings is read-mostly on mobile, with "Requires admin access · Request" states on each row.
   - Option B: add an admin-capable mobile preset with biometric step-up per write.
   - Either way the boards need a read-only / not-permitted state.
2. **Provider set is stale.** 2 providers are drawn (Claude Code, GitHub Copilot); the server has 5 ids (`copilot`, `claude-agent`, `codex`, `opencode`, `acp`). General's 2-segment provider switch cannot scale. Redraw with a provider list and add the missing Sign in / Make default actions.
3. **Project "Pull requests" tab.** Desktop keeps it (D-31, R-3), mobile omits it, and the current mobile code has PR screens. Under "mobile keeps the desktop feature set" it should be added (tab + PR detail).
4. **Filled ink controls vs principle 6.** "Send, Approve or Run is the only filled control", yet the boards fill:
   - Create, Continue, Import, Save, Add, Add codebase, Edit, Start chat, Download, Approve 2, Upload skill / New agent / Add server (Android FAB);
   - and a filled `--err` "Remove · frees 385 MB".

   Either amend the principle ("the one primary action per screen is filled") or restyle. Also unify destructive buttons: `--err` text on `--selected` (alerts), an `--err-bg` capsule (MAgentDelete iOS), or filled `--err` (MCodebase sheet).
5. **Status-colour misuse.** Worktree "Active" = Running blue, "Orphaned" = Needs-you amber, MCP "Custom" = Running blue. These are not status-map states. Confirm that neutral badges are required (MFoundations: "Colour carries state only").
6. **One save model.** Immediate apply (switches), header Save (Source control, Agent editor, MCP add), body button ("Save settings" in Project settings), inline Save (MCP setup). Pick per form type.
7. **Per-device vs server-wide.**
   - Default chat model ("Application-wide" in copy, per-device in code).
   - Terminal/browser prefs.
   - Global skills enable.
   - Decide, and move the server-wide ones to the server (C-4, C-8, C-9).
8. **Editor presentation.** MPrinciples says Agent editor = full-screen modal (Cancel/Save, no swipe dismiss). MAgentEdit and MSetMcpAdd draw a pushed screen with back + Save (+ Discard). Pick one; dirty-back must confirm either way.
9. **MCP scope.**
   - Desktop moves "Add server" into the project Customization tab; mobile keeps it in global Settings.
   - The agent editor says "vetted registry entries only" while Settings lists a user "Custom" HTTP server.
   - Are custom/project servers bindable to agents?
10. **Pairing screen.**
    - The code is drawn with 7 characters; the real one has 12 (3×4, DF-19).
    - "Share address and code" contradicts "Don't … paste it into a chat".
    - Preset names need a shared table (C-12).
    - "Custom" network exposure is unsupported (DF-20). "Restart server" has no remote endpoint.
    - The scope total is "22" vs 25 in code.
11. **Control Center / Quick Settings switch.** Apps cannot toggle these; redraw as guidance + "Add tile" (Android 13+).
12. **Mobile-invented server features.** Morning digest, quiet hours with approvals exempt, per-project notification levels, hide previews at the source. They need server work and desktop counterparts (MD-6). Confirm they are in scope.
13. **Missing states across the group** (none drawn):
    - empty (Projects, Agents, Customization sub-tabs, worktree filters);
    - loading and error for every list;
    - disconnected server;
    - notification permission denied / not determined;
    - biometrics not enrolled;
    - codebase clone error;
    - fetch failed log;
    - provider not installed / sign-in flow;
    - built-in agent read-only variants;
    - Local git / Local folder add-codebase variants;
    - Orchestrator team editing;
    - revoke / unpair / uninstall confirmations.
14. **Android list rule.** Android is flat in lists but carded for composites (agent capability card, editor field groups, provider cards, MCP setup). Android settings-root headers are indented 56 dp while detail headers use 16 dp. Confirm one rule.
15. **Touch-target minimums.** Settings root rows are iOS 44 / Android 52 and some iOS rows are 48, below MFoundations' own "rows ≥ 52 / items 64/72". Confirm which is binding.
16. **Tri-state capabilities** are drawn as 2-state switches with an "inherits" badge, which is ambiguous to touch and screen readers. Desktop uses TriStateRow. Consider a 3-way control on mobile too.
17. **Segment overflow at large text.** 5-way Reasoning effort and 4-way retention/Customization segments clip at Dynamic Type XL / font scale ≥ 1.3. Specify the fallback (menu/select).
18. **Duplicate lists.** Settings › Agents duplicates the Agents module, and Settings › Skills partly overlaps Project › Customization. Share components, and define the relationship between global and project enablement.
19. **Theme copy.** MPrinciples says "17 themes × 6 accents"; the boards and tokens have 18 × 7. The Appearance theme previews stay dark in light mode.
20. **Computer use step-up.** Enabling Computer Use / Take over from a phone is not covered by App lock's "Ask for Face ID before" list. Add it.
