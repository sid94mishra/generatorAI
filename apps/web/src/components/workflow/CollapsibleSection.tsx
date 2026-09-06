// ────────────────────────────────────────────────────────────────
// CollapsibleSection — Accordion section for property panels
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/index.js';

interface CollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, icon, defaultOpen = true, badge, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border last:border-b-0">
      <Button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`collapsible-${title.replace(/\s+/g, '-')}`}
        variant="ghost"
        size="sm"
        className={cn(
          'h-auto flex w-full items-center justify-between rounded-none bg-transparent px-4 py-2.5',
          'text-xs font-semibold uppercase tracking-wider',
          'text-muted-foreground',
          'hover:bg-subtle/50',
          'transition-colors duration-150',
        )}
      >
        <div className="flex items-center gap-2">
          {icon}
          {title}
          {badge && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary normal-case">
              {badge}
            </span>
          )}
        </div>
        <ChevronRight
          className={cn('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-90')}
        />
      </Button>
      <div
        id={`collapsible-${title.replace(/\s+/g, '-')}`}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        {/* `inert` matters as much as the clipping does: a closed section keeps
            its children mounted so the grid-rows transition has something to
            animate, and without this they stayed focusable, clickable and
            announced — a keyboard user could tab into invisible controls. */}
        <div className="overflow-hidden" inert={!open}>
          <div className="px-4 pb-4 pt-1 space-y-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
