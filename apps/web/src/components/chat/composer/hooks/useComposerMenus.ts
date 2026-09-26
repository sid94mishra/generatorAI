// ────────────────────────────────────────────────────────────────
// useComposerMenus — the `/` command and `@` file-mention menus
// (03-component-inventory-domain.md §6.1, F-composer-15/16): their data, the
// fuzzy filter (max 50 rows), and what choosing a row does. A slash command
// becomes the active pill; a mention removes the `@query` text and attaches
// the file's contents as a `mention` chip (once per path).
// ────────────────────────────────────────────────────────────────

import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useSlashCommands, useWorkspaceFileIndex } from '@/hooks/composerQueries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { toast } from '@/components/Toast.js';
import { fuzzyMatch } from '../builtins.js';
import type { MentionFile, SlashCommand } from '../types.js';
import type { ComposerDraft } from './useComposerDraft.js';

export interface UseComposerMenusOptions {
  projectId: string | undefined;
  workspaceId: string | undefined;
  draft: ComposerDraft;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export interface ComposerMenus {
  /** Slash commands matching the open `/` menu's query (empty when it is not open). */
  filteredCommands: SlashCommand[];
  /** Files matching the open `@` menu's query (empty when it is not open). */
  filteredMentions: MentionFile[];
  /** Rows in the open menu. */
  menuCount: number;
  fileIndexLoading: boolean;
  /** A mention's contents are being fetched ("Attaching…"). */
  mentionLoading: boolean;
  applySlashCommand: (cmd: SlashCommand) => void;
  /** Choose row `index` of the open menu. */
  applyMenuSelection: (index: number) => void;
}

export function useComposerMenus({ projectId, workspaceId, draft, textareaRef }: UseComposerMenusOptions): ComposerMenus {
  const { menu, setMenu, setMenuIndex, setText, setActiveCommand, setAttachments } = draft;
  const [mentionLoading, setMentionLoading] = useState(false);

  // ── Composer data (slash commands + `@` file index) ──
  const platform = usePlatform();
  const slashCommands = useSlashCommands(projectId);
  const { files: mentionFiles, isLoading: fileIndexLoading } = useWorkspaceFileIndex(workspaceId);

  const filteredCommands = useMemo(() => {
    if (!menu || menu.type !== 'slash') return [] as SlashCommand[];
    const q = menu.query;
    return slashCommands
      .filter((c) => fuzzyMatch(q, c.name) || (c.description ? fuzzyMatch(q, c.description) : false))
      .slice(0, 50);
  }, [menu, slashCommands]);

  const filteredMentions = useMemo(() => {
    if (!menu || menu.type !== 'mention') return [] as MentionFile[];
    const q = menu.query;
    return mentionFiles
      .filter((f) => fuzzyMatch(q, f.label) || fuzzyMatch(q, f.path))
      .slice(0, 50);
  }, [menu, mentionFiles]);

  const applySlashCommand = useCallback(
    (cmd: SlashCommand) => {
      setActiveCommand(cmd);
      setText('');
      setMenu(null);
      setMenuIndex(0);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [setActiveCommand, setText, setMenu, setMenuIndex, textareaRef],
  );

  const applyMention = useCallback(
    async (file: MentionFile) => {
      const current = menu;
      if (!current || current.type !== 'mention' || !workspaceId) return;
      const el = textareaRef.current;
      // Read the live value from the DOM node so this callback doesn't need to
      // be re-created on every keystroke (keeps typing cheap).
      const value = el?.value ?? '';
      const caret = el?.selectionStart ?? value.length;
      const newText = value.slice(0, current.triggerIndex) + value.slice(caret);
      setText(newText);
      setMenu(null);
      requestAnimationFrame(() => {
        const e2 = textareaRef.current;
        if (e2) {
          e2.focus();
          e2.selectionStart = e2.selectionEnd = current.triggerIndex;
        }
      });
      setMentionLoading(true);
      try {
        const res = await platform.getWorkspaceFileContent(
          workspaceId,
          file.path,
          file.source,
          file.worktreeAlias,
        );
        const blob = new Blob([res.content ?? ''], { type: 'text/plain' });
        const f = new File([blob], file.label, { type: 'text/plain' });
        setAttachments((prev) => {
          if (prev.some((a) => a.source === 'mention' && a.label === file.path)) return prev;
          return [
            ...prev,
            {
              id: `mention:${file.source}:${file.worktreeAlias ?? ''}:${file.path}:${Date.now()}`,
              file: f,
              source: 'mention',
              label: file.path,
            },
          ];
        });
      } catch {
        toast({ variant: 'error', title: `Could not attach ${file.label}` });
      } finally {
        setMentionLoading(false);
      }
    },
    [menu, workspaceId, platform, setText, setMenu, setAttachments, textareaRef],
  );

  const applyMenuSelection = useCallback(
    (index: number) => {
      if (!menu) return;
      if (menu.type === 'slash') {
        const cmd = filteredCommands[index];
        if (cmd) applySlashCommand(cmd);
      } else {
        const file = filteredMentions[index];
        if (file) void applyMention(file);
      }
    },
    [menu, filteredCommands, filteredMentions, applySlashCommand, applyMention],
  );

  return {
    filteredCommands,
    filteredMentions,
    menuCount: menu ? (menu.type === 'slash' ? filteredCommands.length : filteredMentions.length) : 0,
    fileIndexLoading,
    mentionLoading,
    applySlashCommand,
    applyMenuSelection,
  };
}
