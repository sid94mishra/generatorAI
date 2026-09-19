// ────────────────────────────────────────────────────────────────
// OpenInEditorButton — the top bar's "Open in <editor>" split button.
//
// Left half launches the default editor on the page's published target
// (see `editorTargetStore`); the caret lists every editor the server
// knows about plus "Copy path". Editors the server host cannot launch are
// still listed — in a browser talking to a remote server NOTHING is
// launchable there, and the `vscode://` fallback URL is the whole point —
// but they are marked so the label explains itself.
//
// Cross-platform by construction: which editors exist, and whether each is
// installed, is answered by the server for its own host. Nothing here
// inspects the browser's OS.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, Code2, Copy, FolderOpen } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/index.js';
import { Tooltip } from '@/components/Tooltip.js';
import { toast } from '@/components/Toast.js';
import { cn } from '@/lib/utils.js';
import { useEditors, useOpenInEditor, useSourceControlSettings } from '@/hooks/queries.js';
import { useEditorTargetStore } from '@/stores/editorTargetStore.js';
import { isDesktop } from '@/lib/desktop.js';

/** What the OS calls the thing this opens. */
const FILE_MANAGER =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac OS X')
    ? 'Finder'
    : typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
      ? 'File Explorer'
      : 'the file manager';
import type { EditorId, EditorInfo } from '@generatorai/shared';

/** Copy to the clipboard with a `document.execCommand` fallback. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through — a denied permission is not a reason to give up.
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Which editor the primary click uses: the configured default when the
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

export function OpenInEditorButton({ className }: { className?: string }) {
  const target = useEditorTargetStore((s) => s.target);
  const { data: editorList } = useEditors();
  const { data: scmSettings } = useSourceControlSettings();
  const openInEditor = useOpenInEditor();
  const [menuOpen, setMenuOpen] = useState(false);

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
    const ok = await copyText(target.path);
    toast(
      ok
        ? { variant: 'success', title: 'Path copied', description: target.path }
        : { variant: 'error', title: 'Could not copy the path', description: target.path },
    );
  }, [target]);

  // Desktop only, and honest about remote servers: the shell reports back
  // whether the path exists on THIS machine, which it does not when the server
  // runs somewhere else.
  const revealInFileManager = useCallback(async () => {
    if (!target) return;
    const reveal = window.generatoraiDesktop?.showItemInFolder;
    if (!reveal) return;
    const shown = await reveal(target.path).catch(() => false);
    if (!shown) {
      toast({
        variant: 'error',
        title: `Could not show it in ${FILE_MANAGER}`,
        description: 'That folder is on the server, not on this machine.',
      });
    }
  }, [target]);

  // No target → no button. A page that has not resolved a path (or has none)
  // must not show a control that would do nothing.
  if (!target) return null;

  const label = preferred ? `Open in ${preferred.name}` : 'Open in editor';

  return (
    <div className={cn('flex items-center', className)} data-testid="open-in-editor">
      <Tooltip content={target.path}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => open(preferred?.id)}
          loading={openInEditor.isPending}
          leftIcon={<Code2 className="h-3.5 w-3.5" />}
          aria-label={label}
          data-testid="open-in-editor-primary"
          className="h-7 rounded-l-md rounded-r-none border border-r-0 border-border px-2 text-[11px] font-normal text-[var(--color-muted-foreground)] hover:bg-subtle hover:text-[var(--color-foreground)]"
        >
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </Tooltip>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Choose an editor"
            data-testid="open-in-editor-menu"
            className="h-7 w-6 rounded-l-none rounded-r-md border border-border p-0 text-[var(--color-muted-foreground)] hover:bg-subtle hover:text-[var(--color-foreground)]"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Open in</DropdownMenuLabel>
          {editors.length === 0 && (
            <DropdownMenuItem disabled>No editors detected</DropdownMenuItem>
          )}
          {editors.map((editor) => (
            <DropdownMenuItem key={editor.id} onSelect={() => open(editor.id)}>
              <Code2 className="h-3.5 w-3.5" />
              <span className="flex-1 truncate">{editor.name}</span>
              {!editor.available && (
                <span className="text-[10px] text-muted-foreground">not installed</span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copyPath()}>
            <Copy className="h-3.5 w-3.5" />
            Copy path
          </DropdownMenuItem>
          {isDesktop && (
            <DropdownMenuItem onSelect={() => void revealInFileManager()}>
              <FolderOpen className="h-3.5 w-3.5" />
              Show in {FILE_MANAGER}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
