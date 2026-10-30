// ────────────────────────────────────────────────────────────────
// useComposerMenus — the `/` command and `@` file-mention menus
// (03-component-inventory-domain.md §6.1, F-composer-15/16): their data, the
// fuzzy filter (max 50 rows), and what choosing a row does. A slash command
// becomes the active pill; a mention removes the `@query` text and attaches
// the file's contents as a `mention` chip (once per path).
// ────────────────────────────────────────────────────────────────

import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
  SLASH_COMMAND_GROUPS,
  fuzzyMatch,
  slashCommandGroup,
  type MentionFile,
  type SlashCommand,
} from '@generatorai/client-core';
import { useFetchMentionFileContent, useSlashCommands, useWorkspaceFileIndex } from '@/hooks/composerQueries.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
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
  const fetchMentionContent = useFetchMentionFileContent();
  const slashCommands = useSlashCommands(projectId);
  const { files: mentionFiles, isLoading: fileIndexLoading } = useWorkspaceFileIndex(workspaceId);

  const filteredCommands = useMemo(() => {
    if (!menu || menu.type !== 'slash') return [] as SlashCommand[];
    const q = menu.query;
    // Grouped Tools → Skills → Prompts (stable within a group), so the menu's
    // visual order and the keyboard index agree.
    return slashCommands
      .filter((c) => fuzzyMatch(q, c.name) || (c.description ? fuzzyMatch(q, c.description) : false))
      .map((c, i) => ({ c, i, g: SLASH_COMMAND_GROUPS.indexOf(slashCommandGroup(c)) }))
      .sort((a, b) => a.g - b.g || a.i - b.i)
      .map(({ c }) => c)
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
        const content = await fetchMentionContent(workspaceId, file);
        const blob = new Blob([content], { type: 'text/plain' });
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
        toast.error(`Could not attach ${file.label}`, { description: 'The file could not be read from the workspace.' });
      } finally {
        setMentionLoading(false);
      }
    },
    [menu, workspaceId, fetchMentionContent, setText, setMenu, setAttachments, textareaRef],
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
