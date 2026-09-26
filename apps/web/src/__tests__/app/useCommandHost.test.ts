// The web half of the command host (D-24, D-46): the registry's `web` bindings
// are matched by one capture-phase keydown listener. Sequences and bare keys
// never fire while typing or behind a dialog; in a text field only chords
// flagged `firesInEditable` (Mod+K) fire; inside a key-owning surface (the
// terminal, `data-gai-keys="own"`) nothing does. The rule is the same on every
// OS — P1-R1: Ctrl+B / Ctrl+K are editing keys on Windows and Linux.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RENDERER_COMMAND_IDS, type RendererCommandId } from '@generatorai/shared/ui-contract';
import { HANDLERS, installWebKeyHandler, isKeyOwnerTarget, isTypingTarget, modalOverlayOpen } from '@/app/shell/useCommandHost.js';
import { shortcutSections } from '@/app/shell/ShortcutsSheet.js';

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key === '?' || key === '/' ? 'Slash' : undefined;
  const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('installWebKeyHandler', () => {
  let run: ReturnType<typeof vi.fn<(id: RendererCommandId) => void>>;
  let cleanup: () => void;
  let t = 0;

  beforeEach(() => {
    document.body.innerHTML = '';
    run = vi.fn<(id: RendererCommandId) => void>();
    t = 0;
    cleanup = installWebKeyHandler(window, run, { mac: false, now: () => t });
  });
  afterEach(() => cleanup());

  it('G then C goes to Chats', () => {
    const g = press(document.body, 'g');
    expect(g.defaultPrevented).toBe(true);
    expect(run).not.toHaveBeenCalled();
    press(document.body, 'c');
    expect(run).toHaveBeenCalledWith('nav.chats');
  });

  it('G then C inside a text input does nothing', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const g = press(input, 'g');
    press(input, 'c');
    expect(run).not.toHaveBeenCalled();
    expect(g.defaultPrevented).toBe(false);
  });

  it('is ignored in textareas, contenteditable and comboboxes', () => {
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    const combo = document.createElement('div');
    combo.setAttribute('role', 'combobox');
    const inner = document.createElement('span');
    inner.tabIndex = 0;
    combo.append(inner);
    document.body.append(textarea, editable, combo);
    for (const el of [textarea, inner]) {
      press(el, 'g');
      press(el, 'c');
    }
    press(textarea, '?', { shiftKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('is ignored while a dialog is open', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    press(document.body, 'g');
    press(document.body, 'c');
    expect(run).not.toHaveBeenCalled();
  });

  it('a sequence expires', () => {
    press(document.body, 'g');
    t += 5000;
    press(document.body, 'c');
    expect(run).not.toHaveBeenCalled();
  });

  it('? opens the shortcuts sheet; N and Shift+N create', () => {
    press(document.body, '?', { shiftKey: true });
    press(document.body, 'n');
    press(document.body, 'N', { shiftKey: true });
    expect(run.mock.calls.map((c) => c[0])).toEqual(['shortcuts.show', 'chat.new', 'workflow.new']);
  });

  it('Mod+K fires even inside a text field (Ctrl off macOS)', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const e = press(input, 'k', { ctrlKey: true });
    expect(run).toHaveBeenCalledWith('palette.toggle');
    expect(e.defaultPrevented).toBe(true);
  });

  it('Mod+K also fires from a contenteditable', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(editable);
    press(editable, 'k', { ctrlKey: true });
    expect(run).toHaveBeenCalledWith('palette.toggle');
  });

  it('Ctrl+B and Ctrl+Alt+B outside a field toggle the sidebar and the dock', () => {
    const b = press(document.body, 'b', { ctrlKey: true });
    press(document.body, 'b', { ctrlKey: true, altKey: true });
    expect(run.mock.calls.map((c) => c[0])).toEqual(['sidebar.toggle', 'dock.toggle']);
    expect(b.defaultPrevented).toBe(true);
  });

  it('Ctrl+B and Ctrl+Alt+B inside a text field are left to the field (Ctrl off macOS)', () => {
    const textarea = document.createElement('textarea');
    const input = document.createElement('input');
    document.body.append(textarea, input);
    for (const el of [textarea, input]) {
      const b = press(el, 'b', { ctrlKey: true });
      const altB = press(el, 'b', { ctrlKey: true, altKey: true });
      expect(b.defaultPrevented).toBe(false);
      expect(altB.defaultPrevented).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('the terminal owns every key: Ctrl+K, Ctrl+B and sequences never reach the host', () => {
    // xterm focuses a hidden helper textarea inside its `.xterm` root.
    const root = document.createElement('div');
    root.className = 'xterm';
    const helper = document.createElement('textarea');
    helper.className = 'xterm-helper-textarea';
    root.append(helper);
    document.body.append(root);
    const k = press(helper, 'k', { ctrlKey: true });
    const b = press(helper, 'b', { ctrlKey: true });
    press(helper, 'g');
    press(helper, 'c');
    expect(run).not.toHaveBeenCalled();
    expect(k.defaultPrevented).toBe(false);
    expect(b.defaultPrevented).toBe(false);
  });

  it('any element under data-gai-keys="own" owns its keys, even when not a text field', () => {
    const owner = document.createElement('div');
    owner.setAttribute('data-gai-keys', 'own');
    const canvas = document.createElement('div');
    canvas.tabIndex = 0;
    owner.append(canvas);
    document.body.append(owner);
    press(canvas, 'k', { ctrlKey: true });
    press(canvas, 'b', { ctrlKey: true });
    press(canvas, 'n');
    expect(run).not.toHaveBeenCalled();
  });

  it('browser-reserved chords are left to the browser', () => {
    const e = press(document.body, 'n', { ctrlKey: true });
    press(document.body, '1', { ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('cleanup removes the listener', () => {
    cleanup();
    press(document.body, 'n');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('installWebKeyHandler on macOS (Mod = Cmd): same rule', () => {
  let run: ReturnType<typeof vi.fn<(id: RendererCommandId) => void>>;
  let cleanup: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    run = vi.fn<(id: RendererCommandId) => void>();
    cleanup = installWebKeyHandler(window, run, { mac: true, now: () => 0 });
  });
  afterEach(() => cleanup());

  it('Cmd+K fires in a textarea; Cmd+B does not; Ctrl+B is not Mod here', () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    press(textarea, 'k', { metaKey: true });
    const b = press(textarea, 'b', { metaKey: true });
    press(document.body, 'b', { ctrlKey: true });
    expect(run.mock.calls.map((c) => c[0])).toEqual(['palette.toggle']);
    expect(b.defaultPrevented).toBe(false);
    press(document.body, 'b', { metaKey: true });
    expect(run).toHaveBeenLastCalledWith('sidebar.toggle');
  });
});

describe('command host helpers', () => {
  it('has a handler for every renderer command', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual([...RENDERER_COMMAND_IDS].sort());
  });

  it('checkboxes are not typing targets; text inputs are', () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    const text = document.createElement('input');
    expect(isTypingTarget(box)).toBe(false);
    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('key owners: the xterm root and data-gai-keys="own", not ordinary fields', () => {
    document.body.innerHTML =
      '<div class="xterm"><textarea id="a"></textarea></div><div data-gai-keys="own"><span id="b"></span></div><textarea id="c"></textarea>';
    expect(isKeyOwnerTarget(document.getElementById('a'))).toBe(true);
    expect(isKeyOwnerTarget(document.getElementById('b'))).toBe(true);
    expect(isKeyOwnerTarget(document.getElementById('c'))).toBe(false);
    expect(isKeyOwnerTarget(null)).toBe(false);
  });

  it('detects new-kit and legacy overlays', () => {
    document.body.innerHTML = '<div data-gai-overlay="palette"></div>';
    expect(modalOverlayOpen()).toBe(true);
    document.body.innerHTML = '<div role="menu"></div>';
    expect(modalOverlayOpen()).toBe(false);
  });
});

describe('shortcutSections', () => {
  const find = (host: Parameters<typeof shortcutSections>[0], label: string) =>
    shortcutSections(host)
      .flatMap((s) => s.rows)
      .find((r) => r.label === label)?.binding;

  it('shows the host binding for each command', () => {
    expect(find('web', 'Chats')).toBe('G C');
    expect(find('desktopMac', 'Chats')).toBe('Cmd+Shift+C');
    expect(find('desktopWinLinux', 'Chats')).toBe('Ctrl+2');
    expect(find('web', 'Keyboard shortcuts')).toBe('Shift+/');
  });

  it('omits commands unbound on the host', () => {
    expect(find('web', 'Find…')).toBeUndefined();
    expect(find('web', 'Back')).toBeUndefined();
    expect(find('desktopWinLinux', 'Back')).toBe('Alt+Left');
  });

  it('groups global commands first, then surfaces, then system keys', () => {
    const titles = shortcutSections('desktopMac').map((s) => s.title);
    expect(titles[0]).toBe('Navigate');
    expect(titles).toContain('Composer');
    expect(titles.at(-1)).toBe('System');
  });
});
