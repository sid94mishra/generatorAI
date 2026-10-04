// ────────────────────────────────────────────────────────────────
// useCommandHost — executes the registry's global commands (D-24,
// 06-desktop-and-shell.md §5.3).
//
// Commands arrive two ways and run through ONE exhaustive handler table:
//   desktop  the native menu / accelerators / tray send them over IPC. No key
//            listener here: Electron delivers a menu accelerator AND the
//            keydown, so handling both would run every command twice.
//   web      one capture-phase keydown listener matches the registry's `web`
//            bindings, by rule (the same on every OS — `Mod` is Cmd on macOS
//            and Ctrl elsewhere, and Ctrl+B / Ctrl+K are editing keys there):
//            - inside a surface that owns every key (the xterm terminal, any
//              element under `data-gai-keys="own"`) the host handles nothing;
//            - in a text field, combobox or menu only chords flagged
//              `firesInEditable` fire (Mod+K from the composer); every other
//              chord, bare key and sequence is left to the field;
//            - bare keys and sequences ('N', 'G C', '?') also wait while a
//              dialog or palette is open.
//
// `HANDLERS` is a `Record<RendererCommandId, …>`, so adding a renderer command
// to the registry without handling it here is a type error.
//
// Moved from hooks/ to app/shell with the shell (P3-04, D-46).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router';
import {
  COMMANDS,
  NAV_DESTINATIONS,
  RENDERER_COMMAND_IDS,
  createSequenceMatcher,
  firesInEditable,
  isPlainKeyBinding,
  matchesChord,
  type RendererCommandId,
} from '@generatorai/shared/ui-contract';
import { commandHost, isMacOS, onDesktopCommand } from '@/lib/desktop.js';
import { registerCommandRunner } from '@/lib/commandRunner.js';
import { useShellStore } from '@/stores/shellStore.js';
import { useDockStore } from '@/stores/dockStore.js';
import { useActivityStore } from '@/stores/activityStore.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { useNewChatStore } from '@/stores/newChatStore.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import { useReloadScripts } from '@/hooks/scriptQueries.js';

export interface CommandCtx {
  navigate: NavigateFunction;
  toggleTheme: () => void;
  reloadScripts: () => void;
}

const navTo = (path: string) => (ctx: CommandCtx) => ctx.navigate(path);
const navDestination = (command: RendererCommandId) => {
  const dest = NAV_DESTINATIONS.find((d) => d.command === command);
  if (!dest) throw new Error(`No NAV_DESTINATIONS entry for ${command}`);
  return navTo(dest.path);
};

/** No-op handler for commands another component subscribes to itself. */
const handledElsewhere = () => undefined;

export const HANDLERS: Record<RendererCommandId, (ctx: CommandCtx) => void> = {
  'palette.toggle': () => {
    const ui = useShellStore.getState();
    ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
  },
  'nav.home': navDestination('nav.home'),
  'nav.chats': navDestination('nav.chats'),
  'nav.projects': navDestination('nav.projects'),
  'nav.agents': navDestination('nav.agents'),
  'nav.workflows': navDestination('nav.workflows'),
  'nav.automations': navDestination('nav.automations'),
  'nav.scripts': navDestination('nav.scripts'),
  'app.settings': () => useSettingsUiStore.getState().openSettings(),
  // R-1 (04 §0): the sidebar icon, Ctrl/Cmd+N, and the palette action all open
  // the 640 dialog, not the full `/chats/new` page (that is the dialog's own
  // "More options" link, or a direct deep link).
  'chat.new': () => useNewChatStore.getState().open(),
  'workflow.new': navTo('/workflows/new'),
  'project.new': navTo('/projects/new'),
  'automation.new': navTo('/automations/new'),
  'agent.new': navTo('/agents/new'),
  // D-93: Chromium's session history (the same entries the menu's Back / Forward move through).
  'nav.back': (ctx) => ctx.navigate(-1),
  'nav.forward': (ctx) => ctx.navigate(1),
  'sidebar.toggle': () => useShellStore.getState().toggleSidebar(),
  'activity.toggle': () => useActivityStore.getState().toggle(),
  'dock.toggle': () => useDockStore.getState().controller?.toggle(),
  'theme.toggle': (ctx) => ctx.toggleTheme(),
  // FindBar owns the find-in-page state and subscribes to these directly.
  'find.open': handledElsewhere,
  'find.next': handledElsewhere,
  'find.previous': handledElsewhere,
  'shortcuts.show': () => useShellStore.getState().setShortcutsOpen(true),
  'scripts.reload': (ctx) => ctx.reloadScripts(),
};

/** Focus is somewhere typing or list navigation owns the keyboard. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return target.closest('[role="combobox"], [role="listbox"], [role="menu"], [role="textbox"]') !== null;
}

/**
 * Surfaces that own every key, chords included: the xterm terminal (readline's
 * Ctrl+K / Ctrl+B, the tmux prefix) and code editors. Mark a new one with
 * `data-gai-keys="own"` on its container.
 */
export const KEY_OWNER_SELECTOR = '.xterm, [data-gai-keys="own"]';

/** Focus is inside a surface that owns every key (see KEY_OWNER_SELECTOR). */
export function isKeyOwnerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(KEY_OWNER_SELECTOR) !== null;
}

/** A dialog, sheet or palette is open (new kit overlays and legacy Radix dialogs). */
export function modalOverlayOpen(doc: Document = document): boolean {
  return (
    doc.querySelector(
      '[data-gai-overlay="dialog"], [data-gai-overlay="palette"], [role="dialog"], [role="alertdialog"]',
    ) !== null
  );
}

const WEB_BINDINGS = RENDERER_COMMAND_IDS.flatMap((id) => {
  const binding = COMMANDS[id].web;
  return binding === null ? [] : [{ id, binding }];
});

/**
 * Installs the web key handler on `target` and returns its cleanup. Exported
 * for tests; the hook is the only production caller.
 */
export function installWebKeyHandler(
  target: Window,
  run: (id: RendererCommandId) => void,
  options: { mac: boolean; now?: () => number },
): () => void {
  const chordBindings = WEB_BINDINGS.filter((b) => !isPlainKeyBinding(b.binding));
  const plain = createSequenceMatcher(
    WEB_BINDINGS.filter((b) => isPlainKeyBinding(b.binding)),
    { mac: options.mac, now: options.now },
  );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.repeat) return;
    if (isKeyOwnerTarget(e.target)) {
      plain.reset();
      return;
    }
    const typing = isTypingTarget(e.target);
    const chord = chordBindings.find((b) => matchesChord(e, b.binding, options.mac));
    if (chord) {
      plain.reset();
      // Not prevented: the field keeps its own meaning of the key.
      if (typing && !firesInEditable(chord.id)) return;
      e.preventDefault();
      run(chord.id);
      return;
    }
    if (typing || modalOverlayOpen(target.document)) {
      plain.reset();
      return;
    }
    const result = plain.handle(e);
    if (result.kind === 'none') return;
    e.preventDefault();
    if (result.kind === 'match') run(result.id);
  };

  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}

/**
 * Desktop Back / Forward from the keyboard and the mouse (D-93), in the
 * renderer so a surface that owns its keys keeps them:
 *   - Windows / Linux: Alt+← / Alt+→ (the menu shows them but does not
 *     register them — `registerAccelerator: false` in main), except inside a
 *     key-owning surface (the terminal's Alt+← is readline's word-back);
 *   - macOS: mouse buttons 4 / 5 (Chromium delivers them to the page; main
 *     handles `app-command` on Windows / Linux and the trackpad `swipe`).
 * ⌘[ / ⌘] stay menu accelerators on macOS, where no surface uses them.
 * Exported for tests.
 */
export function installDesktopNavHandlers(
  target: Window,
  run: (id: 'nav.back' | 'nav.forward') => void,
  options: { mac: boolean },
): () => void {
  const backChord = COMMANDS['nav.back'].desktopWinLinux;
  const forwardChord = COMMANDS['nav.forward'].desktopWinLinux;
  const onKeyDown = (e: KeyboardEvent) => {
    if (options.mac || e.defaultPrevented || e.isComposing || e.repeat) return;
    if (isKeyOwnerTarget(e.target)) return;
    const id = backChord && matchesChord(e, backChord, false) ? 'nav.back' : forwardChord && matchesChord(e, forwardChord, false) ? 'nav.forward' : null;
    if (!id) return;
    e.preventDefault();
    run(id);
  };
  const onMouseUp = (e: MouseEvent) => {
    if (!options.mac || (e.button !== 3 && e.button !== 4)) return;
    e.preventDefault();
    run(e.button === 3 ? 'nav.back' : 'nav.forward');
  };
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('mouseup', onMouseUp, true);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('mouseup', onMouseUp, true);
  };
}

export function useCommandHost(): void {
  const navigate = useNavigate();
  const { resolvedTheme, setMode } = useTheme();
  const reloadScripts = useReloadScripts();

  // Handlers read the latest context without re-subscribing on every render.
  const ctxRef = useRef<CommandCtx>({ navigate, toggleTheme: () => undefined, reloadScripts: () => undefined });
  ctxRef.current = {
    navigate,
    toggleTheme: () => setMode(resolvedTheme === 'dark' ? 'light' : 'dark'),
    reloadScripts: () => reloadScripts.mutate(),
  };

  useEffect(() => {
    const run = (id: RendererCommandId) => HANDLERS[id](ctxRef.current);
    // The palette (and any other caller) runs commands through the same table.
    const unregister = registerCommandRunner(run);
    const uninstall = commandHost !== 'web' ? onDesktopCommand(run) : installWebKeyHandler(window, run, { mac: isMacOS });
    const uninstallNav = commandHost !== 'web' ? installDesktopNavHandlers(window, run, { mac: commandHost === 'desktopMac' }) : () => undefined;
    return () => {
      unregister();
      uninstall();
      uninstallNav();
    };
  }, []);
}
