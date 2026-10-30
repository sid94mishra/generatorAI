// ────────────────────────────────────────────────────────────────
// useComposerKeymap — the textarea's input handling
// (03-component-inventory-domain.md §6.1): keydown in priority order — menu
// navigation → Backspace removes the `/command` pill → ↑/↓ history →
// Enter / Shift / Ctrl semantics gated on `COMPOSER.sendShortcut` — plus the
// change, paste and click handlers that tie typing to the menus, history and
// dictation.
// ────────────────────────────────────────────────────────────────

import type React from 'react';
import { useCallback } from 'react';
import { COMPOSER } from './affordances.js';
import type { ComposerDraft } from './useComposerDraft.js';
import type { ComposerHistory } from './useComposerHistory.js';
import type { ComposerMenus } from './useComposerMenus.js';
import type { ComposerSend } from './useComposerSend.js';
import type { Dictation } from './useDictation.js';

export interface UseComposerKeymapOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: ComposerDraft;
  menus: ComposerMenus;
  history: ComposerHistory;
  send: ComposerSend;
  dictation: Dictation;
}

/** An IME is composing (CJK input, dead keys): its Enter commits the candidate, not the message. */
function isImeComposing(e: React.KeyboardEvent): boolean {
  // `keyCode` 229 covers the committing keydown some engines (Safari) send
  // with `isComposing` already false.
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

export function useComposerKeymap({ textareaRef, draft, menus, history, send, dictation }: UseComposerKeymapOptions) {
  const { text, setText, menu, setMenu, menuIndex, setMenuIndex, activeCommand, setActiveCommand, detectMenu, attachPastedFiles } = draft;
  const { menuCount, applyMenuSelection } = menus;
  const { navigateHistory, leaveHistory } = history;
  const { handleSend } = send;
  const { pauseVoiceIfListening, noteManualCaretMove, noteTextEdited } = dictation;

  const insertNewline = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => prev + '\n');
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setText((prev) => prev.slice(0, start) + '\n' + prev.slice(end));
    // Restore caret after the inserted newline on the next frame.
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 1;
    });
  }, [setText, textareaRef]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Part C.3: any manual keystroke while dictation is listening pauses
      // it — this is the "the act of typing into the field IS the pause
      // trigger" behavior, not something the user has to remember to do.
      pauseVoiceIfListening();

      // While an IME composes, Enter, Tab and the arrows belong to it.
      if (isImeComposing(e)) return;

      // Composer menu navigation takes priority while it is open.
      if (menu) {
        const count = menuCount;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMenuIndex((i) => (count ? (i + 1) % count : 0));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMenuIndex((i) => (count ? (i - 1 + count) % count : 0));
          return;
        }
        if ((e.key === 'Enter' || e.key === 'Tab') && count > 0) {
          e.preventDefault();
          applyMenuSelection(menuIndex);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMenu(null);
          return;
        }
      }

      // Backspace with an empty textarea removes the active command pill.
      if (e.key === 'Backspace' && activeCommand && text.length === 0) {
        e.preventDefault();
        setActiveCommand(null);
        return;
      }

      // ↑ / ↓ — recall earlier prompts (shell-style; only from the first /
      // last line so multi-line editing still works).
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (navigateHistory(e.key === 'ArrowUp' ? -1 : 1, e.currentTarget)) {
          e.preventDefault();
          return;
        }
      }

      if (e.key !== 'Enter') return;
      // W29 — a surface that does not declare composer key bindings leaves
      // Enter to the textarea's own newline behaviour, so the only way to
      // send is the button. Web and desktop both declare it.
      if (!COMPOSER.sendShortcut) return;
      // Ctrl/Cmd+Enter and Shift+Enter insert a newline; plain Enter sends.
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault();
        insertNewline();
        return;
      }
      e.preventDefault();
      void handleSend();
    },
    [menu, menuCount, menuIndex, setMenuIndex, setMenu, applyMenuSelection, activeCommand, setActiveCommand, text, handleSend, insertNewline, pauseVoiceIfListening, navigateHistory],
  );

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      noteTextEdited();
      setText(value);
      // Editing a recalled prompt makes it the user's own draft again.
      leaveHistory();
      detectMenu(value, e.target.selectionStart ?? value.length);
    },
    [detectMenu, leaveHistory, noteTextEdited, setText],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      pauseVoiceIfListening();
      attachPastedFiles(e);
    },
    [pauseVoiceIfListening, attachPastedFiles],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      noteManualCaretMove();
      detectMenu(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
    },
    [noteManualCaretMove, detectMenu],
  );

  return { handleKeyDown, handleTextChange, handlePaste, handleClick };
}
