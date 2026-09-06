// ────────────────────────────────────────────────────────────────
// InlineDiff — a compact unified diff rendered inside the transcript.
//
// Shown when a file-op step is expanded, so "what did this Edit do?" is
// answered in place instead of by a JSON dump of `old_string`/`new_string`.
// Deliberately minimal: no syntax highlighting, no side-by-side — the Changes
// tab is the full review surface and every diff links there.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { ToolFileOpHunk } from '@generatorai/client-core';
import { cn } from '@/lib/utils.js';

export interface InlineDiffProps {
  hunks: ToolFileOpHunk[];
  truncated?: boolean;
  className?: string;
  /** Rendered in the footer when the diff was cut, e.g. a link to the Changes tab. */
  truncatedAction?: React.ReactNode;
}

type RowKind = 'add' | 'del' | 'ctx';

function rowKind(line: string): RowKind {
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

const ROW_CLASS: Record<RowKind, string> = {
  add: 'bg-success/[0.10] text-foreground',
  del: 'bg-danger/[0.10] text-foreground',
  ctx: 'text-muted-foreground',
};

const SIGN_CLASS: Record<RowKind, string> = {
  add: 'text-success',
  del: 'text-danger',
  ctx: 'text-muted-foreground/50',
};

export function InlineDiff({ hunks, truncated = false, className, truncatedAction }: InlineDiffProps) {
  const showGutter = hunks.some((h) => h.oldStart > 0 || h.newStart > 0);
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-border/70 bg-background/60 font-mono text-[11px] leading-[1.55]',
        className,
      )}
      data-testid="inline-diff"
    >
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse">
          <tbody>
            {hunks.map((h, hi) => {
              let oldNo = h.oldStart;
              let newNo = h.newStart;
              return (
                <React.Fragment key={hi}>
                  {showGutter && (
                    <tr className="bg-subtle/60 text-[10px] text-muted-foreground">
                      <td colSpan={4} className="px-2 py-0.5">
                        @@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
                      </td>
                    </tr>
                  )}
                  {h.lines.map((line, li) => {
                    const kind = rowKind(line);
                    const o = kind === 'add' ? '' : String(oldNo++);
                    const n = kind === 'del' ? '' : String(newNo++);
                    return (
                      <tr key={li} className={ROW_CLASS[kind]}>
                        {showGutter && (
                          <>
                            <td className="w-8 select-none pr-1 text-right text-[10px] text-muted-foreground/50">{o}</td>
                            <td className="w-8 select-none pr-1 text-right text-[10px] text-muted-foreground/50">{n}</td>
                          </>
                        )}
                        <td className={cn('w-4 select-none pl-1.5 text-center', SIGN_CLASS[kind])}>{line[0] ?? ' '}</td>
                        <td className="whitespace-pre pl-1 pr-3">{line.slice(1)}</td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {truncated && (
        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-subtle/40 px-2 py-1 text-[10.5px] text-muted-foreground">
          <span>Diff shortened for the transcript.</span>
          {truncatedAction}
        </div>
      )}
    </div>
  );
}
