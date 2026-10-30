# GeneratorAI redesign ("Instrument"): design-system spec and token gap analysis

Source: 74 `.dc.html` boards in `…/artifact-files/45d76aa2-…/project/` plus `canvas.json`, compared with `packages/design-tokens/src` and `apps/web/DESIGN_SYSTEM.md`. This was a read-only analysis. Every number below was either measured by grep or computed with the repo's own resolver, run through `tsx`.

## 0. Integrity of the source

- **The shared `<helmet><style>` block is byte-identical in 55 of 56 non-theme boards** (md5 `1b5b4c2c`, 7,158 chars). The one exception is `ThemeInstrument.dc.html`, which reuses the shared block unchanged. It holds Google Fonts (Instrument Sans 400–700, JetBrains Mono 400/500), `.t-dark`/`.t-light`, seven `.acc-*` classes and every primitive class.
- **The 17 `Theme<Name>.dc.html` boards** each contain the shared block with two things added:
  - one extra Google Fonts link (Geist, IBM Plex Sans/Mono, Nunito Sans);
  - `.th-<id>-dark` / `.th-<id>-light` token blocks, plus a mono-font override for `.mono`, `.kbd` and `.cnt`.

  Apart from that, the theme boards differ only in title, tag, description, font/radius/accent labels and swatch hexes. The layout is the same in all of them: a header, then a Dark and a Light preview of the Home+chat shell at `scale(0.5)`.
- **Board size and state.** Boards are 1440×900 unless noted. Each board has a `DCLogic` switch (`mode` = dark|light, `accent` = ink by default) that produces `t-<mode> acc-<accent>`.
- **Missing file.** `canvas.json` lists `ThemeGallery.dc.html` ("All themes · dark and light", 1960×1620), but the file is not in the project.

## 1. Design audit ("Design audit · today", Audit.dc.html)

The board says it was measured on the running app in three tours (dark 1440, light 1440, dark 1100), cross-checked against source, with file:line refs in `docs/design-audit/`. It is dated "arch-redesign · Sep 23".

**Headline counts** (web plus desktop, across all 17 themes):

| Count | Finding |
|---|---|
| 16 | font sizes in use, 10 of them arbitrary px values |
| 174 | lucide icons for about 35 concepts |
| 7 | tab strips in 5 visual styles |
| 6 | stage-status colour maps that disagree |
| 11 | hand-rolled menus, 2 with no dismissal |
| 344 | hardcoded palette classes that ignore themes |
| 19 | screens with horizontal overflow |

**Per screen: problem, then the redesign's answer**

- **Dashboard `/`.**
  - Problems: KPI tiles tint entity kinds with status hues. The "Mission Control" heading sits over an activity box that renders empty. Nothing says what needs you or what is running.
  - Redesign: Home leads with *Needs you* and *Running*, and counts sit in one stat line.
- **Chat `/chats/:id`.**
  - Problems: the Widgets tab in the right pane is always empty. One transcript uses five text sizes (9–12.5px). The composer has five popover types and four radii.
  - Redesign: one transcript kit of 28px step rows, one composer, and dock tabs driven by capabilities.
- **Agents `/agents`.**
  - Problems: the search box is broken (the icon is detached and the text is clipped to "es"), it has no accessible name (`aria-label` is dropped), and the breadcrumb falls back to "GeneratorAI".
  - Redesign: one labelled search input with a `/` shortcut, then a title row, a filter bar and a table.
- **Workflow builder `/workflows/:id/edit`.**
  - Problems: the initial fit zooms to about 40%, so labels are unreadable. The empty canvas says "drag from the sidebar" but there is no palette. Nodes use 136 hardcoded palette classes and ignore themes.
  - Redesign: opens at 100% with a minimap, and nodes use tokens and the single status map.
- **Run page `/runs/:id`.**
  - Problems: five stacked strips appear before any content, about 152px of chrome. The error banner is unbounded red text. The stream is about 1,350px wide here but 768px in chat.
  - Redesign: one 44px toolbar with a status badge, stages in a rail, and errors in a callout.
- **Settings › Appearance.**
  - Problems: theme names and descriptions spill out and overlap, and the grid overflows its box by 200px. There are three separate theme writers: the header, this page and the desktop menu.
  - Redesign: fixed-size preview cells, and one theme writer shared by web and desktop.

**Root cause, as the audit states it:** the token system (17 themes × light/dark × 6 accents, contrast-checked) "is sound and stays". Nothing above the tokens is shared. The audit's fix has three rules:

1. **One component per job**: tabs, menus, search, and empty and loading states each exist once.
2. **One status map**: 7 states, each with one glyph and one colour. Entity kinds stay neutral.
3. **One type scale**: 7 sizes from 11 to 28px, nothing smaller, and no arbitrary values.

The Themes board adds one more thing that has to go: the 344 palette classes and the literal `#a855f7` streaming colour.

## 2. Colour tokens (Instrument = the new default)

Component CSS reads only these names. Themes swap values; names never change.

| Token | Dark (`.t-dark`) | Light (`.t-light`) | Role |
|---|---|---|---|
| `--ground` | #0b0b0c | #f1f1ef | behind sidebar + main card |
| `--surface` | #111113 | #ffffff | main card, docks, tables |
| `--raised` | #17171a | #fafaf9 | cards, composer, secondary buttons |
| `--overlay` | #1d1d21 | #ffffff | menus, dialogs, palette |
| `--sunken` | #0d0d0f | #f6f6f4 | inputs, code blocks, kbd |
| `--hover` | rgba(255,255,255,.035) | rgba(0,0,0,.03) | row/item hover |
| `--selected` | rgba(255,255,255,.07) | rgba(0,0,0,.055) | selected nav/tab/row, idle badge bg, skeleton |
| `--line-soft` | #1c1c20 | #ecece9 | dividers inside a surface |
| `--line` | #27272c | #e2e2de | control and card borders |
| `--line-strong` | #37373d | #d0d0cb | checkbox border, switch track |
| `--fg` | #ededef | #18181b | primary text, icons |
| `--fg-2` | #a1a1aa | #55555d | secondary text, idle controls |
| `--fg-3` | #80808a | #6b6b73 | meta, placeholders, entity icons |
| `--run` / `--run-bg` | #6aa6ff / rgba(106,166,255,.12) | #1d6ae5 / rgba(29,106,229,.09) | Running |
| `--ok` / `--ok-bg` | #4cc38a / .12 | #16804c / .09 | Succeeded, additions |
| `--warn` / `--warn-bg` | #f0b429 / .12 | #935f00 / rgba(214,150,0,.13) | Needs you |
| `--err` / `--err-bg` | #ff6369 / .12 | #d1242f / .08 | Failed, deletions |
| `--add-bg` / `--del-bg` | ok .09 / err .09 | ok .08 / err .07 | diff line washes |
| `--shadow-pop` | 0 16px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06) | 0 16px 40px rgba(20,20,30,.14), 0 0 0 1px rgba(0,0,0,.06) | the only shadow |
| `--scrim` | rgba(0,0,0,.62) | rgba(20,20,24,.3) | dialog backdrop |
| `color-scheme` | dark | light | |

**Accents (`.acc-*`: `--accent`, `--on-accent`).** Ink is the default: `--accent: var(--fg); --on-accent: var(--surface)`. The others:

| Accent | Colour | On-accent |
|---|---|---|
| blue | #2f6fed | #fff |
| violet | #7152e0 | #fff |
| green | #1b8a52 | #fff |
| orange | #d4561c | #fff |
| rose | #c8325f | #fff |
| teal | #0f7f7a | #fff |

Rules: the accent colours only the primary button, switch-on, checkbox-on, the focus ring, the selected radio card border and the Send button. Status colours never follow the accent. The accent hexes are fixed and do not vary by theme or appearance.

**Status map**, from Foundations. It is the only one, and it is used by chats, runs, stages, tasks and automations.

| State | Lucide glyph | Colour | Badge class |
|---|---|---|---|
| Queued | circle-dashed | fg-3 | `s-idle` |
| Running | loader-circle | run | `s-run` |
| Needs you | hand | warn | `s-warn` |
| Succeeded (chats say "Done") | circle-check | ok | `s-ok` |
| Failed | circle-x | err | `s-err` |
| Paused | circle-pause | fg-2 | `s-idle` |
| Skipped | circle-minus | fg-3 | `s-idle` |

Rules: always a glyph plus a word, never colour alone. Dense rows use 8px dots. Entity kinds are never colour-coded.

**Measured WCAG for Instrument:**
- **Passes.** Dark fg-2 ≥ 6.56 and status colours ≥ 5.8 on all surfaces. Light status colours are 4.37–5.42.
- **Borderline text.** fg-3 dark is 4.30 on `--overlay`, below 4.5. Light run/ok on `--ground` are 4.37/4.39.
- **Borders fail the non-text bar.** `--line-strong` is 1.5–1.66:1 (dark) and 1.37–1.55 (light). Inputs use `--line` at 1.2–1.3:1. Both fail the 3:1 WCAG 1.4.11 bar that the current suite enforces for `input`.
- **Fixed accents.** acc-green on white text is 4.37:1 and acc-orange is 4.08:1, both below 4.5.

## 3. Typography

- **Families.** UI and prose use "Instrument Sans" (fallback ui-sans-serif, system-ui, -apple-system, "Segoe UI"). Machine text (paths, commands, times, counts, kbd) uses "JetBrains Mono" (fallback ui-monospace, SFMono-Regular, Consolas).
- **Base.** `.app` is 13px/1.45 with antialiasing. `.mono` is 12px.
- **Weights.** Only 400/500/600 are used (473 / 455 / 170 occurrences). 700 is loaded but unused.

**Declared scale** (Foundations):

| Size / weight / tracking | Use |
|---|---|
| 28 / 600 / −0.02em | Home, hero numbers |
| 20 / 600 / −0.01em | page title |
| 16 / 600 | section, dialog title (h2 line-height 1.3) |
| 14 / 400 / lh 1.6 | transcript prose, composer input |
| 13 / 400–500 | UI default, nav |
| 12 / 400–500 | secondary, badges, chips, labels, hints |
| Mono 12 / 400 | paths, commands |
| Mono 11 / 400 | meta, kbd, time, counts |

**Measured font-size frequency** (56 non-theme boards; count, then number of boards):

| px | uses | boards |
|---|---|---|
| 11 | 1734 | 54 |
| 12 | 1383 | 54 |
| 13 | 456 | 54 |
| 10 | 114 | 30 |
| 14 | 80 | 27 |
| 20 | 77 | 31 |
| 16 | 69 | 25 |
| 9 | 7 | 2 |
| 28 | 7 | 6 |

All 121 uses of 9px and 10px are avatar initials (`.av` at 20px or 18px). So the real scale is **11 · 12 · 13 · 14 · 16 · 20 · 28**, plus an avatar-initials exception.

- **Line-heights** (count): 1.3 (140, titles and two-line rows), 1.45 (68), 1 (67, controls), 1.2 (53), 1.35 (41), 1.6 (37, prose), 1.5 (8). Fixed px values (22/16/14/19/17/20/18) appear in code, terminal and diff rows.
- **Letter-spacing:** −0.01em (32), −0.02em (6), 0.08em (1).

## 4. Geometry

**Spacing.** The design claims a 4px grid (4, 8, 12, 16, 20, 24, 32, 40, 48): "page body 24 × 28, rows 8–12". In practice many values are off the 4px grid:

- **Gap frequency:** 8 (887), 6 (712), 10 (511), 4 (428), 2 (264), 12 (248), 16 (56), 1 (47), 14 (39), 5 (30), 24 (26), 20 (15), 18 (10), 28 (7).
- **Common paddings:** `0 6px` (220), `0 8px` (203), `0 12px` (67), `0 16px` (63), `10px 12px` (59, callouts), `12px 14px` (53).
- **Shell paddings:** composer `12px 10px 8px 14px`, chat column `20px 28px`, sidebar `10px 8px 8px 8px`, list-page header `0 10px 0 16px`.

So the effective scale is 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 28 · 32.

**Radii.**
- Declared: 4 badge, 6 control, 8 card/menu, 10 main card/composer/user message, 12 dialog/composer box.
- Measured (count): 6 (320), 8 (272), 50% (186), 3 (172, mini elements), 5 (159: `btn-sm`, `ib-sm`, `seg` button, menu item), 4 (131), 10 (122), 2 (47, progress bar), 12 (34), 7 (`seg` outer).
- The switch uses 999px.
- Component radii are hardcoded; they do not follow the per-theme radius (see §6).

**Control heights.** Three sizes: sm 24 (`btn-sm`, `ib-sm`, `chip`, `seg` button), md 28 (`btn`, `ib`), lg 32 (`btn-lg`, `inp`).

- Rows: nav 30, list/table 44, tree/transcript step 28, menu item 30, menu header 28, table header 32, status-map row 36.
- Bars: page/dock header 44, tabs 36, permission-card header 36, Windows title strip 36 (controls 26 high, caption buttons 46 wide), Mac sidebar drag region 44.
- Small parts: badge 20, kbd 18, checkbox 14, switch 28×16, avatar 24 (20/18 in rows), dot 8 (6 inline).
- Hit area is never below 24px.
- Measured height frequency: 20 (427), 28 (407), 44 (253), 32 (246), 30 (197), 36 (138), 22 (125), 40 (123), 24 (119).

**Layout.**
- Sidebar is 232px on `--ground`. It collapses to a 48px icon rail (32px `ib`) below a 1200px window and in the workflow editors.
- The main card sits in `--surface` with an 8px inset from the edges, a line-soft border and radius 10.
- The side dock is 480px, or a 380px overlay sheet in narrow windows.
- Dialogs are 640px (new chat, command palette) or 960px (settings).
- Menus are 176–460px wide, typically 220–256.
- Pickers: model 620, agent 760.

**Icons.** Lucide (paths match circle-dashed, loader-circle, hand, circle-check, etc.).
- Style: inline SVG, `fill:none`, `stroke:currentColor`, stroke-width 1.75, round caps and joins.
- Sizes: 16 by default, plus `.i12`, `.i14`, `.i20`. Measured: i14 1232, i12 962, 16px about 630, i20 49 (2 boards).
- The registry is one glyph per concept, 49 concepts: home, chats, projects, agents, workflows, automations, scripts, settings, search, plus, more, x, check, edit, trash, copy, changes, files, terminal, browser, tasks, computer, plan, widgets, branch, commit, pr, diff, history, play, stop, retry, send, attach, mic, skills, mcp, hook, variable, webhook, clock, server, lock, key, bell, info, warning, hand.
- Other stroke widths are not icons: 1.6 is the brand mark and 1.5 is the workflow edge legend.

**Elevation and z-order.** The rule is "borders over shadows; shadows only float". There are three levels:

1. flat: a border only;
2. menu/popover/tooltip: `--overlay` background, `--line` border and `--shadow-pop`;
3. dialog: the same, over `--scrim`.

Other elevation details:
- **Z-index:** only 1–5, used locally.
- **Focus ring:** `0 0 0 2px var(--surface), 0 0 0 4px var(--accent)`.
- **Input focus/active:** `0 0 0 3px var(--selected)`; the error variant is `0 0 0 3px var(--err-bg)` plus an `--err` border.
- **Selected segment:** `0 0 0 1px var(--line)`.

**Motion.** There is no transition or animation anywhere in the design. Skeletons are "no shimmer, no spinner". The only behavioural timings are Stop being inert for 400ms and Force reset after 15s. Settings has a "Reduce motion" toggle that also follows the OS setting.

**New per-device settings** (SettingsAppearance):
- Mode: System / Light / Dark.
- Theme: Instrument + 17, grouped Product 5 / Editor 7 / Low glare 6.
- Accent: Ink default.
- **Density:** Compact / Comfortable (row and control heights).
- **Interface font size:** 12 / 13 / 14 (transcript scales with it).
- Reduce motion.
- "Changes apply instantly · Saved on this device".

## 5. Component catalog

### Primitives (CSS classes in the shared block)

| Component | Spec | Variants/states | Boards |
|---|---|---|---|
| Button `.btn` | 28h, pad 0 10, r6, line border, `--raised`, 13/500, gap 6 | `btn-p` (accent), `btn-g` ghost (fg-2, transparent), `btn-d` danger (err text), `btn-sm` 24/r5/12px, `btn-lg` 32; trailing `.kbd` (on primary: transparent, currentColor border, opacity .7); focused ring | 52 (btn-d 11, btn-lg 4) |
| Icon button `.ib` | 28 sq, r6, fg-2 | `ib-sm` 24/r5, `.on` (selected bg + fg), hover (`--hover` + fg), rail variant 32 | 50 |
| Kbd `.kbd` | 18h, min-w 18, r4, sunken, mono 11 fg-3 | on-primary variant | 48 |
| Badge `.bdg` | 20h, pad 0 6, r4, 12/500, gap 4, i12 glyph | `s-run`/`s-ok`/`s-warn`/`s-err`/`s-idle`, mono variant | 38 |
| Text colour utilities | `c-1/2/3`, `c-run/ok/warn/err` | | all |
| Chip `.chip` | 24h, pad 0 8, r6, line border, transparent, fg-2 12/500 | mono (11px), removable (18px `ib` inside), `+N` overflow, dropdown (chevron), borderless (composer toolbar) | 43 |
| Input `.inp` | 32h, r6, line border, `--sunken`, 13px, gap 8 | with icon + kbd (search), select trigger, textarea (64h, pad 7 10), mono, error (err border + err hint) | 37 |
| Label / hint | `.lbl` 12/500 fg-2; `.hint` 12 fg-3 | error hint in err | 21 / 17 |
| Nav item `.nav` | 30h, pad 0 8, r6, gap 10, 13/500 fg-2 | `.on` (selected), hover, two-line 44h with status dot, trailing `.cnt` (mono 11 fg-3) | 34 |
| Section header `.sec` | 28h, 12/500 fg-3 + `.cnt` | | 33 |
| Tabs `.tabs`/`.tab` | gap 20, 36h, 13/500 fg-2, line-soft bottom; `.on` = fg + inset 2px underline in fg (not accent) | count suffix (mono 11) | 11 |
| Segmented `.seg` | pad 2, r7, sunken, line-soft border; buttons 24h r5 12/500; `.on` = raised + 1px line ring | with counts | 35 |
| Card `.card` | raised, line-soft border, r8 | | 22 |
| Table `.th`/`.tr` | th 32h 12/500 fg-3; tr 44h, gap 16, pad 0 20, line-soft bottom | hover (`--hover`), selected (`--selected`), checkbox column, right-aligned mono numbers | 16 / 10 |
| Switch `.sw` | 28×16 pill, line-strong track, 12px white thumb; `.on` = accent track, on-accent thumb | role=switch | 14 |
| Checkbox `.cb` | 14 sq, r4, line-strong border; `.on` = accent fill | | 14 |
| Avatar `.av` | 24 sq **r6** (square, not round), selected bg, fg-2 11/600 initials | 20 (10px text), 18 (9px text) | 33 |
| Dot `.dot` | 8px circle | 6px inline, 7px notification with 2px ground ring | 48 |
| `.mono`, `.trunc` | utilities | | all |

### Composites (inline-styled in the boards; they would become React components)

- **Radio card** (`role=radiogroup`): pad 10, r8; selected state has an accent border, `--selected` background and a 4px accent ring on the radio. Used by: Components, AutomationCreate, ChatCreate*, NewChat, SettingsAppearance, WorkflowNew, DockChanges, ChatLight.
- **Menu / listbox**: overlay, r8, pad 4. Items 30h, r5, 13px, icon + label + right-aligned kbd or chevron. Header 28h 12px fg-3. Separator 1px line-soft with margin 4. Danger item in err. Used by: Components, Automations, Workflows (Import), Projects (row menu), DockChanges, DockBrowser, ComposerStates (4 menus), DesktopMac tray, DesktopWindows server menu, WorkflowStage*, AgentPickerBoard, ComposerModelPicker.
- **Tooltip**: 28h (or pad 4 8), r6, overlay, 12px, optional kbd. Used by: Components, ComposerStates.
- **Dialog / modal**: 640/960 wide, r12, overlay over scrim. Used by: NewChat, CommandPalette, SettingsAppearance, SettingsSecurity; ChatNarrow uses a dock sheet as a dialog.
- **Command palette** (dialog + textbox + listbox): CommandPalette.
- **Callout**: pad 10 12, r8, full `--line` border and a status `*-bg` tint. The rule is "never a left stripe". Tones: run, warn, err, ok. Used by: Components, WorkflowRun (HITL), ProjectDetail, ChatCreateModel, WorkflowValidate, Pairing (alert).
- **Empty state**: one icon, one 13/600 title, one 12px fg-3 sentence, one button. Used by: Components.
- **Skeleton rows**: 44h, `--selected` bars (8h r4 and 6h r3). Used by: Components.
- **Progress bar**: 4h, r2, `--selected` track, `--run` fill. There is also a context ring gauge. Used by: Components, Home, CommandPalette, Settings*, DesktopWindows.
- **Breadcrumb**: 13px fg-3 links, "/" separators, last item 600. Used by: chat headers, AutomationCreate.
- **Dock tab strip**: 44h, pad 0 8, `role=tablist` of `btn-sm`/`btn-g` tabs 28h with icon and count; the active tab has `--selected` background; plus an "open another panel" `ib-sm`. Used by 26 boards (Main, Chat*, Dock*, Workflow* editors).
- **Page/panel header bar**: 44h, line-soft bottom, breadcrumb, status badge, branch chip, `ib` actions.
- **Transcript kit** (Main, Chat*, Components):
  - user message: raised, r10, pad 12 14, 14/1.6, attachment chips;
  - agent header: 20 avatar, name, model, mono time;
  - "Thought for Ns" row;
  - step timeline: 28h rows with a 1px vertical line, glyph, verb 500, mono target, meta, mono duration;
  - inline error block: sunken, r6, mono 12, err;
  - inline code: mono 12, selected background, r4;
  - approval cards (permission, question, plan): line border, r10, raised, 36h header tinted `warn-bg`, and keyboard defaults (Esc, ↵, Ctrl ↵).
- **Composer** (ComposerStates is the largest spec):
  - changes tray: 32h, r8, raised; expanded shows a file tree with M/A letters and +/−;
  - input box: line border, r12, raised, pad 12 10 8 14, 14px placeholder;
  - toolbar: attach `ib-sm`; borderless chips for agent (locked), model, mode (Auto/Plan), effort, context tier; context gauge `btn-g` "42%"; dictate; Send is a 28px accent `ib` at r8;
  - hint row: 11px kbd legend and a wait-state dot;
  - blocking bars: preparing, preparation failed (Retry / Edit sources), waiting on you ("Cancel and send"), running (Stop → Stopping… → Force reset after 15s);
  - slash menu (commands/skills/prompts) and @-file menu;
  - attachment chips, including filled capture chips; dictation state; sources chip and popover (mounts, worktree paths);
  - team row for an orchestrator; context-window popover with a token breakdown.
- **Model picker / agent picker**: listbox popovers, 620 and 760 wide. Boards: ComposerModelPicker, AgentPickerBoard.
- **Stepper**: a vertical numbered step list ("Step 2 of 6") with a sticky Back / Save draft / Continue bar. Board: AutomationCreate. Chat-create screens use a sticky summary and action bar.
- **Stage rail / mini-DAG / waterfall**: WorkflowRun. **Canvas nodes, edge labels, legend, zoom, minimap and inspector**: WorkflowBuilder, WorkflowDetail.
- **Dock panels**: Changes (diff with add-bg/del-bg, Unified/Split segmented control), Files (tree + preview), Terminal (instances, kill-confirm popover, status footer, search), Browser (page tabs, nav bar, viewport, comment bubble), Tasks (group rows, expandable task cards), Plan, Computer (live frame, replay scrubber `role=slider`, grants).
- **Floating bulk bar**: overlay, r8, shadow. Board: ChatsList.
- **Stat line, "Needs you" / "Running" cards, Diagnostics list**: Home, Settings backdrop, DesktopWindows.
- **Pairing gate**: a 6-cell code input and a QR option. Board: Pairing.

**Not in the design:** toasts (the only transient notice is the "Restart to update" pill), spinners, and left-stripe callouts.

### App-shell pieces

- Sidebar 232: server switcher 36h; Search button 30h with Ctrl K kbd; New-chat 30 square; nav; *Needs you* and *Running* sections that are identical on every screen; footer 44h with connection dot and `local:3100`.
- 48px icon rail.
- Main card, inset 8, r10.
- 44px header.
- Side dock: 480px, or a 380px sheet in narrow windows.
- Windows title strip: 36h drag region, back/forward/sidebar, centred search 420×26, update pill, server menu, 46×36 caption buttons.
- macOS: traffic lights in a 44h sidebar drag region; tray menu.

## 6. Themes

Instrument plus 17 themes, all in light and dark:

| Group | Themes |
|---|---|
| Product (5) | **Instrument** (new default), GitHub, Graphite, Carbon, Clay |
| Editor (7) | One, Dracula, Tokyo Night, Catppuccin, Ayu, Night Owl, Rosé Pine |
| Low glare (6) | Nord, Everforest, Gruvbox, Solarized, Flexoki, High Contrast |

Per-theme metadata, from the board labels. Radius values are DEFAULT/lg/xl.

| Theme | Sans | Mono | Radius | Default accent |
|---|---|---|---|---|
| Instrument | Instrument Sans | JetBrains Mono | 4/6/8 (the Themes board says "r8") | Ink |
| GitHub | System UI | System mono | 6/8/10 | Blue |
| Graphite | Geist | JetBrains | 4/6/8 | Blue |
| Carbon | Geist | JetBrains | 8/12/16 | Green |
| Clay | IBM Plex Sans | IBM Plex Mono | 10/14/20 | Orange |
| One | System | JetBrains | 6/8/12 | Blue |
| Dracula | System | JetBrains | 6/10/14 | Violet |
| Tokyo Night | Geist | Cascadia | 6/10/14 | Blue |
| Catppuccin | Nunito Sans | JetBrains | 8/12/16 | Violet |
| Ayu | Geist | Cascadia | 6/8/12 | Orange |
| Night Owl | System | JetBrains | 6/10/14 | Blue |
| Rosé Pine | Plex Sans | JetBrains | 10/14/18 | Violet |
| Nord | Plex Sans | Plex Mono | 4/6/8 | Teal |
| Everforest | Plex | Plex | 6/10/14 | Green |
| Gruvbox | System | JetBrains | 4/6/8 | Orange |
| Solarized | System | Plex Mono | 4/6/10 | Blue |
| Flexoki | Plex | Plex | 4/6/10 | Blue |
| High Contrast | Plex | Plex | 4/6/8 | Blue (AAA) |

- **What a theme controls** (Themes board): "ground, surfaces, lines, text, status hues, font stack and radius".
- **What a theme never controls:** "layout, type scale, spacing, the status map, icons and components".
- **In practice, the `.th-*` blocks set only colours, fonts and color-scheme.** Radius is only a label: the component radii are the same in every theme board.
- **Each `.th-*` block sets 24 values:** 5 surfaces, hover/selected, 3 lines, 3 fg, 4 status + 4 bg, add/del-bg, accent/on-accent, shadow, scrim, color-scheme and font-family (mono via a descendant rule).
- **Formulas used in the theme blocks:**
  - `--hover` / `--selected` = `color-mix(in srgb, fg 4% / 8%, transparent)`;
  - `--fg-3` = `color-mix(in oklab, mutedFg 82%, surface)`;
  - status `-bg` = hue plus alpha `26` (15%) in dark and `20` (12.5%) in light;
  - add/del-bg = hue at 10%;
  - shadow = `0 16px 40px rgba(0,0,0,.5)` in dark (no 1px ring, unlike Instrument), `rgba(20,20,30,.14)` in light;
  - scrim .6 / .3.

## 7. Comparison with `packages/design-tokens`

**The 17 theme boards were generated from the current `ThemeDef`s by a deterministic mapping.** I checked this by running `resolveAppearanceTokens` and `accentEmphasis` for all 34 variants: every value matches with no exceptions.

| New token | Current source (ThemeDef spec / resolved) |
|---|---|
| `--ground` | the darker of `background` / `card` (dark: usually background; light: `card`, e.g. GitHub #f6f8fa) |
| `--surface` | the lighter of `background` / `card` (light: `background` #fff) |
| `--sunken` | = `--ground` |
| `--raised` | `raised`, or `subtle` when `raised` = the surface (5 cases: clay-light, flexoki-dark, github-dark, rose-pine ×2) |
| `--overlay` | `popover` (= current `--overlay`/`--popover`) |
| `--line` | `border` |
| `--line-soft` | `borderMuted` (`--border-muted`) |
| `--line-strong` | derived `input` (the 3:1 WCAG 1.4.11 border, `inputBorder()`) |
| `--fg` / `--fg-2` | `foreground` / `mutedForeground` |
| `--fg-3` | **new**: 82% mutedFg mixed with surface in oklab |
| `--run` / `--ok` / `--warn` / `--err` | `info` / `success` / `warning` / `danger` (hues blue/green/yellow/red) |
| `--*-bg` | `infoMuted` / `successMuted` / `warningMuted` / `dangerMuted` (same `TINT.status` 15 / 12.5) |
| `--add-bg` / `--del-bg` | **new** (10% green/red) |
| `--hover` / `--selected` | **new** neutral fg washes. Today, hover/selected use accent-tinted `--accent` / `--sidebar-accent` |
| `--accent` | current **`--primary-emphasis`** (filled-button colour) for the default accent |
| `--on-accent` | `--primary-foreground` (`onAccent`) |
| `--shadow-pop`, `--scrim` | **new** as tokens |
| (none) | current `--primary` (link/icon hue), `--ring`, `--accent` tint, `--sidebar*`, `--subtle`, `--emphasis`, `--secondary`, `--muted`, `--destructive`, `--done`, `--card-foreground`, `--popover-foreground`, `--surface-hover` have **no counterpart** in the design vocabulary |

**Name collisions to handle during migration:**
- `--accent` exists in both, with different meanings. It is a selection tint today and the filled primary colour in the design.
- `--surface` exists in both. Today it is an alias of `card`; in the design it is the main content card, which in light themes is `background`.
- `--raised` and `--overlay` keep roughly the same meaning.

**What the package can keep unchanged:**
- the `ThemeDef` authoring model, with 6 surfaces, 3 text, 2 borders and 9 hues;
- the registry and groups (`product` / `editor` / `reading` = "Low glare");
- the three-axis storage keys, `resolveAppearance`, `DEFAULT_MODE`;
- `color.ts` (`withAlpha`, `mix`, `ensureContrast`, `contrastRatio`);
- `inputBorder()`, which now feeds `--line-strong`;
- the `TINT.status` alphas;
- terminal (`resolveTerminalPalette`), syntax (`resolveSyntaxTokens` + hljs rules), chart ramp, `FILE_ICON_COLORS`;
- the ANSI emitter, the native/mobile emitter shape (`resolveTokenSet` keyed by var name), and `bin/generate.ts` `--check` / `--write`;
- the whole WCAG suite (AA on every theme × appearance × accent, AAA for `contrast`, surface separability, status distinguishability).

**What must change:**

1. **Add the Instrument theme** (`themes/instrument.ts`, group product) and make it `DEFAULT_THEME`, replacing `github`. Its hues can be authored from run/ok/warn/err. Its light `ground` #f1f1ef is darker than its `surface` #fff, which fits the derivation above. Two follow-ons:
   - The "default theme is unchanged" tests (lines 509–562) pin GitHub as the `:root` default. They will have to be re-pointed or kept as GitHub-specific tests.
   - Instrument's authored `--line-strong` (#37373d / #d0d0cb) fails 3:1. Either derive it with `inputBorder()` as the other themes do, or accept a softer checkbox and switch border.
2. **Accent axis.**
   - Add `ink` to `ACCENT_IDS`. Its `primary` is `foreground`, its emphasis is `foreground`, and its on-accent is `surface`.
   - Make ink the default accent for Instrument. Decide whether `ink` is available in every theme; the design implies yes, 7 accents.
   - Keep the per-theme hue derivation for the other six. Do not adopt the design's fixed `.acc-*` hexes: green and orange fail 4.5:1 with white text, and fixed hexes would ignore the theme. `ensureContrast` already handles this.
3. **Emit the new semantic layer.** Emit `--ground`, `--surface`, `--raised`, `--overlay`, `--sunken`, `--hover`, `--selected`, `--line*`, `--fg*`, `--run*`, `--ok*`, `--warn*`, `--err*`, `--add-bg`, `--del-bg`, `--accent`, `--on-accent`, `--shadow-pop` and `--scrim`, plus Tailwind `@theme inline` utilities (e.g. `bg-ground`, `text-fg-2`, `border-line-soft`).
   - During migration, keep the current names as compat aliases in Layer 3.
   - Rename the old `--accent` tint to something like `--accent-tint` before reusing the name.
   - Add `fg3` to `AppearanceTokens` (an oklab mix; `mix()` is sRGB-linear today, so add an oklab mix or accept an sRGB approximation for mobile literals). Add the WCAG test fg-3 ≥ 4.5 on ground, surface, raised and overlay; Instrument dark fails on overlay at 4.30.
4. **Status.** Collapse to 7 states and 4 hues plus neutrals.
   - Drop `done` (purple) and the separate `info` meaning: `info` becomes `run`.
   - Remove the `#a855f7` streaming literal.
   - `StatusBadge`'s 17-status map is replaced by the 7-state map; chats say "Done", runs say "Succeeded".
5. **Type.**
   - `FONT_SIZE` (11/12/**14** base/15/17/20/24/30) becomes 11/12/**13** base/14/16/20/28, with weights 400/500/600.
   - `LINE_HEIGHT`: add 1.3 and 1.45 as the base, and 1.6 for prose.
   - Add Instrument Sans as a font stack. It conflicts with `fonts.ts`'s "nothing is bundled / offline desktop" policy: Instrument Sans, Geist and Plex must be bundled for Electron, or the stack degrades to system-ui on first launch.
   - Add the Interface font size setting (12/13/14) as a new root scale variable.
6. **Radius.**
   - The design needs 5 steps: 4 badge, 6 control, 8 card, 10 main, 12 dialog, plus 5 for small controls. Today there are 3 theme-owned steps (DEFAULT/lg/xl).
   - Either extend `ThemeDef.radius` to `{sm, DEFAULT, lg, xl, 2xl}`, or keep radius global as the markup does. The Themes board says "a theme changes … radius", so the first option is intended.
   - The label "Instrument 4/6/8" contradicts "control 6 / card 8 / main 10"; this needs resolving.
7. **New scales:**
   - control heights (24/28/32; rows 28/30/44; bars 36/44);
   - density (Compact/Comfortable), which is a new axis;
   - the elevation tokens (`--shadow-pop`, `--scrim`);
   - focus-ring recipe;
   - icon sizes 12/14/16/20 at stroke 1.75.
8. **Motion.** `MOTION` (120/180/220) has no counterpart in the design. Keep it, but add a `prefers-reduced-motion` / "Reduce motion" setting hook.
9. **DESIGN_SYSTEM.md needs rewriting:**
   - defaults: Instrument, ink, 18 themes × 2 × 7 accents = 252 combinations;
   - primitive props: Button variants become primary/secondary/ghost/danger × sm/md/lg + IconButton 24/28 (drop `subtle`); Badge tones become run/ok/warn/err/idle (drop primary/info/done); add Kbd, Chip, SegmentedControl, Switch, Checkbox, RadioCard, Menu, Tooltip, Callout, Avatar (square r6), Dot, ProgressBar;
   - conventions: no toasts in the design; skeletons without shimmer; "never a left stripe"; "never tabs in tabs"; one primary per view;
   - the ratchet (`check:design`) should target the 344 palette classes.

**New versus existing themes:** only **Instrument** is new; its tokens exist only in the shared helmet. The other 17 (github, graphite, carbon, clay, one, dracula, tokyo-night, catppuccin, ayu, night-owl, rose-pine, nord, everforest, gruvbox, solarized, flexoki, contrast) already exist in `packages/design-tokens/src/themes/*.ts` with identical ids, groups, descriptions, fonts, radii and default accents. The redesign re-expresses them in the new vocabulary; it does not re-palette them.
