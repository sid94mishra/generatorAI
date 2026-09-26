// ────────────────────────────────────────────────────────────────
// "Open in editor" for a changed file.
//
// Offered when the server host has an editor OR we are in the desktop shell.
// In a plain browser talking to a remote server the `vscode://` fallback is
// the only thing that could work, and offering it where nothing is installed
// anywhere is a dead control.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo } from 'react';
import { useEditors, useOpenInEditor } from '@/hooks/queries.js';
import { isDesktop } from '@/lib/desktop.js';
import { joinPath } from './changePaths.js';

export function useChangesEditor(mounts: ReadonlyArray<{ alias: string; path: string }>) {
  const editors = useEditors();
  const openInEditor = useOpenInEditor();
  const canOpenInEditor = (editors.data?.some((e) => e.available) ?? false) || isDesktop;

  const mountPathByAlias = useMemo(() => new Map(mounts.map((m) => [m.alias, m.path])), [mounts]);

  /** A changed file, by mount alias + repo-relative path. */
  const openFile = useCallback(
    (alias: string, filePath: string) => {
      const root = mountPathByAlias.get(alias);
      if (!root) return;
      openInEditor.mutate({ path: joinPath(root, filePath) });
    },
    [mountPathByAlias, openInEditor],
  );

  /** Any absolute path on the server host (source control's conflict list). */
  const openAbsolute = useCallback(
    (absolutePath: string) => openInEditor.mutate({ path: absolutePath }),
    [openInEditor],
  );

  return { canOpenInEditor, openFile, openAbsolute };
}
