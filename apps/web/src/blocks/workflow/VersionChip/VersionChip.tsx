// ────────────────────────────────────────────────────────────────
// WF-01 VersionChip / DraftChip — the Badge binding for a definition's
// version state (03-domain §4): "Published v7" (ok, mono `v7`), "Draft"
// (neutral; "Draft rev 13" with a revision), a "Live" chip for the version
// runs use. `onClick` makes it a button (it opens WF-10).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';

interface WrapProps {
  onClick?: (() => void) | undefined;
  title?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

function Wrap({ onClick, title, className, children }: WrapProps) {
  if (!onClick) {
    return (
      <span title={title} className={cn('inline-flex', className)}>
        {children}
      </span>
    );
  }
  return (
    <Button variant="ghost" size="sm" title={title} onClick={onClick} className={cn('px-0.5', className)}>
      {children}
    </Button>
  );
}

export interface VersionChipProps {
  /** The published version number (omit when unknown). */
  version?: number | undefined;
  /** The saved graph is ahead of the published version. */
  hasUnpublishedChanges?: boolean;
  title?: string;
  onClick?: () => void;
  className?: string;
}

/** "Published v7" — or "Published · changes" when saved edits are not published yet. */
export function VersionChip({ version, hasUnpublishedChanges = false, title, onClick, className }: VersionChipProps) {
  return (
    <Wrap onClick={onClick} title={title} className={className}>
      <Badge tone="ok" suffix={version != null ? `v${version}` : undefined}>
        {hasUnpublishedChanges ? 'Published · changes' : 'Published'}
      </Badge>
    </Wrap>
  );
}

export interface DraftChipProps {
  /** The draft's revision ("Draft rev 13"). */
  revision?: number | undefined;
  title?: string;
  onClick?: () => void;
  className?: string;
}

/** "Draft" / "Draft rev 13". */
export function DraftChip({ revision, title, onClick, className }: DraftChipProps) {
  return (
    <Wrap onClick={onClick} title={title} className={className}>
      <Badge tone="neutral" suffix={revision != null ? `rev ${revision}` : undefined}>
        Draft
      </Badge>
    </Wrap>
  );
}

/** The "Live" marker of the version runs use (version lists). */
export function LiveChip({ className }: { className?: string }) {
  return (
    <Badge tone="ok" className={className}>
      Live
    </Badge>
  );
}
