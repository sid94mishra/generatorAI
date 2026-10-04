// ────────────────────────────────────────────────────────────────
// Command + shortcut registry and navigation destinations (D-22, D-24;
// 06-desktop-and-shell.md §5).
//
// One table drives every surface that names a command or its key: the web key
// handler, the command palette hints, the desktop menu accelerators and tray,
// the DesktopCommand union main sends to the renderer, the shortcuts sheet, and
// (next pass) mobile hardware-keyboard shortcuts.
//
// DEPENDENCY-FREE: imported by the Electron main bundle through the
// `@generatorai/shared/ui-contract` subpath. Never import the shared root here.
//
// Binding grammar
//   chord     '+'-joined keys: 'Mod+K', 'Cmd+Shift+H', 'Alt+Left', 'Shift+/'.
//             'Mod' = Cmd on macOS, Ctrl elsewhere — WEB ONLY (one web binding
//             serves every OS). Desktop bindings name Cmd/Ctrl explicitly and
//             are valid Electron accelerators.
//   sequence  WEB ONLY: space-separated chords pressed one after the other
//             ('G H'). Desktop bindings are single chords.
//   null      deliberately unbound on that host — a decision, not an omission.
// Every CommandDef field is required, so adding a command without deciding its
// three bindings is a type error.
// ────────────────────────────────────────────────────────────────

export type WebBinding = string;
export type DesktopBinding = string;
export type Host = 'web' | 'desktopMac' | 'desktopWinLinux';
export const HOSTS: readonly Host[] = ['web', 'desktopMac', 'desktopWinLinux'];

export type CommandScope = 'global' | 'composer' | 'palette' | 'builder' | 'dock' | 'find' | 'settings';
export type CommandGroup = 'navigate' | 'create' | 'view' | 'edit' | 'app' | 'help';

export interface CommandDef {
  /** Palette, shortcuts sheet and (sentence case) menu wording. */
  label: string;
  group: CommandGroup;
  /**
   * `global` commands are dispatched by the host (menu, key handler, palette).
   * Every other scope is handled by its own component and only DISPLAYED here.
   */
  scope: CommandScope;
  /** Where the command executes. `main` commands never reach the renderer. */
  runsIn: 'renderer' | 'main';
  web: WebBinding | null;
  desktopMac: DesktopBinding | null;
  desktopWinLinux: DesktopBinding | null;
  /** Icon concept id (`packages/design-tokens` ICON_CONCEPTS). */
  icon?: string;
  /** Listed in the command palette. */
  palette?: boolean;
  /** May be invoked by `generatorai://command/<id>`. */
  deepLink?: boolean;
  /**
   * The web chord also fires while focus is in a text field (input, textarea,
   * contenteditable, combobox). Every other chord is left to the field there:
   * on Windows and Linux `Mod` is Ctrl, and Ctrl+B / Ctrl+Alt+B are editing
   * keys. Set only where reaching the command from a field is the point
   * (`palette.toggle`: jump from the composer). Surfaces that own every key —
   * the terminal, code editors — never see a host chord, flag or not.
   */
  firesInEditable?: true;
}

export const COMMANDS = {
  // ── Global: dispatched by the host ──────────────────────────────
  'palette.toggle': { label: 'Search or jump to', group: 'navigate', scope: 'global', runsIn: 'renderer', web: 'Mod+K', desktopMac: 'Cmd+K', desktopWinLinux: 'Ctrl+K', icon: 'search', firesInEditable: true },
  'nav.home': { label: 'Home', group: 'navigate', scope: 'global', runsIn: 'renderer', web: 'G H', desktopMac: 'Cmd+Shift+H', desktopWinLinux: 'Ctrl+1', icon: 'home', palette: true },
  'nav.chats': { label: 'Chats', group: 'navigate', scope: 'global', runsIn: 'renderer', web: 'G C', desktopMac: 'Cmd+Shift+C', desktopWinLinux: 'Ctrl+2', icon: 'chats', palette: true },
  'nav.projects': { label: 'Projects', group: 'navigate', scope: 'global', runsIn: 'renderer', web: 'G P', desktopMac: 'Cmd+Shift+P', desktopWinLinux: 'Ctrl+3', icon: 'projects', palette: true },
  'nav.agents': { label: 'Agents', group: 'navigate', scope: 'global', runsIn: 'renderer', web: 'G E', desktopMac: 'Cmd+Shift+E', desktopWinLinux: 'Ctrl+4', icon: 'agents', palette: true },
  'nav.workflows': { label: 'Workflows', group: 'navigate', scope: 'global', runsIn: 'renderer', web: 'G W', desktopMac: 'Cmd+Shift+W', desktopWinLinux: 'Ctrl+5', icon: 'workflows', palette: true },
  'nav.automations': { label: 'Automations', group: 'navigate', scope: 'global', runsIn: 'renderer', web: 'G A', desktopMac: 'Cmd+Shift+A', desktopWinLinux: 'Ctrl+6', icon: 'automations', palette: true },
  'nav.scripts': { label: 'Scripts', group: 'navigate', scope: 'global', runsIn: 'renderer', web: 'G S', desktopMac: 'Cmd+Shift+S', desktopWinLinux: 'Ctrl+7', icon: 'scripts', palette: true },
  // D-93: renderer commands (the palette lists them; the web keeps the browser's own keys, so `web` is null).
  // Desktop Windows/Linux handle Alt+←/→ in the renderer, so a surface that owns its keys keeps them.
  'nav.back': { label: 'Back', group: 'navigate', scope: 'global', runsIn: 'renderer', web: null, desktopMac: 'Cmd+[', desktopWinLinux: 'Alt+Left', icon: 'back', palette: true },
  'nav.forward': { label: 'Forward', group: 'navigate', scope: 'global', runsIn: 'renderer', web: null, desktopMac: 'Cmd+]', desktopWinLinux: 'Alt+Right', icon: 'forward', palette: true },
  'app.settings': { label: 'Open settings', group: 'app', scope: 'global', runsIn: 'renderer', web: 'G ,', desktopMac: 'Cmd+,', desktopWinLinux: 'Ctrl+,', icon: 'settings', palette: true },
  'chat.new': { label: 'New chat', group: 'create', scope: 'global', runsIn: 'renderer', web: 'N', desktopMac: 'Cmd+N', desktopWinLinux: 'Ctrl+N', icon: 'plus', palette: true, deepLink: true },
  'workflow.new': { label: 'New workflow', group: 'create', scope: 'global', runsIn: 'renderer', web: 'Shift+N', desktopMac: 'Cmd+Shift+N', desktopWinLinux: 'Ctrl+Shift+N', icon: 'plus', palette: true, deepLink: true },
  'project.new': { label: 'New project', group: 'create', scope: 'global', runsIn: 'renderer', web: null, desktopMac: null, desktopWinLinux: null, icon: 'plus', palette: true },
  'automation.new': { label: 'New automation', group: 'create', scope: 'global', runsIn: 'renderer', web: null, desktopMac: null, desktopWinLinux: null, icon: 'plus', palette: true },
  'agent.new': { label: 'New agent', group: 'create', scope: 'global', runsIn: 'renderer', web: null, desktopMac: null, desktopWinLinux: null, icon: 'plus', palette: true },
  'sidebar.toggle': { label: 'Toggle sidebar', group: 'view', scope: 'global', runsIn: 'renderer', web: 'Mod+B', desktopMac: 'Cmd+B', desktopWinLinux: 'Ctrl+B', icon: 'sidebar', palette: true },
  'activity.toggle': { label: 'Toggle activity column', group: 'view', scope: 'global', runsIn: 'renderer', web: 'Mod+.', desktopMac: 'Cmd+.', desktopWinLinux: 'Ctrl+.', icon: 'activity', palette: true },
  'dock.toggle': { label: 'Toggle side dock', group: 'view', scope: 'global', runsIn: 'renderer', web: 'Mod+Alt+B', desktopMac: 'Cmd+Alt+B', desktopWinLinux: 'Ctrl+Alt+B', icon: 'dock', palette: true },
  'theme.toggle': { label: 'Toggle theme', group: 'view', scope: 'global', runsIn: 'renderer', web: null, desktopMac: null, desktopWinLinux: null, icon: 'mode-dark', palette: true },
  'find.open': { label: 'Find…', group: 'edit', scope: 'global', runsIn: 'renderer', web: null, desktopMac: 'Cmd+F', desktopWinLinux: 'Ctrl+F', icon: 'search' },
  'find.next': { label: 'Find next', group: 'edit', scope: 'global', runsIn: 'renderer', web: null, desktopMac: 'Cmd+G', desktopWinLinux: 'Ctrl+G' },
  'find.previous': { label: 'Find previous', group: 'edit', scope: 'global', runsIn: 'renderer', web: null, desktopMac: 'Cmd+Shift+G', desktopWinLinux: 'Ctrl+Shift+G' },
  'shortcuts.show': { label: 'Keyboard shortcuts', group: 'help', scope: 'global', runsIn: 'renderer', web: 'Shift+/', desktopMac: 'Cmd+/', desktopWinLinux: 'Ctrl+/', icon: 'keyboard', palette: true },
  'scripts.reload': { label: 'Reload scripts', group: 'app', scope: 'global', runsIn: 'renderer', web: null, desktopMac: null, desktopWinLinux: null, icon: 'refresh', palette: true },
  'window.reload': { label: 'Reload', group: 'view', scope: 'global', runsIn: 'main', web: null, desktopMac: 'Cmd+R', desktopWinLinux: 'Ctrl+R', icon: 'refresh' },
  'devtools.toggle': { label: 'Toggle developer tools', group: 'view', scope: 'global', runsIn: 'main', web: null, desktopMac: 'Alt+Cmd+I', desktopWinLinux: 'Ctrl+Shift+I' },
  'server.restart': { label: 'Restart server', group: 'app', scope: 'global', runsIn: 'main', web: null, desktopMac: null, desktopWinLinux: null, icon: 'restart' },
  'updates.check': { label: 'Check for updates…', group: 'help', scope: 'global', runsIn: 'main', web: null, desktopMac: null, desktopWinLinux: null },
  'update.install': { label: 'Restart to update', group: 'app', scope: 'global', runsIn: 'main', web: null, desktopMac: null, desktopWinLinux: null, icon: 'restart' },

  // ── Scoped: handled by their component, listed for display only ─
  'composer.send': { label: 'Send', group: 'edit', scope: 'composer', runsIn: 'renderer', web: 'Enter', desktopMac: 'Enter', desktopWinLinux: 'Enter', icon: 'send' },
  'composer.newline': { label: 'New line', group: 'edit', scope: 'composer', runsIn: 'renderer', web: 'Shift+Enter', desktopMac: 'Shift+Enter', desktopWinLinux: 'Shift+Enter' },
  'composer.moreOptions': { label: 'Start with more options', group: 'edit', scope: 'composer', runsIn: 'renderer', web: 'Mod+Enter', desktopMac: 'Cmd+Enter', desktopWinLinux: 'Ctrl+Enter' },
  'composer.skills': { label: 'Insert a skill', group: 'edit', scope: 'composer', runsIn: 'renderer', web: '/', desktopMac: '/', desktopWinLinux: '/', icon: 'skills' },
  'composer.files': { label: 'Mention a file', group: 'edit', scope: 'composer', runsIn: 'renderer', web: '@', desktopMac: '@', desktopWinLinux: '@', icon: 'mention' },
  'palette.next': { label: 'Next result', group: 'navigate', scope: 'palette', runsIn: 'renderer', web: 'Down', desktopMac: 'Down', desktopWinLinux: 'Down' },
  'palette.prev': { label: 'Previous result', group: 'navigate', scope: 'palette', runsIn: 'renderer', web: 'Up', desktopMac: 'Up', desktopWinLinux: 'Up' },
  'palette.open': { label: 'Open result', group: 'navigate', scope: 'palette', runsIn: 'renderer', web: 'Enter', desktopMac: 'Enter', desktopWinLinux: 'Enter' },
  'palette.actions': { label: 'Result actions', group: 'navigate', scope: 'palette', runsIn: 'renderer', web: 'Tab', desktopMac: 'Tab', desktopWinLinux: 'Tab' },
  'palette.close': { label: 'Close palette', group: 'navigate', scope: 'palette', runsIn: 'renderer', web: 'Escape', desktopMac: 'Escape', desktopWinLinux: 'Escape' },
  'builder.save': { label: 'Save workflow', group: 'edit', scope: 'builder', runsIn: 'renderer', web: 'Mod+S', desktopMac: 'Cmd+S', desktopWinLinux: 'Ctrl+S', icon: 'save' },
  'builder.undo': { label: 'Undo canvas edit', group: 'edit', scope: 'builder', runsIn: 'renderer', web: 'Mod+Z', desktopMac: 'Cmd+Z', desktopWinLinux: 'Ctrl+Z', icon: 'undo' },
  'builder.redo': { label: 'Redo canvas edit', group: 'edit', scope: 'builder', runsIn: 'renderer', web: 'Mod+Shift+Z', desktopMac: 'Cmd+Shift+Z', desktopWinLinux: 'Ctrl+Shift+Z', icon: 'redo' },
  'builder.delete': { label: 'Delete selection', group: 'edit', scope: 'builder', runsIn: 'renderer', web: 'Delete', desktopMac: 'Delete', desktopWinLinux: 'Delete', icon: 'trash' },
  'dock.dismiss': { label: 'Close sheet / exit maximize', group: 'view', scope: 'dock', runsIn: 'renderer', web: 'Escape', desktopMac: 'Escape', desktopWinLinux: 'Escape' },
  'find.close': { label: 'Close find bar', group: 'edit', scope: 'find', runsIn: 'renderer', web: 'Escape', desktopMac: 'Escape', desktopWinLinux: 'Escape' },
  'settings.close': { label: 'Close settings', group: 'app', scope: 'settings', runsIn: 'renderer', web: 'Escape', desktopMac: 'Escape', desktopWinLinux: 'Escape' },
} as const satisfies Record<string, CommandDef>;

export type CommandId = keyof typeof COMMANDS;

/**
 * Global commands the RENDERER executes: what main may send over IPC
 * (`DesktopCommand`) and what the web host must handle. Scoped commands are
 * excluded — their components own them.
 */
export type RendererCommandId = {
  [K in CommandId]: (typeof COMMANDS)[K] extends { runsIn: 'renderer'; scope: 'global' } ? K : never;
}[CommandId];

export const COMMAND_IDS = Object.keys(COMMANDS) as CommandId[];
export const RENDERER_COMMAND_IDS = COMMAND_IDS.filter(
  (id): id is RendererCommandId => COMMANDS[id].runsIn === 'renderer' && COMMANDS[id].scope === 'global',
);

export function isCommandId(value: unknown): value is CommandId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COMMANDS, value);
}

export function isRendererCommandId(value: unknown): value is RendererCommandId {
  return isCommandId(value) && COMMANDS[value].runsIn === 'renderer' && COMMANDS[value].scope === 'global';
}

/**
 * Commands `generatorai://command/<id>` may run (06 §8): global renderer
 * commands flagged `deepLink`. A link comes from any program on the machine,
 * so everything else is ignored — never "the id is a command, run it".
 */
export type DeepLinkCommandId = {
  [K in RendererCommandId]: (typeof COMMANDS)[K] extends { deepLink: true } ? K : never;
}[RendererCommandId];

export const DEEP_LINK_COMMAND_IDS = RENDERER_COMMAND_IDS.filter(
  (id): id is DeepLinkCommandId => (COMMANDS[id] as CommandDef).deepLink === true,
);

export function isDeepLinkCommandId(value: unknown): value is DeepLinkCommandId {
  return isRendererCommandId(value) && (COMMANDS[value] as CommandDef).deepLink === true;
}

/** Whether the command's web chord fires while focus is in a text field. */
export function firesInEditable(id: CommandId): boolean {
  const def: CommandDef = COMMANDS[id];
  return def.firesInEditable === true;
}

/** The binding for a command on a host (null = unbound there). */
export function bindingFor(id: CommandId, host: Host): string | null {
  return COMMANDS[id][host];
}

/** Sidebar/rail/palette/tray destinations, in the D-22 sidebar order. */
export const NAV_DESTINATIONS = [
  { id: 'home', label: 'Home', path: '/', command: 'nav.home', icon: 'home', tray: true },
  { id: 'chats', label: 'Chats', path: '/chats', command: 'nav.chats', icon: 'chats', tray: true },
  { id: 'projects', label: 'Projects', path: '/projects', command: 'nav.projects', icon: 'projects', tray: true },
  { id: 'agents', label: 'Agents', path: '/agents', command: 'nav.agents', icon: 'agents', tray: true },
  { id: 'workflows', label: 'Workflows', path: '/workflows', command: 'nav.workflows', icon: 'workflows', tray: true },
  { id: 'automations', label: 'Automations', path: '/automations', command: 'nav.automations', icon: 'automations', tray: true },
  { id: 'scripts', label: 'Scripts', path: '/scripts', command: 'nav.scripts', icon: 'scripts', tray: false },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  path: `/${string}`;
  command: RendererCommandId;
  icon: string;
  tray: boolean;
}>;

export type NavDestination = (typeof NAV_DESTINATIONS)[number];
export type NavDestinationId = NavDestination['id'];

/** The section a pathname belongs to ('/' only for the exact root). */
export function navDestinationFor(pathname: string): NavDestination | null {
  if (pathname === '/') return NAV_DESTINATIONS[0];
  return NAV_DESTINATIONS.find((d) => d.path !== '/' && (pathname === d.path || pathname.startsWith(`${d.path}/`))) ?? null;
}

/**
 * OS launcher shortcuts, in order (06 §8): the macOS Dock menu, the Windows
 * JumpList tasks and the Linux `.desktop` actions all list these. A command
 * entry must be a deep-link command (the JumpList and the Linux actions start
 * the app with its `generatorai://command/<id>` link); a destination entry
 * opens that section.
 */
export type LauncherAction =
  | { kind: 'command'; command: DeepLinkCommandId }
  | { kind: 'destination'; destination: NavDestinationId };

export const LAUNCHER_ACTIONS: readonly LauncherAction[] = [
  { kind: 'command', command: 'chat.new' },
  { kind: 'command', command: 'workflow.new' },
  { kind: 'destination', destination: 'home' },
];

/** The deep link that performs a launcher action: `generatorai://command/chat.new`, `generatorai://` (Home). */
export function launcherActionLink(action: LauncherAction): string {
  if (action.kind === 'command') return `generatorai://command/${action.command}`;
  const dest = NAV_DESTINATIONS.find((d) => d.id === action.destination);
  if (!dest) throw new Error(`Unknown destination ${action.destination}`);
  return `generatorai://${dest.path.slice(1)}`;
}

/** The registry label of a launcher action ("New chat", "Home"). */
export function launcherActionLabel(action: LauncherAction): string {
  if (action.kind === 'command') return COMMANDS[action.command].label;
  const dest = NAV_DESTINATIONS.find((d) => d.id === action.destination);
  if (!dest) throw new Error(`Unknown destination ${action.destination}`);
  return dest.label;
}

/**
 * Chords browsers keep for themselves (tabs, windows, address bar, quit, and
 * `Mod+,` = Chrome's preferences on macOS). A web binding must never use one:
 * the page would not receive it, or would fight the browser for it.
 */
export const BROWSER_RESERVED_CHORDS: readonly string[] = [
  'Mod+N',
  'Mod+Shift+N',
  'Mod+T',
  'Mod+Shift+T',
  'Mod+W',
  'Mod+Shift+W',
  ...Array.from({ length: 9 }, (_, i) => `Mod+${i + 1}`),
  'Mod+L',
  'Mod+,',
  'Mod+Q',
  'Mod+H',
  'Mod+M',
];

/**
 * Native-role shortcuts (Electron `role` menu items, not commands) shown in the
 * shortcuts sheet so it is complete. Display only.
 */
export const SYSTEM_SHORTCUTS: ReadonlyArray<{ label: string; group: CommandGroup } & Record<Host, string | null>> = [
  { label: 'Undo', group: 'edit', web: 'Mod+Z', desktopMac: 'Cmd+Z', desktopWinLinux: 'Ctrl+Z' },
  { label: 'Redo', group: 'edit', web: 'Mod+Shift+Z', desktopMac: 'Cmd+Shift+Z', desktopWinLinux: 'Ctrl+Y' },
  { label: 'Cut', group: 'edit', web: 'Mod+X', desktopMac: 'Cmd+X', desktopWinLinux: 'Ctrl+X' },
  { label: 'Copy', group: 'edit', web: 'Mod+C', desktopMac: 'Cmd+C', desktopWinLinux: 'Ctrl+C' },
  { label: 'Paste', group: 'edit', web: 'Mod+V', desktopMac: 'Cmd+V', desktopWinLinux: 'Ctrl+V' },
  { label: 'Select all', group: 'edit', web: 'Mod+A', desktopMac: 'Cmd+A', desktopWinLinux: 'Ctrl+A' },
  { label: 'Zoom in', group: 'view', web: null, desktopMac: 'Cmd+Plus', desktopWinLinux: 'Ctrl+Plus' },
  { label: 'Zoom out', group: 'view', web: null, desktopMac: 'Cmd+-', desktopWinLinux: 'Ctrl+-' },
  { label: 'Actual size', group: 'view', web: null, desktopMac: 'Cmd+0', desktopWinLinux: 'Ctrl+0' },
  { label: 'Toggle full screen', group: 'view', web: null, desktopMac: 'Ctrl+Cmd+F', desktopWinLinux: 'F11' },
  { label: 'Minimize', group: 'view', web: null, desktopMac: 'Cmd+M', desktopWinLinux: null },
  { label: 'Close window', group: 'app', web: null, desktopMac: 'Cmd+W', desktopWinLinux: 'Ctrl+W' },
  { label: 'Quit', group: 'app', web: null, desktopMac: 'Cmd+Q', desktopWinLinux: null },
];

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  navigate: 'Navigate',
  create: 'Create',
  view: 'View',
  edit: 'Edit',
  app: 'App',
  help: 'Help',
};
