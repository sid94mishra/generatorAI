// ────────────────────────────────────────────────────────────────
// useComposerDraft — what is in the box (03-component-inventory-domain.md
// §6.1): the text, the attachment chips, the active `/command` pill, and the
// `/` / `@` menu state with its detection. Attachments arrive by picking,
// dropping or pasting files; each path honours `COMPOSER.attachments`.
// ────────────────────────────────────────────────────────────────

import type React from 'react';
import { useCallback, useState } from 'react';
import type { SlashCommand } from '@generatorai/client-core';
import type { ComposerAttachment, ComposerMenuState, CaptureSource } from '../model/types.js';
import { COMPOSER } from './affordances.js';

export interface UseComposerDraftOptions {
  /** Workspace id — `@` file mentions are only detected when there is one to search. */
  workspaceId: string | undefined;
}

export interface ComposerDraft {
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  attachments: ComposerAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>;
  activeCommand: SlashCommand | null;
  setActiveCommand: React.Dispatch<React.SetStateAction<SlashCommand | null>>;
  menu: ComposerMenuState | null;
  setMenu: React.Dispatch<React.SetStateAction<ComposerMenuState | null>>;
  menuIndex: number;
  setMenuIndex: React.Dispatch<React.SetStateAction<number>>;
  /** Open, move or close the menu for the caret position in `value`. */
  detectMenu: (value: string, caret: number) => void;
  removeAttachment: (id: string) => void;
  /** The hidden file input's change handler. */
  handleFilesChanged: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  /** Attach the clipboard's files (a pasted screenshot); leaves a text paste alone. */
  attachPastedFiles: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}

function asFileAttachments(prefix: 'file' | 'paste', files: File[]): ComposerAttachment[] {
  return files.map((file, i) => ({
    id: `${prefix}:${Date.now()}:${i}:${file.name}`,
    file,
    source: 'file' as CaptureSource,
  }));
}

export function useComposerDraft({ workspaceId }: UseComposerDraftOptions): ComposerDraft {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  // ── Composer menu (`/` commands + `@` file mentions) ──
  const [activeCommand, setActiveCommand] = useState<SlashCommand | null>(null);
  const [menu, setMenu] = useState<ComposerMenuState | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);

  // Detect whether the caret sits inside a `/command` or `@mention` token.
  const detectMenu = useCallback(
    (value: string, caret: number) => {
      // Slash: only when the value starts with '/', the caret is within the
      // first (command) token, and no command is already active.
      if (!activeCommand && value.startsWith('/')) {
        const firstSpace = value.search(/\s/);
        const tokenEnd = firstSpace === -1 ? value.length : firstSpace;
        if (caret <= tokenEnd) {
          setMenu({ type: 'slash', query: value.slice(1, caret), triggerIndex: 0 });
          setMenuIndex(0);
          return;
        }
      }
      // Mention: last '@' before the caret, preceded by start/whitespace, with
      // no whitespace between it and the caret. Requires a workspace to search.
      if (workspaceId) {
        const upto = value.slice(0, caret);
        const at = upto.lastIndexOf('@');
        if (at !== -1) {
          const before = at === 0 ? '' : value.charAt(at - 1);
          const token = value.slice(at + 1, caret);
          if ((at === 0 || /\s/.test(before)) && !/\s/.test(token)) {
            setMenu({ type: 'mention', query: token, triggerIndex: at });
            setMenuIndex(0);
            return;
          }
        }
      }
      setMenu(null);
    },
    [activeCommand, workspaceId],
  );

  const handleFilesChanged = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) {
      setAttachments((prev) => [...prev, ...asFileAttachments('file', files)]);
    }
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // W29 — dropping a file on a surface that declares no file attachment
    // must do nothing, not silently attach. `preventDefault` still runs so
    // the browser does not navigate away to the dropped file.
    if (!COMPOSER.attachments) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      setAttachments((prev) => [...prev, ...asFileAttachments('file', files)]);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const attachPastedFiles = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // A pasted image (screenshot from the clipboard) becomes an attachment
    // instead of being silently dropped.
    if (!COMPOSER.attachments) return;
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    setAttachments((prev) => [
      ...prev,
      ...files.map((file, i) => ({
        id: `paste:${Date.now()}:${i}:${file.name}`,
        file: file.name
          ? file
          : new File([file], `pasted-${Date.now()}.${(file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`, {
              type: file.type,
            }),
        source: 'file' as CaptureSource,
      })),
    ]);
  }, []);

  return {
    text,
    setText,
    attachments,
    setAttachments,
    activeCommand,
    setActiveCommand,
    menu,
    setMenu,
    menuIndex,
    setMenuIndex,
    detectMenu,
    removeAttachment,
    handleFilesChanged,
    handleDrop,
    handleDragOver,
    attachPastedFiles,
  };
}
