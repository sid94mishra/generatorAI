// ────────────────────────────────────────────────────────────────
// WF-03 ProblemsPanel — the builder's validation problems, docked under the
// canvas (WorkflowValidate board):
//
//   header  ⊗ 3 errors  ⚠ 1 warning  "Publish and Run are blocked until the
//           errors are fixed. Save still works."   checked 14:07 · Check
//           again · Close
//   rows    status glyph · the stage (or "A → B" for an edge) · the issue
//           code in mono · message + hint · the row's action: its quick fix
//           ("Declare", "Rename" …) or "Go to →"
//   footer  "Warnings don't block Publish or Run." when there are warnings
//
// Presentational: plain rows and callbacks. Clicking a row goes to it.
// ────────────────────────────────────────────────────────────────

import type { MouseEvent } from 'react';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Table, TableBody, TableCell, TableRow } from '@/ui/primitives/Table/Table.js';

export interface ProblemRowFix {
  /** Short button label ("Declare", "Rename", "Remove"). */
  label: string;
  /** The full description, as the button's tooltip ("Declare variable 'risk_threshold'"). */
  title?: string | undefined;
  onApply: () => void;
}

export interface ProblemRow {
  id: string;
  severity: 'error' | 'warning';
  /** The stage's name, "A → B" for an edge; omit for a workflow-level problem. */
  target?: string | undefined;
  /** The stable issue code (`undeclared-variable`). */
  code: string;
  message: string;
  hint?: string | undefined;
  /** The one-click fix, when the problem has one. */
  fix?: ProblemRowFix | undefined;
  /** Bring the problem's stage or edge into view (rows without a target have none). */
  onGoTo?: (() => void) | undefined;
}

export interface ProblemsPanelProps {
  rows: readonly ProblemRow[];
  /** When the problems were last checked ("checked 14:07"). */
  checkedAt?: Date | undefined;
  onCheckAgain?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  className?: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function clock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const COLUMNS = [16, 'minmax(96px,200px)', 'minmax(0,180px)', 'minmax(0,1fr)', 'auto'] as const;

/** The builder's problems panel (WF-03). */
export function ProblemsPanel({ rows, checkedAt, onCheckAgain, onClose, className }: ProblemsPanelProps) {
  const errors = rows.filter((r) => r.severity === 'error').length;
  const warnings = rows.length - errors;
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <section aria-label="Problems" className={cn('flex min-h-0 flex-col', className)} data-testid="problems-panel">
      <header className="sticky top-0 z-sticky flex h-bar shrink-0 items-center gap-3 border-b border-line-soft bg-surface pr-2 pl-4">
        {rows.length === 0 ? (
          <span className="flex items-center gap-1.5 text-ui font-semibold text-ok">
            <Icon concept="status-succeeded" size={14} />
            No problems
          </span>
        ) : (
          <>
            {errors > 0 ? (
              <span className="flex shrink-0 items-center gap-1.5 text-ui font-semibold text-fg">
                <Icon concept="status-failed" size={14} className="text-err" />
                {plural(errors, 'error', 'errors')}
              </span>
            ) : null}
            {warnings > 0 ? (
              <span className="flex shrink-0 items-center gap-1.5 text-ui font-semibold text-fg">
                <Icon concept="warning" size={14} className="text-warn" />
                {plural(warnings, 'warning', 'warnings')}
              </span>
            ) : null}
          </>
        )}
        <span className="min-w-0 flex-1 truncate text-small text-fg-3">
          {errors > 0
            ? 'Save, Publish and Run are blocked until the errors are fixed.'
            : rows.length > 0
              ? "Warnings don't block Publish or Run."
              : 'Publish and Run are not blocked.'}
        </span>
        {checkedAt ? <span className="shrink-0 font-mono text-micro text-fg-3">checked {clock(checkedAt)}</span> : null}
        {onCheckAgain ? (
          <Button variant="ghost" size="sm" icon="refresh" onClick={onCheckAgain}>
            Check again
          </Button>
        ) : null}
        {onClose ? <IconButton icon="x" size="sm" label="Close problems" onClick={onClose} /> : null}
      </header>

      {rows.length > 0 ? (
        <Table columns={COLUMNS} inset="compact" label="Problems" bare>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                interactive={row.onGoTo !== undefined}
                onClick={row.onGoTo}
                className="h-auto min-h-row py-2"
                data-testid="problem-row"
              >
                <TableCell>
                  <Icon
                    concept={row.severity === 'error' ? 'status-failed' : 'warning'}
                    size={14}
                    className={row.severity === 'error' ? 'text-err' : 'text-warn'}
                    label={row.severity === 'error' ? 'Error' : 'Warning'}
                  />
                </TableCell>
                <TableCell>
                  {row.onGoTo ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2 max-w-full min-w-0 justify-start text-ui text-fg"
                      onClick={(e) => {
                        stop(e);
                        row.onGoTo?.();
                      }}
                    >
                      <span className="truncate">{row.target ?? 'Workflow'}</span>
                    </Button>
                  ) : (
                    <span className="truncate text-fg">{row.target ?? 'Workflow'}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Chip mono size="sm" title={row.code}>
                    <span className="truncate">{row.code}</span>
                  </Chip>
                </TableCell>
                <TableCell className="flex-col items-start">
                  <span className="max-w-full text-ui break-words text-fg">{row.message}</span>
                  {row.hint ? <span className="max-w-full text-small break-words text-fg-3">{row.hint}</span> : null}
                </TableCell>
                <TableCell align="end">
                  {row.fix ? (
                    <Button
                      size="sm"
                      icon="plus"
                      title={row.fix.title}
                      onClick={(e) => {
                        stop(e);
                        row.fix?.onApply();
                      }}
                    >
                      {row.fix.label}
                    </Button>
                  ) : row.onGoTo ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      trailingIcon="forward"
                      aria-label={`Go to ${row.target ?? 'problem'}`}
                      onClick={(e) => {
                        stop(e);
                        row.onGoTo?.();
                      }}
                    >
                      Go to
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {errors > 0 && warnings > 0 ? (
        <p className="px-4 py-2 text-small text-fg-3">Warnings don&apos;t block Publish or Run.</p>
      ) : null}
    </section>
  );
}
