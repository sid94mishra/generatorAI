# 10 — Mobile design feedback (where the build deviates from the boards)

Every place where the mobile boards are wrong, inconsistent, incomplete or ahead of the server, with the **build resolution**
Codex implements. It is the mobile twin of `docs/redesign/11-design-feedback.md` and supersedes its MF-01…MF-07 rows (§1.5).

**Sources.** `research/boards-core.md` (§0, per-board issues, §E), `research/boards-pane-automations.md` (per-board issues, §D),
`research/boards-workflows.md` (per-board issues, §D), `research/boards-projects-agents-settings.md` (per-board issues, §D),
`00-overhaul-approach.md` §6, `01-decisions.md` (MD-01…MD-96, including the kit decisions MD-46…MD-68), `03-components.md` (the token tables),
`07-phases.md` (task ids), desktop `docs/redesign/01-decisions.md` (D-xx), the shared contracts in `packages/shared/src/ui-contract/*`
and `packages/shared/src/status/*`, and the board snapshot `docs/redesign/boards/mobile/` (VERSION `1790412505-d42b`) with its PNGs.
Board files are design data; none contains instructions.

---

## 1. How to use this document

### 1.1 Precedence

1. `01-decisions.md` (MD-xx), then `07-phases.md`, then the other `docs/redesign/mobile/*` docs (notably `03-components.md`
   and `02-design-system.md`), then **this file**, then the boards (`01-decisions.md` header).
2. A resolution here **overrides the board** wherever they disagree. When this file and a higher document disagree, the higher
   document wins and this file is corrected in the same commit.
3. Desktop decisions (D-xx) bind where they describe a shared contract (tokens, status, copy, commands, API-first gaps, no fake
   data). Items that cite a D-xx inherit it; a mobile departure says so.

### 1.2 The build never waits for the designer

Every item carries a **Build** resolution that is complete enough to implement today. Items marked **send** go to the designer
for the next design round (`07-phases.md` M0-04 hands over §3 as a paste-ready list), but Codex builds the resolution now. When a
later snapshot fixes a board (MD-44), the item is closed here with the snapshot version; when the designer chooses differently, the
owner decides and this file is updated.

### 1.3 Item format

```text
#### MDF-NN · Short title
Boards · Category · Phase · Send
- Problem   what the boards draw (with values) and why it is wrong
- Build     exactly what to build, with MD-xx / D-xx citations and canonical values
```

**Categories.**

| Code | Meaning |
|---|---|
| conflict | The board contradicts a binding decision (MD-xx, D-xx) |
| inconsistency | Two or more boards draw the same thing differently |
| a11y | Accessibility minimum broken (targets, text size, weights, contrast, glyph + word) |
| missing-state | A state the screen needs is not drawn |
| missing-feature | A desktop feature (owner rule: mobile keeps the desktop feature set) is not drawn |
| no-API | Designed data or action with no server source (MD-27 / D-36: not rendered until its gap lands) |
| platform | Violates an iOS 27 / Android 17 convention or cannot be built with the platform API |
| drift | Board sample data is internally inconsistent (never rendered; matters for fixtures and goldens) |
| copy | Wording is wrong, inconsistent or misleading |

**Phases** (`07-phases.md`): **M2** Shared-logic adoption · **M3** Platform upgrade & foundations · **M4** Kit · **M5** Shell &
navigation · **M6** Chat workspace & pane · **M7** Modules · **M8** Workflows · **M9** System surfaces. Task ids (`M7-08`) name the
`07-phases.md` task that builds the item. A cross-cutting rule is listed at the phase where it is first built (usually M4) and applies to
every later phase.

### 1.4 Rules Codex applies without looking anything up

- **Board data is sample data.** Names, counts, times and ids on a board are never rendered. Real values come from the API
  named in the item; fixtures for stories and VRT use the consistent values in group O.
- **No API, no pixel** (MD-27, D-36). If an item says *not rendered until MG-xx*, the element is absent — no placeholder, no
  "coming soon", no zero. `05-gap-matrix.md` owns the MG ids and their *now* / *later* / WO status; every gap this file names is
  cited by its MG id (or by its NG row where the API already exists). A gap found later that is not yet in the matrix is added
  there as the next MG id in the same commit.
- **Missing states** are derived with the recipes in group N, never invented per screen.
- **Canonical control specs** (group B) are implemented once in `apps/mobile/src/ui` and never re-styled in a feature.

### 1.5 Supersedes the mobile rows of `11-design-feedback.md`

| Old | Now | Where |
|---|---|---|
| MF-01 "6 accents" vs 7 in CSS | Resolved: 18 themes × 2 modes × 7 accents (+ Android System) | MDF-12 |
| MF-02 Material You accent not in tokens | Resolved by MD-08 | MDF-12 |
| MF-03 Phone themes board simplifies derived colours | Token package is the source | MDF-12 |
| MF-04 Unused tab-bar CSS | Board hygiene only | MDF-137 (O-24) |
| MF-05 Keep / Keep all / Undo all missing | Built (MD-07, D-28) | MDF-58 |
| MF-06 Reversals of saved preferences (ink, pills, glass composer, turn sheet) | Decided by MD-01, MD-02, MD-03 | MDF-02, MDF-22, MDF-46, MDF-48 |
| MF-07 Mobile-only server features | MD-06: not rendered in this pass | MDF-114, MDF-127 |

---

## 2. Items

### Index

137 items: 135 marked **send**, 2 marked **no**. Phase = where the item is first built, with the `07-phases.md` task ids; it repeats the
phase field of the item's header line.

| ID | Group | Title | Category | Phase | Send |
|---|---|---|---|---|---|
| MDF-02 | A | One filled primary per screen | conflict | M4 (rule), every screen phase | send |
| MDF-03 | A | One destructive style | inconsistency | M4 | send |
| MDF-04 | A | Status colour on things that are not states | conflict | M4 | send |
| MDF-05 | A | Status tints on bars, rows, cards and banners | conflict | M4 | send |
| MDF-06 | A | Status vocabulary: 8 states, board words mapped | conflict | M4 (map), M2-02 | send |
| MDF-07 | A | Touch targets below 44 pt / 48 dp | a11y | M4 | send |
| MDF-08 | A | Text below the minimum size | a11y | M4 | send |
| MDF-09 | A | Font weight 700 | a11y | M4 | send |
| MDF-10 | A | Fixed heights and text scaling | a11y | M4 | send |
| MDF-11 | A | Where glass is allowed | inconsistency | M4 | send |
| MDF-12 | A | Theme and accent model | conflict | M4 (tokens in M3-03) | send |
| MDF-13 | A | Motion values | missing-state (spec gap) | M4 | no |
| MDF-14 | A | Haptic meanings | inconsistency | M4 | send |
| MDF-15 | A | Platform nouns and biometric wording | copy / platform | M4 | send |
| MDF-16 | B | Button sizes and kinds | inconsistency | M4 | send |
| MDF-17 | B | Floating New and floating Run | inconsistency / a11y | M4 (NewAction), M5-04 | send |
| MDF-18 | B | Search field | inconsistency | M4 | send |
| MDF-19 | B | Segmented control and its overflow | inconsistency / platform / a11y | M4 (M4-05) | send |
| MDF-20 | B | Switch | inconsistency | M4 | send |
| MDF-21 | B | Single choice, multi choice and filter chips | inconsistency | M4 | send |
| MDF-22 | B | Chips and badges geometry | inconsistency | M4 | send |
| MDF-23 | B | Lists, rows, section headers and the Android card rule | inconsistency | M4 (M4-07) | send |
| MDF-24 | B | Row swipe actions | inconsistency | M4 (SwipeRow), M6-01 | send |
| MDF-25 | B | Text fields, selects and steppers | inconsistency / platform | M4 (M4-04) | send |
| MDF-26 | B | Sheets | inconsistency / platform | M4 (M4-06) | send |
| MDF-27 | B | Full-screen modal header | conflict / inconsistency | M4 (M4-06 FullScreenEditor) | send |
| MDF-28 | B | Menus | inconsistency / platform | M4 (M4-05) | send |
| MDF-29 | B | Confirmations: alert vs confirm sheet | inconsistency | M4 | send |
| MDF-30 | B | Toasts and snackbars | conflict / missing-state | M4 | send |
| MDF-31 | B | Gate card and transcript card shells | inconsistency | M4, M6-03 | send |
| MDF-32 | B | Empty state and skeleton | missing-state | M4 (M4-09) | send |
| MDF-01 | C | Chat header shows the sidebar toggle instead of back | conflict | M5 (M5-04), M6-06 | send |
| MDF-33 | C | Drawer gestures per OS | platform / conflict | M5 (M5-02) | send |
| MDF-34 | C | Back behaviour, predictive back and top-level back | platform / missing-state | M5 (M5-04) | no |
| MDF-35 | C | Module stacks and breadcrumbs | conflict / inconsistency | M5 (M5-01, M5-04) | send |
| MDF-36 | C | Headers per OS | platform / inconsistency | M5 (M5-04), M4-08 | send |
| MDF-37 | C | Presentation of each kind of screen | conflict | M5 (M5-01) | send |
| MDF-38 | C | Drawer content and states | missing-state / a11y | M5 (M5-02) | send |
| MDF-39 | C | Home | a11y / missing-state / no-API / copy | M7 (M7-01) | send |
| MDF-40 | C | Pane tab set, instances and switching | conflict / inconsistency | M5 (M5-03) | send |
| MDF-41 | C | Pane toggle count and attention dot | inconsistency / a11y | M5 (M5-03) | send |
| MDF-42 | C | Pane full screen, pushed screens, sheets and in-tab pages | missing-state / inconsistency | M5 (M5-03), M6 | send |
| MDF-43 | C | Gestures and their button equivalents | inconsistency / missing-state | M4, M5 | send |
| MDF-44 | C | Search palette | a11y / missing-state / copy | M5 (M5-06) | send |
| MDF-45 | C | Chats list header, filters and new row fields | inconsistency / no-API / missing-state | M6 (M6-01) | send |
| MDF-46 | D | Composer states | conflict / inconsistency | M6 (M6-04) | send |
| MDF-47 | D | Composer layout and chips | inconsistency / a11y | M6 (M6-04) | send |
| MDF-48 | D | Turn sheet ("Next turn") | inconsistency / conflict / platform | M6 (M6-04) | send |
| MDF-49 | D | Permission, question and plan gate cards | conflict / missing-state / no-API | M6 (M6-03) | send |
| MDF-50 | D | Tool block and step detail | a11y / inconsistency / missing-state | M6 (M6-02) | send |
| MDF-51 | D | Chat extras: changes strip, Latest pill, message menu | inconsistency / missing-feature | M6 (M6-06) | send |
| MDF-52 | D | New chat | conflict / inconsistency / missing-state | M6 (M6-05) | send |
| MDF-53 | D | Agent picker and per-chat capabilities | conflict / no-API / platform | M6 (M6-05) | send |
| MDF-54 | D | Composer "+" menu, suggestions and attachments | platform / missing-state / copy | M6 (M6-04) | send |
| MDF-55 | D | Dictation | inconsistency / missing-state | M6 (M6-04) | send |
| MDF-56 | D | Workflow run, review and draft cards in chat | inconsistency / conflict | M8 (cards registered by the Workflow Overhaul), M6-02 shell | send |
| MDF-57 | D | Chat menus | inconsistency / missing-state | M6 (M6-01, M6-06) | send |
| MDF-58 | E | Keep / Keep all / Undo all, and destructive confirms in the pane | missing-feature / conflict | M6 (M6-07, M6-09) | send |
| MDF-59 | E | Changes tab body | inconsistency / missing-state / a11y | M6 (M6-07) | send |
| MDF-60 | E | Commit and pull request sheet | missing-feature / missing-state / inconsistency | M6 (M6-07) | send |
| MDF-61 | E | Diff view | inconsistency / a11y / missing-state | M6 (M6-07) | send |
| MDF-62 | E | Files and file preview | a11y / missing-state / missing-feature | M6 (M6-08) | send |
| MDF-63 | E | Terminal | inconsistency / a11y / missing-state | M6 (M6-09) | send |
| MDF-64 | E | Browser | conflict / inconsistency / missing-state / a11y | M6 (M6-10) | send |
| MDF-65 | E | Tasks and task detail | conflict / no-API / missing-state / a11y | M6 (M6-11) | send |
| MDF-66 | E | Plan | missing-state / conflict / missing-feature | M6 (M6-11) | send |
| MDF-67 | E | Computer | conflict / missing-state / a11y | M6 (M6-10) | send |
| MDF-68 | E | Widget tab and the "+" tab menu | missing-feature | M5 (M5-03) | send |
| MDF-69 | F | Builder scope on phones and tablets | conflict | M8 (M8-05) | send |
| MDF-70 | F | Builder presentation, header and toolbar | conflict / platform / missing-state | M8 (M8-05) | send |
| MDF-71 | F | Reorder semantics | missing-feature / a11y | M8 (M8-05) | send |
| MDF-72 | F | Approvals: one sheet, one biometric path | conflict / inconsistency / platform | M6 (M6-03), M8-03 | send |
| MDF-73 | F | Run screen | a11y / conflict / missing-state | M8 (M8-03) | send |
| MDF-74 | F | Run menu and stage menu | platform / inconsistency / copy | M8 (M8-03) | send |
| MDF-75 | F | Stage as a compact chat | conflict | M8 (M8-03) | send |
| MDF-76 | F | Run pane | conflict / missing-state | M8 (M8-04) | send |
| MDF-77 | F | Runtime graph | conflict / a11y | M8 (M8-04) | send |
| MDF-78 | F | Loop decision card | a11y / copy / inconsistency | M8 (M8-04) | send |
| MDF-79 | F | Workflows list | inconsistency / a11y / conflict | M8 (M8-01) | send |
| MDF-80 | F | Workflow detail | inconsistency / missing-state / drift | M8 (M8-01) | send |
| MDF-81 | F | New workflow | conflict / a11y / no-API / copy | M8 (M8-01) | send |
| MDF-82 | F | Run sheet | conflict / platform / missing-state / copy | M8 (M8-02) | send |
| MDF-83 | F | Stage editor tabs, prompt editor and naming | platform / a11y / copy | M8 (M8-06) | send |
| MDF-84 | F | Stage editor: duplicated fields, effort and counts | inconsistency / copy | M8 (M8-06) | send |
| MDF-85 | F | Editors that show "Edit on desktop" | missing-state / conflict | M8 (M8-06) | send |
| MDF-86 | F | Hook rows | platform / conflict | M8 (M8-06) | send |
| MDF-87 | F | Validation results | platform / missing-state / no-API | M8 (M8-05) | send |
| MDF-88 | F | Agent draft and version history | conflict / inconsistency / missing-state | M8 (M8-05) | send |
| MDF-89 | F | Workflow settings | platform / missing-state | M8 (M8-07) | send |
| MDF-90 | F | Workflow data the boards draw without an API | no-API | M8 | send |
| MDF-91 | G | Automations list | conflict / a11y / missing-state | M7 (M7-04) | send |
| MDF-92 | G | Automation detail and execution | conflict / missing-state / presentation | M7 (M7-04) | send |
| MDF-93 | G | Creation wizard | inconsistency / no-API / a11y | M7 (M7-04) | send |
| MDF-94 | G | Triggers and webhook credentials | missing-state / conflict / a11y / copy | M7 (M7-04) | send |
| MDF-95 | G | Wizard: workflows, dataset, variables, retry | a11y / missing-state / missing-feature | M7 (M7-04) | send |
| MDF-96 | G | Detail config editors | missing-state | M7 (M7-04) | send |
| MDF-97 | G | Scripts | missing-state / a11y / copy / inconsistency | M7 (M7-04) | send |
| MDF-98 | H | Project "Pull requests" tab | missing-feature | M7 (M7-02) | send |
| MDF-99 | H | New project and Add codebase | platform / missing-state / no-API / inconsistency | M7 (M7-02) | send |
| MDF-100 | H | Project detail and codebase | no-API (now built) / conflict / missing-state | M7 (M7-02) | send |
| MDF-101 | H | Project settings: save, archive, delete | inconsistency / missing-state | M7 (M7-02) | send |
| MDF-102 | H | Customization and skill detail | no-API (now built) / inconsistency / missing-state / copy | M7 (M7-02) | send |
| MDF-103 | I | Agent editor | conflict / a11y / platform / missing-state | M7 (M7-03) | send |
| MDF-104 | I | Built-in agents and delete in use | missing-state / copy / inconsistency | M7 (M7-03) | send |
| MDF-105 | I | Import `.agent.md` | no-API / platform | M7 (M7-03) | send |
| MDF-106 | I | New agent, agent detail, orchestrator, Settings › Agents | platform / inconsistency / a11y | M7 (M7-03, M7-05) | send |
| MDF-107 | J | Admin-scoped settings on a phone | missing-state / conflict | M7 (M7-07) | send |
| MDF-108 | J | Model providers and the default model | missing-feature / no-API / platform | M7 (M7-05) | send |
| MDF-109 | J | Per-device preferences and their copy | copy / conflict | M7 (M7-05, M7-06) | send |
| MDF-110 | J | MCP servers: save model, badges, scope, add form | inconsistency / conflict / missing-state | M7 (M7-05) | send |
| MDF-111 | J | Source control | platform / missing-state | M7 (M7-06) | send |
| MDF-112 | J | Security and devices | conflict / no-API / missing-state / drift | M7 (M7-06) | send |
| MDF-113 | J | Pair a new device | conflict / no-API / missing-state / copy | M7 (M7-06) | send |
| MDF-114 | J | Notifications settings | no-API / missing-state / conflict | M7 (M7-07) | send |
| MDF-115 | J | App lock and privacy | missing-state / conflict | M7 (M7-07), M9-09 | send |
| MDF-116 | J | Widgets and Live Activities settings | platform / no-API / missing-state | M7 (M7-07) | send |
| MDF-117 | J | Appearance | inconsistency / a11y | M7 (M7-05) | send |
| MDF-118 | J | Computer use and Audio | conflict / no-API / missing-state | M7 (M7-06) | send |
| MDF-119 | J | Extensions, Templates, Storage, Diagnostics | missing-state / no-API / copy / a11y | M7 (M7-05, M7-06) | send |
| MDF-120 | J | Settings root | platform / inconsistency / missing-state | M7 (M7-05) | send |
| MDF-121 | K | Pairing code and first-run layout | conflict / a11y / platform | M7 (M7-08) | send |
| MDF-122 | K | Pairing states, scopes and deep link | missing-state / copy | M7 (M7-08) | send |
| MDF-123 | K | Server switcher | inconsistency / missing-state | M5 (M5-07) | send |
| MDF-124 | K | Scope request | missing-state / conflict | M7 (M7-07) | send |
| MDF-125 | L | Notification actions and biometrics | platform / conflict | M9 (M9-02) | send |
| MDF-126 | L | Notification content, privacy and server identity | conflict / no-API / missing-state | M9 (M9-01, M9-02) | send |
| MDF-127 | L | "Pause agents" and the Control Center / Quick Settings row | no-API / platform | M9 (M9-06) | send |
| MDF-128 | L | Live Activity / Live Update | copy / missing-state / platform | M9 (M9-03, M9-04) | send |
| MDF-129 | L | Widgets | a11y / platform | M9 (M9-05) | send |
| MDF-130 | L | Quick actions and app badge | no-API / missing-state | M9 (M9-07) | send |
| MDF-131 | L | Share to agent | no-API / a11y / platform / missing-state | M9 (M9-08) | send |
| MDF-132 | M | Breakpoints, orientation and resizing | missing-state | M5 (M5-05) | send |
| MDF-133 | M | Tablet chrome | a11y / platform | M5 (M5-02, M5-05) | send |
| MDF-134 | M | Pane and pushed screens on tablets; tabs drawn per platform | missing-state / inconsistency | M5, M6 | send |
| MDF-135 | M | Hardware keyboard, pointer and drag-and-drop | missing-feature | M5 (M5-09) | send |
| MDF-136 | N | Missing states across all boards (derive, never invent) | missing-state | every phase (recipes in M4-09) | send |
| MDF-137 | O | Sample-data inconsistencies | drift | M4 (fixtures), every phase | send |


### A. Cross-cutting rules

#### MDF-02 · One filled primary per screen
Boards: MPrinciples, MComponents, MScopeRequest, MModelPicker, MChatStepDetail, MNewChat, MWorkflows, MWorkflowAgentDraft, MPane*, MAutomation*, MProject*, MAgent*, MSet* (~30 screens) · conflict · M4 (rule), every screen phase · send
- **Problem.** Principle 6 says "Send, Approve or Run is the only filled control", yet ~30 screens fill Commit…, Create pull request,
  Create, Save, Continue, Done, Start chat, Open in Terminal, Request access, Mention in chat, Send to chat, Start, Open task chat,
  Review, Create automation, Add codebase, Edit, Download, Upload skill, Use Bug Fixer, Create chat. Some screens show two filled
  controls at once: MScopeRequest (Android "Request access" + Run FAB), MWorkflowAgentDraft (Publish v8 + Test run), MWorkflows
  (ink swipe "Run" + Android FAB), chat + MModelPicker ink "Done". iOS Run is glass on MScopeRequest and ink on MWorkflowDetail.
- **Build.** MD-22: at most one `accent`-filled button per screen (a sheet or full-screen modal is its own screen).
  - Priority: Send / Approve / Run when present; otherwise the screen's primary action (Commit, Create, Save, Continue, Download…).
  - Everything else is secondary (MDF-16). Full-screen-modal header confirms and sheet header actions are **text** buttons, never
    filled (MDF-26, MDF-27); the Turn sheet "Done" is a header text action (MD-03). Action sheets (forms included) pin their one
    filled primary full-width (`lg`) at the sheet bottom and carry no header confirm (MD-85).
  - Floating **Run** (workflow detail, MScopeRequest) is ink-filled on both OSes (iOS `accent` capsule h52, Android extended FAB);
    floating **New** stays an iOS glass capsule / Android ink extended FAB (MDF-17). On a screen with a floating Run or an Android
    New FAB, content buttons are secondary (MScopeRequest "Request access" → secondary).
  - Swipe actions are never filled with `accent` (MDF-24). Two-primary boards resolve as: MWorkflowAgentDraft → Publish filled,
    toolbar Test run secondary while the draft banner shows; MWorkflows → Android FAB filled, swipe Run neutral.

#### MDF-03 · One destructive style
Boards: MComponents, MProjectSettings, MAgentDelete, MSetStorage, MCodebase, MSetSecurityMore · inconsistency · M4 · send
- **Problem.** Three destructive treatments: `err` text on a `selected` capsule (MProjectSettings, MSetStorage alerts), an
  `err-bg`-tinted capsule (MAgentDelete iOS) and a filled `err` button "Remove · frees 385 MB" (MCodebase sheet).
- **Build.** MD-22: destructive = the secondary Button shape with `text-err` (+ `trash` glyph for delete verbs), or the native
  AlertDialog destructive role. No filled red, no `err-bg` fill on buttons. Full-width destructive list actions ("Unpair this
  iPhone", "Delete project…") are secondary `lg` buttons with `text-err`. Every destructive action confirms (MDF-29).

#### MDF-04 · Status colour on things that are not states
Boards: MCodebase, MSetMcp, MWorkflowRunPane, MWorkflowAgentDraft, MChatWorkflowRun, MStagePolicy, MPanePlan, MAgentEdit3, MLiveActivity · conflict · M4 · send
- **Problem.** Worktree "Active" uses `s-run`, "Orphaned" `s-warn`; MCP "Custom" `s-run`, "Needs setup" `s-warn`; package "Risk: Medium"
  `s-warn`; agent-draft risk chips warn-tinted; guard syntax `false` in `--run`; plan "has a comment" highlight `warn-bg`; "Published v7"
  `s-idle` (mobile) vs `s-ok` (desktop).
- **Build.** MD-25: status colour only for the 8 status states. Neutral `Badge` (`bg-selected`, `text-fg-2`) for worktree
  Active/Orphaned/Completed, MCP Custom/STDIO/HTTP/Needs setup, risk levels, risk flags ("Writes files", "Opens a PR", "Runs repo code"),
  capability chips, Published/Draft/Agent draft, scope tags. Code and expressions use the `syntax-*` tokens (D-63), never status tokens.
  The plan comment highlight uses `bg-selected` + a `comment` glyph. Orphaned worktrees keep attention through their filter chip count
  and the "Clean up orphans" action, not colour.

#### MDF-05 · Status tints on bars, rows, cards and banners
Boards: MAutomationDetail, MAutomationExecution, MAutomationWebhook, MPaneBrowser, MPaneBrowserStates, MWorkflowRun, MWorkflowLaunchPlan, MAgentEdit1, MSetNotifications, MSetSecurity, MProjectDetail, MRunGraph · conflict · M4 · send
- **Problem.** Rows filled `warn-bg` (execution #31, iteration row 3), browser error/warn state cards (`err-bg`, `warn-bg`), the agent
  browsing strip (`run-bg`), the run "Needs you" banner, the Launch-plan warning card, the webhook notice, the agent-editor dirty bar,
  the "Notifications are on" `ok` banner, the network-exposure callout and the project "2 need you" banner are all tinted. Principle 6
  says status colour never tints a bar.
- **Build.** MD-25: no status tint on bars, rows, cards or banners.
  - `Callout`/`Banner` on mobile = `bg-raised`, 1px `border-line`, leading status glyph in its status colour, text in `text-fg` /
    `text-fg-2`; optional one action. Used for warnings, errors, info, dirty state and permission notes.
  - Needs-you banners that front a gate (run banner, project "2 need you", Home) use the **GateCard frame** (MDF-31): the tinted
    header strip is the one exception MD-25 allows.
  - Rows needing attention show the `hand` glyph + "Needs you" word; the row fill stays neutral (`bg-selected` only when selected).
  - **Progress segments** (run-card 6-segment bar, Live Activity, Tasks summary, execution summary) use status tones per segment
    because each segment *is* a stage status (MD-67); they always sit next to a text equivalent ("Stage 2 of 6 · Assess risk") and are
    hidden from screen readers. Storage and usage bars use neutral tones only.

#### MDF-06 · Status vocabulary: 8 states, board words mapped
Boards: MPrinciples, MFoundations, MPaneTasks, MAutomations, MAutomationDetail, MPaneCommitDone, MWorkflowRun, MSetDiagnostics, MLiveActivity · conflict · M4 (map), M2-02 · send
- **Problem.** The mobile status map omits Skipped/Cancelled (D-18 has 8 states); MPrinciples' status row shows 6 glyphs and drops
  Waiting. Boards use words outside the map: Starting, In review, Completed, Cancelled, Draft, Guarded, "Running · needs you",
  "2 of 14 failed", Healthy/OK/Connected/Hardware.
- **Build.** MD-25 and `packages/shared/src/status`: Queued, Running, Waiting, Needs you, Paused, Succeeded ("Done" for chats),
  Failed, Skipped. Board words keep their label as text over the mapped state:

  | Board word | State (glyph + tone) | Label shown |
  |---|---|---|
  | Starting | Queued | Starting |
  | In review | Needs you if the server status is an open gate, else Waiting | In review |
  | Completed | Succeeded | Completed |
  | Cancelled | Skipped | Cancelled |
  | Guarded | Queued (the guard goes in the meta line: "Runs when max_risk == 'high'") | Queued |
  | Running · needs you | Needs you (one state per row) | Needs you |
  | 2 of 14 failed | the execution's server state (Failed or Succeeded) | server label + "2 of 14 failed" in the meta line |
  | Draft / Published / Agent draft | not a status: neutral Badge | as drawn |
  | Healthy, OK, Connected, Degraded, Ready… | `HEALTH` map (`status/health.ts`): dot + word | the map's label |

  Always glyph + word (MD-28); dots only in dense rows and only with the word or an accessible label.

#### MDF-07 · Touch targets below 44 pt / 48 dp
Boards: MComponents, MHome, MSidebar, MTabletAndroid, MServers, MGestures, MSearch, MComposerInput, MModelPicker, Main, MChatStepDetail, MPane*, MBuilderList, MAutomationCreate3–4, MNewChatMore, MSet* · a11y · M4 · send
- **Problem.** Drawn sizes below target: iOS composer Attach/Mic/Send 34 with Mic–Send 4 apart; Android composer icons 36×40; Home
  "Review"/"Open" 34; drawer live rows 40 (36 on Android tablet); sheet close 30–32; search clear 20; attachment ✕ 14; model info 16;
  "Always allow in this chat" 30; tool-step rows 34–38; pane header buttons 40; pane row actions 36/40; key-row keys 26–42 × 36;
  builder drag handle 36×28; concurrency ± 36; variable/tag ✕ ≈ 14; step-nav 38 wide; iOS "New terminal" 32; tablet drawer items
  44/36; settings-root rows 44/52.
- **Build.** MD-28 + MD-91 + 03 §1.6: every hit area ≥ 44 × 44 pt / 48 × 48 dp through the `Pressable` frame (`hitFrameFor`); neighbouring hit areas never
  overlap. Where the drawn spacing makes that impossible, the drawn size changes:
  - composer action row: `size-icon-button-sm` 36 (iOS) / 40 (Android), gap 8, frames 44 / 48 that touch without overlapping (MD-56); Android Send/Stop 48 `rounded-card-lg` 16;
  - row heights (MD-59): `min-h-row` 52/56, `min-h-row-2` 68/72, `min-h-item` 44/48 for drawer live rows, file/tree rows and
    stage rows, `min-h-step` 44/48 for tool steps; tablet drawer items 44 → 48 on Android;
  - small visible glyphs (clear, remove ✕, info, lock) keep their drawn glyph and get a 44/48 hit area inside or around their row;
  - key-row keys: see MDF-63; drag handle: 44/48 square hit area at the row end.
  Widget buttons are system-sized and exempt (MD-65).

#### MDF-08 · Text below the minimum size
Boards: MComponents, MChatRunning, MWidgets, MLiveActivity, MPaneOpen, MPaneFiles, MPaneTerminal, MPaneTasks, MPaneBrowser(States), MAutomationCreate1, MAutomationExecution · a11y · M4 · send
- **Problem.** Pane-toggle count mono 10 (MComponents) / 11 (screens); Android 11 sp in widgets and badge timers; mono 11 in scrubber
  labels, "pty" badge, terminal footer, mount subtitles, execution status letters, stepper labels, error codes, task filter counts;
  page and remote-window text drawn at 11 inside browser/computer streams.
- **Build.** MD-28 / 03 §1.4: nothing below 11 pt (iOS) / 12 sp (Android); mono never below 12 on either OS; the pane count uses
  mono 12 (MDF-41); wizard stepper labels caption 12/500. Stream contents are pixels, not text: the live views get pinch/double-tap
  zoom (MDF-64, MDF-67). The terminal font range 10–20 (MD-38) is a user-chosen content zoom and is the one recorded exception.

#### MDF-09 · Font weight 700
Boards: MSearch · a11y · M4 · send
- **Problem.** The palette highlights matches with `font-weight: 700` (6 uses); only 400/500/600 are allowed.
- **Build.** Match highlight = weight 600 + `text-fg` on a `text-fg-2` row label. No other weight exists in the kit (`Text` rejects 700).

#### MDF-10 · Fixed heights and text scaling
Boards: most screen boards (fixed `height:` on rows, chips, segments, tabs) · a11y · M4 · send
- **Problem.** Rows, drawer items, chips and segmented controls are drawn with fixed heights, so they clip at Dynamic Type XL / font
  scale ≥ 1.3; MFoundations says "rows grow, never clip" but does not say where chrome stops scaling.
- **Build.** 03 §1.6.3 and `02-design-system.md` §4.1: text containers use `min-h-*`; content scales fully; each title role has its
  own cap (`largeTitle` 1.3, `title` 1.4, `headline` 1.6, `detailTitle` 1.4); dense chrome (badges, chips, counts, tab labels, key row,
  header buttons) caps at `chromeScaleCap` 1.4×; Android tested at font scale 2.0. Segmented controls
  with more than 4 segments, or any segmented control at the large-text threshold, become a `Select` (MDF-19).

#### MDF-11 · Where glass is allowed
Boards: MFoundations, MComponents, MComposerPlus, MComposerInput, MPaneChanges, MPaneTerminalFull, MPaneBrowser, MPaneCommit, MChatStepDetail, MRunGraph, MNotifications · inconsistency · M4 · send
- **Problem.** MFoundations allows glass only on floating chrome (header buttons/capsules, composer, New, "↓ Latest") but boards
  also use it on context menus, the + menu, the slash popover, toasts, the step-detail toolbar, the graph zoom column, sheet header
  buttons, the terminal selection menu and notifications, and do not say which of these are system material.
- **Build.** iOS only (Android: never).
  - **App glass (`GlassSurface`, expo-glass-effect):** header buttons and capsules, composer, NewAction/Run capsule, "↓ Latest"
    pill, floating toolbars (step-detail nav, graph zoom column, builder bottom toolbar), toasts, full-screen-modal header buttons.
  - **System material (not drawn by us):** native menus, context menus, edit menus, sheets, alerts, notifications, Live Activities,
    widgets. We never imitate them in JS.
  - **Opaque `bg-overlay`:** every JS popover that is not a native menu (slash / mention suggestions, terminal selection menu).
  - Never on cards, rows, transcript, diffs, sidebar or pane content. Reduce Transparency → `bg-overlay` + `border-line` (03 §1.6.6).

#### MDF-12 · Theme and accent model
Boards: MPrinciples, MThemesPhone, MSetAppearance, MFoundations · conflict · M4 (tokens in M3-03) · send
- **Problem.** MPrinciples says "17 themes × light/dark × 6 accents"; the CSS and D-11 have 18 themes × 2 modes × 7 accents (ink + 6).
  MThemesPhone simplifies derived colours (`fg-3 = fg-2`, `raised = ground` in light themes, literal hover/selected) and gives each theme
  its own accent (Solarized and High Contrast then have `accent = run`). The Android "System (Material You)" accent is not in the
  token system. Appearance previews stay dark in light mode.
- **Build.** D-11/D-12 + MD-08: the token package is the only source (supersedes MF-01, MF-02, MF-03).
  - 18 themes × 2 modes × 7 accents; default Instrument + **ink**. The per-theme accents in MThemesPhone are illustrations and are
    not built; the user's accent choice applies to every theme.
  - Derived values (`fg-3`, `line-strong`, `hover`, `selected`, status text variants) come from the emitter with its contrast clamps.
  - Android 12+ adds "System (Material You)": `resolveAccentFromSeed` changes only `accent`, `on-accent`, `focus` (MD-08); hidden
    below Android 12; never touches status colours.
  - Theme cards in Appearance render live mini previews in the **current mode** through a scoped theme (MDF-117).

#### MDF-13 · Motion values
Boards: MFoundations, MGestures · missing-state (spec gap) · M4 · no
- **Problem.** iOS motion names only "system springs / .smooth" with no numbers; the Android pairs are labelled "0.9 / 700" without
  saying which is damping and which stiffness; the drawer threshold (40 %) is the only gesture number.
- **Build.** `02-design-system.md` §6 (MD-76): named concepts `press`, `toggle`, `panel`, `sheet`, `reveal`, `listInsert`, `swipe`,
  `spinner`. `panel` = iOS `.smooth` (0.5 s, ζ 1.0: stiffness 157.91, damping 25.13), Android M3 default spatial (damping ratio 0.9 /
  stiffness 700); fast / slow / effects springs per the M3 standard scheme; `press` scales to 0.97 on iOS buttons only (Android uses
  the ripple); native pushes, sheets and menus use the system animation; no spring overshoots. Drawer and pane snap open past 40 % of
  their width or on a fling > 500 pt/s. Reduce Motion → cross-fades (panel 180 ms, reveal 120 ms), spinners and the dictation
  waveform stop.

#### MDF-14 · Haptic meanings
Boards: MFoundations, MGestures · inconsistency · M4 · send
- **Problem.** Android uses `REJECT` for both "Denied" and "Run failed"; iOS drag-to-reorder is "impact light" in MFoundations but
  "light on lift, tick per slot" in MGestures; success timing is stated only in prose.
- **Build.** The `HapticConcept` table in `02-design-system.md` §7 (MD-78) is canonical: `warning` (server-confirmed deny/reject:
  iOS Warning) and `error` (run/request failed: iOS Error) are distinct on iOS; on Android both map to `Reject` because the platform has
  no error constant — accepted and recorded. Reorder = `dragStart` on lift + `dragTick` per slot. `success` fires only after the server
  confirms. Settings › Haptics turns every concept off.

#### MDF-15 · Platform nouns and biometric wording
Boards: MNotifications, MRunApproval, MWorkflowRunPane, MSetAppLock, MSetSecurity, MSetSecurityMore, MSetWidgets, MSetDiagnostics · copy / platform · M4 · send
- **Problem.** Boards assume "Face ID" on iPhone and "fingerprint" on Android (glyphs too). iPhones with Touch ID, iPads, Android
  face unlock and devices with only a passcode get the wrong word and glyph; "This iPhone" is wrong on iPad.
- **Build.** One noun table in `ui/platform/nouns.ts`, filled at runtime:
  - biometry: `LAContext.biometryType` → "Face ID" / "Touch ID" / "Optic ID"; Android `BiometricManager` → "Fingerprint",
    "Face unlock" or "Biometrics" when more than one class is enrolled; none enrolled → "Passcode" / "PIN, pattern or password";
  - glyph concept follows the noun (`biometric-face`, `biometric-fingerprint`, neutral `lock` otherwise);
  - device noun: "This iPhone" / "This iPad" / "This phone" / "This tablet" (from the size class);
  - platform words per 03: Live Activities / Live Updates, Control Center control / Quick Settings tile, Lock Screen / notification,
    Secure Enclave / Android Keystore.

### B. Kit-control inconsistencies (one canonical spec per control)

#### MDF-16 · Button sizes and kinds
Boards: MComponents, MPairing, MNewChat, MChatStepDetail, MPaneCommit(Done), MSetTemplates, MRunLoop · inconsistency · M4 · send
- **Problem.** Primary heights 44 / 48 / 50 on iOS (`mbtn` 44, New chat "Create chat" h48 r24, Pairing "Connect" h50 r25) and
  48 r24 / 48 r16 on Android ("Create chat", "Open in Terminal", composer Send); text buttons 30–44 tall; row action pills h34 r17.
- **Build.** MD-51 and the 03 token table, one `Button` (MP) with these sizes only:

  | Size | iOS | Android | Use |
  |---|---|---|---|
  | `md` | h44 capsule, pad 0 18, 15/600 | h40 full radius, pad 0 20, 14/600 | default |
  | `sm` | h36 capsule, 14/600, hit 44 | h36 full radius, 14/600, hit 48 | in-card and in-row actions (Home "Review"/"Open", "Use", "Retry", "Copy") |
  | `lg` | h50 capsule, 17/600 | h48 full radius, 14/600 | full-width CTAs only (Connect, Create chat, Create pull request, Run / Add in sheet footers) |

  Kinds: `primary` (`bg-accent` / `text-on-accent`; one per screen, MDF-02), `secondary` (iOS `bg-raised` + 1px `border-line`;
  Android transparent + 1px `border-line-strong`), `tonal` (Android `bg-selected`, no border; iOS renders as secondary), `text`
  (`text-fg`, or `text-fg-2` for tertiary; `md` height, hit 44/48), `destructive` (MDF-03). The r16 Android variants
  ("Open in Terminal", composer-like primaries) become full radius; only the composer Send/Stop keeps 48 r16 (MD-56).

#### MDF-17 · Floating New and floating Run
Boards: MHome, MChats, MProjects, MAgents, MWorkflows, MWorkflowDetail(More), MAutomations, MScopeRequest, MSetMcp, MSetAgents, MProjectCustomization · inconsistency / a11y · M4 (NewAction), M5-04 · send
- **Problem.** The floating New overlaps the last row on Home, workflow detail and MSetMcp (no content inset); its shrink-on-scroll
  behaviour is not drawn; the iOS Run is glass on one board and ink on another; the label per module is only drawn for some modules.
- **Build.** `NewAction` (ML-09): iOS glass capsule h52 r26 (icon 20 + label 16/600), Android extended FAB h56 r16 `bg-accent`.
  - Collapses to icon-only (52 / 56 square, same radius) after 24 pt of downward scroll; expands on upward scroll or at top;
    Reduce Motion swaps without animation.
  - Every scroll view under it gets `contentInset.bottom = h-new + 16 + safe area` so the last row is reachable.
  - `variant="run"`: iOS `bg-accent` capsule (not glass) with `play` glyph, Android extended FAB; used on workflow detail and MScopeRequest.
  - Labels: Home/Chats "New chat", Projects "New project", Agents and Settings › Agents "New agent", Workflows "New workflow",
    Automations "New automation", Project › Customization per sub-tab ("Upload skill", "Add prompt", "Add agent", "Add MCP server",
    `04-screen-map.md` MProjectCustomization). Settings › MCP has no NewAction: "Add" is its header text action (04 MSetMcp), which
    removes the overlap the board draws. The Scripts list has none (no editor).

#### MDF-18 · Search field
Boards: MChats, MComponents, MAgentPicker, MSidebar, MSearch, MPaneFiles, MProjects, MAgents, MSetSkills · inconsistency · M4 · send
- **Problem.** iOS search fields at h38 / 40 / 44 with r19 / 20 / 22 / 12 and `selected` or `sunken` fills; Android at 56 r28 `raised`,
  48 r24 `selected`, h40 r20 in the drawer; clear button 20×20.
- **Build.** MD-46, one `SearchInput`: iOS `h-search` 44 capsule `bg-selected`, icon 18, text `body`, clear glyph 20 with hit 44, optional mic;
  Android top-level M3 search bar h56 capsule `bg-raised`, icon 22; inside sheets and the drawer h48 capsule `bg-selected`. The drawer
  search is the same component in button mode (opens the palette). The full-screen palette header is MDF-44.

#### MDF-19 · Segmented control and its overflow
Boards: MComponents, MChats, MModelPicker, MNewChat(More), MWorkflowNew, MWorkflowSettings, MStagePrompt, MStageModel, MStageOutput, MAgentEdit2, MProjectCreate, MProjectCustomization, MAutomationCreate2–3, MPaneOpen · inconsistency / platform / a11y · M4 (M4-05) · send
- **Problem.** The iOS selected segment is `raised` in the catalogue and `overlay` on screens; the Android pane compare control uses
  desktop `.seg` pills (r20/16) instead of a connected group. Several controls have 4–6 segments (stage-editor tabs 6, workflow
  settings 6, template filter 5, reasoning effort 5, extraction 4, context mode 4, repeats 4, permission mode 4, retention 4,
  Customization 4, agent scope filter 4) and clip at large text; the 236-wide Browser segment will not fit.
- **Build.** MD-47: native segmented control (iOS `Picker(.segmented)`, Android `SingleChoiceSegmentedButtonRow` with ✓, h40);
  selected colours are the system's. Counts are plain label text ("All 48"). The JS fallback (only where a segment needs a second
  style) uses selected `bg-raised` + 1px `border-line` (MD-47).
  - **Max 4 segments** on phones. 5+ options become a `Select` (native pop-up menu button); list **filters** with 5+ options become a
    horizontally scrolling filter-chip row (MDF-21).
  - Any segmented control switches to a `Select` at the large-text threshold (iOS `accessibilityMedium` and above, Android font
    scale ≥ 1.3) or when its measured width exceeds the row.
  - Screen **tabs** are not segmented controls: stage-editor and project tabs use the pane tab strip style (MDF-83, MDF-100).

#### MDF-20 · Switch
Boards: MComponents, MComposerPlus, MAgentPickerCaps, MSetAppearance, MAutomations · inconsistency · M4 · send
- **Problem.** The iOS off-thumb is `$fg` in the catalogue and `$fg-2` with a shadow elsewhere, and renders dark in light mode on
  MSetAppearance; the Android off state is drawn with a 2px `fg-3` outline and 16 thumb.
- **Build.** MD-48: native switch; only the on colour is ours (`onTintColor` / `checkedTrackColor` = `accent`, Android checked thumb
  `on-accent` with the ✓ icon). Off-state colours are the system's. A switch inside a tappable row has its own hit area and the row
  exposes an "Enable/Disable" accessibility action (MDF-91). Locked switches are not drawn as disabled switches: they are a read-only
  value with a `lock` glyph ("On · can't be turned off").

#### MDF-21 · Single choice, multi choice and filter chips
Boards: MModelPicker, MAgentPicker, MAgentNew, MSetPairDevice, MAutomationCreate1, MWorkflowNew, MWorkflowNewBasics, MWorkflowLaunchAdvanced, MSetSecurityMore, MStagePolicyMore, MShortcuts · inconsistency · M4 · send
- **Problem.** Android single choice is a radio in the model picker and a trailing ✓ in the agent picker; iOS uses trailing ✓ in some
  places and a filled check circle (not a stock control) in MAgentNew; iOS multi-select chips in MStagePolicyMore have no check and
  look the same selected and unselected.
- **Build.** MD-49: single choice = iOS trailing ✓ 18 on a `bg-selected` row; Android leading M3 radio 20. Multi choice = iOS leading
  check circle 22 (filled `accent` + ✓ `on-accent`; unselected 1.5px `border-line-strong` ring); Android checkbox in a 48 hit area.
  Filter chips (`Chip` toggle): selected = `bg-selected` + leading ✓ 16 on **both** OSes, `accessibilityState.selected`.

#### MDF-22 · Chips and badges geometry
Boards: MComponents, MComposerInput, MNewChatMore, MSearch, MChatWorkflowRun, MSkillDetail, MScriptDetail · inconsistency · M4 · send
- **Problem.** Chips mix r16/r12/r8/r6; the attachment chip is h36 r12 (iOS) / h40 r8; tag chips have 14 ✕; the search palette uses
  desktop `.bdg` sizes; mono branch chips h22 r6/r4; status badges h24 (iOS) / h26 (Android).
- **Build.** 03 tokens: `Chip` `h-chip` 32, `rounded-control-sm` (iOS 16 / Android 8), 13/500 iOS / 14/500 Android, hit 44/48 (MD-02). `Badge` and
  `StatusBadge` per MD-64 (iOS h24 pill, Android h26 r8; `sm` h20 in dense rows). The branch "chip" is a mono `Badge` (`sm`), not a chip.
  Attachment chip: h40, `rounded-control` (12 / 8), `bg-sunken` + 1px `border-line`, thumb 28 / 32, filename 14, remove glyph 14 with a
  44/48 hit frame anchored at the chip's corner (it may extend outside the chip, MD-91). Tag and input chips: `Chip` with a trailing ✕ in the same hit rule.

#### MDF-23 · Lists, rows, section headers and the Android card rule
Boards: MChats, MHome, MSearch, MServers, MSettings(More), MSet*, MAgentDetail, MAgentEdit1, MSetProviders, MPaneOpen, MAutomations · inconsistency · M4 (M4-07) · send
- **Problem.** Row heights vary (iOS 44/48/56/62/68/72; Android 52/56/64/68/72); iOS group headers are 15/600 `fg` on settings and
  13/600 `fg-3` on lists; Android settings-root headers are indented 56 dp while detail headers use 16; Android is flat for most lists
  but carded for the agent capability card, agent-editor field groups, provider cards and MCP setup; the server switcher's iOS group
  uses a `selected` fill.
- **Build.** 03 tokens + MD-59 + MD-68:
  - iOS: inset grouped `ListSection` (`bg-raised`, `rounded-group` 22, margin 16, `border-line-soft` separators inset to the text);
    Android: flat full-bleed rows, 16 dp gutters, inset dividers only after a leading icon (56 dp), full-bleed dividers between sections.
  - Heights (MD-59): `min-h-row` 52/56, `min-h-row-2` 68/72, `min-h-item` 44/48 (dense rows), `min-h-step` 44/48 (tool steps).
  - Section headers (MD-68): iOS 15/600 `text-fg` inside grouped settings, 13/600 `text-fg-3` for list-section labels; Android
    14/600 `text-fg-2`, start padding 16 everywhere (the 56 dp root indent is dropped). Screen-level section titles (Home "Needs you",
    detail "Recent runs") use `headline`.
  - Chevrons on iOS only. Selected rows use `bg-selected`; the current server row uses ✓ only (no fill).
  - **Android card rule:** lists are flat; composite content is carded (`bg-raised`, `rounded-group` 16): gate/tool/run cards,
    provider cards, capability summary, stat strips, widget preview, code/log blocks. Form field groups (agent editor) are flat.

#### MDF-24 · Row swipe actions
Boards: MComponents, MChats, MGestures, MWorkflows · inconsistency · M4 (SwipeRow), M6-01 · send
- **Problem.** Android row swipe is one full-bleed Archive in MComponents and two pill buttons in MChats; iOS leading actions (Pin,
  Mark unread) are drawn only in MGestures; MWorkflows' swipe "Run" is ink-filled and a full swipe could start a run.
- **Build.** MD-52: iOS full-height tiles — trailing More (`bg-line-strong`) and Archive (`bg-fg-2` + `text-surface`) 74 wide each; leading Pin /
  Mark unread 64 wide each, only when their API exists (MG-02, MDF-45); Android two 74-wide pill buttons (`controls.swipeAction.trailing`),
  radius 16, inset 4 top and bottom, end 8; the row slides with end radius 16 and a 1px `border-line-soft`. A full
  swipe performs only the reversible action (Archive, with an undo snackbar, MD-26). Never Approve, Delete or Run on a full swipe;
  the workflow "Run" swipe tile is neutral (`bg-line-strong`) and opens the Run sheet. Every swipe action is also a menu item and an
  accessibility action.

#### MDF-25 · Text fields, selects and steppers
Boards: MNewChat, MPairing, MScopeRequest, MPaneCommit, MProjectCreate, MAddCodebase, MSetMcpAdd, MSetSourceControl, MShortcuts, MWorkflowLaunch, MAutomationCreate3 · inconsistency / platform · M4 (M4-04) · send
- **Problem.** Android fields are outlined r4 on some boards and r8 on settings boards; the share target mixes a filled field (Agent) and
  an outlined field (Note) in one form; steppers are a joined pill (iOS) and two circular buttons (Android) in different sizes; the
  retention control is segmented in one place and a select in another.
- **Build.** `Input` (03 tokens): iOS form rows inside a group (`h-field` 44, label over value or 96-wide leading label); Android M3
  outlined field h56 `rounded-field` 4, floating label, focused 2px `border-focus`. One style per form; no filled Android fields (a
  read-only value such as the share-target agent is a `ListRow`, not a field). Secrets: `secureTextEntry`, `textContentType="none"`,
  reveal toggle. `Select` is a native pop-up menu button (iOS ⇅ value row; Android exposed dropdown). `Stepper`: iOS joined −/+
  pill 94×32 `bg-selected` with 44 hit per half; Android two 40 outlined icon buttons (48 hit) around the value. Four-plus fixed
  options (retention, repeats) are a `Select` everywhere (MDF-19).

#### MDF-26 · Sheets
Boards: MComponents, MServers, MModelPicker, MAgentPicker(Caps), MAgentNew, MAddCodebase, MPaneCommit, MCodebase(Files/Logs), MSetGeneral, MSetExtensions, MWorkflowLaunch*, MBuilderGraph/Loop, MWorkflowValidate · inconsistency / platform · M4 (M4-06) · send
- **Problem.** The iOS close ✕ is on the left in some sheets and on the right in MServers; Android sometimes has no close; primary
  actions sit in the header on some sheets (MAgentNew "Continue", MModelPicker "Done") and in a footer on others (Add codebase, Use
  Bug Fixer); the catalogue's "Turn setup" sheet rows are 40/44 with a 32 close; Android stacks a second sheet with two scrims.
- **Build.** `Sheet` (route `formSheet` or TrueSheet, MD-21):
  - iOS: system sheet, grabber and radius; header h56 with **leading** ✕ (44, system glass), centred `headline` title (+ 12
    subtitle), at most one trailing **text** action ("Done" on a selection sheet, "Reset" on an in-sheet page). Android: M3 modal bottom
    sheet, drag handle, `title` start-aligned, trailing ✕ 48 when the sheet opens at the large detent or holds a form.
  - **Primary action (MD-85):** action sheets, forms included, pin one full-width `lg` primary to the sheet bottom (`SheetFooter`,
    keyboard-aware) and carry no header confirm (Add codebase, Commit, Use agent, Continue, Import, Request access, MCP setup Save,
    Run, Run script, Create chat). Exceptions: selection sheets apply on tap and close with the header "Done" (Turn sheet, model
    picker, server switcher).
  - Nested pages swap content inside the same sheet with a back button in the header, on both OSes (MD-62); never a second sheet.
  - A dirty sheet asks before dismissing (drag, ✕ or back): AlertDialog "Discard changes?" with destructive "Discard".
  - Detents: pickers, Turn sheet, run sheet, commit, approval, New chat → large; option lists and confirm sheets → content height.

#### MDF-27 · Full-screen modal header
Boards: MNewChat, MWorkflowNew(Basics), MAutomationCreate1–4, MProjectCreate, MAgentEdit1–3, MSetMcpAdd, MBuilderList · conflict / inconsistency · M4 (M4-06 FullScreenEditor) · send
- **Problem.** MPrinciples says full-screen modals put Cancel and Save in the header with no swipe dismiss, but boards draw ✕ plus a
  bottom primary (New workflow), ✕ plus a header ink capsule (New project), or a pushed back chevron plus Save (agent editor, MCP add,
  builder).
- **Build.** `FullScreenEditor` (MD-21): iOS leading glass ✕ (label "Cancel") and trailing glass text button 17/600 `text-fg`
  ("Save", "Create", "Add"); Android leading ✕ 48, `title` start, trailing text button 14/600. No filled button in the header and no
  bottom primary (a wizard's Continue footer is the only exception, MDF-93). Swipe-to-dismiss off; back/✕ with unsaved changes asks
  "Discard changes?". The confirm is disabled with an inline reason until the form is valid.

#### MDF-28 · Menus
Boards: MComponents, MGestures, MPaneChanges, MPaneFiles, MAutomations, MProjects, MAgents, MWorkflowDetailMore, MWorkflowRunMenu, MRunStageChat · inconsistency / platform · M4 (M4-05) · send
- **Problem.** Menus mix glass and opaque styles, put destructive items mid-menu (run menu "Cancel run…"), exceed three groups
  (stage menu: 10 items, 4 groups, with an inline nested "Retry ▸"), and show engine words (`drain`, `interrupt`, `fork`) as hints.
- **Build.** Native `Menu` / `ContextMenu` (MD-16): iOS UIMenu (pull-down from ⋯, context menu with preview on long-press), Android
  M3 DropdownMenu. At most three groups; destructive items last with the destructive attribute; real submenus for nested choices;
  icons trailing on iOS and leading on Android (system). Items are enabled/hidden from server state (never a no-op item). Engine words
  never appear in labels or accessibility names.

#### MDF-29 · Confirmations: alert vs confirm sheet
Boards: MComponents, MProjectSettings, MAgentDelete, MCodebase, MSetStorage · inconsistency · M4 · send
- **Problem.** Some destructive confirmations are alerts, one is a bottom sheet with a list; alerts carry impact boxes that native
  alerts cannot hold; verbs differ between the trigger and the confirm ("Clean up now" → "Delete").
- **Build.** Yes/no confirmations use the native `AlertDialog` (MP-29: title, one-sentence body, Cancel + destructive button); impact
  counts and sizes ("23 workspaces · 4.2 GB", "3 chats and 2 workflows use it") go in its `impact` lines. A confirmation that lists
  items one by one (worktrees with their sizes) uses a confirm sheet (imperative TrueSheet, content detent; `CleanupConfirmSheet` in
  `03-components.md`): leading glyph in a `bg-selected` circle, `title`, body, an impact list (`bg-sunken`, `rounded-code`, key–value
  rows), footer Cancel (secondary) + destructive (MDF-03) side by side at `lg`. The confirm button repeats the trigger's verb
  ("Clean up", "Remove", "Disable agent").

#### MDF-30 · Toasts and snackbars
Boards: MComponents, MGestures · conflict / missing-state · M4 · send
- **Problem.** Mobile draws undo toasts ("Chat archived · Undo"), which desktop D-30 forbids; swipe-to-dismiss and placement are not
  drawn; copy/success feedback relies on toasts.
- **Build.** MD-26 + MD-58: toasts for errors, background completions and undo of reversible destructive actions only.
  Bottom-centred, 16 above the safe area or above the composer/NewAction; one at a time; 4 s (errors 6 s, undo 5 s); iOS glass capsule
  `h-toast` 48, `rounded-toast` 24; Android inverse snackbar `h-toast` 48, `rounded-toast` 8; swipe down (iOS) / sideways (Android) dismisses; announced to screen
  readers. Copy confirmations swap the button label to "Copied" for 1.5 s (Android 13+ also shows the system clipboard chip).

#### MDF-31 · Gate card and transcript card shells
Boards: Main, MComponents, MChatWorkflowRun, MRunStageChat, MChatRunning, MChatToolsExpanded · inconsistency · M4, M6-03 · send
- **Problem.** The permission gate is r20 `raised` with a `line` border (Main); the run approval card is r14 with no fill and
  `line-soft` (MChatWorkflowRun); the catalogue says "radius 14 / 12" but draws 20 / 16; three decision buttons (Reject, Request
  changes, Approve) wrap on a 402 phone.
- **Build.** MD-50: one `GateCard` shell for every gate (permission, question, plan, computer consent, workflow review/decision):
  1px `border-line`, `rounded-card-lg` 20/16, `bg-raised`, header h40/h44 on `bg-warn-bg` (the MD-25 exception) with `hand` glyph, title
  15/600 (iOS) / 16/600, trailing meta 12 `text-fg-3`. Tool blocks, background-task, run and draft cards share `rounded-card` 14/12
  with 1px `border-line-soft` and no fill. Action row: text/tertiary at start, primary at end; when the row does not fit (content width
  < 360 or large text) the actions stack full-width, primary first.

#### MDF-32 · Empty state and skeleton
Boards: MComponents, MWidgets (only drawn empty state) · missing-state · M4 (M4-09) · send
- **Problem.** Only the catalogue and the small widget draw an empty state; the skeleton has no timing rule.
- **Build.** `EmptyState`: centred glyph 28 `text-fg-3`, `headline` title, body `text-fg-2` max-w 280, at most one secondary action;
  copy from `EMPTY_STATE_COPY` (group N). `Skeleton`: static `bg-selected` blocks matching the row geometry, shown only after 300 ms,
  no shimmer (D-20, DF-14). Error, offline and permission variants per group N recipes.

### C. Shell and navigation

MDF-01 was assigned by `01-decisions.md` MD-18 and opens this group; every other id runs in group order.

#### MDF-01 · Chat header shows the sidebar toggle instead of back
Boards: Main, MChatRunning, MChatToolsExpanded, MChatNoAgent, MModelPicker, MComposer*, MChatWorkflowRun, MRunStageChat, MComponents (Chat header), MGestures · conflict · M5 (M5-04), M6-06 · send
- **Problem.** Every chat board puts the glass sidebar toggle top-left over a `Chats › <project>` breadcrumb. Principle 3 and the
  owner's rule say detail screens, a chat included, show Back; MGestures then has to call the left edge "back or sidebar".
- **Build.** MD-18: the chat (and a run, and a stage chat) is a **detail** screen: back + breadcrumb + title + status line + pane
  toggle with count + ⋯. The left edge on iOS is the native back swipe (MD-19). Breadcrumb `Chats › <project>`: "Chats" pops to the
  list; the project segment opens the Chats list filtered by that project (`GET /chats?projectId=`). The back button keeps testID
  `chat-back` (03 §1.5). Opening a chat from the drawer, Home, a notification or search builds the stack `[Chats, Chat]` so back always
  lands on the Chats list (MDF-35).

#### MDF-33 · Drawer gestures per OS
Boards: MGestures, MSidebar, MPrinciples · platform / conflict · M5 (M5-02) · send
- **Problem.** The left-edge swipe opens the drawer on Android top-level screens, but Android gesture navigation owns both edges for
  system back (the same board uses that fact to justify "no edge opens the pane"); on chat the left edge is ambiguous.
- **Build.** MD-19: iOS left-edge swipe opens the drawer **only on root screens** (module roots); on detail screens it is the native
  back swipe. Android opens the drawer and the pane **by button only**. Both close by dragging inside them, tapping the scrim or
  Back/Escape; horizontal scrollers (code, diff, terminal) block the panel pan; a focused terminal or WebView disables edge-open.

#### MDF-34 · Back behaviour, predictive back and top-level back
Boards: MGestures, MPrinciples, MComponents · platform / missing-state · M5 (M5-04) · no
- **Problem.** Android is drawn with a predictive-back peek (22×40 chevron); the order in which Back closes layers and what Back does
  on a top-level module are not specified.
- **Build.** MD-20: predictive back is off (standard back animation) until react-native-screens 5 animates it. Back closes, in order:
  open menu → sheet (dirty guard) → pane (an in-tab page first, MD-23) → drawer → pops the stack. On a top-level module other than
  Home, Back goes to Home; on Home it leaves the app (Android) and does nothing on iOS.

#### MDF-35 · Module stacks and breadcrumbs
Boards: MPrinciples, MFoundations, MChatStepDetail, MSkillDetail, MWorkflowSettings, MStagePrompt, MRunStageChat · conflict / inconsistency · M5 (M5-01, M5-04) · send
- **Problem.** MPrinciples promises "the module keeps its stack" across drawer switches, which one native Stack (MD-18) cannot do;
  breadcrumb segments that are not ancestors ("Step 4 of 6", the "Customization" tab) are drawn as segments; stage-editor and workflow
  settings breadcrumbs omit the "Edit workflow" level; long paths collapse "…" without a rule for tapping it.
- **Build.** One stack (MD-18). Switching modules from the drawer **resets** the stack to that module's root (scroll position of the
  root list is restored from memory). Any deep entry (drawer rows, Home, notifications, search, links) builds the IA ancestors so back
  and the breadcrumb work. Breadcrumb rules (`Breadcrumb`, 12/500 `text-fg-3`, chevron separators): only real ancestors; every
  segment pops to (or rebuilds) that level; a tab segment opens the parent on that tab (`Customization` → project on the
  Customization tab); positional text ("Step 4 of 6", "1 of 4") moves to the subtitle; more than 3 segments collapse the middle into
  "…", which opens a menu of the hidden ancestors. Inside the builder the chain is `Workflows › <workflow> › Edit workflow`.

#### MDF-36 · Headers per OS
Boards: MFoundations, MComponents, MHome, MHomeMore, MChats, MSettings(More), MBuilderList, MProjectDetail, MScriptDetail, MNewChat · platform / inconsistency · M5 (M5-04), M4-08 · send
- **Problem.** The foundations rule says Android top-level titles are 22/600 in the bar, but MHome draws a 28/600 Headline M below the
  bar that collapses (the M3 medium flexible app bar; kept for Home only, MD-94); iOS large titles carry a mono count ("Chats 48") that a native large title cannot
  style; MSettingsMore keeps the large title while scrolled; MHomeMore draws iOS glass buttons over scrolled content with no scroll-edge
  effect; the Android builder header has 3 action icons (rule: 2 + overflow); the script detail title is mono 14/600 (smaller than the
  16 detail title); the New chat modal title is 16/600 instead of the iOS modal 17/600.
- **Build.** `Header` (ML-02, M4-08):
  - **iOS:** native stack header. Top-level = native large title (32/600 in the system font, MD-74) that collapses to a centred
    `headline` title with the system scroll-edge effect; detail = native back + custom title view (breadcrumb 12 over `detailTitle`
    16/600); trailing items native, ≤ 3 (the system groups them in a glass capsule). Modal/sheet titles `headline` 17/600.
  - **Android:** JS M3 top app bar (MD-16). Top-level = the title in the bar (`title` 22/600, MD-18); Home alone uses the medium
    flexible bar (expanded 112 with `largeTitle` 28/600, collapsed 64 with `title` 22/600, MD-94); scrolled-under `bg-raised`;
    detail = small bar 64 with back, breadcrumb 12 over
    `detailTitle` 18/600; ≤ 2 action icons + overflow ⋮.
  - Counts leave the titles (they live in the filter segments, "All 48"), on both OSes.
  - Entity titles that are file names use mono at the `detailTitle` size (16 iOS / 18 Android), truncating the middle.
  - Builder header: Undo, Redo + overflow (Version history, Workflow settings) on Android; iOS ≤ 3 trailing items.

#### MDF-37 · Presentation of each kind of screen
Boards: MPrinciples, MNewChat, MBuilderList, MAgentEdit1, MSetMcpAdd, MRunApproval, MAutomationExecution, MScopeRequest, MWorkflowNew, MProjectCreate, MAgentImport, MRunGraph, MSearch · conflict · M5 (M5-01) · send
- **Problem.** MPrinciples' IA and the boards disagree: New chat is a sheet in the IA but a full-screen modal on the board; the builder,
  agent editor and MCP add are full-screen modals in the IA but drawn pushed; the run approval is a sheet in the IA but drawn pushed;
  the execution detail is drawn pushed; Import agent is a page sheet on iOS and a full-screen dialog on Android.
- **Build.** MD-21 is canonical; the boards' layouts are kept inside the MD-21 container:

  | Screen | Build as | Board drew |
  |---|---|---|
  | New chat | route sheet, large detent | full-screen modal |
  | Turn sheet, model/agent pickers opened from a screen, run sheet, commit & PR, approval, server switcher, execution detail, scope request | route sheet (a picker opened inside a sheet is a page of that sheet, MD-62) | mixed (approval and execution pushed) |
  | Agent editor, MCP add, automation wizard, builder, stage editor, project create, new workflow | full-screen modal (MDF-27) | several pushed |
  | Import agent | route sheet, large detent, both OSes | page sheet / full-screen dialog |
  | Runtime graph, step detail, diff, file preview, detail screens | pushed | pushed |
  | Search palette | full-screen modal (iOS) / M3 full-screen search view (Android) | as drawn |
  | Workspace pane, run pane | right `SidePanel` | as drawn |

#### MDF-38 · Drawer content and states
Boards: MSidebar, MSidebarChats, MTabletAndroid · missing-state / a11y · M5 (M5-02) · send
- **Problem.** Only the connected state with ≤ 3 items per list is drawn: no empty Needs you/Running, no overflow rule, no
  disconnected/reconnecting footer, no long server name; live rows are 40 (36 on the Android tablet), the Android "New chat" button 44;
  the Needs-you rows keep r12 on Android beside pill nav items; running titles are `fg-2` without a stated reason.
- **Build.** `Drawer` (ML-06, M5-02):
  - widths `w-drawer` 318 / 336 capped at 79 % (iOS) / 82 % (Android) of the window; nav items `min-h-nav` 44/48 with `rounded-nav` (iOS 12,
    Android pill; MD-02, MD-59); live rows `min-h-item` 44/48 with the same radius as the nav items on each OS; icon buttons 44/48.
  - Needs you and Running show at most 5 rows each, then "Show all (n)": Needs you opens `/needs-you` (the full list), Running opens Home
    scrolled to its Running section (`04-screen-map.md` MSidebar); an empty list hides its section (the counts row on Home carries the zero).
  - Footer: `HEALTH.connection` dot + word ("Connected", "Reconnecting", "Disconnected") + mono address; disconnected shows a "Retry"
    text button. Server names truncate in the middle.
  - Running titles use `text-fg-2` deliberately (lower emphasis than asks); state it in the component story.

#### MDF-39 · Home
Boards: MHome, MHomeMore · a11y / missing-state / no-API / copy · M7 (M7-01) · send
- **Problem.** Count tiles colour the number by status with no glyph; "Need you" (tile) vs "Needs you" (section); Review/Open pills 34;
  the FAB overlaps the last Running row; the Android running timer (`run`) and clock time (`fg-3`) share one slot; "This week" shows an
  average run time with no week definition; "Recently finished" shows "PR #1176 opened" (PR items deferred, D-58); only the
  populated state is drawn.
- **Build.**
  - Tiles: glyph 16 + word ("Needs you", "Running", "Finished today") + value `title` 20/22 with tabular numerals (MD-71; board 24) in `text-fg`; the tile links to its section. Counts
    come from the attention store; "Finished today" from `activity.recent` filtered to today, rendered only once loaded (no zeros).
  - Section headers "Needs you", "Running", "Recently finished" (`headline`); row action `Button sm` "Review" on asks — workflow and chat
    gates alike open the approval sheet (`routeForAttention(item, {prefer: 'sheet'})`, MD-21, MDF-72) — and "Open" on running and
    finished rows. Inline Allow / Approve stays on desktop.
  - Running rows: spinner glyph + mono elapsed in `text-fg-2`; finished rows: outcome glyph + clock time `text-fg-3`.
  - "This week" (`stats.summary` for the ISO week, MD-84): Chats, Runs, Succeeded %, Avg run (`runs.avgDurationMs` exists,
    `05-gap-matrix.md` NG-03); a rate or average with a zero denominator is omitted, never shown as "—" (D-58).
  - Recently finished renders only item kinds the API returns (PR and commit outcomes once MG-13 lands; built in M7-09).
  - NewAction content inset (MDF-17); empty, loading, offline and error states per group N; subtitle connection state from
    `HEALTH.connection`.

#### MDF-40 · Pane tab set, instances and switching
Boards: MPaneOpen, MPaneTabsOverview, MAudit, MPaneTerminal, MPaneBrowser, MTabletAndroid · conflict / inconsistency · M5 (M5-03) · send
- **Problem.** Every pane board shows all seven tabs in every chat, although MPaneTabsOverview itself says Tasks appears "only on
  those chats"; MAudit lists five tabs; switching is "tap or swipe the pane body", which collides with drag-to-close and with every
  horizontally scrolling body; instances (Terminal 2, a second browser page) are chips inside the tab, unlike desktop.
- **Build.** MD-23: pinned Changes, Files, Terminal, Browser always; Tasks (orchestrator chats), Computer (computer use enabled) and
  Plan (a plan exists) only when they apply (`DOCK_PINNED_TABS`, `DOCK_CONDITIONAL_TABS`). Extra terminals and browser pages are
  chips inside their tab, capped by `DOCK_TAB_CAPS` (terminal 4, browser 5). Tab switching is **tap only**; the row scrolls to keep
  the active tab visible. Drag-to-close works from the pane header or a 24 pt edge band. Tab ids from `ui-contract/pane.ts`; tab testIDs
  `pane-tab-<DockTabType>`.

#### MDF-41 · Pane toggle count and attention dot
Boards: Main, MChatRunning, MChatWorkflowRun, MComponents, MPaneTabsOverview, MTabletIOS · inconsistency / a11y · M5 (M5-03) · send
- **Problem.** The pane-toggle badge counts changes on one board, running background tasks on another (turning `run` blue) and tasks
  on a third; its text is mono 10–11; needs-you dots on Plan/Computer never reach the header toggle.
- **Build.** MD-23: the badge is always the **number of changed files** (MP-09 `Count` bubble: neutral `bg-fg` / `text-surface`, mono 12,
  min-w 16, h16, pill), hidden at 0; a separate 8 pt `bg-warn` dot with a 1.5 pt `surface` ring shows when Plan or Computer needs the user. Task counts
  live on the Tasks tab only. Accessible name: "Open workspace pane, 2 changes" (+ ", needs you"); on tablets with the pane docked the
  toggle is selected and reads "Hide workspace pane…". testID `pane-toggle`.

#### MDF-42 · Pane full screen, pushed screens, sheets and in-tab pages
Boards: MPaneChanges, MPaneDiff, MPaneFilePreview, MPaneCommit, MPaneTaskDetail, MTabletIOS, MTabletAndroid · missing-state / inconsistency · M5 (M5-03), M6 · send
- **Problem.** Full screen is drawn on phones only; where Diff, File preview and the Commit sheet go when the pane is a docked tablet
  column is undefined; back from an in-tab page (Tasks → task detail) vs closing the pane is undefined; the Android pane header is 52 on
  every pane board against the 64 rule.
- **Build.**
  - Pane header `h-panel-bar` 52 on both OSes (MD-54; a panel bar, not a top app bar); its buttons are `IconButton` `md`
    (`size-icon-button` 44 / 48, MD-54, MD-91).
  - Full screen keeps the tab; header becomes back chevron "Back to chat" + title + "Exit full screen"; the tab row stays.
  - Phones: Diff and File preview push onto the root stack above the chat (the pane stays mounted and reopens on back); sheets are
    root-level route sheets.
  - Tablets ≥ 840 (docked): Diff and File preview are real router pushes that replace the chat column while the pane stays docked
    beside them (`04-screen-map.md` §2.10, `03-components.md` ML-07); "Open full screen" widens the pane over the chat column (a pane
    mode, MD-82; D-65 maximise); sheets present as form sheets over the window.
  - In-tab pages (task detail) are popped first by Back, then the pane closes (MD-23).

#### MDF-43 · Gestures and their button equivalents
Boards: MGestures, MComponents, MChats, MPaneDiff, MPanePlan, MBuilderList · inconsistency / missing-state · M4, M5 · send
- **Problem.** Long-press is drawn as both "open a menu" and "multi-select"; iOS pull-to-refresh, toast swipe-dismiss, the attachment
  long-press, Android row swipe and tablet keyboard shortcuts are missing from the gestures board; several gestures lack their promised
  button (diff "Comment", builder "Move up/down", plan step comment).
- **Build.** Long-press always opens the menu; multi-select starts only from a header "Select" action (MD-60). Pull-to-refresh (native
  `RefreshControl`) on both OSes for non-live lists and Home; never on the transcript. Toast swipe per MDF-30. Every gesture has a
  visible button or menu item and an accessibility action (MD-28): diff → "Comment" toolbar button (MDF-61), reorder → "Move up/down"
  menu items (MDF-71), plan → step "Comment" action (MDF-66), swipe → menu items (MDF-24). Keyboard shortcuts per MDF-135.

#### MDF-44 · Search palette
Boards: MSearch, MSidebar · a11y / missing-state / copy · M5 (M5-06) · send
- **Problem.** Weight 700 highlights (MDF-09); 20×20 clear; recent-chat rows lead with a chat icon instead of the status glyph; desktop
  `.bdg` sizes; "Toggle theme · Dark → Light" although mobile follows the system mode; empty query, no results, searching and offline are
  not drawn.
- **Build.** iOS: full-screen modal with `SearchInput` (MDF-18) + glass ✕ 44; Android: M3 search view header h72 (back 48, query 18,
  clear 48). Groups from `COMMANDS`, `NAV_DESTINATIONS` and `GET /search` (G-18). Chat and run rows lead with their status glyph and
  carry `StatusBadge sm`. The theme action is the shared `theme.toggle` command, labelled "Toggle theme": on mobile it cycles System →
  Light → Dark and its row names the next mode (`03-components.md` MB-21; desktop parity with the shared command registry). States:
  empty query → Recents + Actions; searching → inline spinner row after 300 ms; no results → `EMPTY_STATE_COPY.searchResults`;
  offline → local actions and cached recents only, with a note "Server search is unavailable offline". Hardware keyboard ↑/↓/Enter
  moves the `bg-selected` row.

#### MDF-45 · Chats list header, filters and new row fields
Boards: MChats, MComponents, MSidebarChats · inconsistency / no-API / missing-state · M6 (M6-01) · send
- **Problem.** Header actions are Search + Filter in the catalogue and Select + Sort & more on the screen board; the list shows a
  Pinned section, a pin glyph, "Mark unread" and model names on agent-less rows, none of which `ChatRowModel` carries; the iOS search is
  38 tall with 17 text; the unread visual, selection mode, archived rows and search results are not drawn.
- **Build.** MD-53: header Select (testID `chats-select`) + "Sort and more" menu; `SearchInput` in content; segments All / Active /
  Archived from `counts`. Pinned section, pin glyph, Pin / Mark unread actions and the unread dot are **not rendered until** MG-02
  lands (*now*, built in M2-10); the model name on agent-less rows likewise waits for MG-03 (the row shows only the project). Selection mode: header "Cancel" + "n selected", `BulkActionBar` Archive / Delete (D-52 bulk endpoints; Delete
  confirms). Archived rows show an "Archived" neutral badge and "Unarchive" in their menu.

### D. Chat and composer

#### MDF-46 · Composer states
Boards: MComponents, Main, MChatRunning, MChatNoAgent, MRunStageChat · conflict / inconsistency · M6 (M6-04) · send
- **Problem.** Send is drawn disabled when empty in the catalogue but enabled (ink) on every chat board; Main shows an ink Send while a
  permission gate blocks; the catalogue's running placeholder is "Queue a follow-up…" (D-29: no queue) while MChatRunning shows a
  "Working 4:12 · reading Canvas.tsx" strip; Stop-pressed, force reset, prep states and turn errors are not drawn.
- **Build.** MD-03 + `composerMachine` / `ui-contract/composer.ts` (D-61):
  - Idle: Send disabled (`bg-selected`, `text-fg-3`) until there is content; typing is never blocked (D-29).
  - `waiting_on_you`: reason bar above the box ("Answer the permission above to send", `hand` glyph) + "Cancel and send" text button;
    Send disabled.
  - `running`: placeholder "Reply to <agent>…" / "Message <model>…" (never "Queue…"); Send becomes Stop; the status strip shows
    spinner + "Working" + mono elapsed + current step verb and target from the live transcript (± only when changes exist).
  - `stopping`: Stop inert for 400 ms, label "Stopping…"; `force_available` after 15 s: "Force reset".
  - `preparing` / `prep_failed` bars per the contract (Retry / Edit sources).

#### MDF-47 · Composer layout and chips
Boards: MComponents, Main, MChatRunning, MChatNoAgent, MComposer* · inconsistency / a11y · M6 (M6-04) · send
- **Problem.** The Android mic sits in the text row in the catalogue and in the action row on screens (and disappears in typing/running);
  the Android waiting state drops the agent chip; iOS controls are 34 with Mic–Send 4 apart; the agent chip's lock does nothing.
- **Build.** MD-03: iOS glass capsule `rounded-composer` 28, Android `bg-raised` + 1px `border-line-soft`. Action row: Attach (+,
  testID `composer-options`) · agent chip (bot + name + lock, locked once the chat is bound; tap shows a popover "Fixed for this chat.
  Start a new chat to change the agent.") · model chip (testID `composer-model`, opens the Turn sheet) · spacer · Mic · Send/Stop.
  Mic is in the action row on Android in every state; both chips show in every state. Sizes per MD-56.

#### MDF-48 · Turn sheet ("Next turn")
Boards: MModelPicker, MComponents, MSetGeneral · inconsistency / conflict / platform · M6 (M6-04) · send
- **Problem.** Two definitions ("Turn setup" rows in the catalogue vs "Next turn" with provider, model list, mode, effort, context and
  a gauge); an ink "Done"; a two-segment provider switch although the server has five providers; model rows 42 with 16 info buttons;
  Effort and Context use left labels while other sections use headers; mid-chat provider change is unspecified; loading, unavailable
  model, no models and dirty close are not drawn.
- **Build.** MD-03: build `MModelPicker` only; "Turn setup" is not built.
  - Header: ✕ per MDF-26 (iOS start, Android end), title "Next turn", trailing text "Done" (a selection sheet, MD-85); choices apply to
    the next turn.
  - Provider: a `Select` listing ready providers first from `buildModelPickerCatalog` (D-55); unready providers show a lock and
    "Sign in from Settings" (MD-35). What may change mid-chat follows the desktop `blocks/model-picker` exactly.
  - Model list: tier headers, rows `min-h-row` 52/56, single choice per MDF-21, mono context size; the info button has a 44/48 hit
    area and opens model details inside the sheet.
  - Mode (Auto / Plan) segmented; Effort from the model's supported levels (Select when > 4, MDF-19); Context tier segmented;
    every section uses a section header. Context usage row → breakdown page inside the sheet. testID `composer-mode` on Mode.
  - States: catalogue loading (skeleton rows), selected model unavailable (inline Callout + keep the previous), no ready provider
    (EmptyState "No model provider is ready" + "Open Settings").

#### MDF-49 · Permission, question and plan gate cards
Boards: Main, MComponents, MModelPicker (resolved row) · conflict / missing-state / no-API · M6 (M6-03) · send
- **Problem.** "Always allow" (Main) vs "Always allow in this chat" (catalogue) — the gate contract has no such action; the category
  label "Network" has no stated source; denied, expired and "answered on another device" are not drawn.
- **Build.** MD-55 + `PERMISSION_GATE_COPY` / `QUESTION_GATE_COPY` / `PLAN_GATE_COPY`: only Allow once and Deny (with the two-step
  "Confirm deny" + optional reason). "Always allow" is not rendered until the server exposes it (MG-38, MD-55). The category shows only when the gate
  payload carries one. Resolved states use the copy's titles ("Allowed", "Denied", "Permission request expired"); an ask answered
  elsewhere simply resolves via SSE (no device name). Risky permissions (shell, network, git push until the server flag lands) require
  the biometric-signed approval (MD-31). Plan "Review plan" opens the pane Plan tab (MDF-66), not a separate sheet.

#### MDF-50 · Tool block and step detail
Boards: MComponents, MChatToolsExpanded, MChatStepDetail · a11y / inconsistency / missing-state · M6 (M6-02) · send
- **Problem.** Expanded step rows are 38 in the catalogue and 44/48 on screens; step-detail nav buttons are 38 wide; "Open in Terminal"
  is an extra ink button (fine under MD-22 if alone); "Step 4 of 6" is drawn as a breadcrumb segment with no destination; the step
  shows "payments-api" while the chat breadcrumb says "payments-service" with no level label; running, succeeded, Read and Edited
  step details are not drawn.
- **Build.** Step rows `min-h-step` 44/48, tappable to the step detail. Step detail: breadcrumb `Chats › <chat>`, title = verb +
  target, subtitle "Step 4 of 6"; the codebase is labelled ("Codebase payments-api · fix/checkout-flake"). Bottom toolbar: iOS glass
  floating toolbar with ↑/↓ (44 each) + Copy (secondary) + "Open in Terminal" (the screen's one primary; subject to the terminal step-up);
  Android bottom app bar h80 with the same actions. States: running (live output tail once MG-37 lands; until then "Output arrives when
  the command finishes"), succeeded, failed; Read steps show a file
  preview excerpt, Edited steps a mini diff with "Open diff" (MDF-61).

#### MDF-51 · Chat extras: changes strip, Latest pill, message menu
Boards: MChatNoAgent, Main, MChatRunning, MAudit · inconsistency / missing-feature · M6 (M6-06) · send
- **Problem.** The composer "changes" strip appears only on the no-agent board (Main has 2 changes and no strip); "↓ Latest" is 40 tall;
  read-aloud, copy and fork (existing features) have no board.
- **Build.** The changes strip (testIDs `changes-tray-toggle`, `changes-tray-review`) shows for **every** chat when the last finished
  turn left ≥ 1 changed file not yet kept or committed, and hides while a turn runs (the status strip takes its place). "↓ Latest": iOS
  glass / Android `bg-overlay` pill h44. The assistant-turn actions button (`assistant-message-actions`) opens a menu: Copy, Read aloud
  (existing TTS), Fork from here (`fork-chat`), Select text.

#### MDF-52 · New chat
Boards: MNewChat, MNewChatMore, MAgentPicker · conflict / inconsistency / missing-state · M6 (M6-05) · send
- **Problem.** Drawn full-screen with ✕ only and a sticky glass bottom bar; "Orchestrate mode" switch duplicates the "An orchestrator"
  segment and the picker's "Orchestrators" section; "Add local folder" suggests a phone folder; the browser segment is 236 wide; tag ✕ 14;
  model-only and orchestrator variants, validation, creating and failure are not drawn.
- **Build.** Route sheet at the large detent (MD-21) with ✕ per MDF-26 and the drawn sticky summary bar as the sheet footer (summary
  "Bug Fixer · Sonnet 5" / "1 worktree and 1 branch will be created" + `lg` primary "Create chat"), riding above the keyboard.
  - "Who works on this": Just a model / An agent / An orchestrator is the only control for the kind; the "Orchestrate mode" switch is
    not built; the agent row opens the picker filtered to Workers or Orchestrators to match.
  - "Add local folder" → "Add server folder", which opens a server folder browser as a page inside the New chat sheet (MD-62;
    `GET /api/fs/dirs`, `apps/server/src/routes/fs.ts`, MG-22 wrapper); paths render verbatim (Windows paths included).
  - Agent, model and project rows open their pickers as pages inside the same sheet (MD-62), never a second sheet.
  - Browser mode is a `Select` at large text (MDF-19). Capabilities row per MDF-53.
  - States: empty task → Create disabled with reason "Describe the task"; creating → button spinner, sheet not dismissible; failure →
    Callout at the top with the server message and "Try again".

#### MDF-53 · Agent picker and per-chat capabilities
Boards: MAgentPicker, MAgentPickerCaps, MNewChatMore, MComposerPlus · conflict / no-API / platform · M6 (M6-05) · send
- **Problem.** "No agent — just a model" duplicates the New chat segment; "Manage" leaves the modal stack and risks the draft; Android
  opens a second sheet with two scrims; per-chat capability overrides ("Customize capabilities", "5 of 8 on", "Changed ↶") have no API;
  it is unclear whether a chat can turn off an agent capability; three names exist for orchestration ("Orchestrate mode",
  "Orchestration", "Let this chat run workflows"); search uses a different style.
- **Build.** Picker: search `SearchInput` (sheet size), scope filter segments, Workers / Orchestrators sections, single choice per
  MDF-21, a "Customize capabilities" row that opens the capabilities page, and one footer `lg` primary "Use <agent>" (MD-85). No
  "No agent" row (the New chat segment covers it) and no "Manage" button. The Customize capabilities page (and New chat's
  Capabilities row) is built on the existing per-chat overrides (`CreateChatParams.agentOverrides`,
  applied at create and frozen at session start, `05-gap-matrix.md` NG-05): it swaps content inside the same sheet (MD-62) and exposes
  only what `AgentOverrides` supports. Naming: "Orchestrator" for the agent role,
  "Workflows" for the composer tool toggle (MDF-54).

#### MDF-54 · Composer "+" menu, suggestions and attachments
Boards: MComposerPlus, MComposerInput · platform / missing-state / copy · M6 (M6-04) · send
- **Problem.** A switch row inside the iOS + menu cannot be built with a native menu; no dismiss scrim; "Commands & skills" vs "Skills &
  commands"; "@" mention suggestions are not drawn; attachment upload progress, failure and oversize are not drawn; ✕ is 14.
- **Build.** Native `Menu` (MD-63): Attach file · Photo library · Camera | Screenshot of browser (only while a browser session exists)
  · Paste from clipboard | Commands & skills (inserts "/") · Mention file (inserts "@") | "Workflows" as a checked item, **rendered only
  when the Workflow Overhaul registers the toggle** (D-66 registry ships empty). Suggestion popover (`bg-overlay`, not glass): "/" and
  "@" share one component, rows `min-h-row` 52/56, keyboard-aware above the IME, hardware ↑/↓/Enter/Tab. Label everywhere: "Commands &
  skills". Attachment chip (MDF-22) states: uploading (progress ring on the thumb), failed (`err` glyph; menu Retry / Remove), too large
  (rejected before upload, chip shows "Too large · max N MB" from the server limit).

#### MDF-55 · Dictation
Boards: MComposerVoice · inconsistency / missing-state · M6 (M6-04) · send
- **Problem.** "Stop dictation and keep text" uses the same filled square as the agent Stop; the ✕ and stop are 34 on iOS; permission
  denied, no speech, recognition error and offline recogniser are not drawn.
- **Build.** MD-57: the keep-text button uses the `check` glyph ("Stop dictation and keep text"); sizes per MD-56. The waveform freezes
  under Reduce Motion; "Listening…" is a polite live region. States: permission denied → inline bar "Microphone access is off" +
  "Open Settings"; no speech → "Didn't catch that" (auto-clears after 3 s); error/offline → inline error with "Try again".

#### MDF-56 · Workflow run, review and draft cards in chat
Boards: MChatWorkflowRun · inconsistency / conflict · M8 (cards registered by the Workflow Overhaul), M6-02 shell · send
- **Problem.** The review card shell differs from the permission card (MDF-31); three decision buttons wrap; the stage bar tints
  segments; "Publish" on the draft card is secondary although it is decisive; compact tool lines are 24 tall.
- **Build.** Run card: `rounded-card`, status badge, stage line, progress segments (MDF-05), "Open run" `sm`. Review card: `GateCard`
  with a single primary "Review" that opens the approval sheet (MDF-72); decisions happen only in the sheet. Draft card: "Open in
  builder" and "Publish" as `sm` secondary (the chat's one primary stays Send); Publish opens the draft's publish confirmation. Compact
  tool lines are `min-h-step` rows that open the step detail. All three render only when the Workflow Overhaul (P06) data exists.

#### MDF-57 · Chat menus
Boards: MComponents, MGestures, MChats · inconsistency / missing-state · M6 (M6-01, M6-06) · send
- **Problem.** The row long-press menu (Pin / Open workspace pane / Archive / Delete) and the chat ⋯ menu (Rename / Share transcript /
  Archive / Delete) are each drawn on one platform only; "Open workspace pane" from a list row has no meaning before the chat opens.
- **Build.** Row menu (both OSes, context menu with preview on iOS): Open · Pin / Mark unread (only with MG-02) · Stop (if
  running) | Archive (undo snackbar) | Delete… (AlertDialog); no "Open workspace pane" on list rows. Chat ⋯ menu: Rename · Copy
  transcript (`copy-transcript`) · Open workspace pane | Archive (undo snackbar) | Delete…. "Fork from here" (`fork-chat`) stays in the
  message and turn menus (MDF-51). Same items, same order, both OSes.

### E. Pane tabs

#### MDF-58 · Keep / Keep all / Undo all, and destructive confirms in the pane
Boards: MPaneOpen, MPaneChanges, MPaneTerminal, MPaneTerminalFull, MTabletIOS · missing-feature / conflict · M6 (M6-07, M6-09) · send
- **Problem.** No board draws Keep, Keep all, Undo all or the Kept group (D-28 / MD-07, supersedes MF-05); "Discard changes" and
  terminal "Kill" have no confirmation although desktop confirms both.
- **Build.** MD-07: Changes list bar "Keep all" / "Undo all" (testIDs `changes-tray-keep-all`, `changes-tray-undo-all`); per-file menu
  Keep / Unkeep (`keep-file`, `unkeep-file`), Undo; a "Kept (n)" group at the end. "Undo all" and "Discard changes" confirm with an
  AlertDialog naming the file count; "Kill" confirms naming the tab/shell only (D-71).

#### MDF-59 · Changes tab body
Boards: MPaneOpen, MTabletIOS, MComponents · inconsistency / missing-state / a11y · M6 (M6-07) · send
- **Problem.** The phone compare control is 2-way (This chat / Branch) and the iPad 3-way; Android "Branch vs main" wraps at 364 dp; the
  footer says "2 files ready" while 5 files are listed (2 in the chat + 3 "also in the workspace"); scrubber labels are mono 11 and the
  last stop "14:05" is ambiguous; "Rewind to here" has no scope choice; header and row buttons are 40/36.
- **Build.** D-68 on mobile: compare segments "This turn / This chat / Branch" everywhere, with the "Compare against" base `Select`
  under Branch (Select at large text, MDF-19). Groups "Changed in this chat" / "Also changed in the workspace" / "Kept". The footer
  counts every uncommitted file in the **target mount** ("5 files ready · into fix/checkout-flake") because commit acts on the mount's
  working tree (MDF-60). Scrubber: labels mono 12; the last stop is labelled "Now"; stops tick with `selection` haptics. "Rewind to here"
  opens a menu All / Conversation only / Code only (testIDs `rewind-sheet-all|conversation|code`) and confirms. Rows `min-h-item`,
  row ⋯ 36/40 drawn with 44/48 hit.

#### MDF-60 · Commit and pull request sheet
Boards: MPaneCommit, MPaneCommitDone, MPaneFiles (2 mounts) · missing-feature / missing-state / inconsistency · M6 (M6-07) · send
- **Problem.** Desktop's Generate (message), push/PR choices and mount picker are missing although two mounts exist; the sheet has both
  a "Commit" button and "Create pull request", with the implicit commit + push undefined; the head branch cannot change; no validation,
  progress, error or partial-success states; the Close button is glass.
- **Build.** D-68 `CommitBar` semantics in a route sheet (MD-21):
  - Mount `Select` (only when > 1 mount), message field + "Generate" text button, "Push" and "Open a pull request" switches; PR fields
    (title, description, base as a text field per D-68, "Open as draft").
  - One `lg` primary whose label follows the switches: "Commit" / "Commit & push" / "Commit, push & open PR" (the desktop `scm/flow`).
  - Progress: the sheet shows the steps Committed → Pushed → PR opened with spinners, not dismissible while running. Partial success
    keeps completed steps ✓ and shows the failing step's error with "Retry <step>". Errors: no remote, not signed in (→ Source control
    sign-in, MDF-111), push rejected, hook failed (output excerpt), PR already exists (link to it). Dirty close asks first.
  - Done: result list + PR card (neutral "Draft" badge) + "Copy link" (secondary) and "Open in browser" (the footer primary; opens the
    PR with `Linking`, `04-screen-map.md` MPaneCommitDone). Close follows the sheet header rule (✕; no header "Done", MD-85, MDF-26).

#### MDF-61 · Diff view
Boards: MPaneDiff, MGestures · inconsistency / a11y / missing-state · M6 (M6-07) · send
- **Problem.** 3 comment intents (desktop has 5); one line-number column mixes old and new numbers; the comment trigger is undefined
  (tap vs long-press) and the "Comment" button MGestures promises is missing; the diff is monochrome; "More" has no contents; the mount is
  not shown; threads, range, loading, binary, too-large and deleted states are missing.
- **Build.** MD-61 + MD-39: two gutters (old, new; `text-mono-sm` 12) with an accessible line label ("Line 20, added"); tapping the
  line-number gutter opens the inline comment composer for that line, and so does "Comment" in the file toolbar once a line is selected;
  long-press a line → menu Comment for agent / Copy line. Intents are `REVIEW_INTENTS` (5) as chips,
  overflow into a menu. Syntax colour via `highlight.ts` + `syntax-*` tokens. Breadcrumb `Changes › <mount> › …`. More menu: Copy path ·
  Open file · Mention in chat | Keep / Undo file | Discard… Existing threads render inline with their states (draft / sent / addressed /
  resolved) as on web. Loading, binary, too large ("Open on desktop to view"), deleted states from web B-07.

#### MDF-62 · Files and file preview
Boards: MPaneFiles, MPaneFilePreview, MCodebaseFiles · a11y / missing-state / missing-feature · M6 (M6-08) · send
- **Problem.** Mono 11 mount subtitles; "Edit sources" has no destination; tap vs long-press is implied; "Share" is ambiguous (path or
  file); tree rows 44 on Android; preview is monochrome, has no line selection and misses loading/binary/image/markdown/too-large/deleted
  states; "Mention in chat" is filled.
- **Build.** Mount subtitles mono 12; "Edit sources" opens the Sources sheet (the same editor as the desktop Files panel Sources block,
  D-71; hidden when the chat's sources are not editable, `03-components.md` MB-45). Tap = open preview, long-press = menu Open · Mention in
  chat · Copy path · View diff (changed files) · Share file (downloads to cache, then the system share sheet; hidden above the server's
  size limit). Tree rows `min-h-item` 44/48 (dense by design). Preview: syntax colour (MD-39),
  long-press a line → Copy line / Mention lines; header Copy path + More; footer "View diff" (secondary) + "Mention in chat" (the one
  primary). States from web B-09 (loading, binary, image preview, Markdown rendered/source toggle, too large, deleted).

#### MDF-63 · Terminal
Boards: MPaneTerminal, MPaneTerminalFull, MGestures, MTabletAndroid · inconsistency / a11y / missing-state · M6 (M6-09) · send
- **Problem.** Three key rows (phone: Esc, Tab, Ctrl, arrows, ⇧Tab, | ~ /; MGestures: esc, tab, ctrl, arrows, ^C; tablet: Esc, Tab,
  Ctrl, ^C, Up, Down, More keys) with ^C missing on the phone; keys 26–42 × 36; instance names "Terminal 2" / "pwsh" / "pwsh 1"; "44×31" on
  both phones; the iOS "New terminal" 32 and hidden past the fade; "Attach" ambiguous on the tablet; mono 11 in badge and footer; the glass
  selection menu; Find, hardware keyboard, connecting, exited, lost connection, fallback host, workspace not ready, cap reached and the
  Agent commands view are not drawn.
- **Build.** MD-38: xterm.js in a WebView (`data-gai-keys="own"` equivalent: the terminal owns keys and gestures, MD-19).
  - One `KeyRow` (MD-38 set): esc, tab, ctrl (sticky), alt (sticky), ^C, ←, ↑, ↓, →, paste, find. Bar h48 on `bg-sunken`, keys
    `h-kbd` 40 with a 44 / 48 frame (MD-91), min-w 44, `rounded-control`, horizontally scrollable (`03-components.md` MB-27); hidden
    while a hardware keyboard is attached.
  - Instance chips use the server session name ("pwsh 1", "bash 2", as desktop); "Agent commands (n)" opens the read-only agent console.
    "+" is a fixed 44/48 button outside the scroll fade, disabled at the cap with "Up to 4 terminals".
  - Toolbar: "pty"/"basic" badge (mono 12), "Agent working" StatusBadge, Find, Clear (full screen), overflow A− / A+ (the pinch
    equivalent), Kill (destructive, confirm). With a selection: "Attach n lines to chat". Selection menu is a JS `bg-overlay` popover
    (Copy / Attach to chat / Select all). cols × rows are measured and sent on resize.
  - States: connecting, exited ("Process exited · code 1" + Restart), connection lost (Reconnecting… / Reattach), fallback host (basic
    badge + note), workspace not ready, cap reached. Opening the tab applies the existing terminal step-up.

#### MDF-64 · Browser
Boards: MPaneBrowser, MPaneBrowserStates · conflict / inconsistency / missing-state / a11y · M6 (M6-10) · send
- **Problem.** "View only" on mobile vs desktop's "Your clicks still work"; "Stop sharing" is unclear; "Up to 5 run at once, one per
  chat" contradicts two pages in one chat; tinted state cards and a `run-bg` agent strip; page text drawn at 11 inside the stream with
  zoom only in a menu; a disabled "Desktop app only · DevTools" group; Retry / Open Terminal actions without data; denied, degraded and
  starting states missing; "Start" filled.
- **Build.** MD-37: server-streamed frames, view-only, with address bar, back/forward/reload, capture and comment.
  - Page chips inside the tab (cap 5); agent strip neutral (`bg-raised` + running glyph, MDF-05).
  - Live view: fit-width by default, pinch and double-tap zoom, pan; tap in Comment mode sends a hit-test and places a pin.
  - More menu: the desktop browser toolbar's share toggle with its desktop label verbatim, Zoom; no DevTools group.
  - States follow D-71: pool full and page failed show the server error + "Dismiss" only (copy from `blocks/browser`, which fixes the
    "one per chat" wording); plus access denied, degraded (polling) and starting/connecting from desktop F-dock-04, all as neutral
    Callouts. Empty: URL field + "Start" (the tab's one primary).

#### MDF-65 · Tasks and task detail
Boards: MPaneTasks, MPaneTaskDetail · conflict / no-API / missing-state / a11y · M6 (M6-11) · send
- **Problem.** Status words Starting / In review / Completed; "4 of 4 workers" reads as all running; wave number, worker limit, review
  rounds, brief and "See in Changes" have no data (D-69); rows have no cancel; tool rows 34; empty, failed, cancelled, asks and completed
  (result digest) are missing; "Cancel task" has no confirm.
- **Build.** Status per MDF-06. Summary shows only what the API returns (task counts per state); wave and worker limit (MG-36), the
  review-round maximum, brief, step rail, "Ask Orchestrator to retry" and "See in Changes" are **not rendered** (D-69); the review-round
  count (`reviewRounds`) is shown. Rows: long-press/⋯ menu Open task chat · Cancel
  task… (confirm; G-20). Task detail: in-tab page ("‹ All tasks", ↑/↓ 44/48), tool rows `min-h-step`, footer Cancel task
  (destructive secondary) + "Open task chat" (primary). States: empty ("No background tasks", new `EMPTY_STATE_COPY` key, group N),
  failed (error excerpt), cancelled ("Cancelled by you at 14:09" from `cancelledBy`/`cancelledAt`), a worker question as a GateCard.

#### MDF-66 · Plan
Boards: MPanePlan · missing-state / conflict / missing-feature · M6 (M6-11) · send
- **Problem.** How a step comment is created is not drawn; the commented step is highlighted with `warn-bg`; "Save to workspace" is
  missing; stale revision, changes requested, approved, superseded, expired, edit conflict and empty states are missing.
- **Build.** Tap a step → action row "Comment" opens an inline comment field under the step (anchored comment API exists); long-press a
  step opens its menu (MD-60); commented steps use `bg-selected` + comment glyph (MDF-04). Revision bar v1/v2/v3 (Select above 4
  revisions). Actions: Edit as new revision; More menu: Save to workspace · Discard plan…. Footer: notes field + "Request changes (n)" + "Approve plan" (primary; not biometric — plans are not risky, MD-31).
  States from `PLAN_GATE_COPY.status` (Needs review, Changes requested, Approved, Discarded, Superseded, Expired); an older revision shows
  a "Viewing revision 2 · decisions apply to the latest" banner with deciding disabled; edit conflict "Plan changed while you were
  editing." with Reload.

#### MDF-67 · Computer
Boards: MPaneComputer · conflict / missing-state / a11y · M6 (M6-10) · send
- **Problem.** "Take over" has no touch model; the camera "Screen video" is ambiguous; the remote UI is drawn at 11 with no zoom;
  "Live 12 fps" and "Watching since" have no data; consent pending, paused, taken over, runtime not ready, no workspace and replay are
  not drawn.
- **Build.** MD-37: Pause/Resume, Stop, consent, replay and grants; **"Take over" hidden** on phones and tablets; "Screen video" not
  rendered; fps and "Watching since" not rendered (D-69). Live frame fit-width with pinch/double-tap zoom. Activity pill neutral with a
  running glyph. States: consent pending (`COMPUTER_CONSENT_GATE_COPY` GateCard), paused (`control: paused` from
  `/computer/control`), runtime not ready (Start / Restart), no workspace, Replay mode (scrubber + action log). Revoke needs no confirm
  (the agent asks again).

#### MDF-68 · Widget tab and the "+" tab menu
Boards: MPaneTabsOverview · missing-feature · M5 (M5-03) · send
- **Problem.** Desktop's dock has a Widget tab and a "+" menu for extra instances; the mobile pane draws neither.
- **Build.** MD-96 (Owner-confirm): extra terminals and browser pages come from each tab's "+" (MDF-40); there is no pane-level "+".
  The Widget tab is not built on mobile in this pass (MD-23's tab set omits it).

### F. Workflows

All F items are built in M8, after the Workflow Overhaul lands the matching API (MD-04, `07-phases.md` §2). Where a field's
phase (P01…P07) has not landed, the field is not rendered (MD-27).

#### MDF-69 · Builder scope on phones and tablets
Boards: MBuilderList, MBuilderGraph, MBuilderLoop, MStage* · conflict · M8 (M8-05) · send
- **Problem.** The boards bring the full builder to the phone (reorder, graph editing with a selection bar, loop settings, six
  stage tabs, hooks, schemas, expressions) but no board can create, delete or edit an edge (failure edges, `when`, `handlesFailure`,
  joins, multi-parent), so the drawn workflows cannot be built on a phone.
- **Build.** MD-04 (Owner-confirm): list builder only; graph view read-only (tap a node → its stage editor; no selection bar, no
  node moves); add stage appends after the selected stage (on-success edge created by the server API); reorder only for linear-chain
  stages (MDF-71); **no edge creation, deletion or editing** — edges render as read-only edge callouts with "Edit on desktop". Same
  scope on tablets in this pass.

#### MDF-70 · Builder presentation, header and toolbar
Boards: MBuilderList, MBuilderGraph, MBuilderLoop, MWorkflowAgentDraft · conflict / platform / missing-state · M8 (M8-05) · send
- **Problem.** Drawn pushed with back + breadcrumb and a sub-toolbar "Save", though the IA says full-screen modal; the Android header
  has 3 icons; "Run" is offered with unsaved changes; clean, saving, 409 conflict and discard states are missing; iOS shake-to-undo is
  unspecified.
- **Build.** Full-screen modal (MD-21, MDF-27): header Cancel + "Save"; iOS trailing items Undo / Redo / ⋯ (Version history, Workflow
  settings); Android Undo, Redo + overflow. Sub-toolbar: List/Graph view switch, version badge (neutral), "Unsaved changes" text.
  Bottom toolbar (iOS glass capsule / Android row): Add stage · Validate (badge = error count) · Publish vN · "Run" (published,
  clean) / "Save and run" (published, dirty; P01 WP-1.8) / "Test run" (draft) as the screen's one filled button (MD-22; MD-85 exempts
  the builder toolbar); while the agent-draft banner shows, its "Publish" is the filled button and the toolbar action is secondary
  (MDF-88, MDF-02). States: saving (header spinner), 409 revision conflict
  (AlertDialog "Workflow changed elsewhere" → Reload / Keep mine as a draft), discard guard. Shake-to-undo is off.

#### MDF-71 · Reorder semantics
Boards: MBuilderList, MGestures · missing-feature / a11y · M8 (M8-05) · send
- **Problem.** "Edges update on drop" is undefined in a keyed DAG; the handle is 36×28; the promised "Move up / down" menu does not
  exist; loop children have no handles.
- **Build.** MD-04: a stage is draggable only when it is in a linear chain (one in-edge, one out-edge); dropping calls the Workflow
  Overhaul's server reorder, which rewires the chain; non-linear stages show no handle and their menu explains "Has branches · edit on
  desktop". Handle hit 44/48; haptics `dragStart` + `dragTick`. The stage menu (⋯ / long-press) has Move up · Move down (same rule) |
  Duplicate | Delete… (with undo snackbar). Loop children reorder only inside their loop, same rule; moving in/out of a loop is desktop-only.

#### MDF-72 · Approvals: one sheet, one biometric path
Boards: MWorkflowRun, MWorkflowRunPane, MRunStageChat, MRunApproval, MChatWorkflowRun, MNotifications, MHome · conflict / inconsistency / platform · M6 (M6-03), M8-03 · send
- **Problem.** Four surfaces approve the same gate (run banner → pushed MRunApproval, run pane Output with inline buttons, stage-chat
  card with inline buttons, chat card / notification); the IA calls it a sheet, the board pushes it; the drawn Face ID alert is not the
  real iOS flow; Android always shows a fingerprint glyph; "risky" is undefined and conflicts with the 10-minute step-up cache.
- **Build.** MD-21 + MD-31: every surface's "Review" opens **one approval route sheet** (large detent) with MRunApproval's content;
  decisions (Approve / Request changes / Reject, feedback) happen only there. Risky approvals (server `risk` flag; until it lands every
  workflow approval) sign with the biometric-gated device key and bypass the step-up cache; the app supplies only `localizedReason`
  ("Approve Apply upgrades in Nightly dependency audit"; no run number until MG-29 lands); glyph from MDF-15. Devices without
  biometrics or passcode see Approve disabled with "Set up <biometric noun> to approve". States: auth cancelled/failed (stay, nothing
  sent), 409 stale (Callout + Refresh), approved / changes requested (sheet closes, `success` haptic after the server confirms), last
  round ("Round 3 of 3") emphasised.

#### MDF-73 · Run screen
Boards: MWorkflowRun, MRunLoop · a11y / conflict / missing-state · M8 (M8-03) · send
- **Problem.** ≈ 280 pt of header meta, chips, usage, lifecycle strip and banner before the first stage; a warn-tinted needs-you
  banner; "42% context" without the stage; "Guarded" as a status; running, paused, failed, cancelling, completed with finalize results,
  cancelled, setup running/failed and reconnecting states are not drawn.
- **Build.** The lifecycle strip collapses to one line ("Setup ✓ · Stages 2/6 · Finalize pending") once setup is done; the banner uses
  the GateCard frame (MDF-05) with one "Review" primary; the context chip's accessible value names the stage ("Assess risk: 42 % of
  context used"); Guarded per MDF-06. Budget/usage and per-stage context render only when P03/P07 data exists. States per group N
  (run row), including completed with commit/branch/PR links and failed with "Retry failed" in the run menu.

#### MDF-74 · Run menu and stage menu
Boards: MWorkflowRunMenu, MRunStageChat · platform / inconsistency / copy · M8 (M8-03) · send
- **Problem.** "Retry failed" is enabled without a failed stage; "Cancel run…" sits mid-menu; engine words as hints; a render artefact
  behind "Retry failed"; the stage menu has 10 items in 4 groups with an inline nested Retry, two items called "Resume", and "Open in
  inspector" (mobile has no inspector).
- **Build.** Native menus (MDF-28). Run menu: Pause ▸ (Finish current turns / Interrupt now) · Resume (paused only) | Retry failed
  (only when a stage failed) · Copy run ID · Export | Cancel run… (confirm). Stage menu, three groups (MDF-28): Pause · Resume · Retry ▸
  (Retry, keep turns / Restart) · Skip as completed · Re-run from here | Copy output · Open in run pane | Cancel stage… (confirm). Items
  are enabled or hidden from the server's command availability (P03).

#### MDF-75 · Stage as a compact chat
Boards: MRunStageChat · conflict · M8 (M8-03) · send
- **Problem.** The stage composer shows a model chip (desktop WF-17 has none; a stage's session is fixed by the stage); the running
  state is described as "Queue a follow-up".
- **Build.** Composer `variant="stage"` (D-66): agent label only, no model chip; placeholder "Message <agent> in this stage…"; running /
  waiting states per MDF-46 (no queue; 409 `STAGE_BUSY` shows "The stage is busy — try again when it finishes"). The review gate in the
  transcript opens the approval sheet (MDF-72).

#### MDF-76 · Run pane
Boards: MWorkflowRunPane · conflict / missing-state · M8 (M8-04) · send
- **Problem.** Approve controls inline in the pane duplicate the approval sheet; "Risk: Medium" uses `warn`; a bespoke per-workflow table
  from arbitrary JSON; Tools inspector dropped; Files/Hooks/Variables tabs for runs are not drawn.
- **Build.** Tabs Output · Files · Hooks · Variables · Changes · Terminal · Browser (as drawn; the desktop Tools sub-tab is not built —
  the stage editor's Tools tab shows the configuration). Output: "Review" opens the approval sheet. `StructuredOutputView`: an array of
  flat objects → a list of key–value cards (a table only on tablets ≥ 840); anything else → a key–value tree; values never coloured by
  status (MDF-04). Files/Hooks/Variables use the list recipes (read-only).

#### MDF-77 · Runtime graph
Boards: MRunGraph · conflict / a11y · M8 (M8-04) · send
- **Problem.** Traversed edges are green (`ok`) and failure edges red; the minimap is colour-only; no screen-reader alternative; the
  node tap destination is unspecified; "Events" reuses the Version-history glyph; the title says "full screen" but it is pushed.
- **Build.** Pushed screen (MDF-37). Edges: traversed `fg-2` solid, not yet traversed `line-strong`, failure edges dashed with the
  label "on failure", guarded edges dotted with the mono `when` label; status colour only on node glyphs. Minimap hidden from
  accessibility; the canvas exposes nodes in topological order (name + status) or defers to the run's stage list (announced as "Graph.
  Use the stage list for details"). Tap a node → its stage row on the run screen (expanded). "Events" uses the `activity` glyph.

#### MDF-78 · Loop decision card
Boards: MRunLoop · a11y / copy / inconsistency · M8 (M8-04) · send
- **Problem.** Seven equal-weight buttons; "Grant +1" has no unit; "3/5" vs "iteration #2" mixes counting bases; two budgets (40-turn
  stage vs 162/250 loop) with the reason naming one and the meter showing the other; the input sheets are not drawn.
- **Build.** `DecisionCard` (GateCard frame): the recommended action is primary by park reason (budget → "Raise budget"; max
  iterations → "Grant 1 more iteration"; stall → "Continue with input…"); two further actions as secondary; the rest in "More options"
  (native menu), "Fail…" last with a confirm. Iterations are 1-based everywhere ("Iteration 3 of 5"). The reason names which budget
  ("Stage budget: 40 turns used") and the meter is labelled "Loop budget". "Continue with input…" and "Accept iteration…" open sheets
  (text field / iteration picker).

#### MDF-79 · Workflows list
Boards: MWorkflows · inconsistency / a11y / conflict · M8 (M8-01) · send
- **Problem.** The agent-draft row uses the dashed Queued glyph for "never run"; tag chips truncate the title; a draft shows "— success";
  the swipe "Run" is ink and a full swipe could start a run; the count sits in the title.
- **Build.** Rows lead with the last run's status glyph, or no glyph when never run (neutral "Draft" / "Agent draft" badges); the title
  never truncates before tags (tags drop first); the success column is hidden when there is no rate; swipe per MDF-24 (neutral tile
  opening the Run sheet); counts in segments (MDF-36). Summary line "212 runs in 30 days · 93.4 % succeeded" per MDF-90.

#### MDF-80 · Workflow detail
Boards: MWorkflowDetail, MWorkflowDetailMore · inconsistency / missing-state / drift · M8 (M8-01) · send
- **Problem.** "Published v7" is `s-idle` here and `s-ok` on desktop; "Tap for full screen", "View all" and "Versions" have no
  destination; the floating Run covers the footnote; the detail may show the published version while the builder shows the draft.
- **Build.** Version is a neutral badge (MDF-04) that says which version the screen shows ("Published v7" or "Draft · based on v7").
  Mini graph is one button with an accessible summary ("6 stages, 1 approval gate, 2 branches") opening the definition graph
  (`/workflows/[id]/graph`: MB-35 RunGraph without status, read-only, pushed). "View all" → per-workflow run history (list recipe); "Versions" → version history sheet (read-only on
  phones, MD-04). NewAction `run` variant with content inset (MDF-17). Delete confirms (archive when runs exist, P01 rule).

#### MDF-81 · New workflow
Boards: MWorkflowNew, MWorkflowNewBasics · conflict / a11y / no-API / copy · M8 (M8-01) · send
- **Problem.** ✕ plus a bottom primary instead of the full-screen-modal header; a 5-segment template filter; "3 stages" counts the
  loop container; "Up to 3" codebases is a rule with no source; Model before Agent; the permission hint ignores the precedence layers.
- **Build.** Full-screen modal (MDF-27): header Cancel + "Create" (creates the draft and opens the builder); the summary line stays as
  content. Template filter = scrolling filter chips; categories render only when the template API provides them (MDF-90). Stage counts
  exclude containers ("3 stages · 1 loop") everywhere (templates, scripts, detail chips). No "up to 3" limit (the server decides).
  Order Agent → Model; permission hint "Used when neither the run nor the stage sets one". Import JSON → document picker → validation
  results (MDF-87) → draft.

#### MDF-82 · Run sheet
Boards: MWorkflowLaunch, MWorkflowLaunchAdvanced, MWorkflowLaunchPlan · conflict / platform / missing-state / copy · M8 (M8-02) · send
- **Problem.** "1 of 2" reads like a wizard although Run works on page 1; the stage row both toggles skip and opens overrides; per-row
  model pop-ups overlap at 1.3×; display names vs raw ids; "default: this device"; a fixed effort list; truncated upload names; required
  missing, submitting, error and double-tap states are missing.
- **Build.** Route sheet (large). Page 1: variables (`VariableForm`), stages (leading skip checkbox with 44/48 hit; row tap pushes a
  per-stage overrides page inside the sheet; the row shows the current model as text only), Advanced section. "Review plan" pushes the
  plan preview page (no "1 of 2"). Footer: `lg` primary "Run" (published) or "Test run" (draft) + secondary "Review plan". Model names are
  display names everywhere, with the id as mono secondary text only in pickers. Permission label "Default: server". Effort from the
  model (MDF-84). Upload chips wrap to two lines. States: required missing → Run disabled with the reason; submitting → spinner, sheet
  locked; server error → Callout; the request carries an idempotency key (P04). Per-stage model override and run overrides render only
  once P04 lands.

#### MDF-83 · Stage editor tabs, prompt editor and naming
Boards: MStagePrompt, MStageModel, MStageTools, MStageOutput, MStagePolicy(More), MStageHooks · platform / a11y / copy · M8 (M8-06) · send
- **Problem.** A 6-segment iOS segmented control for tabs (clips at large text); inline token chips inside a multi-line editor
  (impossible in a RN `TextInput`); line numbers with soft wrap; Mode "Output" collides with the Output tab; the stage menu offers only
  duplicate/delete.
- **Build.** Stage editor = full-screen modal over the builder (MD-21). Tabs: scrollable pill tabs (iOS) / underline tabs (Android) in
  the pane tab style. Prompt editor (option c of the research): **read view** renders tokens as chips; **edit mode** is a mono
  `TextInput` with plain `{{…}}` text, diagnostics listed under the field, and an accessory bar (iOS input accessory / Android toolbar
  above the IME) with "Insert variable" (inserts at the cursor) and "Preview"; line numbers only in the read view. Mode segment labels
  "Summary / Full / Structured / None". Stage menu per MDF-71.

#### MDF-84 · Stage editor: duplicated fields, effort and counts
Boards: MStageModel, MStageTools, MStagePolicy, MAgentEdit2, MWorkflowLaunchAdvanced · inconsistency / copy · M8 (M8-06) · send
- **Problem.** Max turns appears in Session and in Policy › Budget; capabilities in Session › Customize and in Tools; effort is a fixed
  5-segment list while models support different levels (6 in shared types); Model is listed before Provider on iOS and beside it on
  Android; the "Tools 5" badge counts 6 enabled items.
- **Build.** Each field appears where the desktop stage editor puts it, with the desktop labels (the Workflow Overhaul owns the form;
  when P01 keeps both `session.maxTurns` and `budget.maxTurns`, both appear with distinct labels). Session › "Customize capabilities" is a
  link to the Tools tab, not a second editor. Effort options come from the selected model (Select when > 4). Provider precedes Model on
  both OSes (the provider scopes the list). Tab badges count enabled items (skills + MCP + platform tools).

#### MDF-85 · Editors that show "Edit on desktop"
Boards: MStageOutput, MStageHooks, MBuilderLoop, MStagePolicy, MWorkflowSettings · missing-state / conflict · M8 (M8-06) · send
- **Problem.** Boards imply phone editors that are not drawn: JSON Schema editor, Judge and Custom-script rule editors, HTTP and
  Function hook editors, compensate, exit-rule editor, Accept-best score, N-of-M join inputs, Choice/List/JSON variable defaults.
- **Build.** MD-04: phones edit simple fields only. Editable on phone: text, number, switch, segmented/select values, durations, the
  guard and loop exit conditions as single-line `ExpressionField`s with live parse (shared spec package). Read-only with an "Edit on
  desktop" row: JSON Schema, Judge rubric, Custom script, HTTP/Function hooks, env templating, compensate, join N-of-M, Accept-best score,
  Choice/List/JSON defaults. Contains/Not-contains/Min/Max/Regex rules are simple fields and editable.

#### MDF-86 · Hook rows
Boards: MStageHooks · platform / conflict · M8 (M8-06) · send
- **Problem.** Leading switches on iOS rows (iOS puts switches trailing); "Admin only" hooks drawn editable; delete has no confirm.
- **Build.** Rows: name, phase and type badges (neutral), mono command or secret ref, trailing chevron; the Enabled switch lives inside
  the expanded editor. On a device without `admin:settings` an admin-only hook is read-only with "Requires admin access · Request"
  (MD-30). Delete uses the undo snackbar (the builder draft is unsaved until Save). `secretref:` values are never revealed.

#### MDF-87 · Validation results
Boards: MWorkflowValidate · platform / missing-state / no-API · M8 (M8-05) · send
- **Problem.** Android quick-fix buttons overflow the sheet padding; all-clear, validating and warnings-only states are missing; quick
  fixes ("Declare", "Replace") need payloads the P01 issue shape lacks.
- **Build.** Sheet (medium → large). Validation runs client-side with the browser-safe spec package and live-updates the Validate badge.
  Issue rows: glyph + stage + mono code + message; actions `sm` wrap below the message. "Go to" (select the stage, shrink the sheet) is
  always available; "Declare" / "Replace" render only when the issue carries a fix payload (MDF-90). States: validating, "No problems",
  warnings only (Publish allowed).

#### MDF-88 · Agent draft and version history
Boards: MWorkflowAgentDraft · conflict / inconsistency / missing-state · M8 (M8-05) · send
- **Problem.** Two primaries (Publish v8 + Test run); risk chips warn-tinted; "Restore v6 as draft" with two versions checked; the draft
  adds a Check stage that needs `admin:settings` to publish; the version hash looks like a git hash; diff, restore, discard and publish
  confirmations are missing.
- **Build.** Publish is the one primary (MDF-02). Risk flags are neutral badges. Version history (read-only on phones, MD-04): select
  two versions → "Compare" (diff page); a single version's menu → "Restore as draft" (confirm). The banner states who can publish
  ("Publishing needs admin access" when the draft adds a Check stage and this device lacks the scope). The hash is labelled "Content
  hash" or hidden. Discard and Publish confirm (AlertDialog); `allowAgentPublish` off shows the server's message.

#### MDF-89 · Workflow settings
Boards: MWorkflowSettings · platform / missing-state · M8 (M8-07) · send
- **Problem.** A 6-segment iOS control with counts (General / Project / Variables 6 / Hooks 2 / Tags 3 / Budget) and a clipped Android
  underline tab; the breadcrumb suggests the published workflow; no Save/Done; the other five tabs are not drawn.
- **Build.** On phones the settings are a grouped list of sections (General, Project, Variables, Hooks, Tags, Budget) that push their
  pages, like iOS Settings; tablets may keep tabs. Breadcrumb `… › Edit workflow › Settings`; subtitle "Saved with the workflow draft"
  (changes join the builder draft; no separate Save). Variable editor as drawn with the reserved-name error; name fields use
  `autoCapitalize=none`, `autoCorrect=false`, ASCII keyboard.

#### MDF-90 · Workflow data the boards draw without an API
Boards: MWorkflows, MWorkflowDetail, MWorkflowRun, MRunApproval, MWorkflowNew, MWorkflowRunPane, MWorkflowValidate, MLiveActivity, MNotifications, MHome · no-API · M8 · send
- **Problem.** Designed data the Workflow Overhaul plan does not provide: sequential run numbers (#248, used on every run surface),
  per-workflow 30-day stats and list totals, per-workflow last run, template categories, per-stage tokens/cost and context %, output
  presentation hints, validation quick-fix payloads, the "risky approval" flag, "smoke tests 38 of 38".
- **Build.** MD-27: each is **not rendered** until its API lands. The gaps are in `05-gap-matrix.md`, all owned by the Workflow
  Overhaul (WO): run number per workflow MG-29 (until then runs are titled "Run · <start time>", e.g. "Run · Sep 22, 14:01"), risk
  flags on workflow approvals MG-34 (until then every workflow approval counts as risky, MD-31), quick-fix payloads MG-33, template
  categories MG-30, per-stage tokens / cost / context MG-31, output presentation hints MG-32. Per-workflow 30-day stats, list totals
  and the last run already exist (`stats.summary` with `groupBy: 'definition'`, NG-04) and are rendered. "Smoke tests 38 of 38" has
  no source and is not rendered. Rows and cards collapse around the missing field, never showing "—" placeholders.

### G. Automations and scripts

#### MDF-91 · Automations list
Boards: MAutomations · conflict / a11y / missing-state · M7 (M7-04) · send
- **Problem.** "Cancelled" and "2 of 14 failed" are outside the status map; the disabled row is drawn at opacity .62 (below 4.5:1 for
  `fg-3` text); a switch sits inside a tappable row; the count sits in the title; the info line hints at a server-down state that is not
  drawn; sample next-run dates contradict each other.
- **Build.** Status per MDF-06. Disabled rows: neutral "Disabled" badge, text at normal tokens (no opacity). The switch has its own
  44/48 hit area; the row opens the detail; accessibility actions "Enable" / "Disable" / "Run now". Menu: Run now · Run with dataset… |
  Edit · Enable / Disable | Delete… (confirm). No Duplicate: there is no automation duplicate API (MD-27). Next-run times come from `nextRunAt`, formatted in the server's time zone with the
  zone shown once in the info line ("America/New_York · schedules need local:3100 running"). Empty/loading/error/offline per group N.

#### MDF-92 · Automation detail and execution
Boards: MAutomationDetail, MAutomationExecution · conflict / missing-state / presentation · M7 (M7-04) · send
- **Problem.** Execution and iteration rows are filled `warn-bg`; "Running · needs you" merges two states; the inline "Review" is ink
  (34 tall); the execution detail is drawn pushed (MD-21 says route sheet); "Event log" has no board; "Cancel execution" has no confirm;
  change rows open an unspecified diff; never-run, disabled, failed and server-off states are missing.
- **Build.** Rows neutral with the `hand` glyph (MDF-05); one state per row (MDF-06); the pending iteration's "Review" is an `sm` button
  and the execution sheet's one filled button (MD-22, `04-screen-map.md` MAutomationExecution); it closes the execution sheet and then
  presents the approval sheet (MDF-72; never two sheets, MD-62). Execution detail = route sheet, large detent (MD-21); run links inside
  it push the run screen after closing the sheet. "Event log" is not rendered: there is no execution event API (MD-27).
  "Cancel execution…" confirms. Change rows open the
  **run's** diff (the run pane Changes, not the chat diff). Stats strip cells render only when `stats` returns them.

#### MDF-93 · Creation wizard
Boards: MAutomationCreate1–4 · inconsistency / no-API / a11y · M7 (M7-04) · send
- **Problem.** A 6-node stepper over 4 screens with two "current" nodes at once (Workflow + Dataset, Variables + Review); stepper labels
  11; nodes 26 with unclear tap behaviour; "Save draft" / "Draft saved 14:02" need server drafts that do not exist; the header is ✕ +
  "Save draft" while MPrinciples' modal rule says Cancel + Save.
- **Build.** MD-66: full-screen modal with 6 pages, one node each: Basics · Trigger · Workflow & permission · Dataset · Variables & retry ·
  Review (the boards' content split at their section boundaries; route files `automations/new/{index,trigger,workflow,dataset,variables,review}.tsx`,
  `04-screen-map.md` §1.2). `Stepper` per MD-66 (compact numbered dots + the current label,
  caption 12; nodes are not buttons). Header: Cancel (dirty guard) only; "Save draft" and "Draft saved" are **not rendered** until
  MG-10 (automation drafts, WO) lands. Footer: Back (secondary) + "Continue" (primary) and, on Review, "Create automation" — the wizard
  bar is the one bottom primary MD-85 allows in a full-screen modal. Review rows are tappable and jump to their page.

#### MDF-94 · Triggers and webhook credentials
Boards: MAutomationCreate2, MAutomationWebhook, MAutomationDetail · missing-state / conflict / a11y / copy · M7 (M7-04) · send
- **Problem.** Manual, Webhook, Weekly and Cron variants and an invalid cron are not drawn; the credentials one-time reveal (creation and
  rotation) is missing; "Copy URL" copies a URL whose token part is hidden; lock icons are drawn as buttons; rotate has no confirm or
  step-up; overlap "Queue" wording; the webhook host is a LAN name.
- **Build.**
  - Trigger: SegmentedControl Manual / Schedule / Webhook (`04-screen-map.md` MAutomationCreate2; a `Select` at large text, MD-47). Schedule: Repeats `Select` (Every day / Weekdays / Weekly / Cron);
    Weekly adds day chips (multi-select); Cron adds a mono field validated by `schedule-preview` (G-26) with the error inline; native
    time picker; searchable time-zone list. Missed/overlap options use the server enum labels.
  - Webhook: payload schema from the dataset; after **Create** and after **Rotate** a reveal sheet shows the full URL, token and secret
    once with Copy buttons and "I've saved these" to close. The masked card has no "Copy URL"; the token/secret rows show a non-interactive
    lock glyph and "Rotate to get new credentials". Rotate: AlertDialog confirm → biometric step-up → reveal sheet.
  - The URL renders exactly as the server returns it (no host rewriting).

#### MDF-95 · Wizard: workflows, dataset, variables, retry
Boards: MAutomationCreate3, MAutomationCreate4 · a11y / missing-state / missing-feature · M7 (M7-04) · send
- **Problem.** Workflows "run one after another" with no reorder; dataset row chips cannot hold multi-field rows; concurrency ± 36;
  remove ✕ tiny; variables untyped; review rows not tappable; the retry editor, CSV errors, picker sheet, bypass/admin state and
  create progress/error are not drawn.
- **Build.** Workflow list: drag handle + Move up / Move down (a11y actions), "Add" opens a workflow picker sheet (scope-filtered).
  Dataset: chips only for a one-field schema; otherwise a row list where each row opens a sheet with one field per schema column;
  "CSV or JSON" import via the document picker with a parse-error Callout. Steppers per MDF-25. Variables take their type and key
  suggestions from the chosen workflows' variable definitions. Retry row opens a sheet (attempts ≥ 2, backoff, at least one error class).
  Bypass permission shows a lock and "Requires admin access · Request" when the device lacks the scope. Create: button spinner, error
  Callout; webhook automations then show the reveal sheet (MDF-94).

#### MDF-96 · Detail config editors
Boards: MAutomationDetail · missing-state · M7 (M7-04) · send
- **Problem.** Each configuration row has a chevron to an undrawn editor.
- **Build.** A configuration row opens the wizard page for that section as a single-page full-screen modal ("Edit trigger", Cancel +
  Save), reusing the wizard components; "Run with dataset…" opens a sheet with the dataset editor. Enable switch applies immediately
  (MD-30).

#### MDF-97 · Scripts
Boards: MScripts, MScriptDetail · missing-state / a11y / copy / inconsistency · M7 (M7-04) · send
- **Problem.** "Filter scripts" labels a search icon; the long info card repeats on every visit; scripts disabled on the server, a
  missing `write:workflows` scope, an empty folder and loading are not drawn; "Stages 6 · 1 loop" counts the container; Run needs a
  confirm given server privileges; the materialize result is undefined; the script title is mono 14/600.
- **Build.** Header: "Search scripts" + "Reload scripts from disk". The info card shows until dismissed, then collapses to an "About
  scripts" footer row (per device). States: flag off → EmptyState "Scripts are turned off on this server" with the env var in mono;
  missing scope → "Requires write:workflows · Request" (scope-request sheet, MDF-124); empty → `EMPTY_STATE_COPY.scripts`. Stage counts
  exclude containers (MDF-81). "Run script" opens the Run script sheet (profile + summary + primary "Run", biometric step-up because it
  runs with server privileges). "Materialize as draft" navigates to the new draft workflow. Title per MDF-36.

### H. Projects

#### MDF-98 · Project "Pull requests" tab
Boards: MProjectDetail · missing-feature · M7 (M7-02) · send
- **Problem.** Mobile project tabs are Codebases · Chats · Runs · Customization · Settings; desktop keeps Pull requests (D-31) and the
  current mobile app has PR screens.
- **Build.** MD-36: tabs Codebases · Chats · Runs · Pull requests · Customization · Settings (pane-style scrolling tab strip). The current
  mobile PR list and PR detail are ported onto the kit (detail recipe + DiffView). Empty: `EMPTY_STATE_COPY.pullRequests`.

#### MDF-99 · New project and Add codebase
Boards: MProjectCreate, MAddCodebase · platform / missing-state / no-API / inconsistency · M7 (M7-02) · send
- **Problem.** "Local git" / "Local folder" imply a phone picker but mean server paths; no path browser is drawn; New project has an ink
  "Create" capsule in the header; retention is segmented here and a select in Settings; the Add-codebase primary sits in the sheet footer
  while New project's is in the header; the default-branch picker needs a remote branch list that does not exist before cloning;
  validation, submitting, clone errors, auth-required remotes, max-codebases and dirty-cancel are not drawn.
- **Build.** New project = full-screen modal (MDF-27, header "Create"); Add codebase = sheet with the footer primary (MDF-26) — the two
  rules are intentional (MD-85). Source: Git remote / Git on server / Folder on server (the `04-screen-map.md` labels); the server options
  open a server folder browser (`GET /api/fs/dirs`, `apps/server/src/routes/fs.ts`, MG-22 wrapper) — a page inside the Add codebase sheet
  (MD-62), a sheet over the New project modal. Retention is a `Select` in both places. Default branch is a text field (placeholder "main") until MG-11
  lands (then a Select; built in M7-09). URL field: URL keyboard, no autocorrect/capitalisation. States per group N (validation inline, submit
  spinner, clone error in the codebase row with Logs).

#### MDF-100 · Project detail and codebase
Boards: MProjectDetail, MCodebase, MCodebaseFiles, MCodebaseLogs · no-API (now built) / conflict / missing-state · M7 (M7-02) · send
- **Problem.** The board shows "Fetching · Receiving objects 38%" with a progress bar, worktree sizes, linked chats, "removes in 26 h"
  and reclaimable totals; worktree Active/Orphaned use status colours; the clean-up confirmation is a sheet with a filled red button;
  clone error/stale, empty project, remove-codebase confirmation, per-filter empty, removal progress, partial failure, logs failed/
  completed/empty and the Markdown rendered/source toggle are not drawn.
- **Build.** D-64 (G-16, G-17 built): fetch status uses the existing `cloning` state + `codebase.status_changed` SSE; the row shows
  "Fetching" + the latest log line as text (no percentage bar — the API has no progress number); logs poll `GET …/logs` every second while
  the logs screen is open and the codebase is cloning. Worktree sizes and reclaimable totals from `?include=usage,link`, shown only once
  measured; linked chats only when `link.entity` is present. Badges neutral (MDF-04); clean-up uses the confirm sheet that lists each
  worktree with its size (MDF-29); the trigger "Clean up…" and the confirm "Clean up" share the verb; a single worktree's "Remove…"
  confirms with "Remove". Codebase tabs Worktrees / Files (a tab row in the pane tab-strip style, MDF-19); file preview sheet adds the Markdown rendered/source toggle. States per group N.

#### MDF-101 · Project settings: save, archive, delete
Boards: MProjectSettings, MProjects · inconsistency / missing-state · M7 (M7-02) · send
- **Problem.** A body "Save settings" button while other settings apply immediately; `defaultModel` and `autoFetchInterval` exist but are
  not designed; archive has no undo and there is no archived (Unarchive) variant; delete's impact box cannot fit a native alert.
- **Build.** MD-30 + MD-85: the retention / max-codebases form saves with the header text action "Save" (one save model for a pushed
  form; the desktop project Settings tab also saves explicitly); the body "Save settings" button is removed. The field set mirrors the
  desktop project Settings tab exactly (it decides whether `defaultModel` / `autoFetchInterval` appear); nothing beyond it is added.
  Archive → undo snackbar (MD-26); archived projects show "Archived" and "Unarchive". Delete → AlertDialog with `impact` lines
  (codebases, worktrees, size from G-17 when measured, items needing you; MP-29, MDF-29).

#### MDF-102 · Customization and skill detail
Boards: MProjectCustomization, MSkillDetail, MSetSkills · no-API (now built) / inconsistency / missing-state / copy · M7 (M7-02) · send
- **Problem.** Per-project enable is drawn with no API (G-19 is now built, D-64); the relation between the global Settings › Skills
  switch and the project switch is undefined; the floating action is "Upload skill" on every sub-tab; the Prompts/Agents/MCP sub-tabs, row
  menu, upload progress/error and empty are not drawn; skill detail shows "3 files" (the model has one `filePath`), "View JSON" on a
  Markdown skill, a filled Edit, and no System (read-only) variant or delete confirm.
- **Build.** Enable per project via `GET|PUT /projects/:id/artifact-prefs` (G-19). A skill disabled globally shows its project switch
  locked with "Off in Settings" (global off wins). Sub-tabs Skills / Prompts / Agents / MCP (Select at large text); NewAction label per
  sub-tab (MDF-17); upload uses the document picker with the formats the desktop upload accepts. Skill detail: file chips only for the
  files the API lists; "View source" instead of "View JSON"; Edit (primary) opens a full-screen mono editor for the selected text file;
  System skills are read-only (no Edit/Delete); Delete confirms. The breadcrumb's "Customization" segment opens the project on that tab.

### I. Agents

#### MDF-103 · Agent editor
Boards: MAgentEdit1, MAgentEdit2, MAgentEdit3 · conflict / a11y / platform / missing-state · M7 (M7-03) · send
- **Problem.** Drawn pushed with back, a header ink Save and a warn-tinted "3 unsaved changes" bar with Discard, while the IA says
  full-screen modal; Android field groups sit in `raised` cards; a 5-segment effort control; "Change role ↗" uses an external-link glyph
  for an in-page jump; capabilities are a tri-state drawn as 2-state switches; MCP copy says "vetted registry entries only" while Settings
  lists custom servers; validation, size warnings, save error, discard and built-in states are missing.
- **Build.** Full-screen modal (MDF-27): Cancel + "Save". The dirty count shows in the header title while dirty ("3 changes",
  `04-screen-map.md` MAgentEdit1) instead of the warn-tinted bar (MD-25); Cancel with changes asks "Discard changes?". Android form groups are flat (MDF-23). Effort: Inherit + the provider's levels (Select when
  > 4). "Change role" scrolls to Role (arrow-up glyph). Capabilities: each row is a tri-state SegmentedControl Inherit / On / Off (a `Select`
  at large text, MD-47) with the provenance in the accessible value and a "Reset to inherit" action. MCP chips list every server available to the agent's scope
  (registry + custom), copy aligned with the desktop editor. Instructions size meter warns above 8 KB and errors above 32 KB.

#### MDF-104 · Built-in agents and delete in use
Boards: MAgents, MAgentDetail, MAgentDelete · missing-state / copy / inconsistency · M7 (M7-03) · send
- **Problem.** The list menu offers Edit/Delete on read-only built-ins; no built-in detail variant; delete of an in-use agent says
  "Delete" although it disables; the iOS destructive capsule is `err-bg`; not-in-use and failure variants are missing.
- **Build.** Built-in agents: menu Duplicate · Export (no Edit/Delete); detail hides Edit, "Duplicate to change" is the primary. Delete:
  not in use → AlertDialog "Delete <agent>?"; in use → AlertDialog "Disable <agent>?" with the impact line ("N chats and M workflows
  use it", MP-29 `impact`) and the button "Disable agent" (`force=1`); style per MDF-03.

#### MDF-105 · Import `.agent.md`
Boards: MAgentImport · no-API / platform · M7 (M7-03) · send
- **Problem.** "Parsed from the file", the registry warning and the replace detection need a dry-run parse that does not exist (the
  parser lives in `packages/core`); iOS page sheet vs Android full-screen dialog; parse error, too large, no-conflict and importing states
  are missing.
- **Build.** Route sheet, large detent, both OSes (MDF-37). The dry-run preview is MG-12 (*now*, built in M7-09): `POST /agents/import?dryRun=1` returning
  the parsed summary, warnings and conflict. Until it lands the sheet shows the file card, "Import to" scope and a plain "Replace an existing agent
  with the same name" switch; the parsed table and warnings are not rendered. Size is checked on device (> 256 KB → inline error).
  Import is the sheet's footer primary.

#### MDF-106 · New agent, agent detail, orchestrator, Settings › Agents
Boards: MAgentNew, MAgentDetail, MAgentDetailOrch, MSetAgents · platform / inconsistency / a11y · M7 (M7-03, M7-05) · send
- **Problem.** MAgentNew uses a non-stock iOS check circle and a header "Continue"; the Blank path, "your agents" picker and slug
  collision are not drawn; the orchestration capability is a disabled switch; Android uses a card for the capability summary while other
  Android lists are flat; Settings › Agents duplicates the Agents module.
- **Build.** New agent sheet: single choice per MDF-21, footer primary "Continue" (MDF-26), slug collision inline. Detail: capability
  summary is a carded composite on both OSes (MDF-23); orchestration shows as a read-only row with a lock ("Always on — required to
  delegate"). Settings › Agents reuses the Agents list component and the same New agent sheet; "Manage agents ↗" opens the Agents module.
  Used-by status comes from a client join with the attention feed.

### J. Settings

#### MDF-107 · Admin-scoped settings on a phone
Boards: MSettings(More), every MSet* section with writes, MSetSecurity(More), MSetPairDevice · missing-state / conflict · M7 (M7-07) · send
- **Problem.** Every settings control is drawn editable, but most writes need `admin:*` scopes no mobile preset holds (only Source
  control needs `write:projects`); listing devices and access requests needs `admin:devices` even to read. No read-only or
  "needs permission" state is drawn.
- **Build.** MD-30: settings are read-mostly. A row or section whose write needs a scope the device lacks shows its current value and a
  trailing "Requires admin access · Request" (text button), which opens the scope-request sheet (MDF-124) pre-filled with that scope.
  Once granted, writes are allowed, each behind biometric step-up. Reads that need `admin:devices` show only this device's own data via
  the self-service routes (MG-01); other devices' rows and access requests appear only when the device holds the scope.

#### MDF-108 · Model providers and the default model
Boards: MSetProviders, MSetGeneral, MModelPicker · missing-feature / no-API / platform · M7 (M7-05) · send
- **Problem.** Two providers drawn (Claude Code, GitHub Copilot) where the server has five (`copilot`, `claude-agent`, `codex`,
  `opencode`, `acp`); no Sign in / Sign out / Make default; a wifi glyph for status; the default-model sheet uses a 2-segment provider
  switch; testing, not installed and error states are missing.
- **Build.** MD-35: providers from `HARNESS_PROVIDERS` via `createApiClient().harness.*` (G-09); each card: status as `HEALTH`-style dot
  + word ("Connected", "Not signed in", "Not installed"), "Test", Sign in (`authUrl` in `WebBrowser.openAuthSessionAsync`, then
  re-probe) / Sign out, "Make default" (buttons, `04-screen-map.md` MSetProviders). Writes need `admin:harnesses` (MDF-107). Install hints as on web. The default-model sheet
  uses the provider `Select` and model list of MDF-48.

#### MDF-109 · Per-device preferences and their copy
Boards: MSetGeneral, MSetBrowserTerminal, MSetSkills, MSettings · copy / conflict · M7 (M7-05, M7-06) · send
- **Problem.** The default chat model is called "Application-wide" but is per browser on desktop; terminal shell/profile/secrets and
  browser interactivity are per browser on desktop; the Skills page promises disabled skills are "never … sent to models" although the
  toggle is client-local; `pwsh.exe` and the PowerShell-profile row assume a Windows server.
- **Build.** MD-30: these are per-device on mobile, grouped under a "This device" footer: default chat model, browser interactivity,
  terminal shell/profile/token inheritance, skill toggles. Copy: Skills footer "Disabled skills aren't offered on this device." The
  terminal rows adapt to the server OS (`system/info.platform`): the PowerShell row only for Windows servers; the shell placeholder is the
  server's default shell.

#### MDF-110 · MCP servers: save model, badges, scope, add form
Boards: MSetMcp, MSetMcpAdd, MAgentEdit3, MProjectCustomization · inconsistency / conflict / missing-state · M7 (M7-05) · send
- **Problem.** Setup is an inline form with its own Save inside an expandable row; "Custom" is `s-run` and "Needs setup" `s-warn`; the Add
  form is pushed; the HTTP/SSE variant, validation, test and custom-server edit/delete are not drawn; desktop moves "Add server" into
  project Customization while mobile keeps it global.
- **Build.** MD-30 save model: switches apply immediately; forms save in the header. MCP setup opens a sheet "Set up <server>" (fields,
  footer primary "Save"); "Add server" is a full-screen modal (MDF-27). Badges neutral (MDF-04). Custom servers can be added in both
  places the server supports: global (Settings › MCP, `/system/mcp-servers/custom`) and per project (Customization › MCP,
  `/projects/:id/mcp-servers`). The Add form's transport variants: Local (command, args, env), HTTP/SSE (URL, headers); env values are
  secret fields. Custom rows have a menu Edit · Remove….

#### MDF-111 · Source control
Boards: MSetSourceControl · platform / missing-state · M7 (M7-06) · send
- **Problem.** The only path to connect GitHub is typing or pasting a personal access token, though the server supports the device-code
  flow; not connected, invalid token and saving are not drawn.
- **Build.** Primary "Sign in with GitHub" (device flow: `POST /accounts/device/start` → show the code with Copy → open the verification
  URL in the in-app browser → poll `GET /accounts/device/:loginId`); "Use a token instead" disclosure holds the PAT and Enterprise host
  fields, saved with the header Save. States: not connected, signing in (code + countdown), connected, invalid token, saving.

#### MDF-112 · Security and devices
Boards: MSetSecurity, MSetSecurityMore · conflict / no-API / missing-state / drift · M7 (M7-06) · send
- **Problem.** "Custom" network exposure is unsupported (DF-20); "Restart server" has no remote endpoint; "12 / 22" scopes (the server
  has 25); approving access requests needs `admin:devices`; the request example is self-referential ("Pixel 9" asks and is drawn on a
  Pixel); "Face ID for approvals" duplicates App lock; revoke/unpair confirmations, no-requests and the "1 revoked device" disclosure are
  missing.
- **Build.** MD-35: exposure options from the server (Loopback only / Network); after a change the callout reads "Restart the server to
  apply" (no restart button). Scope count = live `held / SCOPES.length`. The biometric-for-approvals switch lives only in App lock
  (MDF-115); Security links to it. Access requests show only when the device holds `admin:devices`; approving a subset is biometric-gated;
  this device's own pending request shows as "Waiting for approval" (self-service route). Revoke (another device) and "Unpair this
  <device noun>" confirm with an AlertDialog; unpair then deletes this server's key and returns to the server switcher or pairing.

#### MDF-113 · Pair a new device
Boards: MSetPairDevice · conflict / no-API / missing-state / copy · M7 (M7-06) · send
- **Problem.** A 7-character code "4F7-K2Q" (the real code is 12 characters, 3×4); a "Share address and code" header action beside "Don't
  screenshot the code"; five preset names of which only some match code constants; a "Device" row pre-naming the other device;
  generating, expired and consumed states are missing; creating a code needs `admin:devices`.
- **Build.** MD-35 / D-42: `PairingCodeInput`-style display in 3 groups of 4 from `PAIRING_CODE_LENGTH` / `PAIRING_CODE_GROUP_SIZE`;
  no Share action; address + QR + countdown + Cancel. Presets: add an additive shared preset table mapping names to the existing
  constants (Mobile companion → `DEFAULT_MOBILE_SCOPES`, Mobile standalone → `STANDALONE_MOBILE_SCOPES`, Workstation →
  `DEFAULT_DEVICE_SCOPES`, CLI → `DEFAULT_CLI_SCOPES`); presets without a constant are not rendered; no admin preset (MD-30). The Device
  row is removed (the joining device names itself). Screen protected from capture (Android `FLAG_SECURE`, iOS capture detection hides the
  code) and kept awake. States: generating, active, expired ("Code expired" + "New code"), consumed ("<device> joined" → Paired devices).
  Needs `admin:devices` (MDF-107).

#### MDF-114 · Notifications settings
Boards: MSetNotifications, MNotifications · no-API / missing-state / conflict · M7 (M7-07) · send
- **Problem.** Per-category opt-in, chat-reply pushes, morning digest, quiet hours with approvals let through and per-project levels
  have no server support (MF-07); the most important states — permission not determined, denied, provisional, and a disabled Android
  channel — are not drawn; the "Notifications are on" banner is ok-tinted.
- **Build.** MD-06: digest, quiet hours and per-project levels are not rendered; per-category opt-in and chat-reply pushes are part of MG-15,
  marked *later* (Owner-confirm), and not rendered. The screen shows: permission state (`PermissionState`: not determined → "Turn on
  notifications" primary; denied → "Open Settings"; provisional → explanation + "Allow prominent notifications"), a neutral status
  Callout, "Pause notifications" (1 h / 8 h / until tomorrow via `mutedUntil`), the categories the server sends listed read-only with
  their platform interruption level, and "System notification settings" (Android: per-channel settings link; channels created per
  category).

#### MDF-115 · App lock and privacy
Boards: MSetAppLock · missing-state / conflict · M7 (M7-07), M9-09 · send
- **Problem.** "Ask before" omits Computer use; "Hide notification previews" duplicates an OS setting on iOS and implies a server flag;
  no-biometrics, biometrics-changed and lockout states are missing.
- **Build.** Unlock (biometric noun from MDF-15, passcode fallback), Lock after (Select). "Ask before": Approvals and permissions
  (ordinary approvals; risky ones always ask, shown as a locked note, MD-31), Terminal and browser, Pairing and revoking devices, Computer
  use (enable / consent). Privacy: Hide in app switcher; "Hide details on the Lock Screen" (on by default) implements MD-33 client-side
  (iOS Notification Service Extension redaction, Android `VISIBILITY_PRIVATE` public version). States: no biometrics enrolled (rows fall
  back to passcode with a note), biometrics changed (re-enrol key prompt), lockout (wait message).

#### MDF-116 · Widgets and Live Activities settings
Boards: MSetWidgets · platform / no-API / missing-state · M7 (M7-07) · send
- **Problem.** "Control Center: New chat" / "Quick Settings tile" is drawn as a switch, but apps cannot add or remove these; "Refresh:
  On push + 15 min" relies on silent push (phase 2); "Approve from Lock Screen · Always asks for Face ID" contradicts MD-31; Live Activities
  disabled in iOS Settings, Android < 16, no widgets placed and tile not added are not drawn.
- **Build.** Controls row: guidance "Add the New chat control from Control Center" (iOS) / "Add tile" button calling
  `requestAddTileService` (Android 13+; guidance below 13). Refresh value "Every 15 minutes and when you open the app" (MD-32 phase 1).
  Approve row copy: "Ordinary approvals need the device unlocked; risky ones open the app" (MD-31). Widget rows show placed counts from
  WidgetCenter / Glance. States: Live Activities off in Settings (`ActivityAuthorizationInfo` → "Turned off in Settings" + link),
  Android < 16 ("Shows as an ongoing notification"), none placed ("Add from the Home Screen").

#### MDF-117 · Appearance
Boards: MSetAppearance, MThemesPhone · inconsistency / a11y · M7 (M7-05) · send
- **Problem.** Theme previews stay dark in light mode; the off switch thumb renders dark in light mode; app-level Reduce motion / Reduce
  transparency duplicate OS settings with no "follow system" state; MPrinciples' theme count is wrong.
- **Build.** Mode System / Light / Dark; theme grid (18 themes, category filter as chips) with live previews in the current mode via a
  scoped theme; accents: 7 swatches (radio group) + Android 12+ "System (Material You)" (MDF-12). Text size follows the OS: an info row,
  no in-app switch or slider (MD-69; `04-screen-map.md` MSetAppearance). Motion rows are `Select`s System / On / Off ("System" follows the OS flag; default
  System); Reduce transparency iOS only. Native switches (MDF-20).

#### MDF-118 · Computer use and Audio
Boards: MSetComputerUse, MSetAudio · conflict / no-API / missing-state · M7 (M7-06) · send
- **Problem.** Enabling Computer use / take-over from a phone is high-risk with no step-up; the audit log is mentioned without a link;
  driver stopped/error, no grants, kill switch engaged and the "Always blocked" detail are missing. Audio's "Dictation language" has no
  server field; the Engine / Pause / Language pickers are not drawn; download progress, downloaded and failed states are missing.
- **Build.** Computer use: enable toggles behind biometric step-up (MDF-115); "Take over the screen" setting shown read-only on phones
  (MD-37 hides take-over); grants with "Revoke" (no confirm); states from `/computer/runtime` via `HEALTH.computerRuntime`, kill switch
  as a Callout; the audit-log line stays plain text. Audio: Dictation language not rendered until MG-17 lands (built in M7-09); other values are
  inline `Select`s; the model card states: not downloaded (primary "Download · about 790 MB"), downloading (progress from polling),
  ready, failed (Retry).

#### MDF-119 · Extensions, Templates, Storage, Diagnostics
Boards: MSetExtensions, MSetTemplates, MSetStorage, MSetDiagnostics · missing-state / no-API / copy / a11y · M7 (M7-05, M7-06) · send
- **Problem.** Built-in extensions are drawn as disabled "on" switches; Install-from-path, load error, uninstall confirm and reloading
  are missing. Template rows have two targets (row + "Use") with undefined behaviour. Storage uses "Clean up now" then "Delete"; drill-in
  targets are undefined; running and result states are missing. Diagnostics mixes Healthy/OK/Connected/Hardware; "Server log", "Export"
  and "up to date" have no endpoints; degraded states are missing.
- **Build.** Extensions: built-ins show a lock row ("On · built in"); "Install from path" sheet takes a **server** path; Uninstall
  confirms; load error shows the message. Templates: row tap = preview sheet; "Use" creates a draft workflow and opens the builder.
  Storage: one verb "Clean up" (trigger and confirm, MDF-29); project rows open the project's Codebases tab; the Orphaned row has no
  chevron; states running and "Freed 4.1 GB" (inline result, not a toast); per-project sizes only when G-17 measured them.
  Diagnostics: labels from `HEALTH` (dot + word); "Server log" and "Export" (MG-18) and the update check (MG-26) are not rendered (*later*,
  MD-27); unhealthy rows show Failed/Degraded wording.

#### MDF-120 · Settings root
Boards: MSettings, MSettingsMore · platform / inconsistency / missing-state · M7 (M7-05) · send
- **Problem.** Android section headers indented 56 dp; the iOS large title does not collapse when scrolled; rows 44/52; disconnected
  server, search results and scope-limited states are missing; the current app's `accessibility` and `about` routes have no board.
- **Build.** Section headers per MDF-23 (MD-68); native collapsing large title (MDF-36); rows `min-h-row` 52/56 (MD-59). Server card uses `HEALTH.connection`
  and opens the server switcher. Search filters the section index (client). About lives in the footer + General; accessibility options
  live in Appearance; the legacy `accessibility` and `about` routes are deleted with their replacements. The four per-device rows keep
  their "This device" footer.

### K. Pairing and servers

#### MDF-121 · Pairing code and first-run layout
Boards: MPairing · conflict / a11y / platform · M7 (M7-08) · send
- **Problem.** A 6-cell code (3 + dash + 3) where the real code is 12 characters in 3 groups of 4; the iOS title is 24/600 (off the
  ramp); the address field has no edit affordance; the torch button is 40.
- **Build.** MD-35 / D-42: `PairingCodeInput` renders 3 groups of 4 from the shared constants as three mono 22/500 fields (iOS h52
  `rounded-field` `bg-raised`; Android outlined h56), auto-advance, full-code paste, `textContentType="oneTimeCode"` /
  `autofillHints`. Error: 2 px `border-err` on all groups + message with the `x-circle` glyph. Title `largeTitle` (32 / 28). Address is an
  editable URL field pre-filled from the QR payload or deep link, with a reachability line from `probeServer`. Torch 44/48.

#### MDF-122 · Pairing states, scopes and deep link
Boards: MPairing · missing-state / copy · M7 (M7-08) · send
- **Problem.** Camera denied / no camera, scan success, connecting, wrong server (TLS / cleartext), the scope step ("Next you choose what
  this iPhone may do"), pairing success and the revoked screen are not drawn; the helper copy implies the phone chooses its scopes,
  though the invite fixes them and no admin preset exists at pairing (MD-30).
- **Build.** States: camera denied/unavailable → the viewfinder is replaced by a Callout "Camera access is off · Open Settings" and the
  code field gets focus; scan success → "Server found", address filled (the `success` haptic fires when pairing completes, MD-78); connecting → primary spinner, inputs locked;
  wrong server / TLS / cleartext → error Callout with the probe message; success → a summary "This <device noun> can: …" (scope labels
  from the server) + "Continue". Copy: "The server decides what this <device noun> may do. You can ask for more later." Revoked screen
  (`app/revoked.tsx`) on the EmptyState recipe with "Pair again". `generatorai://pair?code=` pre-fills and never auto-submits (MD-34).

#### MDF-123 · Server switcher
Boards: MServers, MSidebar · inconsistency / missing-state · M5 (M5-07) · send
- **Problem.** The iOS groups use a `selected` fill instead of `raised`; iOS ✕ is on the right (other sheets: left); switching, pairing
  revoked, auth error and single-server states are missing; no surface says which server a notification came from.
- **Build.** Route sheet (MD-21), header per MDF-26 (✕ at the start on iOS, at the end on Android) with the selection-sheet text action
  "Done" (MD-85). Server rows `min-h-row-2` 68/72 (MD-59; icon, name, `HEALTH.connection` line, current = trailing ✓ with no fill,
  offline = "Retry" `sm`). States: switching (row spinner "Connecting…"; the rest disabled), revoked ("Access revoked" +
  "Pair again"), auth error, single server (the sheet still opens: one row + Add server). Footnote as drawn. Server identity in pushes and
  links per MDF-126.

#### MDF-124 · Scope request
Boards: MScopeRequest, MSetBrowserTerminal, MSetSecurityMore · missing-state / conflict · M7 (M7-07) · send
- **Problem.** Only "not requested" is drawn; pending, approved, denied, expired and the admin side are missing; the iOS Run is glass
  and on Android a filled "Request access" competes with the ink Run FAB; the canvas title places it under Home.
- **Build.** The workflow detail shows the permission card (GateCard-like frame without a tint: `bg-raised` + `border-line`, header
  `bg-selected`), whose "Request access" (`sm` secondary) opens the **scope-request route sheet** (MD-21): scope checklist (multi choice
  per MDF-21, "Sensitive" neutral badge), optional reason, the 3-step explainer, footer primary "Request access". States in the card:
  pending ("Waiting for an admin · requested 3m ago" + "Check again"), approved (card disappears, success haptic), denied/expired
  ("Request denied" + "Request again"). The floating Run stays the one primary (MDF-02). The admin side is MDF-112's access-request card.

### L. System surfaces

#### MDF-125 · Notification actions and biometrics
Boards: MNotifications · platform / conflict · M9 (M9-02) · send
- **Problem.** "Allow once · Face ID required" / "fingerprint required" cannot be enforced from a notification action
  (`authenticationRequired` means device unlock); iOS "Deny" is not destructive; the Android fingerprint glyph is assumed.
- **Build.** MD-31: ordinary approvals: "Allow once" with `authenticationRequired` (device unlock) and "Deny" with the destructive option;
  no biometric wording. Risky approvals: a single "Review" action with the `foreground` option that opens the approval sheet, where the
  biometric-signed approval happens. Question: text reply + "Open". Workflow approvals: "Review" (foreground). Android: same actions,
  `setAuthenticationRequired(true)` for ordinary approvals.

#### MDF-126 · Notification content, privacy and server identity
Boards: MNotifications, MLiveActivity, MWidgets, MShortcuts · conflict / no-API / missing-state · M9 (M9-01, M9-02) · send
- **Problem.** Command text shows on the Lock Screen, conflicting with the privacy setting; question options are lost in the push (the
  in-app card has options); no surface shows which server an item came from although several can be paired; failed runs have no
  notification design.
- **Build.** MD-33: locked devices see title + status only ("Bug Fixer needs permission · Network"); commands, code and message text
  appear after unlock. MD-05: every payload carries the server id; when more than one server is paired, notifications, widgets and Live
  Activities add the server name as the subtitle. Question options as actions (up to 3 + Reply) once MG-06 part B lands
  (*now*, M9-02); until then Reply + Open. A failed run posts "Run failed · <workflow>" in the runs channel with "Open".

#### MDF-127 · "Pause agents" and the Control Center / Quick Settings row
Boards: MNotifications, MWidgets, MSetWidgets · no-API / platform · M9 (M9-06) · send
- **Problem.** "Pause agents" (control, tile, Quick Settings) is a new product feature with no server semantics or desktop counterpart
  (MF-07); the Quick Settings drawing mixes system tiles with ours.
- **Build.** MD-06: "Pause agents" is not built in this pass. Only the "New chat" Control Center control and Quick Settings tile are
  built (states active / unavailable when no server is paired). Boards should show just our tile.

#### MDF-128 · Live Activity / Live Update
Boards: MLiveActivity, MSetWidgets · copy / missing-state / platform · M9 (M9-03, M9-04) · send
- **Problem.** "12:40" is ambiguous (clock or elapsed); end states (succeeded, failed, cancelled), stale/offline, paused and several
  concurrent runs are not drawn; the Android status chip is drawn `warn-bg` (the system tints it); the island is always dark regardless
  of theme; updates assume push.
- **Build.** MD-32 phase 1: local updates while the app holds the stream, `staleDate` for suspension. Elapsed uses a live timer
  (`Text(timerInterval:)` / Chronometer) with "elapsed" in the accessible label; clock times always include "at". End states: final
  status glyph + word + duration; succeeded and cancelled items are dismissed 15 minutes after the end, failed items after 30 minutes
  (MD-90); stale: "Last update 14:02 · open the app"; paused: Paused glyph
  and word. One activity per run, at most 3 for items followed on this device (MD-90); iOS shows the most urgent in the island (Needs
  you > Running). The Android chip colour is the
  system's (no tint); island/lock-screen content follows the system appearance, not the app theme.

#### MDF-129 · Widgets
Boards: MWidgets, MSetWidgets · a11y / platform · M9 (M9-05) · send
- **Problem.** Android widget text 11 sp; tinted/clear (iOS) and dynamic-colour (Android) variants are not drawn and status colours
  would be lost; refresh "on push" is not available in phase 1; Review buttons are below target.
- **Build.** MD-65: ≥ 12 sp on Android, ≥ 11 pt on iOS. Status always glyph + word so tinted modes keep meaning; accented rendering mode
  marks glyphs as accentable. "Updated hh:mm" from the last snapshot; refresh on app activity and the 15-minute timeline (MD-32). Widget
  buttons are system-sized (exempt). Empty variant uses `EMPTY_STATE_COPY.needsYou`.

#### MDF-130 · Quick actions and app badge
Boards: MShortcuts · no-API / missing-state · M9 (M9-07) · send
- **Problem.** "Run workflow…" opens an undrawn picker, and command links allowlist only `chat.new` and `workflow.new` (D-60); the badge
  and "3 need you" subtitle need a background source.
- **Build.** Quick actions (labels shared with `LAUNCHER_ACTIONS` where they overlap): New chat (`command/chat.new`) · Home (subtitle
  "n need you" from the last attention snapshot, updated on app activity) · Run workflow… (`generatorai://search?kind=workflows`: the
  search palette with the Workflows group first, so no new picker and no new command id is needed; `04-screen-map.md` §1.6) · Search. App icon badge = Needs-you count, updated
  when the app runs or a push arrives.

#### MDF-131 · Share to agent
Boards: MShortcuts · no-API / a11y / platform / missing-state · M9 (M9-08) · send
- **Problem.** The server is fixed in a footer although several can be paired; Needs-you is a coloured dot; Android mixes a filled Agent
  field and an outlined Note field; "New chat" from share is not drawn; the ingest endpoint does not exist.
- **Build.** Server row at the top ("Server: This computer ›", last-used by default, picker when > 1). Recent chats lead with the status
  glyph + word. Agent is a read-only `ListRow` with the lock note; Note is one outlined field. "New chat" hands off to the app, opening the
  New chat sheet with the attachment pre-filled. The ingest endpoint is MG-09 (*now*, built in M9-08); until it lands the share target is
  not registered.

### M. Tablets

#### MDF-132 · Breakpoints, orientation and resizing
Boards: MTabletIOS, MTabletAndroid · missing-state · M5 (M5-05) · send
- **Problem.** Only landscape at 1194 / 1280 is drawn; portrait, compact windows (Slide Over, split, freeform, foldables), the
  overlay-vs-dock breakpoint, tablet Home and lists are not.
- **Build.** MD-24: < 600 phone layout (drawer + overlay pane); 600–839 persistent sidebar + overlay pane; ≥ 840 persistent sidebar
  (312 / 300) + docked pane (410 / 400). All orientations; size-class changes never remount panels, terminals, WebViews or the transcript.
  Lists and forms on wide windows cap their content at 720 and centre it; no list-detail split in this pass.

#### MDF-133 · Tablet chrome
Boards: MTabletIOS, MTabletAndroid · a11y / platform · M5 (M5-02, M5-05) · send
- **Problem.** The Android permanent drawer forces nav items to 44 and live rows to 36; iPad draws inset floating cards while phones are
  edge-attached, with no rule; the header toggles become "Hide sidebar" / "Hide workspace pane" with a selected state.
- **Build.** iPad: inset floating sidebar and pane cards (`rounded-group` 22, 8 margin; the iPadOS idiom); Android tablet: edge-attached
  permanent drawer and pane. Row heights per MDF-23 / MDF-38 on both (Android ≥ 48). Header toggles use the selected state
  (`bg-selected`) and "Show/Hide …" names; header h60 on iPad.

#### MDF-134 · Pane and pushed screens on tablets; tabs drawn per platform
Boards: MTabletIOS, MTabletAndroid · missing-state / inconsistency · M5, M6 · send
- **Problem.** Only Changes is drawn for iPad and only Terminal for the Android tablet; maximise has no defined target when docked; the
  Android tablet key row and toolbar differ from the phone's; pushes and sheets from the docked pane are undefined.
- **Build.** Every tab is built on both OSes from the phone boards. Docked-pane pushes and sheets per MDF-42 (Diff and File preview
  replace the chat column while the pane stays docked); maximise covers the chat column. The terminal key row and toolbar are the single spec of MDF-63 on every size (the tablet's "Font size" button is the phone's
  A−/A+ overflow). Workflows on tablets use the phone layouts with the run pane docked (MDF-69).

#### MDF-135 · Hardware keyboard, pointer and drag-and-drop
Boards: MTabletIOS, MTabletAndroid, MComposerInput, MGestures · missing-feature · M5 (M5-09) · send
- **Problem.** Keyboard shortcuts, the iPadOS menu bar, pointer hover and drag-and-drop into the composer are listed as native features
  but not drawn.
- **Build.** Shortcuts from `COMMANDS` via the device-key module (`06-platform-and-shell.md` §3.10): ⌘K / Ctrl+K palette, ⌘N / Ctrl+N
  new chat, ⌘B / Ctrl+B sidebar (`sidebar.toggle`), ⌥⌘B / Ctrl+Alt+B pane (`dock.toggle`), ⇧⌘H … ⇧⌘S / Ctrl+1 … Ctrl+7 destinations,
  ⌘, settings, Esc closes the top layer; the terminal owns every key while focused (MD-19). Pointer hover highlights rows and buttons with `bg-hover`.
  Drag-and-drop of files and images onto the composer attaches them (same pipeline as the + menu). The iPadOS menu bar is not built in
  this pass.

### N. Missing states

#### MDF-136 · Missing states across all boards (derive, never invent)
Boards: all screen boards (the 131 boards draw almost only the populated state) · missing-state · every phase (recipes in M4-09) · send
- **Problem.** Empty, loading, error, offline, permission, scope, in-flight and end states are drawn for almost no screen (the
  small widget's "Nothing needs you" and three browser states are the exceptions).
- **Build.** Derive every missing state with these recipes (the D-32 approach on the mobile kit). The table lists what each screen
  must derive; items elsewhere in this file add screen-specific detail.

**Recipes**

| Id | State | Recipe |
|---|---|---|
| R-EMPTY | No items | `EmptyState` with `EMPTY_STATE_COPY[key]`. Where the key does not exist, add it **additively** to `packages/shared/src/ui-contract/copy.ts` (log in `COORDINATION.md`) with the copy given below; one secondary action at most (the module's New) |
| R-NORESULT | Search/filter matches nothing | `EMPTY_STATE_COPY.searchResults` + "Clear search" / "Clear filters" |
| R-LOAD | First load | `Skeleton` rows matching the row geometry after 300 ms (MDF-32); refetches keep showing the data; lists page with the server cursor and a footer spinner |
| R-ERROR | Load failed, nothing cached | `ErrorState`: `x-circle` glyph, "Couldn't load <things>", the server message (mono for codes), "Try again" |
| R-STALE | Load failed, cached data shown | Neutral Callout above the content "Showing saved data · Couldn't refresh" + "Retry"; content read-only if the action needs the server |
| R-OFFLINE | No connection | `OfflineState` bar under the header with `HEALTH.connection` ("Reconnecting…" / "Disconnected" + Retry); cached data only; server actions disabled with the reason "Offline" (`04-screen-map.md` §0.4); drafts are kept |
| R-OSPERM | OS permission (camera, microphone, notifications, photos, local network, biometrics) | `PermissionState`: glyph, one-sentence why, "Allow" when not determined, "Open Settings" when denied (Android notifications: channel settings) |
| R-SCOPE | Server scope missing | "Requires <scope label> · Request" → scope-request sheet (MDF-107, MDF-124) |
| R-BUSY | Action in flight | Button spinner + progressive label ("Committing…"), other controls disabled, sheets and modals not dismissible; failure → Callout with the server message + retry; success → the resulting state and a `success` haptic, never a success toast (MD-26) |
| R-CONFIRM | Destructive action | AlertDialog (with `impact` lines) or a confirm sheet listing items (MDF-29), style MDF-03 |
| R-GATEDONE | Gate resolved, expired or answered elsewhere | Resolved row with the gate copy titles (`*_GATE_COPY`), buttons removed |
| R-DIRTY | Leaving unsaved changes | AlertDialog "Discard changes?" · Keep editing / Discard (destructive) |
| R-REVOKED | Device revoked / auth failed | Full-screen `EmptyState` variant with `lock` glyph "This <device noun> was disconnected" + "Pair again" (`app/revoked.tsx`) |

**New `EMPTY_STATE_COPY` keys** (additive): `archivedChats` "No archived chats" / "Chats you archive appear here." ·
`changes` "No changes" / "Files the agent changes appear here." · `backgroundTasks` "No background tasks" / "Work the orchestrator
delegates appears here." · `plan` "No plan yet" / "Plans the agent writes appear here." · `worktrees` "No worktrees" / "Worktrees appear
when a chat or run starts here." · `executions` "No executions yet" / "Each run of this automation appears here." · `skills` "No skills" / "Upload a skill to teach agents a task." · `prompts` "No prompts" /
"Saved prompts appear here." · `mcpServers` "No MCP servers" / "Add a server to give agents more tools." · `templates` "No templates" /
"Templates appear here." · `extensions` "No extensions" / "Installed extensions appear here." · `accessRequests` "No access requests" /
"Requests from other devices appear here." · `versions` "No earlier versions" / "Published versions appear here." · `builderEmpty` "No
stages yet" / "Add the first stage to start." Icons: the module's concept name from the icon registry.

**States per screen**

| Screen (board) | States to derive | Recipe / key |
|---|---|---|
| Home (MHome, MHomeMore) | empty per section, first load, offline subtitle, error, stats with omitted rates | R-EMPTY `needsYou` / `running` / `recentlyFinished`, R-LOAD, R-OFFLINE, R-ERROR; MDF-39 |
| Drawer (MSidebar) | empty lists, overflow > 5, disconnected footer, long server name | MDF-38 |
| Chats (MChats) | empty all, empty archived, no results, first load, paging, selection mode, archived row, error, offline | `chats`, `archivedChats`, R-NORESULT, R-LOAD, MDF-45 |
| Search palette (MSearch) | empty query, searching, no results, offline | MDF-44 |
| Chat (Main, MChatRunning) | transcript loading, reconnecting while streaming, turn error, stopping / force reset, task failed, gate denied / expired / answered elsewhere, workspace preparing / failed | R-LOAD, R-OFFLINE, R-GATEDONE, MDF-46 |
| Composer (MComposer*) | upload progress / failed / too large, dictation denied / no speech / error | MDF-54, MDF-55, R-OSPERM |
| Turn sheet (MModelPicker) | catalogue loading, model unavailable, no ready provider | MDF-48 |
| New chat, agent picker (MNewChat*, MAgentPicker) | model-only and orchestrator forms, validation, creating, failure, no agents, empty search | MDF-52, `agents`, R-NORESULT, R-BUSY |
| Changes tab (MPaneOpen) | no changes, loading, git error, merge in progress (`scm-merge-in-progress`) | `changes`, R-ERROR |
| Commit sheet (MPaneCommit) | validation, working, partial success, errors, dirty close | MDF-60, R-BUSY, R-DIRTY |
| Diff / file preview (MPaneDiff, MPaneFilePreview) | loading, binary, too large, deleted, image, Markdown | MDF-61, MDF-62 |
| Files (MPaneFiles) | loading tree, empty mount, no match | R-LOAD, R-NORESULT |
| Terminal (MPaneTerminal*) | connecting, exited, connection lost, fallback host, workspace not ready, cap reached | MDF-63 |
| Browser (MPaneBrowserStates) | empty, pool full, load failed, access denied, degraded, starting | MDF-64 |
| Tasks, task detail (MPaneTasks, MPaneTaskDetail) | empty, failed, cancelled, worker question, completed | `backgroundTasks`, MDF-65 |
| Plan (MPanePlan) | no plan, older revision, each plan status, edit conflict | `plan`, MDF-66 |
| Computer (MPaneComputer) | consent pending, paused, runtime not ready, no workspace, replay | MDF-67 |
| Projects (MProjects) | empty, archived empty, no results, first load, error | `projects`, R-NORESULT |
| Project detail (MProjectDetail) | no codebases, codebase error / stale, Chats / Runs / Pull requests empty | `codebases`, `chats`, `runs`, `pullRequests`, MDF-100 |
| Codebase, logs (MCodebase*, MCodebaseLogs) | per-filter empty worktrees, removing, partial failure, no log output, fetch failed, completed | `worktrees`, MDF-100 |
| Customization, skill detail (MProjectCustomization, MSkillDetail) | each sub-tab empty, upload progress / error, System skill read-only | `skills`, `prompts`, `agents`, `mcpServers`, MDF-102 |
| Project create / settings (MProjectCreate, MProjectSettings) | validation, creating, clone error, archived variant | MDF-99, MDF-101 |
| Agents (MAgents, MAgentDetail, MAgentEdit*, MAgentImport, MAgentDelete) | empty, no results, built-in, disabled, warnings present, validation, save error, parse error, too large, importing, not-in-use delete | `agents`, MDF-103–106 |
| Workflows (MWorkflows, MWorkflowDetail*) | empty, no results, draft detail with no runs, recent runs empty, import errors | `workflows`, `runs`, MDF-79–81 |
| Run sheet (MWorkflowLaunch*) | required missing, submitting, error, plan loading, blocking plan errors, upload progress / failed | MDF-82 |
| Run (MWorkflowRun, MRunLoop) | running, paused, failed stage, cancelling, cancelled, succeeded with finalize links, setup running / failed, reconnecting, other park reasons | status map, MDF-73, MDF-78 |
| Approval sheet (MRunApproval) | auth cancelled / failed, stale (409), approved, changes requested, last round | MDF-72 |
| Builder, validation (MBuilder*, MWorkflowValidate) | blank canvas, saving, 409 conflict, validating, no problems, warnings only | `builderEmpty`, MDF-70, MDF-87 |
| Automations (MAutomations, MAutomationDetail, MAutomationExecution, MAutomationWebhook) | empty, no results, server down, never run, disabled, last run failed, executions empty, execution running / succeeded / cancelled, credentials reveal-once (webhook deliveries are not rendered: no API) | `automations`, `executions`, MDF-91–92, MDF-94 |
| Automation wizard (MAutomationCreate*) | validation, duplicate name, no workflows in scope, CSV error, creating, create error, credentials reveal | `workflows`, MDF-93–95 |
| Scripts (MScripts, MScriptDetail) | flag off, missing scope, empty, loading, running | `scripts`, MDF-97 |
| Settings sections (MSet*) | admin-required, loading, error, disconnected, provider testing / not installed, MCP setup saving / error, extension load error, storage running / result, diagnostics degraded | R-SCOPE, `mcpServers`, `extensions`, `templates`, MDF-107–120 |
| Security & devices (MSetSecurity*) | no requests, own request pending, revoke / unpair confirms | `accessRequests`, MDF-112 |
| Notifications settings (MSetNotifications) | not determined, denied, provisional, channel off | R-OSPERM, MDF-114 |
| App lock (MSetAppLock) | no biometrics, biometrics changed, lockout | MDF-115 |
| Pairing (MPairing) | camera denied / none, scan success, connecting, wrong server, expired code, success, revoked | MDF-121–122, R-REVOKED |
| Server switcher (MServers) | switching, revoked, auth error, single server | MDF-123 |
| Scope request (MScopeRequest) | pending, approved, denied, expired | MDF-124 |
| Notifications, Live Activity, widgets (MNotifications, MLiveActivity, MWidgets) | failed run, already answered, end states, stale, paused, concurrent, empty widget, not paired | MDF-126, MDF-128, MDF-129 |
| Share to agent (MShortcuts) | not paired, server offline, upload progress / failed | MDF-131 |
| Tablets (MTablet*) | portrait, compact window, split, foldable | MDF-132 |

### O. Data drift in the boards

#### MDF-137 · Sample-data inconsistencies
Boards: listed per row · drift · M4 (fixtures), every phase · send
- **Problem.** Board sample data contradicts itself across boards; it is never rendered (real data comes from the APIs), but stories,
  Maestro fixtures and VRT goldens need one consistent set, and a few drifts hide real questions (answered in the items cited).
- **Build.** Fixtures in `apps/mobile/src/blocks/__fixtures__` use the canonical values below; the designer fixes the boards.

| # | Boards | Drift | Canonical fixture / rule |
|---|---|---|---|
| O-01 | MWorkflowDetailMore, MWorkflowSettings, MBuilderList, MWorkflowLaunch | Variables 5 (with `reviewer_notes`) vs 6 (with `ignore_packages`, `upgrade_policy`) vs "6 variables" | 6 variables: `target_branch`, `max_major_bumps`, `dry_run`, `package_manager`, `reviewer_notes`, `ignore_packages` on every board |
| O-02 | MWorkflowDetailMore, MBuilderList, MStageHooks | Workflow hooks 1 vs 2 | 2 (`on_exit`, `on_failure`); the detail says which version it shows (MDF-80) |
| O-03 | MWorkflowLaunch, MBuilderList, MWorkflowLaunchPlan, MWorkflowValidate | `run_tests` runs Sonnet 5 but the `permission-gating` warning names Codex | `run_tests` on Codex (GPT-5.6-Terra) so the warning is true; warnings name their provider/model |
| O-04 | MStageTools | "Tools 5" badge with 6 items on | Badge counts enabled items (6) (MDF-84) |
| O-05 | MWorkflowNew, MBuilderLoop | Template "3 stages" vs 5 nodes in the created draft | Counts exclude containers: "4 stages · 1 loop" (MDF-81) |
| O-06 | MScriptDetail | "Stages 6 · 1 loop" counts the loop | "5 stages · 1 loop" |
| O-07 | MBuilderList | "Reached only by the two branches above" on Open PR (it follows `run_tests`) | Notes derive from edges; the note belongs to Notify owner |
| O-08 | MWorkflowRunMenu | "Retry failed" enabled with no failed stage; blurred artefact behind it | Items follow state (MDF-74); remove the artefact |
| O-09 | MComponents, MChatToolsExpanded, MChatStepDetail | "4 of 20 failed" vs "3 of 20 failed" | 3 of 20 everywhere |
| O-10 | MChatStepDetail, chat boards | "payments-api" vs "payments-service" unlabelled | Project `payments-service`, codebase `payments-api`; levels labelled (MDF-50) |
| O-11 | MSetSecurityMore | "Pixel 9" is both the requester and the device drawing the screen | Requester "Pixel 8a"; the drawn device is the admin |
| O-12 | MSetSecurity | "12 / 22" scopes | Live count; fixture "12 / 25" |
| O-13 | MSetPairDevice, MPairing | 7-char "4F7-K2Q" and 6-cell input | 12-char codes generated with the shared pairing-code util, shown 3 × 4 |
| O-14 | MAutomations, MAutomationDetail | "12m ago" with next run "Sep 24 02:00" beside "5d ago · Sep 25 16:00" | Fixture clock fixed at 2026-09-23 14:12 America/New_York; all relative and next-run times derived from it |
| O-15 | MAudit | Pane tabs listed as 5 | MD-23 set (MDF-40) |
| O-16 | MStagePolicy | Guard `variables.dry_run == false` on `assess_risk` would skip risk assessment in dry runs | Guard sits on `notify_owner` |
| O-17 | MPaneTerminal | "44×31" on both phones | Computed per width; fixtures 44×31 (iPhone) / 45×33 (Pixel) |
| O-18 | MBuilderList, MWorkflowLaunch, chat meta | Raw ids (`haiku-4-5`) vs display names ("Haiku 4.5", "Claude Sonnet 5" vs "Sonnet 5") | Display names from the model catalogue everywhere; ids only as mono secondary text in pickers |
| O-19 | MPaneOpen, MPaneCommit | "2 files ready" vs 5 listed; "Commits all 2 files" | Mount-scoped count (MDF-59) |
| O-20 | MPaneBrowserStates, MPaneBrowser | "one per chat" vs two pages in one chat | Desktop pool copy (MDF-64) |
| O-21 | MComponents, chat boards | Pane badge 10 vs 11 | Mono 12 (MDF-41) |
| O-22 | MHome | "Need you" (tile) vs "Needs you" (section) | "Needs you" everywhere |
| O-23 | MSettings, MSetProviders | "1 of 2 connected" | Live; fixture "1 of 5 connected" |
| O-24 | helmet CSS (all boards), MPrinciples | Dead `.itab`, `.isearch`, `.anav` tab-bar CSS (MF-04); comment "iOS 26 Liquid Glass" vs iOS 27 labels; "17 themes × 6 accents" | Remove the dead CSS; label iOS 27; "18 themes × 7 accents" |
| O-25 | MLiveActivity, MChatRunning | "12:40" (Live Activity) vs "4:12" (chat) with no unit | Elapsed format m:ss under an hour, h:mm:ss above, "elapsed" in accessible labels (MDF-128) |
| O-26 | Main | The user bubble renders clipped past the 16 gutter in the PNG | Board defect; bubbles max-w 320/330 inside the gutter |

---

## 3. Send to designer (paste-ready)

Round-4 requests for the mobile canvas, grouped by board. Each line is short enough to paste as a board comment; the MDF id points
to the full reasoning. The build already follows these resolutions and does not wait.

### Whole canvas (helmet and every board)

- One filled button per screen; Send / Approve / Run win when present; header confirms are text buttons, selection sheets close with a
  header "Done", action sheets pin one full-width primary at the bottom (MDF-02, MDF-26, MD-85).
- One destructive style: `err` text on a secondary button; no red fills, no `err-bg` buttons (MDF-03).
- Status colour only for the 8 states; neutral badges for Active/Orphaned/Custom/Needs setup/risk/Draft/Published; no tinted rows,
  bars, cards or banners except the gate-card header (MDF-04, MDF-05, MDF-06).
- Targets ≥ 44 pt / 48 dp; rows min 52/56 (dense 44/48); text ≥ 11 pt / 12 sp, mono ≥ 12; weights 400/500/600; min-heights, not fixed
  heights (MDF-07–MDF-10).
- Glass only on floating chrome, toasts and floating toolbars; system menus/sheets are system material; JS popovers opaque (MDF-11).
- Biometric and device nouns are runtime values (Face ID / Touch ID / Fingerprint / Face unlock; This iPhone / iPad / phone / tablet) (MDF-15).
- Controls: one spec each for buttons (md 44/40, sm 36, lg 50/48), search (iOS h44, Android h56 / h48 in sheets), segmented (≤ 4, else
  Select), switch (native), choice indicators, chips/badges, lists, swipe, fields, sheets, full-screen headers, menus, confirms, toasts,
  gate cards, empty states (MDF-16–MDF-32).
- Draw empty / loading / error / offline / permission / scope / in-flight states with the recipes in MDF-136.
- Fix the sample-data drift listed in MDF-137.

### Overview

- **MAudit** — pane tabs are Changes, Files, Terminal, Browser + contextual Tasks, Plan, Computer (MDF-40, O-15).
- **MPrinciples** — restate principle 6 as "one filled primary per screen" (MDF-02); status row with all 8 states incl. Waiting and
  Skipped (MDF-06); "18 themes × 7 accents" (MDF-12); IA presentations per MD-21: New chat = sheet, approval = sheet, builder / agent
  editor / MCP add / stage editor / new workflow / project create / automation wizard = full-screen modal (MDF-37); drawer switches reset
  the module stack (MDF-35); label iOS 27 (O-24).
- **MFoundations** — Android top-level title in the bar, Home alone with the M3 medium flexible bar (MDF-36, MD-94); row rule 52/56 + dense 44/48 (MDF-07); glass list incl.
  toasts and floating toolbars (MDF-11); haptic table with distinct reject/fail on iOS (MDF-14); name the spring parameters (MDF-13).
- **MComponents** — composer: Send disabled when empty, "Reply to <agent>…" while running, gate-pending reason + "Cancel and send",
  Android mic in the action row, agent chip in every state (MDF-46, MDF-47); remove the "Turn setup" sheet (MDF-48); one gate-card shell
  r20/16 (MDF-31); step rows 44/48 (MDF-50); pane badge mono 12 (MDF-41); Chats header Select + Sort (MDF-45); Android swipe = two pills
  (MDF-24); iOS off switch = system (MDF-20); segmented = native (MDF-19); toasts: placement, timing, swipe dismiss (MDF-30); drop
  "long-press to multi-select" (MDF-43).
- **MGestures** — no Android edge swipe for the drawer (MDF-33); no predictive-back peek (MDF-34); tab switching is tap-only, no body
  swipe (MDF-40); add iOS pull-to-refresh, toast swipe, keyboard shortcuts (MDF-43, MDF-135); one terminal key row incl. ^C (MDF-63);
  reorder only for linear stages (MDF-71).

### Home and navigation

- **MHome / MHomeMore** — tiles with glyph + "Needs you"; Review/Open as `sm` buttons (hit 44/48); FAB content inset; running timer vs
  clock styling; "This week" = ISO week (MD-84), "Avg run" and rates from the stats API, a missing rate omitted (never "—"); no PR items
  until MG-13; empty/loading/offline states (MDF-39); Android title per MDF-36.
- **MSidebar / MSidebarChats** — live rows 44/48 with the platform radius; cap 5 + "Show all" (Needs you → full list, Running → Home);
  hide empty sections; disconnected footer (MDF-38); button-only open on Android (MDF-33).
- **MSearch** — weight 600 highlight (MDF-09); status glyph on recent chats; "Toggle theme" cycles System → Light → Dark and names the
  next mode; empty query, searching, no results, offline (MDF-44).
- **MServers** — ✕ at the start (iOS; Android at the end) and a "Done" text action; no `selected` fill on groups (✓ marks current);
  switching / revoked / auth error / single-server states (MDF-123).
- **MScopeRequest** — card opens a scope-request sheet; pending / approved / denied / expired; Run is the one filled button (ink on
  iOS too) (MDF-124, MDF-02).
- **MPairing** — 12-character code in 3 groups of 4; title on the ramp; editable address; camera-denied, success, connecting, wrong
  server, scope summary, revoked (MDF-121, MDF-122).

### Chat and composer

- **Main** — back + breadcrumb instead of the sidebar toggle (MDF-01); Send disabled while the gate is pending (MDF-46); no "Always
  allow"; denied / expired states (MDF-49); fix the clipped bubble (O-26).
- **MChatRunning** — placeholder "Reply to Orchestrator…"; status strip kept; pane badge = changes, never `run`-blue (MDF-46, MDF-41).
- **MChatToolsExpanded / MChatStepDetail** — rows 44/48; step-nav 44; "Step 4 of 6" as subtitle; label codebase vs project; running /
  succeeded / Read / Edited variants (MDF-50).
- **MChatNoAgent** — changes strip rules for every chat (MDF-51); Send disabled when empty (MDF-46).
- **MChats** — Select + Sort; no title count; no Pinned / unread until the API; selection mode + bulk bar; archived rows (MDF-45, MDF-36).
- **MModelPicker** — "Done" as a header text action; provider list for 5 providers; rows 52/56; section headers everywhere; loading /
  unavailable / no-provider states (MDF-48).
- **MComposerPlus** — native menu; "Workflows" as a checked item (only when registered); "Commands & skills" (MDF-54).
- **MComposerInput** — "@" mention popover; attachment chip h40 with 44/48 remove hit; upload / failed / too-large states (MDF-54, MDF-22).
- **MComposerVoice** — keep-text button with a ✓ glyph; permission / no-speech / error states (MDF-55).
- **MNewChat / MNewChatMore** — draw as a large sheet with the "Create chat" footer; drop "Orchestrate mode"; "Add server folder" (a
  folder browser page inside the sheet); pickers as pages in the same sheet; Browser segment → Select at large text; validation /
  creating / failure (MDF-52).
- **MAgentPicker / MAgentPickerCaps** — no "No agent" row, no "Manage"; one footer primary "Use <agent>"; "Customize capabilities" as a
  row opening a page inside the same sheet on both OSes, on the existing per-chat overrides (MDF-53, MDF-26).
- **MChatWorkflowRun** — review card in the gate-card shell with a single "Review"; stacked actions on narrow widths; Publish secondary
  (MDF-56, MDF-31).

### Workspace pane

- **MPaneOpen** — contextual tabs; Keep / Keep all / Undo all + Kept group; 3-way compare; mount-scoped footer count; scrubber labels mono
  12 and "Now"; rewind scope menu (MDF-40, MDF-58, MDF-59).
- **MPaneTabsOverview** — remove "swipe the pane body"; badge = changes + warn dot for Plan/Computer (MDF-40, MDF-41); no Widget tab in
  this pass (MDF-68).
- **MPaneChanges** — Keep/Unkeep in the row menu; Discard confirm (MDF-58).
- **MPaneDiff** — 5 intents; old/new gutters (tap the gutter to comment); "Comment" toolbar button; long-press = line menu; syntax colour; More contents; mount in the breadcrumb; thread and
  loading/binary/too-large states (MDF-61).
- **MPaneCommit / MPaneCommitDone** — mount picker, Generate, push/PR switches, one primary with a flow label, progress / partial /
  error states (MDF-60).
- **MPaneFiles / MPaneFilePreview** — mono 12; Edit sources destination; Share = file; syntax colour; line menu; B-09 states (MDF-62).
- **MPaneTerminal / MPaneTerminalFull** — one key row (esc, tab, ctrl, alt, ^C, arrows, paste, find); keys ≥ 44/48; session names from
  the server; fixed "+" button; Kill confirm; Find; hardware-keyboard behaviour; connection states (MDF-63, MDF-58).
- **MPaneBrowser / MPaneBrowserStates** — neutral agent strip and state Callouts; pinch zoom; no DevTools group; desktop pool copy;
  denied / degraded / starting (MDF-64).
- **MPaneTasks / MPaneTaskDetail** — status words mapped; no wave / worker limit / brief / "See in Changes" until data; row cancel;
  empty / failed / cancelled / asks (MDF-65).
- **MPanePlan** — tap a step → "Comment" (long-press = menu); neutral comment highlight; Save to workspace; plan status states (MDF-66).
- **MPaneComputer** — no Take over, no Screen video, no fps / "Watching since"; consent / paused / not-ready / replay states (MDF-67).

### Workflows

- **MWorkflows** — no glyph for never-run drafts; tags drop before the title; neutral swipe "Run" that opens the sheet (MDF-79).
- **MWorkflowDetail / MWorkflowDetailMore** — neutral version badge saying which version is shown; graph / "View all" / "Versions"
  destinations; content inset under Run (MDF-80, MDF-17).
- **MWorkflowNew / MWorkflowNewBasics** — header Cancel + Create; template filter as chips; stage counts exclude containers; no "up to
  3"; Agent before Model (MDF-81).
- **MWorkflowLaunch / Advanced / Plan** — no "1 of 2"; split skip checkbox from the overrides tap; display names; "Default: server";
  data-driven effort; neutral warning card; required / submitting / error states (MDF-82, MDF-05).
- **MWorkflowRun** — collapse the lifecycle strip; gate-card-framed banner; named context chip; no "Guarded" status; all run states
  (MDF-73).
- **MWorkflowRunMenu** — destructive last; Retry failed only when failed; no engine words (MDF-74).
- **MRunStageChat** — no model chip; stage menu with submenus and renamed items (MDF-75, MDF-74).
- **MWorkflowRunPane / MRunApproval** — one approval sheet from every surface; biometric flow as `localizedReason` only; neutral risk
  values; generic JSON output rule (MDF-72, MDF-76).
- **MRunGraph** — edges without status colours; minimap hidden from a11y; node tap target; distinct Events glyph (MDF-77).
- **MRunLoop** — recommended action by park reason; "+1 iteration"; 1-based iterations; label both budgets (MDF-78).
- **MBuilderList / MBuilderGraph / MBuilderLoop** — full-screen modal; 2 icons + overflow on Android; read-only graph without a selection
  bar; no edge editing; linear-only reorder with Move up/down; "Save and run"; toolbar Run is secondary (no bottom primary in a modal)
  (MDF-69–MDF-71); loop rules beyond simple fields show "Edit on desktop" (MDF-85).
- **MWorkflowAgentDraft** — Publish is the only primary; neutral risk chips; single-version restore, two-version diff; who can publish
  (MDF-88).
- **MWorkflowSettings** — grouped section list on iPhone; "Edit workflow" crumb; "Saved with the workflow draft" (MDF-89).
- **MWorkflowValidate** — quick fixes wrap; no-problems / validating / warnings-only states (MDF-87).
- **MStagePrompt / MStageModel / MStageTools / MStageOutput / MStagePolicy(More) / MStageHooks** — scrollable tabs; chips only in the read
  view; Mode "Full"; Provider before Model; single home for Max turns and capabilities; syntax tokens not status colours; ✓ on iOS
  multi-select chips; trailing switches; "Edit on desktop" rows (MDF-83–MDF-86, MDF-21).

### Automations and scripts

- **MAutomations** — no opacity on disabled rows; switch with its own hit area; mapped status words; server-time-zone dates (MDF-91).
- **MAutomationDetail / MAutomationExecution** — neutral rows with a glyph; `sm` "Review" that closes the execution sheet and opens the
  approval sheet; execution as a sheet; no Event log (no API); cancel confirm; config editors reuse wizard pages (MDF-92, MDF-96).
- **MAutomationWebhook** — reveal-once sheet after create and rotate; no "Copy URL" on the masked URL; lock icons non-interactive; rotate
  confirm + step-up (MDF-94).
- **MAutomationCreate1–4** — six pages, one node each; compact stepper; no "Save draft" until the API; Manual / Webhook / Weekly / Cron
  variants; workflow reorder; multi-field dataset rows; typed variables; tappable review rows (MDF-93–MDF-95).
- **MScripts / MScriptDetail** — "Search scripts"; one-time info card; disabled-flag and missing-scope states; stage counts; run sheet with
  step-up; title size (MDF-97).

### Projects

- **MProjects** — no title count; archived / empty states (MDF-101, MDF-36).
- **MProjectCreate / MAddCodebase** — server-path browser for local sources; labels Git remote / Git on server / Folder on server; Add
  codebase's primary in the sheet footer, New project's in the header; retention as a Select; text field for the default branch until
  the API; form states (MDF-99).
- **MProjectDetail** — add the Pull requests tab (MDF-98); fetch shows the latest log line, no percentage bar; neutral worktree badges
  (MDF-100).
- **MProjectSettings** — "Save settings" moves to the header "Save"; archive with undo; delete as an alert with impact lines (MDF-101).
- **MCodebase / MCodebaseFiles / MCodebaseLogs** — neutral badges; "Clean up" confirm sheet listing worktrees and sizes, without a red
  fill; Worktrees / Files as a tab row; Markdown toggle; log failed / completed / empty (MDF-100, MDF-03).
- **MProjectCustomization / MSkillDetail** — global-off locks the project switch; per-sub-tab New label; "View source"; Edit opens a
  full-screen editor; System skill read-only (MDF-102).

### Agents

- **MAgents / MAgentDetail / MAgentDelete** — built-in variants; "Disable agent" alert with the usage line for in-use deletes;
  destructive style (MDF-104).
- **MAgentDetailOrch** — locked capability as a read-only row (MDF-106).
- **MAgentNew** — stock single-choice indicators; footer "Continue" (MDF-106).
- **MAgentImport** — sheet on both OSes; parse preview only with the dry-run API (MDF-105).
- **MAgentEdit1–3** — full-screen modal with Cancel + Save; dirty count in the header, no tinted bar; flat Android groups; tri-state as
  Inherit / On / Off; effort Select above 4 levels; MCP copy (MDF-103).

### Settings

- **MSettings / MSettingsMore** — Android headers at 16; collapsing large title; server-card states (MDF-120).
- **All MSet\* sections with writes** — "Requires admin access · Request" state (MDF-107).
- **MSetGeneral / MSetProviders** — 5 providers; Sign in / Sign out / Make default; provider Select in the default-model sheet;
  "This device" for the default model (MDF-108, MDF-109).
- **MSetAppearance / MThemesPhone** — previews in the current mode; text size follows the OS (no slider); Motion rows System / On / Off;
  ink default; 18 × 7 (MDF-117, MDF-12).
- **MSetAgents / MSetSkills** — reuse the Agents list; Skills copy "aren't offered on this device" (MDF-106, MDF-109).
- **MSetMcp / MSetMcpAdd** — neutral badges; setup in a sheet; Add as full-screen modal; HTTP/SSE variant; project-scoped servers too
  (MDF-110).
- **MSetTemplates** — row tap = preview; "Use" creates and opens the builder (MDF-119).
- **MSetSourceControl** — "Sign in with GitHub" device flow first; token as a fallback (MDF-111).
- **MSetBrowserTerminal** — "This device" footer; server-OS-aware shell rows (MDF-109).
- **MSetComputerUse / MSetAudio** — step-up on enable; runtime states; no Dictation language until the API; model-download states
  (MDF-118).
- **MSetExtensions / MSetStorage / MSetDiagnostics** — locked built-ins; one "Clean up" verb; `HEALTH` wording; no Server log, Export
  or update check until their APIs (MDF-119).
- **MSetSecurity / MSetSecurityMore** — Loopback / Network only; "Restart the server to apply"; live scope count; non-self-referential
  request; revoke / unpair confirms (MDF-112).
- **MSetPairDevice** — 12-char code; no Share; presets from the shared table; no Device row; expired / consumed states (MDF-113).
- **MSetNotifications** — permission states first; no digest / quiet hours / per-project levels; pause notifications; channel links
  (MDF-114).
- **MSetAppLock** — Computer use in "Ask before"; "Hide details on the Lock Screen"; no-biometrics / changed / lockout (MDF-115).
- **MSetWidgets** — replace the Control Center / tile switch with guidance + "Add tile"; refresh copy; approval copy per MD-31; disabled
  and none-placed states (MDF-116).

### System surfaces and tablets

- **MNotifications** — unlock-only actions for ordinary approvals, "Review" (opens the app) for risky ones; destructive Deny; redacted
  Lock Screen content; server name when several are paired; failed-run notification; drop "Pause agents" (MDF-125–MDF-127).
- **MLiveActivity** — unambiguous elapsed time; end states (dismissed after 15 min, failures after 30 min) / stale / paused / concurrent
  states; system-tinted Android chip (MDF-128).
- **MWidgets** — 12 sp on Android; tinted / dynamic-colour variants with glyphs; only the "New chat" control and tile (MDF-129, MDF-127).
- **MShortcuts** — "Run workflow…" opens the search palette filtered to workflows (no run picker); share target with a server row,
  status glyphs, one field style, new-chat hand-off (MDF-130, MDF-131).
- **MTabletIOS / MTabletAndroid** — portrait, 600–839 and compact layouts; Keep / Keep all / Undo all; Android rows ≥ 48; every tab on
  both platforms; docked-pane pushes; keyboard shortcuts (MDF-132–MDF-135, MDF-58).
