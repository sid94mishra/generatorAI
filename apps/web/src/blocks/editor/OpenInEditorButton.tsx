// ────────────────────────────────────────────────────────────────
// OpenInEditorButton — the page header's "Open" split button (owner,
// 2026-10-20): the main part opens the page's target in the default editor
// and shows that editor's mark; the chevron lists the editors offered — VS
// Code and Cursor, each with its mark, the default checked and one the server
// cannot find marked "Not installed" (its URL scheme still tries). Picking one
// opens there and makes it the default. Renders nothing without a target.
// ────────────────────────────────────────────────────────────────

import type { EditorId } from '@generatorai/shared';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { EditorMark } from '@/ui/icons/vendor/VendorIcons.js';
import { useEditorActions } from './useEditorActions.js';

const FALLBACK: EditorId = 'vscode';

export function OpenInEditorButton() {
  const editor = useEditorActions();
  if (!editor.target) return null;
  const current = editor.preferred?.id ?? FALLBACK;
  const name = editor.preferred?.name ?? 'VS Code';
  return (
    <div className="inline-flex shrink-0" data-testid="open-in-editor">
      <Button
        size="sm"
        aria-label={`Open in ${name}`}
        title={`Open in ${name}`}
        loading={editor.pending}
        onClick={() => editor.open(current)}
        className="rounded-r-none"
      >
        <span className="flex items-center gap-1.5">
          <EditorMark editor={current} className="size-3.5 shrink-0" />
          Open
        </span>
      </Button>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              size="sm"
              aria-label="Choose an editor"
              title="Choose an editor"
              trailingIcon="chevron-down"
              className="rounded-l-none border-l-0 px-1.5"
            />
          }
        />
        <Menu.Popup align="end" className="min-w-52">
          <Menu.Group>
            <Menu.GroupLabel>Open in</Menu.GroupLabel>
            {editor.editors.map((e) => (
              <Menu.Item
                key={e.id}
                onClick={() => editor.choose(e.id)}
                trailing={
                  e.id === current ? (
                    <Icon concept="check" size={14} className="text-fg-2" />
                  ) : !e.available ? (
                    'Not installed'
                  ) : undefined
                }
                data-testid={`open-in-${e.id}`}
              >
                <span className="flex items-center gap-2">
                  <EditorMark editor={e.id} className="size-4 shrink-0" />
                  {e.name}
                </span>
              </Menu.Item>
            ))}
          </Menu.Group>
        </Menu.Popup>
      </Menu.Root>
    </div>
  );
}
