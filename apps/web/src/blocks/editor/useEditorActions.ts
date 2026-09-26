// ────────────────────────────────────────────────────────────────
// useEditorActions — "Open in <editor>" for the page's published target
// (`editorTargetStore`): the default editor, every editor the server knows,
// Copy path and (desktop) Show in the file manager. Page headers render it
// (the chat header's More menu, P4-12; project / codebase / run pages as they
// port); the legacy OpenInEditorButton shares `resolveDefaultEditor`.
//
// Cross-platform by construction: which editors exist and whether each is
// installed is answered by the server for its own host. Only the file
// manager's NAME reads the browser's OS, and only for the label.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo } from 'react';
import type { EditorId, EditorInfo } from '@generatorai/shared';
import { useEditors, useOpenInEditor, useSourceControlSettings } from '@/hooks/queries.js';
import { isDesktop } from '@/lib/desktop.js';
import { useEditorTargetStore, type EditorTarget } from '@/stores/editorTargetStore.js';
import { copyTextToClipboard } from '@/utils/copyToClipboard.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';

/** What the OS calls the thing "Show in …" opens. */
export const FILE_MANAGER =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac OS X')
    ? 'Finder'
    : typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
      ? 'File Explorer'
      : 'the file manager';

/**
 * Which editor the primary action uses: the configured default when the
 * server still reports it, else the first one it can actually launch, else
 * the first it knows about (its URL scheme is the browser fallback).
 */
export function resolveDefaultEditor(
  editors: EditorInfo[] | undefined,
  configured: EditorId | null | undefined,
): EditorInfo | undefined {
  const list = editors ?? [];
  if (configured) {
    const match = list.find((e) => e.id === configured);
    if (match) return match;
  }
  return list.find((e) => e.available) ?? list[0];
}

export interface EditorActions {
  /** The page's target; null → render no editor action at all. */
  target: EditorTarget | null;
  editors: EditorInfo[];
  preferred: EditorInfo | undefined;
  /** "Open in VS Code", or "Open in editor" before the list loads. */
  label: string;
  pending: boolean;
  open: (editor?: EditorId) => void;
  copyPath: () => Promise<void>;
  /** Desktop only (undefined in a browser). */
  reveal: (() => Promise<void>) | undefined;
}

export function useEditorActions(): EditorActions {
  const target = useEditorTargetStore((s) => s.target);
  const { data: editorList } = useEditors();
  const { data: scmSettings } = useSourceControlSettings();
  const openInEditor = useOpenInEditor();
  const editors = useMemo(() => editorList ?? [], [editorList]);
  const preferred = resolveDefaultEditor(editors, scmSettings?.settings.editor.defaultEditor);

  const open = useCallback(
    (editor?: EditorId) => {
      if (!target) return;
      openInEditor.mutate({ path: target.path, ...(editor ? { editor } : {}) });
    },
    [openInEditor, target],
  );

  const copyPath = useCallback(async () => {
    if (!target) return;
    try {
      await copyTextToClipboard(target.path);
    } catch {
      toast.error('Could not copy the path', { description: target.path });
    }
  }, [target]);

  // Honest about remote servers: the shell reports whether the path exists on
  // THIS machine, which it does not when the server runs somewhere else.
  const reveal = useCallback(async () => {
    if (!target) return;
    const show = window.generatoraiDesktop?.showItemInFolder;
    if (!show) return;
    const shown = await show(target.path).catch(() => false);
    if (!shown) {
      toast.error(`Could not show it in ${FILE_MANAGER}`, {
        description: 'That folder is on the server, not on this machine.',
      });
    }
  }, [target]);

  return {
    target,
    editors,
    preferred,
    label: preferred ? `Open in ${preferred.name}` : 'Open in editor',
    pending: openInEditor.isPending,
    open,
    copyPath,
    reveal: isDesktop ? reveal : undefined,
  };
}
