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
// Lives in hooks/ (not app/shell/ as 06 §5.3 sketches) because its caller,
// the legacy AppLayout, may not import app/; it moves with the shell in P3.
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
import { useUiStore } from '@/stores/uiStore.js';
import { useRightPaneStore } from '@/stores/rightPaneStore.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
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
    const ui = useUiStore.getState();
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
  // The new-chat dialog opens from the Chats list until it becomes a global overlay (P5).
  'chat.new': navTo('/chats?new=1'),
  'workflow.new': navTo('/workflows/new'),
  'project.new': navTo('/projects/new'),
  'automation.new': navTo('/automations/new'),
  'agent.new': navTo('/agents/new'),
  'sidebar.toggle': () => useUiStore.getState().toggleSidebar(),
  'dock.toggle': () => useRightPaneStore.getState().controller?.toggle(),
  'theme.toggle': (ctx) => ctx.toggleTheme(),
  // FindBar owns the find-in-page state and subscribes to these directly.
  'find.open': handledElsewhere,
  'find.next': handledElsewhere,
  'find.previous': handledElsewhere,
  'shortcuts.show': () => useUiStore.getState().setShortcutsOpen(true),
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
    return () => {
      unregister();
      uninstall();
    };
  }, []);
}
