// ────────────────────────────────────────────────────────────────
// Icon concept registry (D-17, 02-design-system-spec.md §6.6, §9).
//
// Code names CONCEPTS ("changes", "status-running"), never glyphs. Each
// concept resolves to one lucide icon (kebab-case name) for web, and for
// mobile to an SF Symbol (iOS) and a Material Symbol (Android) — or is
// `lucideOnly` (mobile 02 §5.1). Web reads only `lucide`.
// `apps/web/src/ui/icons` maps concepts to lucide components; direct
// `lucide-react` imports anywhere else are lint errors.
//
// `lucide` is the lucide-react 1.x name (apps/web has 1.48; P1-U5). 1.x keeps
// some 0.x names only as deprecated aliases (trash-2, history, file-code-2,
// loader-2 …); the registry always names the canonical glyph, which
// apps/web/src/__tests__/ui/iconRegistry.test.ts enforces through each
// component's displayName.
// ────────────────────────────────────────────────────────────────

export interface IconConceptDef {
  /** Canonical lucide 1.x name (kebab-case). Web and lucide-only mobile glyphs. */
  lucide: string;
  /** SF Symbol (iOS). Absent only when `lucideOnly`. */
  sfSymbol?: string;
  /** SF Symbol for the filled / selected state (e.g. 'pin.fill'). */
  sfSymbolFill?: string;
  /** Material Symbols name (Android, Outlined style, weight 400). Absent only when `lucideOnly`. */
  material?: string;
  /** The concept has a filled state on Android → rendered from the generated SVG (expo#46850). */
  materialFill?: true;
  /** Domain glyph with no native counterpart: lucide on iOS and Android (MD-41, MD-73). */
  lucideOnly?: true;
  /** Flip horizontally in RTL on Android (SF uses .forward/.backward names that flip themselves). */
  mirrorInRtl?: true;
}

/** Icon sizes (px) → Tailwind `size-3`, `size-3.5`, `size-4`, `size-5`. Stroke scales with the 24 viewBox. */
export const ICON = { sizes: [12, 14, 16, 20] as const, defaultSize: 16, strokeWidth: 1.75 } as const;
export type IconSize = (typeof ICON.sizes)[number];

/** The Foundations board's 48 concepts (02 §9). */
const FOUNDATION_CONCEPTS = {
  home: { lucide: 'house', sfSymbol: 'house', material: 'home' },
  chats: { lucide: 'message-square', sfSymbol: 'bubble.left', material: 'chat_bubble' },
  projects: { lucide: 'folder', sfSymbol: 'folder', material: 'folder' },
  agents: { lucide: 'bot', lucideOnly: true },
  workflows: { lucide: 'workflow', sfSymbol: 'flowchart', material: 'account_tree' },
  automations: { lucide: 'calendar-clock', sfSymbol: 'calendar.badge.clock', material: 'event_repeat' },
  scripts: { lucide: 'file-code-corner', sfSymbol: 'chevron.left.forwardslash.chevron.right', material: 'code' },
  settings: { lucide: 'settings', sfSymbol: 'gearshape', material: 'settings' },
  search: { lucide: 'search', sfSymbol: 'magnifyingglass', material: 'search' },
  plus: { lucide: 'plus', sfSymbol: 'plus', material: 'add' },
  more: { lucide: 'ellipsis', sfSymbol: 'ellipsis', material: 'more_horiz' },
  x: { lucide: 'x', sfSymbol: 'xmark', material: 'close' },
  check: { lucide: 'check', sfSymbol: 'checkmark', material: 'check' },
  edit: { lucide: 'pencil', sfSymbol: 'pencil', material: 'edit' },
  trash: { lucide: 'trash', sfSymbol: 'trash', material: 'delete' },
  copy: { lucide: 'copy', sfSymbol: 'doc.on.doc', material: 'content_copy' },
  changes: { lucide: 'git-compare', lucideOnly: true },
  files: { lucide: 'files', sfSymbol: 'doc.plaintext', material: 'topic' },
  terminal: { lucide: 'square-terminal', sfSymbol: 'apple.terminal', material: 'terminal' },
  browser: { lucide: 'globe', sfSymbol: 'globe', material: 'language' },
  tasks: { lucide: 'list-tree', sfSymbol: 'list.bullet.indent', material: 'pending_actions' },
  computer: { lucide: 'monitor', sfSymbol: 'desktopcomputer', material: 'computer' },
  plan: { lucide: 'list-checks', sfSymbol: 'checklist', material: 'checklist' },
  widgets: { lucide: 'layout-grid', sfSymbol: 'square.grid.2x2', material: 'grid_view' },
  branch: { lucide: 'git-branch', lucideOnly: true },
  commit: { lucide: 'git-commit-horizontal', lucideOnly: true },
  pr: { lucide: 'git-pull-request', lucideOnly: true },
  diff: { lucide: 'file-diff', lucideOnly: true },
  history: { lucide: 'rotate-ccw-clock', sfSymbol: 'clock.arrow.circlepath', material: 'history' },
  play: { lucide: 'play', sfSymbol: 'play', sfSymbolFill: 'play.fill', material: 'play_arrow', materialFill: true },
  stop: { lucide: 'square', sfSymbol: 'stop', sfSymbolFill: 'stop.fill', material: 'stop', materialFill: true },
  retry: { lucide: 'rotate-ccw', sfSymbol: 'arrow.counterclockwise', material: 'replay' },
  send: { lucide: 'arrow-up', sfSymbol: 'arrow.up', material: 'arrow_upward' },
  attach: { lucide: 'paperclip', sfSymbol: 'paperclip', material: 'attach_file' },
  mic: { lucide: 'mic', sfSymbol: 'mic', material: 'mic' },
  skills: { lucide: 'book-open', sfSymbol: 'book', material: 'menu_book' },
  mcp: { lucide: 'plug', sfSymbol: 'powerplug', material: 'electrical_services' },
  hook: { lucide: 'anchor', lucideOnly: true },
  variable: { lucide: 'variable', lucideOnly: true },
  webhook: { lucide: 'webhook', lucideOnly: true },
  clock: { lucide: 'clock', sfSymbol: 'clock', material: 'schedule' },
  server: { lucide: 'server', sfSymbol: 'server.rack', material: 'dns' },
  lock: { lucide: 'lock', sfSymbol: 'lock', material: 'lock' },
  key: { lucide: 'key-round', sfSymbol: 'key', material: 'key' },
  bell: { lucide: 'bell', sfSymbol: 'bell', material: 'notifications' },
  info: { lucide: 'info', sfSymbol: 'info.circle', material: 'info' },
  warning: { lucide: 'triangle-alert', sfSymbol: 'exclamationmark.triangle', material: 'warning' },
  hand: { lucide: 'hand', sfSymbol: 'hand.raised', material: 'back_hand' },
} as const satisfies Record<string, IconConceptDef>;

/** One glyph per status state (packages/shared/src/status, D-18). */
const STATUS_CONCEPTS = {
  'status-queued': { lucide: 'circle-dashed', sfSymbol: 'circle.dashed', material: 'pending' },
  'status-running': { lucide: 'loader-circle', sfSymbol: 'progress.indicator', material: 'progress_activity' },
  'status-waiting': { lucide: 'clock', sfSymbol: 'clock', material: 'schedule' },
  'status-needs-you': { lucide: 'hand', sfSymbol: 'hand.raised', material: 'back_hand' },
  'status-paused': { lucide: 'circle-pause', sfSymbol: 'pause.circle', material: 'pause_circle' },
  'status-succeeded': { lucide: 'circle-check', sfSymbol: 'checkmark.circle', material: 'check_circle' },
  'status-failed': { lucide: 'circle-x', sfSymbol: 'xmark.circle', material: 'cancel' },
  'status-skipped': { lucide: 'circle-minus', sfSymbol: 'minus.circle', material: 'do_not_disturb_on' },
} as const satisfies Record<string, IconConceptDef>;

/** UI glyphs the boards use that the Foundations list omits (02 §9). */
const UI_CONCEPTS = {
  'chevron-down': { lucide: 'chevron-down', sfSymbol: 'chevron.down', material: 'keyboard_arrow_down' },
  'chevron-right': { lucide: 'chevron-right', sfSymbol: 'chevron.forward', material: 'chevron_right', mirrorInRtl: true },
  'chevron-up': { lucide: 'chevron-up', sfSymbol: 'chevron.up', material: 'keyboard_arrow_up' },
  'chevron-left': { lucide: 'chevron-left', sfSymbol: 'chevron.backward', material: 'chevron_left', mirrorInRtl: true },
  sidebar: { lucide: 'panel-left', sfSymbol: 'sidebar.left', material: 'menu' },
  dock: { lucide: 'panel-right', sfSymbol: 'sidebar.right', material: 'view_sidebar' },
  maximize: { lucide: 'maximize-2', sfSymbol: 'arrow.up.left.and.arrow.down.right', material: 'open_in_full' },
  shield: { lucide: 'shield-check', sfSymbol: 'checkmark.shield', material: 'verified_user' },
  file: { lucide: 'file', sfSymbol: 'doc', material: 'draft' },
  'folder-open': { lucide: 'folder-open', sfSymbol: 'folder', material: 'folder_open' },
  'file-text': { lucide: 'file-text', sfSymbol: 'doc.text', material: 'description' },
  refresh: { lucide: 'refresh-cw', sfSymbol: 'arrow.clockwise', material: 'refresh' },
  forward: { lucide: 'arrow-right', sfSymbol: 'arrow.forward', material: 'arrow_forward', mirrorInRtl: true },
  back: { lucide: 'arrow-left', sfSymbol: 'arrow.backward', material: 'arrow_back', mirrorInRtl: true },
  undo: { lucide: 'undo-2', sfSymbol: 'arrow.uturn.backward', material: 'undo' },
  redo: { lucide: 'redo-2', sfSymbol: 'arrow.uturn.forward', material: 'redo' },
  restart: { lucide: 'rotate-cw', sfSymbol: 'arrow.clockwise.circle', material: 'restart_alt' },
  view: { lucide: 'eye', sfSymbol: 'eye', material: 'visibility' },
  upload: { lucide: 'upload', sfSymbol: 'arrow.up.to.line', material: 'upload' },
  download: { lucide: 'download', sfSymbol: 'arrow.down.to.line', material: 'download' },
  save: { lucide: 'save', sfSymbol: 'square.and.arrow.down', material: 'save' },
  tool: { lucide: 'wrench', sfSymbol: 'wrench.adjustable', material: 'build' },
  scan: { lucide: 'scan', sfSymbol: 'viewfinder', material: 'crop_free' },
  'external-link': { lucide: 'external-link', sfSymbol: 'arrow.up.right.square', material: 'open_in_new' },
  model: { lucide: 'cpu', sfSymbol: 'cpu', material: 'memory' },
  message: { lucide: 'message-square-text', sfSymbol: 'text.bubble', material: 'chat' },
  pointer: { lucide: 'mouse-pointer-2', sfSymbol: 'cursorarrow', material: 'arrow_selector_tool' },
  'zoom-in': { lucide: 'zoom-in', sfSymbol: 'plus.magnifyingglass', material: 'zoom_in' },
  'zoom-out': { lucide: 'zoom-out', sfSymbol: 'minus.magnifyingglass', material: 'zoom_out' },
  layers: { lucide: 'layers', sfSymbol: 'square.3.layers.3d', material: 'layers' },
  archive: { lucide: 'archive', sfSymbol: 'archivebox', material: 'archive' },
  users: { lucide: 'users', sfSymbol: 'person.2', material: 'group' },
  calendar: { lucide: 'calendar', sfSymbol: 'calendar', material: 'calendar_today' },
  sort: { lucide: 'arrow-up-down', sfSymbol: 'arrow.up.arrow.down', material: 'swap_vert' },
  link: { lucide: 'link', sfSymbol: 'link', material: 'link' },
  camera: { lucide: 'camera', sfSymbol: 'camera', material: 'photo_camera' },
  list: { lucide: 'list', sfSymbol: 'list.bullet', material: 'list' },
  database: { lucide: 'database', sfSymbol: 'cylinder.split.1x2', material: 'database' },
  activity: { lucide: 'activity', sfSymbol: 'waveform.path.ecg', material: 'show_chart' },
  zap: { lucide: 'zap', sfSymbol: 'bolt', material: 'bolt' },
  pause: { lucide: 'pause', sfSymbol: 'pause', sfSymbolFill: 'pause.fill', material: 'pause', materialFill: true },
  tag: { lucide: 'tag', sfSymbol: 'tag', material: 'sell' },
  user: { lucide: 'user', sfSymbol: 'person', material: 'person' },
  device: { lucide: 'smartphone', sfSymbol: 'iphone', material: 'mobile' },
  'mode-light': { lucide: 'sun', sfSymbol: 'sun.max', material: 'light_mode' },
  'mode-dark': { lucide: 'moon', sfSymbol: 'moon', material: 'dark_mode' },
  'mode-system': { lucide: 'monitor', sfSymbol: 'circle.lefthalf.filled', material: 'contrast' },
  power: { lucide: 'power', sfSymbol: 'power', material: 'power_settings_new' },
  'more-vertical': { lucide: 'ellipsis-vertical', sfSymbol: 'ellipsis', material: 'more_vert' },
  minus: { lucide: 'minus', sfSymbol: 'minus', material: 'remove' },
  mention: { lucide: 'at-sign', sfSymbol: 'at', material: 'alternate_email' },
  pin: { lucide: 'pin', sfSymbol: 'pin', sfSymbolFill: 'pin.fill', material: 'keep', materialFill: true },
  /** Keyboard shortcuts (the palette's and help menu's `shortcuts.show`). */
  keyboard: { lucide: 'keyboard', sfSymbol: 'keyboard', material: 'keyboard' },
  /** The Spinner glyph (P-12): the same drawing as status-running, but not a status. */
  loader: { lucide: 'loader-circle', sfSymbol: 'progress.indicator', material: 'progress_activity' },
  /** Transcript reasoning (B-16 ThoughtPill, `think` steps). */
  think: { lucide: 'brain', sfSymbol: 'brain', material: 'psychology' },
  /** A screenshot or image a step produced. */
  image: { lucide: 'image', sfSymbol: 'photo', material: 'image' },
  /** Expand / collapse every section of a list (the Changes dock's files). */
  'expand-all': { lucide: 'chevrons-up-down', sfSymbol: 'chevron.up.chevron.down', material: 'unfold_more' },
  'collapse-all': { lucide: 'chevrons-down-up', sfSymbol: 'arrow.down.and.line.horizontal.and.arrow.up', material: 'unfold_less' },
  /** Workflow builder (PW-b): stage kinds, canvas tools, quick fixes. */
  repeat: { lucide: 'repeat', sfSymbol: 'repeat', material: 'repeat' },
  hourglass: { lucide: 'hourglass', sfSymbol: 'hourglass', material: 'hourglass_empty' },
  layout: { lucide: 'layout-grid', sfSymbol: 'rectangle.grid.2x2', material: 'dashboard' },
  group: { lucide: 'group', sfSymbol: 'square.dashed', material: 'select_all' },
  ungroup: { lucide: 'ungroup', sfSymbol: 'square.split.2x2', material: 'deselect' },
  braces: { lucide: 'braces', sfSymbol: 'curlybraces', material: 'data_object' },
  wand: { lucide: 'wand-sparkles', sfSymbol: 'wand.and.stars', material: 'wand_stars' },
} as const satisfies Record<string, IconConceptDef>;

export const ICON_CONCEPTS = {
  ...FOUNDATION_CONCEPTS,
  ...STATUS_CONCEPTS,
  ...UI_CONCEPTS,
} as const satisfies Record<string, IconConceptDef>;

export type IconConcept = keyof typeof ICON_CONCEPTS;

/**
 * Mobile-only concepts (mobile 02 §5.1). Not part of ICON_CONCEPTS: web's
 * registry is typed `satisfies Record<IconConcept, LucideIcon>`. Entries are
 * added (with the names fixed in 02 §5.1) when the first mobile screen needs
 * one; the registry test applies the same rules to them.
 */
export const MOBILE_ICON_CONCEPTS = {
  /** CodeBlock soft-wrap toggle (MP-42). */
  wrap: { lucide: 'text-wrap', sfSymbol: 'arrow.turn.down.left', material: 'wrap_text' },
  /** Input secret toggle "Hide", privacy / redaction (02 §5.1). */
  hide: { lucide: 'eye-off', sfSymbol: 'eye.slash', material: 'visibility_off' },
  /** ReorderList handle (MBuilderList, MGestures; 02 §5.1). */
  grip: { lucide: 'grip-vertical', sfSymbol: 'line.3.horizontal', material: 'drag_indicator' },
  /** ScrollToLatest "↓ Latest" pill (02 §5.1). */
  latest: { lucide: 'arrow-down', sfSymbol: 'arrow.down', material: 'arrow_downward' },
  /** Full-screen pane "Exit full screen" (MPaneOpen; 02 §5.1). */
  minimize: { lucide: 'minimize-2', sfSymbol: 'arrow.down.right.and.arrow.up.left', material: 'close_fullscreen' },
} as const satisfies Record<string, IconConceptDef>;
export type MobileIconConcept = IconConcept | keyof typeof MOBILE_ICON_CONCEPTS;

/** Every concept the mobile kit can draw, with its full definition. */
export function mobileIconDef(concept: MobileIconConcept): IconConceptDef {
  const all: Record<string, IconConceptDef> = { ...ICON_CONCEPTS, ...MOBILE_ICON_CONCEPTS };
  return all[concept] as IconConceptDef;
}
export type FoundationIconConcept = keyof typeof FOUNDATION_CONCEPTS;
export type StatusIconConcept = keyof typeof STATUS_CONCEPTS;

export const FOUNDATION_ICON_CONCEPTS = Object.keys(FOUNDATION_CONCEPTS) as FoundationIconConcept[];
export const STATUS_ICON_CONCEPTS = Object.keys(STATUS_CONCEPTS) as StatusIconConcept[];

export function isIconConcept(value: unknown): value is IconConcept {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ICON_CONCEPTS, value);
}

/** The lucide 1.x name of a concept. */
export function lucideName(concept: IconConcept): string {
  return ICON_CONCEPTS[concept].lucide;
}
