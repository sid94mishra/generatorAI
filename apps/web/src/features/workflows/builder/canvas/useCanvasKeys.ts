// ────────────────────────────────────────────────────────────────
// useCanvasKeys — the builder canvas's keyboard (window-level, like the
// legacy canvas): Delete/Backspace removes the selected stage or edge,
// Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes, A opens the kind palette.
// None of them fire while typing (inputs, textareas, selects, comboboxes,
// contenteditable — CodeMirror editors are contenteditable), inside a
// surface that owns every key (`data-gai-keys="own"`, D-46) or a floating
// layer (a menu's Backspace is not a stage delete), or when another handler
// (the command host's sequences) already took the key.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true;
  const role = target.getAttribute('role');
  return role === 'combobox' || role === 'textbox' || role === 'searchbox';
}

function isShielded(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-gai-keys="own"], [data-gai-overlay]') !== null;
}

/** A dialog or the command palette is open: bare keys belong to it. */
function modalOpen(): boolean {
  return document.querySelector('[data-gai-overlay="dialog"], [data-gai-overlay="palette"]') !== null;
}

/** `onOpenPalette` should be stable (a useCallback): the listener is re-bound when it changes. */
export function useCanvasKeys(onOpenPalette: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || isShielded(e.target)) return;
      const store = useWorkflowBuilderStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && !e.altKey && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod || e.altKey) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (modalOpen()) return;
        if (store.selectedNodeId) store.removeStage(store.selectedNodeId);
        else if (store.selectedEdgeId) store.removeEdge(store.selectedEdgeId);
        return;
      }
      if (key === 'a' && !e.shiftKey && !e.repeat && !modalOpen()) {
        e.preventDefault();
        onOpenPalette();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenPalette]);
}
