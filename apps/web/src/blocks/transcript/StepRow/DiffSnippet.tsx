// ────────────────────────────────────────────────────────────────
// DiffSnippet — the compact unified diff an expanded file-op step shows
// (B-18 "Edited + DiffSnippet from fileOp"). No syntax highlighting, no side
// by side: the Changes dock is the review surface and every diff links there.
// ────────────────────────────────────────────────────────────────

import { Fragment, type ReactNode } from 'react';
import type { InlineHunk } from '@generatorai/client-core';
import { cn } from '@/ui/lib/cn.js';

type RowKind = 'add' | 'del' | 'ctx';

function rowKind(line: string): RowKind {
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

const ROW: Record<RowKind, string> = {
  add: 'bg-add-bg text-fg',
  del: 'bg-del-bg text-fg',
  ctx: 'text-fg-2',
};

const SIGN: Record<RowKind, string> = {
  add: 'text-ok',
  del: 'text-err',
  ctx: 'text-fg-3',
};

export interface DiffSnippetProps {
  hunks: readonly InlineHunk[];
  /** The diff was cut for the transcript. */
  truncated?: boolean;
  /** Footer action when truncated ("Open full diff"). */
  truncatedAction?: ReactNode;
  className?: string;
}

/** A small unified diff: optional @@ headers and line numbers when the hunks carry them. */
export function DiffSnippet({ hunks, truncated = false, truncatedAction, className }: DiffSnippetProps) {
  const showGutter = hunks.some((h) => h.oldStart > 0 || h.newStart > 0);
  return (
    <div
      className={cn('overflow-hidden rounded-control border border-line-soft bg-sunken font-mono text-micro', className)}
      data-testid="inline-diff"
    >
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse">
          <tbody>
            {hunks.map((h, hi) => {
              let oldNo = h.oldStart;
              let newNo = h.newStart;
              return (
                <Fragment key={hi}>
                  {showGutter ? (
                    <tr className="text-fg-3">
                      <td colSpan={4} className="px-2 py-0.5">
                        @@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
                      </td>
                    </tr>
                  ) : null}
                  {h.lines.map((line, li) => {
                    const kind = rowKind(line);
                    const o = kind === 'add' ? '' : String(oldNo++);
                    const n = kind === 'del' ? '' : String(newNo++);
                    return (
                      <tr key={li} className={ROW[kind]}>
                        {showGutter ? (
                          <>
                            <td className="w-8 pr-1 text-right text-fg-3 select-none">{o}</td>
                            <td className="w-8 pr-1 text-right text-fg-3 select-none">{n}</td>
                          </>
                        ) : null}
                        <td className={cn('w-4 pl-1.5 text-center select-none', SIGN[kind])}>{line[0] ?? ' '}</td>
                        <td className="pr-3 pl-1 whitespace-pre">{line.slice(1)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {truncated ? (
        <div className="flex items-center justify-between gap-2 border-t border-line-soft px-2 py-1 font-sans text-small text-fg-3">
          <span>Diff shortened for the transcript.</span>
          {truncatedAction}
        </div>
      ) : null}
    </div>
  );
}
