// ────────────────────────────────────────────────────────────────
// Icon concept registry (D-17, 02-design-system-spec.md §6.6, §9).
//
// Code names CONCEPTS ("changes", "status-running"), never glyphs. Each
// concept resolves to one lucide icon (kebab-case name) for web, and — filled
// in the mobile pass — an SF Symbol (iOS) and a Material Symbol (Android).
// `apps/web/src/ui/icons` maps concepts to lucide components; direct
// `lucide-react` imports anywhere else are lint errors.
//
// `lucide` holds the name in the lucide-react version apps/web has INSTALLED
// (0.460 until P1-U5). `lucide1` is set only where lucide-react 1.x renamed or
// removed that icon, so P1-U5 can switch without re-deriving the mapping:
// after the upgrade, `lucide1 ?? lucide` is the name (1.x keeps the old names
// only as deprecated aliases). Checked file by file against
// lucide-react 1.48.0 (apps/web/src/__tests__/lib/iconConcepts.test.ts checks
// the installed version).
// ────────────────────────────────────────────────────────────────

export interface IconConceptDef {
  /** lucide icon name (kebab-case) in the installed lucide-react. */
  lucide: string;
  /** lucide 1.x name, only when it differs from `lucide`. */
  lucide1?: string;
  /** SF Symbol name (iOS) — mobile pass. */
  sfSymbol?: string;
  /** Material Symbol name (Android) — mobile pass. */
  material?: string;
}

/** Icon sizes (px) → Tailwind `size-3`, `size-3.5`, `size-4`, `size-5`. Stroke scales with the 24 viewBox. */
export const ICON = { sizes: [12, 14, 16, 20] as const, defaultSize: 16, strokeWidth: 1.75 } as const;
export type IconSize = (typeof ICON.sizes)[number];

/** The Foundations board's 48 concepts (02 §9). */
const FOUNDATION_CONCEPTS = {
  home: { lucide: 'house' },
  chats: { lucide: 'message-square' },
  projects: { lucide: 'folder' },
  agents: { lucide: 'bot' },
  workflows: { lucide: 'workflow' },
  automations: { lucide: 'calendar-clock' },
  scripts: { lucide: 'file-code-2', lucide1: 'file-code-corner' },
  settings: { lucide: 'settings' },
  search: { lucide: 'search' },
  plus: { lucide: 'plus' },
  more: { lucide: 'ellipsis' },
  x: { lucide: 'x' },
  check: { lucide: 'check' },
  edit: { lucide: 'pencil' },
  trash: { lucide: 'trash-2', lucide1: 'trash' },
  copy: { lucide: 'copy' },
  changes: { lucide: 'git-compare' },
  files: { lucide: 'files' },
  terminal: { lucide: 'square-terminal' },
  browser: { lucide: 'globe' },
  tasks: { lucide: 'list-tree' },
  computer: { lucide: 'monitor' },
  plan: { lucide: 'list-checks' },
  widgets: { lucide: 'layout-grid' },
  branch: { lucide: 'git-branch' },
  commit: { lucide: 'git-commit-horizontal' },
  pr: { lucide: 'git-pull-request' },
  diff: { lucide: 'file-diff' },
  history: { lucide: 'history', lucide1: 'rotate-ccw-clock' },
  play: { lucide: 'play' },
  stop: { lucide: 'square' },
  retry: { lucide: 'rotate-ccw' },
  send: { lucide: 'arrow-up' },
  attach: { lucide: 'paperclip' },
  mic: { lucide: 'mic' },
  skills: { lucide: 'book-open' },
  mcp: { lucide: 'plug' },
  hook: { lucide: 'anchor' },
  variable: { lucide: 'variable' },
  webhook: { lucide: 'webhook' },
  clock: { lucide: 'clock' },
  server: { lucide: 'server' },
  lock: { lucide: 'lock' },
  key: { lucide: 'key-round' },
  bell: { lucide: 'bell' },
  info: { lucide: 'info' },
  warning: { lucide: 'triangle-alert' },
  hand: { lucide: 'hand' },
} as const satisfies Record<string, IconConceptDef>;

/** One glyph per status state (packages/shared/src/status, D-18). */
const STATUS_CONCEPTS = {
  'status-queued': { lucide: 'circle-dashed' },
  'status-running': { lucide: 'loader-circle' },
  'status-waiting': { lucide: 'clock' },
  'status-needs-you': { lucide: 'hand' },
  'status-paused': { lucide: 'circle-pause' },
  'status-succeeded': { lucide: 'circle-check' },
  'status-failed': { lucide: 'circle-x' },
  'status-skipped': { lucide: 'circle-minus' },
} as const satisfies Record<string, IconConceptDef>;

/** UI glyphs the boards use that the Foundations list omits (02 §9). */
const UI_CONCEPTS = {
  'chevron-down': { lucide: 'chevron-down' },
  'chevron-right': { lucide: 'chevron-right' },
  'chevron-up': { lucide: 'chevron-up' },
  'chevron-left': { lucide: 'chevron-left' },
  sidebar: { lucide: 'panel-left' },
  dock: { lucide: 'panel-right' },
  maximize: { lucide: 'maximize-2' },
  shield: { lucide: 'shield-check' },
  file: { lucide: 'file' },
  'folder-open': { lucide: 'folder-open' },
  'file-text': { lucide: 'file-text' },
  refresh: { lucide: 'refresh-cw' },
  forward: { lucide: 'arrow-right' },
  back: { lucide: 'arrow-left' },
  undo: { lucide: 'undo-2' },
  redo: { lucide: 'redo-2' },
  restart: { lucide: 'rotate-cw' },
  view: { lucide: 'eye' },
  upload: { lucide: 'upload' },
  download: { lucide: 'download' },
  save: { lucide: 'save' },
  tool: { lucide: 'wrench' },
  scan: { lucide: 'scan' },
  'external-link': { lucide: 'external-link' },
  model: { lucide: 'cpu' },
  message: { lucide: 'message-square-text' },
  pointer: { lucide: 'mouse-pointer-2' },
  'zoom-in': { lucide: 'zoom-in' },
  'zoom-out': { lucide: 'zoom-out' },
  layers: { lucide: 'layers' },
  archive: { lucide: 'archive' },
  users: { lucide: 'users' },
  calendar: { lucide: 'calendar' },
  sort: { lucide: 'arrow-up-down' },
  link: { lucide: 'link' },
  camera: { lucide: 'camera' },
  list: { lucide: 'list' },
  database: { lucide: 'database' },
  activity: { lucide: 'activity' },
  zap: { lucide: 'zap' },
  pause: { lucide: 'pause' },
  tag: { lucide: 'tag' },
  user: { lucide: 'user' },
  device: { lucide: 'smartphone' },
  'mode-light': { lucide: 'sun' },
  'mode-dark': { lucide: 'moon' },
  'mode-system': { lucide: 'monitor' },
  power: { lucide: 'power' },
  'more-vertical': { lucide: 'ellipsis-vertical' },
  minus: { lucide: 'minus' },
  mention: { lucide: 'at-sign' },
  pin: { lucide: 'pin' },
} as const satisfies Record<string, IconConceptDef>;

export const ICON_CONCEPTS = {
  ...FOUNDATION_CONCEPTS,
  ...STATUS_CONCEPTS,
  ...UI_CONCEPTS,
} as const satisfies Record<string, IconConceptDef>;

export type IconConcept = keyof typeof ICON_CONCEPTS;
export type FoundationIconConcept = keyof typeof FOUNDATION_CONCEPTS;
export type StatusIconConcept = keyof typeof STATUS_CONCEPTS;

export const FOUNDATION_ICON_CONCEPTS = Object.keys(FOUNDATION_CONCEPTS) as FoundationIconConcept[];
export const STATUS_ICON_CONCEPTS = Object.keys(STATUS_CONCEPTS) as StatusIconConcept[];

export function isIconConcept(value: unknown): value is IconConcept {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ICON_CONCEPTS, value);
}

/** The lucide name for the installed lucide-react. */
export function lucideName(concept: IconConcept): string {
  return ICON_CONCEPTS[concept].lucide;
}
