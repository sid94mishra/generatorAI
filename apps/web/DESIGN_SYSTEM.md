# GeneratorAI Web — Design System

The web app and the Electron desktop app render the same SPA from one kit. **All UI is built from the kit in `src/ui` and the shared parts in `src/blocks`** — never hand-roll a button, field, menu, dialog, table or badge. The design spec is [`docs/redesign/02-design-system-spec.md`](../../docs/redesign/02-design-system-spec.md); binding decisions are in [`docs/redesign/01-decisions.md`](../../docs/redesign/01-decisions.md); Storybook (`pnpm --filter @generatorai/web storybook`) is the visual catalogue of every component in every state.

## 1. Layers

| Folder | Holds | May import |
|---|---|---|
| `src/ui/primitives` · `patterns` · `templates` · `shell` | Presentational kit: Base UI + `cva` + design utilities | `ui/*` only — no stores, platform, react-query, router |
| `src/ui/icons` | Icons by **concept name** (`<Icon concept="branch" />`) over lucide | — |
| `src/blocks/<domain>` | Query-aware parts shared by two or more features | `ui`, hooks, stores — no `features` |
| `src/features/<domain>` | Pages and their domain parts | `ui`, `blocks`, `hooks/*Queries.ts`, stores — no other feature |
| `src/app` | Router modules, registries, shell wiring, providers glue | everything |

The boundaries are ESLint errors (`eslint-plugin-boundaries`, root `eslint.config.mjs`). A folder that is not a declared layer fails lint.

## 2. Tokens and theming

The source of truth is [`packages/design-tokens`](../../packages/design-tokens/). `pnpm tokens:write` regenerates the token layers in [`src/styles/globals.css`](./src/styles/globals.css) (between the `@generated-tokens` markers), [`css/vocabulary.css`](../../packages/design-tokens/css/vocabulary.css) and the mobile token module; `pnpm check:tokens` fails CI when any of them is stale. **Never hand-edit generated blocks.**

### Axes

| Axis | Values | DOM | Storage key |
|---|---|---|---|
| Mode | `light` / `dark` / `system` | `.light`/`.dark` class + `data-mode` | `generatorai-theme` |
| Theme | 18 palettes (below), default `instrument` | `data-theme` | `generatorai-theme-palette` |
| Accent | `ink` (default), `blue`, `violet`, `green`, `orange`, `rose`, `teal` | `data-accent` | `generatorai-accent` |
| Density | `comfortable` / `compact` | `data-density` | `generatorai-density` |
| Font size | 12, 13 (default), 14 px interface size | `data-font-size` | `generatorai-font-size` |
| Motion | full / reduced (setting or OS) | `data-motion` | `generatorai-reduce-motion` |

| Group | Themes |
|---|---|
| Product | `instrument` (default), `github`, `graphite`, `carbon`, `clay` |
| Editor | `one`, `dracula`, `tokyo-night`, `catppuccin`, `ayu`, `night-owl`, `rose-pine` |
| Reading | `nord`, `everforest`, `gruvbox`, `solarized`, `flexoki`, `contrast` |

Every theme × mode × accent (18 × 2 × 7 = 252) is asserted against WCAG AA in `packages/design-tokens/src/__tests__/tokens.test.ts`; `contrast` targets AAA. An accent recolours interactive chrome only; status colours never follow the accent.

### CSS layers (generated)

1. **Shared values** — `--font-sans/--font-mono`, `--canvas-*`, `--chart-1…6`, `--syntax-*` (the Shiki theme of `ui/patterns/CodeBlock`), `--file-icon-*`; per theme × mode.
2. **Design values** — `--gai-*` colours per theme × mode × accent, plus the scales (`--gai-h-*` density, `--gai-text-*` type, `--gai-radius-*`, `--gai-duration-*`, `--gai-z-*`, `--gai-w-*`).
3. **Vocabulary** — `css/vocabulary.css` maps them to Tailwind utilities: `bg-surface`, `text-fg-2`, `border-line-soft`, `text-ui`, `rounded-card`, `h-control`, `shadow-pop`, `z-dialog`, `w-sidebar` …

Tailwind's default colour, type-size, radius and shadow namespaces are reset (`src/styles/theme-reset.css`, P7-02): `bg-blue-500`, `text-sm`, `rounded-lg` and `shadow-md` do not exist. The emission order in [`emit/css.ts`](../../packages/design-tokens/src/emit/css.ts) is load-bearing — `.light[data-theme]` and `[data-theme][data-accent]` tie on specificity and are resolved by source order.

**Adding a theme:** add `packages/design-tokens/src/themes/<id>.ts` (a `ThemeDef`), register it in `themes/index.ts`, run `pnpm tokens:write`. Pickers, CSS, terminal palette, syntax colours and the WCAG suite all read the registry.

**Consumers that need literals** (xterm.js, canvases) read `resolveTerminalPalette()` / the token package, never `getComputedStyle`. [`src/providers/ThemeProvider.tsx`](./src/providers/ThemeProvider.tsx) is the only writer of the axes; the pre-paint script in [`index.html`](./index.html) mirrors it before first paint.

## 3. Rules

- **Only design utilities.** Forbidden: arbitrary values (`text-[11px]`), hex/rgb in TS, `var(--…)` in class strings, palette and default-namespace classes, `text-white/black`, literal inline styles (inline `style` is for computed geometry only).
- **Variants via `cva`, merging via `cn()`** from `@/ui/lib/cn` (a tailwind-merge config generated from the vocabulary).
- **Icons by concept** from `@/ui/icons`; floating layers carry `data-gai-overlay` (the kit primitives do this); a surface that owns every key carries `data-gai-keys="own"`.
- **One component, one place.** Check Storybook before building; if a component almost fits, add a variant in `ui/` with a story. A new `ui/` component ships with a story covering its variants and states, and passes the axe check.
- **No fake data** (D-36): a designed element whose API does not exist is not rendered.
- **Selectors are stable** (`docs/redesign/09-verification.md` §7.2): a ported element keeps its test id, role and accessible name.
- **Loading:** skeletons for predictable shapes, spinners only inside controls. **Errors:** inline next to what failed; toasts for transient out-of-context events (`toast` from `@/ui/primitives/Toast`).

### Enforcement

| Check | Command | What it holds |
|---|---|---|
| ESLint | `pnpm --filter @generatorai/web lint` | layer boundaries, vocabulary (`better-tailwindcss`), raw elements, restricted imports — all errors |
| Design ratchet | `pnpm --filter @generatorai/web check:design --strict` | every rule locked at 0 ([`design-system-baseline.json`](./design-system-baseline.json)) |
| CSS emission | `pnpm --filter @generatorai/web check:css` | required utilities built and token-backed for all 18 themes × 2 modes |
| Tokens | `pnpm check:tokens` | generated files current |
| Stories + a11y | `pnpm --filter @generatorai/web test:stories` | every kit component renders in three appearances with axe passing |
| This index | `pnpm --filter @generatorai/web docs:design-index --check` | the tables below match `src/` |

## 4. Kit index

<!-- design-index:start — generated by `pnpm --filter @generatorai/web docs:design-index`; do not edit by hand -->

### Primitives (49) — `@/ui/primitives/<Name>/<Name>.js`

| ID | Component | Inventory name | Story |
|---|---|---|---|
| P-11 | `AgentGlyph` |  | ✓ |
| P-32 | `AlertDialog` | AlertDialog + useConfirm | ✓ |
| P-19 | `Autocomplete` |  | ✓ |
| P-10 | `Avatar` |  | ✓ |
| P-05 | `Badge` |  | ✓ |
| P-02 | `Button` |  | ✓ |
| P-40 | `Callout` |  | ✓ |
| P-48 | `Card` |  | ✓ |
| P-21 | `Checkbox` |  | ✓ |
| P-09 | `Chip` | Chip + ChipList | ✓ |
| P-45 | `Collapsible` | Collapsible + Accordion | ✓ |
| P-18 | `Combobox` |  | ✓ |
| P-08 | `Count` |  | ✓ |
| P-31 | `Dialog` |  | ✓ |
| P-41 | `EmptyState` |  | ✓ |
| P-16 | `Field` |  | ✓ |
| — | `FileInput` |  | ✓ |
| P-39 | `Gauge` |  | ✓ |
| P-01 | `Icon` | Icon lives in ui/icons next to its registry | ✓ |
| P-03 | `IconButton` |  | ✓ |
| P-44 | `InlineCode` |  | ✓ |
| P-13 | `Input` |  | ✓ |
| P-04 | `Kbd` |  | ✓ |
| P-42 | `Link` |  | ✓ |
| P-30 | `Menu` |  | ✓ |
| P-27 | `NavItem` |  | ✓ |
| P-20 | `NumberField` |  | ✓ |
| P-29 | `Popover` |  | ✓ |
| P-38 | `ProgressBar` | ProgressBar / Meter | ✓ |
| P-24 | `RadioCard` |  | ✓ |
| P-23 | `RadioGroup` | RadioGroup / Radio | ✓ |
| P-36 | `ScrollArea` |  | ✓ |
| P-14 | `SearchInput` |  | ✓ |
| P-25 | `SegmentedControl` |  | ✓ |
| P-17 | `Select` |  | ✓ |
| P-35 | `Separator` |  | ✓ |
| P-33 | `Sheet` |  | ✓ |
| P-37 | `Skeleton` |  | ✓ |
| P-46 | `Slider` |  | ✓ |
| P-12 | `Spinner` |  | ✓ |
| P-06 | `StatusBadge` |  | ✓ |
| P-07 | `StatusDot` |  | ✓ |
| P-22 | `Switch` |  | ✓ |
| P-43 | `Table` | Table parts | ✓ |
| P-26 | `Tabs` |  | ✓ |
| P-15 | `Textarea` |  | ✓ |
| P-34 | `Toast` |  | ✓ |
| P-47 | `Toolbar` |  | ✓ |
| P-28 | `Tooltip` |  | ✓ |

### Patterns (36) — `@/ui/patterns/<Name>/<Name>.js`

| ID | Component | Inventory name | Story |
|---|---|---|---|
| C-16 | `ActionBar` |  | ✓ |
| C-08 | `ActivityRow` |  | ✓ |
| C-29 | `Banner` |  | ✓ |
| C-02 | `Breadcrumb` |  | ✓ |
| C-06 | `BulkActionBar` |  | ✓ |
| C-26 | `ChoiceCardGrid` |  | ✓ |
| C-23 | `CodeBlock` |  | ✓ |
| C-21 | `CommandList` |  | ✓ |
| C-05 | `DataTable` |  | ✓ |
| C-33 | `DiffStat` |  | ✓ |
| C-19 | `DockTabStrip` |  | ✓ |
| C-31 | `Dropzone` |  | ✓ |
| C-09 | `EntityCard` | EntityCard / CardGrid | ✓ |
| C-07 | `EntityRow` |  | ✓ |
| C-04 | `FilterBar` |  | ✓ |
| C-32 | `FindWidget` |  | ✓ |
| C-14 | `FormSection` |  | ✓ |
| C-30 | `GateCardFrame` |  | ✓ |
| C-18 | `Inspector` |  | ✓ |
| C-27 | `KbdHintRow` |  | ✓ |
| C-11 | `KeyValueList` |  | ✓ |
| C-34 | `ListPane` |  | ✓ |
| — | `Markdown` |  | ✓ |
| C-22 | `MenuButton` | MenuButton / SplitButton | ✓ |
| C-35 | `ModalForm` | ModalForm body | ✓ |
| C-01 | `PageHeader` |  | ✓ |
| C-03 | `PageTitle` |  | ✓ |
| C-28 | `PairingCodeInput` |  | ✓ |
| C-12 | `SectionHeader` |  | ✓ |
| C-13 | `SettingsSection` | SettingsSection / SettingRow / SettingsTable | ✓ |
| C-20 | `SplitPane` |  | ✓ |
| C-10 | `StatStrip` | StatStrip / StatTile | ✓ |
| C-17 | `Stepper` |  | ✓ |
| C-25 | `StepRail` |  | ✓ |
| C-15 | `SummaryAside` |  | ✓ |
| C-24 | `TerminalFrame` |  | ✓ |

### Page templates (10) — `@/ui/templates/<Name>/<Name>.js`

| ID | Component | Inventory name | Story |
|---|---|---|---|
| L-04 | `CanvasEditor` |  | ✓ |
| L-01 | `Dashboard` |  | ✓ |
| T-02 | `DetailPage` |  | ✓ |
| T-03 | `FormWithAside` |  | ✓ |
| L-03 | `Gate` |  | ✓ |
| T-01 | `ListPage` |  | ✓ |
| T-05 | `MasterDetail` |  | ✓ |
| L-05 | `ModalWithAside` |  | ✓ |
| L-02 | `Wizard` |  | ✓ |
| T-04 | `Workspace` |  | ✓ |

### Shell (14) — `@/ui/shell/<Name>/<Name>.js`

| ID | Component | Inventory name | Story |
|---|---|---|---|
| S-01 | `AppFrame` |  | ✓ |
| S-10 | `CommandPaletteFrame` |  | ✓ |
| S-08 | `DockFrame` |  | ✓ |
| S-12 | `FindBarFrame` |  | ✓ |
| S-07 | `MacTrafficLightRow` |  | ✓ |
| S-04 | `MainCard` |  | ✓ |
| S-09 | `NarrowDockSheet` |  | ✓ |
| S-03 | `Rail` |  | ✓ |
| S-11 | `SettingsModalFrame` |  | ✓ |
| S-02 | `Sidebar` |  | ✓ |
| — | `SidebarFlyout` |  | ✓ |
| S-06 | `TitleStrip` |  | ✓ |
| S-13 | `ToasterRegion` |  | ✓ |
| — | `UpdatePill` |  | ✓ |

### Blocks — query-aware parts shared by two or more features

| Folder | Components |
|---|---|
| `blocks/agent-picker` | `AgentPicker` |
| `blocks/browser` | `AgentBrowsingStrip`, `BrowserEmptyState`, `BrowserPanel`, `BrowserToolbar`, `CommentsPopover`, `DeviceEmulationBar`, `NativeBrowserView`, `useBrowserAnnotations`, `useBrowserCapture`, `useBrowserDescriptor`, `useBrowserEvents`, `useBrowserLiveInput`, `useBrowserLiveStream`, `useBrowserNavigation`, … (18) |
| `blocks/capabilities` | `CapabilityToggleList`, `EffectiveCapabilities` |
| `blocks/changes` | `ChangeFileRow`, `ChangesDockPanel`, `ChangesPanel`, `ChangesToolbar`, `CheckpointScrubber`, `CheckpointScrubberView`, `CommentsPopover`, `CompareBar`, `MountGroupsBar`, `PendingCommentsBar`, `useChangesEditor`, `useChangesModel`, `useChangesNavigation`, `useChangesViewSettings`, … (21) |
| `blocks/chats-table` | `chatsColumns` |
| `blocks/composer` | `AttachmentChips`, `Binding`, `BlockingBar`, `ChangesTray`, `Composer`, `ComposerMenu`, `ComposerSkeleton`, `ContextGauge`, `DictationControl`, `SendStopButton`, `SourcesChip`, `ToolbarMenu`, `ToolsPopover`, `useComposerDraft`, … (22) |
| `blocks/diff` | `DiffCodeView`, `DiffProviders`, `FloatingCard`, `ReviewComposerPopover`, `ReviewThreadCard`, `useDocumentAppearance` |
| `blocks/directory-browser` | `DirectoryBrowser` |
| `blocks/dock` | `Dock`, `useActivated`, `useDockLinkParam`, `useDockOpen`, `useDockState`, `useSurfaceDockTabs` |
| `blocks/editor` | `useEditorActions` |
| `blocks/files` | `FileCodeView`, `FilesPanel`, `FileTree`, `FileViewer`, `MountFileTree`, `SourcesBlock`, `useFileTabs` |
| `blocks/model-picker` | `ModelPicker` |
| `blocks/plan` | `PlanPanel` |
| `blocks/scm` | `CommitBar`, `CommitBarView`, `ScmConflictActions`, `ScmConflictCard`, `ScmResultCard`, `useCommitBar` |
| `blocks/sources` | `SourcePicker` |
| `blocks/terminal` | `AgentConsole`, `TerminalPanel`, `useTerminalSession`, `useXtermInstance` |
| `blocks/transcript` | `AgentTurnHeader`, `AssistantText`, `AttachmentList`, `BackgroundStepTail`, `ComputerConsentCard`, `DelegationGroup`, `DiffSnippet`, `InlineError`, `PermissionCard`, `PlanReadyCard`, `QuestionCard`, `StepList`, `ThoughtPill`, `ToolCallCard`, … (21) |
| `blocks/widgets` | `WidgetFrame`, `WidgetHost` |
| `blocks/workflow` | `CanvasGroupNode`, `CarryTable`, `ExitRuleTable`, `IterationsTable`, `ProblemsPanel`, `RunDialog`, `RunPlanPreview`, `StageKindPalette`, `VersionHistoryPanel`, `WorkflowChips` |

<!-- design-index:end -->
