# Mobile redesign — September 2026

What changed in `apps/mobile`, why, and what it was checked against. The feature
inventory this started from is `docs/mobile-audit/INVENTORY.md`; nothing in it
was removed except the Widgets tab, which was never on mobile.

## Research that shaped it

**The platforms.** iOS 26's Human Interface Guidelines split an app into a
*content layer* and a *functional layer*: Liquid Glass is for controls and
navigation that float over content (bars, sheets, side panels), never for the
content itself. Secondary work is a sheet with detents (medium / large) and a
grabber. Material 3 (Expressive) uses the *modal navigation drawer* on compact
windows — it travels over the content behind a scrim, trailing corners
rounded, max 360dp — and the *modal bottom sheet* for secondary surfaces.
Chips are 32dp tall inside a 48dp target. Gesture navigation owns the outer
~24dp of each side for Back, so an edge strip no wider than that is dead.

**The category.** ChatGPT, Claude and the Codex / Claude Code mobile clients all
settled on the same shell: no tab bar; a menu button opens a left drawer with
New chat, search, the app's destinations and a list of recent conversations;
Settings hangs off the drawer's footer; the conversation owns the whole
screen; the composer is one rounded card with the attachment button leading,
the model control inside it, and mic + send trailing. Tools that are not the
conversation (diffs, files, terminals) open *over* it and are dismissed back
to it; mobile diff viewers are single-column with a file list first.

**Keyboard.** React Native's `Keyboard` events cannot drive a chat composer
correctly: Android only reports *after* the keyboard has risen, and the height
it reports includes or excludes the bottom system bar depending on navigation
mode and OEM. `react-native-keyboard-controller` reads the IME inset from the
platform's own animation callback on every frame on both platforms and is the
library Expo documents for this.

## Decisions

| Area | Before | Now |
|---|---|---|
| Navigation | Bottom tab bar, 4 tabs; Settings in every header | Left drawer (`src/navigation/shell`): New chat, search, exactly the desktop sidebar — Home, Projects, Chats, Agents, Workflows, Scripts, Automations — in its order, recent chats with live / waiting state, host status, approvals, Settings. Home is the default screen. iOS pushes the content aside; Android gets the M3 modal drawer. Button first, edge swipe second (strip widened past Android's Back zone). |
| Chat screen | Transcript shared a pager with 6 tool panes under a segmented strip | Transcript only. Header: menu · title (tap to rename) · connection dot · **workbench** · more. |
| Session tools | Pager pages + a separate "More" sheet | **Workbench** (`src/components/workbench`): the header button slides an index in from the right — one row per tool with a live one-line glimpse (changed files and ± lines, branch / ahead / behind / PR, browser host, running tasks, plan status, model and context %). Picking a row raises the tool as a bottom sheet with half / full detents; a chip strip in the sheet switches tool in place. Tools: Changes, Files, Terminal, Browser, Computer, Background tasks, Plan, Session. As on desktop there is no separate source-control tab: commit → push → pull request (generate text, base branch, draft, conflicts, a merge left in progress) is the block at the foot of Changes, and its glimpse leads with the branch state. |
| Tool performance | Every pane one swipe from mounting | Only the visible tool is mounted. Terminal / Browser / Computer stay mounted but paused while the sheet is open, capped at the two most recent (`nextKeepAlive`); closing the sheet frees everything. Index queries run only while the index or a tool is on screen. |
| Composer | One "turn setup" chip for model + effort + mode + permissions; mic inside the text row | Desktop's row: `+` · **model** chip (opens the model picker) · **effort** chip (opens effort) · **Plan** chip when on · options (permissions, context window) · context gauge · mic · send / stop. The row scrolls, so a long model name never displaces Send. |
| Keyboard | Hand-rolled from RN `Keyboard` events | `useKeyboardHeight` is the controller's frame-accurate inset; the dock pads by `max(keyboard, bottom inset)`. A focused field that turns read-only (a gate opened mid-typing) now dismisses the IME instead of stranding an empty keyboard-height band. |
| Workflow run | Tap a stage → separate screen; Changes / Terminal as list rows | Steps on a connected rail expand **in place** (one at a time, the running one by default) to the tail of the stage's live transcript, rendered with the chat's own rows. The same workbench (Changes, Source control, Files, Terminal, Browser) hangs off the header. The workflow definition's stage list uses the same rail. |
| Workflows and runs | A "Work" screen with Workflows / Runs / Automations / Scripts segments | Desktop's model: Workflows, Scripts and Automations are drawer destinations with no switcher; there is **no runs list**. A workflow's page leads with its runs (recent, show all), starts a new run, and deletes the workflow; "+" on Workflows creates one from a template (the DAG builder stays on desktop). A run backs out to its workflow. Projects and Agents are likewise separate destinations. |
| Changes review | Per-file discard only, via a checkpoint restore that could not serve worktree mounts | Desktop's set: **Keep** per file (pinned to the content seen, so an agent edit returns it to review), **Keep all**, **Undo all**, a Kept view with "move back to review", and discard through `changes/discard`, which works for every mount kind and snapshots first. Push defaults on when the mount can push, as on desktop. |
| Home | Approvals queue + activity feed | Desktop's Mission Control: four stat tiles (Chats, Workflows, Automations, Health — each opens its list, health opens Diagnostics) above the queue and feed, and the feed's inline actions — **Stop** a running chat turn, **Cancel** a running run (confirmed), **Retry** a failed one. |
| Chats list | Active / Archived, per-row swipe and menu | Desktop's **All / Active / Archived** with All as the default, and its **Select** mode: pick several chats, Select all, bulk delete behind a confirmation. |
| Agents | Grouped by scope, searchable | Plus desktop's role filter (All roles / Agents / Orchestrators). |
| Settings | No audio settings | **Audio**: dictation engine, spoken punctuation, pause before committing, read-aloud and its speed — the server settings the phone's mic and Read aloud depend on. Needs "Change server settings"; read-only otherwise. The desktop machine's microphone picker and the speech-model download stay on desktop. |
| Chips | 44pt lozenges (visual = touch target) | 34pt pill inside a 44pt target, everywhere. |
| Theming | — | Unchanged and already at parity: all 17 palettes, light / dark / system and accents come from `@generatorai/design-tokens`, the same source as desktop and web. New surfaces use the `sidebar-*`, `card`, `subtle` tokens so every palette styles them. Colour is shared; shape, motion and material are per platform. |

## Defects found by driving the app like a user (21 September)

- **Composer options unreachable.** On a 411dp phone the options chip was squeezed to a 9px sliver beside the mic, so a tap meant for it started dictation. Options now sits outside the scrolling strip next to "+", and the Plan chip leads the strip.
- **Dictation hung forever** when speech is switched off on the server: the socket is never answered, and nothing timed out. The hook now fails after 10s waiting for `ready` and 30s waiting for `final`, with a message that says why.
- **Rewinding a fork dropped the conversation but left every file.** A fork owns its workspace but inherits turns that ran in its parent, where their snapshots live. `restoreTurn` now falls back to the nearest ancestor's snapshot when its tree is reachable from the fork's repository (`ancestorWorkspaceIds`); covered by `restoreTurnInherited.test.ts`.
- **Action sheets clipped.** Capped at 40% of the screen, the Attach menu lost its last rows and Cancel. The cap is now a ceiling of 85%.
- **Plan card overflow** (a long generated file name ran off the card), **the tool chip strip not showing the active tool**, **the commit bar going stale after Undo all**, and the fork menu still describing a shared workspace.

## Defects found on iOS 27 (22 September)

- **The app would not launch.** iOS 27 refuses apps without the UIScene life cycle. `plugins/withSceneLifecycle.js` adds the scene manifest and a `SceneDelegate` that starts React Native in the scene's window and forwards URLs, user activities and foreground/background changes.
- **A running turn vanished on reopen.** The server saves the assistant message only when a turn ends, so a chat reopened while a turn was parked on a plan or permission showed the prompt and the gate card with nothing between. `useTurnCatchUp` pages the chat's event log for the unfinished turn, feeds it through the same event router as live frames, and subscribes from the last event. Adding a scope to an already open stream connection now carries its resume cursor (`POST /connections/:id/subs` accepts `cursors`), which it silently could not before.
- **Workflow stages did not stream.** A running stage showed its prompt and nothing else until it finished. `useStageLive` rebuilds the stage from the run's log (each agent event carries its `stageRunId`), then follows the run stream; one shared feed per stage, however many screens show it. Long answers inline collapse behind "Show more".
- **Template workflows failed before their first stage.** A template's "Clone repository" step looked for a repository the imported definition never declares. It now uses an existing checkout for the alias, else clones the run's Repository URL input; a URL alone also satisfies "requires a codebase".
- **Runs started for a project were listed under no project**, and their stage agents could not see project-scoped agents: the orchestrator never tagged `__projectId`.
- **Plans stayed "awaiting review" after their gate died** (a server restart), so Approve did nothing, silently. The plan now expires with its gate, a stale decision settles it, and the phone says so.
- **Form sheets drew their first rows under the title.** react-native-screens resizes the first ScrollView it finds on an iOS form sheet to the whole sheet; `RouteSheet` keeps its ScrollView out of that search.
- Smaller: the composer strip drops Plan and effort to icons when Stop and the gauge need the room; the plan sheet closes after a decision so the work it starts is visible; shell permission requests show the command once; gate tools read "Plan ready for review" / "Question for you" / "Update to-dos" as plain rows; a retried failure leaves Home's queue; the workflows list reports the newest run, not the first one listed; centred Confirm / Unlock buttons.

## Review pass against desktop (22 September, evening)

- The drawer is navigation only, like desktop's sidebar: no New chat, no divider, no recent chats. It floats as Liquid Glass like the workbench panel.
- The brand mark is desktop's lightning bolt on the primary colour (`BrandMark`), in the drawer, the lock screen and the launch splash.
- Segmented controls use desktop's FilterTabs look: a bordered track and a solid `primary-emphasis` pill, from theme tokens.
- Home has no approvals card queue (the bell opens the same sheet) and no floating New chat; compose is a header icon on Home and Chats.
- Home rows: entity glyph (`entityIcons.ts`, desktop's sidebar icons), one-line name, "Workflow · 2h ago", and a status mark (spinner, tick, cross, hand) instead of Retry.
- A settled turn's fold names what it did ("Ran 2 commands, read 3 files"), and its rule hangs from the row's icon.
- Expanding a row keeps it in place: the transcript follows the end only while a turn is live or the chat is first settling, and rows have no layout transition.
- Read aloud is hidden behind `READ_ALOUD_ENABLED`, as on desktop.
- The changes tray is a glass box with a folder tree (capped height, scrolls), Keep all (tick) and Undo all (rewind).
- Switching drawer destinations from a pushed screen on another tab left a blank screen (tab switched inside a frozen stack screen); the drawer now pops first and switches on the next frame.

## Colour and shape follow desktop (22 September, night)

- Interactive fills use `control` (`--sidebar-accent`) and `control-strong` (`--accent`), aliases in `tailwind.config.js`. They are desktop's blue-tinted `bg-accent` / `bg-primary/10`, per theme. `subtle` / `emphasis` grey is kept for content surfaces only (code, diffs, terminal, skeletons, tracks).
- Secondary buttons are transparent with a border, and composer chips have no fill at rest, as on desktop.
- Corners, not pills: tabs, chips, badges, the changes tray (12pt) and the composer card (20pt, `bg-card`, not glass).
- Tabs select solid `primary-emphasis`, both the segmented control and the chip tab strip (`Chip tone="tab"`).
- List rows and the workbench panel are flat: glyph and text, no tile or card behind them.
- Inline code is mono text in `primary`, with no background (a nested Text background fills the whole line box on native).
- A chat has Back, not the menu; the drawer opens on the top-level sections only.
- A work fold lists its calls flat, and rows ease open and closed (`Collapsible`).

## Verified on

Android 15 emulator (Pixel 7, gesture navigation), debug and release builds,
against an isolated server with a real project, a Claude Code chat that edited
files behind permission prompts, and a four-stage workflow run. iOS 27
simulator (iPhone 18 Pro, Xcode 27), release build: pairing by deep link, the
pushed drawer and Liquid Glass workbench, plan-first chat through question,
plan review, approval, permissions and completion, workflow runs streaming
stage by stage, the terminal behind Face ID step-up, light and dark themes.
