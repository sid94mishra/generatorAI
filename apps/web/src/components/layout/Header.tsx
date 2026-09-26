// ────────────────────────────────────────────────────────────────
// Header — the legacy global header (D-21): section title + context actions
//          (Open in editor, side-pane toggle). Since P3-04 it renders only
//          inside app/shell/LegacyHeader, as the first row of the main card,
//          for routes not yet ported. The chat workspace renders its own
//          ChatHeader since P4-12 (its breadcrumb, status and Archive left this
//          file then). Deleted in P7.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { useLocation } from 'react-router';
import { useDockStore } from '@/stores/dockStore.js';
import { OpenInEditorButton } from '@/components/shared/OpenInEditorButton.js';
import { cn } from '@/lib/utils.js';
import { Tooltip } from '@/components/Tooltip.js';
import { Button } from '@/components/ui/index.js';
import { PanelRightOpen, PanelRightClose } from 'lucide-react';

/** Section title for a route still on the legacy header. */
function sectionTitle(pathname: string): string {
  if (pathname === '/') return 'Home';
  if (pathname.startsWith('/workflows')) return 'Workflows';
  if (pathname.startsWith('/projects')) return 'Projects';
  if (pathname.startsWith('/agents')) return 'Agents';
  if (pathname.startsWith('/scripts')) return 'Scripts';
  if (pathname.startsWith('/automations')) return 'Automations';
  if (pathname.startsWith('/settings')) return 'Settings';
  return 'GeneratorAI';
}

export function Header() {
  const location = useLocation();
  // Registered by a page with a dock (today only the legacy workflow run page
  // on this header).
  const dockController = useDockStore((s) => s.controller);

  return (
    <header
      data-testid="app-header"
      className="@container flex h-11 min-w-0 items-center justify-between gap-2 border-b border-border px-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap text-sm">
        <span className="font-medium text-[var(--color-foreground)]">{sectionTitle(location.pathname)}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* Open the page's subject in a real editor. Page-agnostic: workflow
            run, project and codebase pages each publish their own path into
            `editorTargetStore`, and the button hides itself when nothing is
            published. */}
        <OpenInEditorButton />

        {dockController && (
          <Tooltip content={dockController.open ? 'Hide side pane' : 'Show side pane'}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={dockController.toggle}
              aria-pressed={dockController.open}
              aria-label={dockController.open ? 'Hide side pane' : 'Show side pane'}
              data-testid="dock-toggle"
              className={cn(
                'rounded-md border p-1 transition-colors',
                dockController.open
                  ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'border-border text-[var(--color-muted-foreground)] hover:bg-subtle hover:text-[var(--color-foreground)]',
              )}
            >
              {dockController.open ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
          </Tooltip>
        )}
      </div>
    </header>
  );
}
