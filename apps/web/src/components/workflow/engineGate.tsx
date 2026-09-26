// ────────────────────────────────────────────────────────────────
// engineGate — builder helpers shared by the stage panel, the edge
// editor and the workflow settings. The engine runs every v2 field, so
// no control is gated:
//   • `FieldIssues` shows the validator's issues next to the field they
//     point at (D-25);
//   • `ExpressionField` is the Expression v2 editor (P05 WP-5B.5): a lazy
//     CodeMirror editor with scope autocomplete, a live type check and a
//     last-run hover, over a plain textarea until the chunk arrives.
// ────────────────────────────────────────────────────────────────

import React, { Suspense, useCallback, useContext, useMemo } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { QueryClientContext } from '@tanstack/react-query';
import { parseExpression } from '@generatorai/workflow-spec';
import { Textarea } from '@/components/ui/index.js';
import type { BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { cn } from '@/lib/utils.js';
import { builderScopeModel, lastRunValue, type PlaceHint } from './expression/builderScope.js';
import { IssueFixButton } from './builder/issueFixes.js';

/** The CodeMirror editor, in its own lazy chunk (with CodeMirror itself). */
const CodeExpressionEditor = React.lazy(() => import('./expression/CodeExpressionEditor.js'));

/** Issues whose field is `prefix` or lies under it. */
export function issuesAt(issues: readonly BuilderIssue[], ...prefixes: string[]): BuilderIssue[] {
  return issues.filter((i) =>
    prefixes.some((p) => i.field === p || (i.field ?? '').startsWith(`${p}/`)),
  );
}

/** Issue messages shown under a field. */
export function FieldIssues({ issues }: { issues: readonly BuilderIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5" data-testid="field-issues">
      {issues.map((issue, i) => (
        <li
          key={`${issue.code}:${issue.path}:${i}`}
          className={cn(
            'flex items-start gap-1 text-[11px] leading-snug',
            issue.severity === 'error' ? 'text-danger' : 'text-warning',
          )}
        >
          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
          <span>
            {issue.message}
            {issue.hint && <span className="text-muted-foreground"> — {issue.hint}</span>}
            <IssueFixButton issue={issue} className="ml-1 inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * An Expression v2 input (or, with `mode="template"`, a template). The
 * editor autocompletes from the scope of `place` (default: the selected
 * stage, or the selected edge's source), type-checks as you type and shows
 * a path's type and last-run value on hover. The syntax line below and the
 * validator's `issues` stay as before.
 */
export function ExpressionField({
  id,
  value,
  onChange,
  placeholder,
  issues,
  disabled,
  ariaLabel,
  place,
  expect,
  mode = 'expression',
  rows = 2,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  issues?: readonly BuilderIssue[];
  disabled?: boolean;
  ariaLabel?: string;
  /** Where the expression is evaluated (what it may read); default: the selected stage or edge. */
  place?: PlaceHint;
  /** A condition (guard, edge when, exit rule) must be a boolean. */
  expect?: 'boolean' | 'any';
  mode?: 'expression' | 'template';
  rows?: number;
}) {
  const parsed = useMemo(() => (mode === 'expression' && value.trim() ? parseExpression(value) : null), [mode, value]);
  const placeKey = place ? JSON.stringify(place) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const getModel = useCallback(() => builderScopeModel(place), [placeKey]);
  const platform = useContext(PlatformContext);
  const queryClient = useContext(QueryClientContext);
  const lastValue = useMemo(
    () => (platform && queryClient ? (path: string) => lastRunValue(platform, queryClient, path) : undefined),
    [platform, queryClient],
  );
  const fallback = (
    <Textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      disabled={disabled}
      aria-label={ariaLabel}
      className="resize-y font-mono text-xs"
      placeholder={placeholder}
      spellCheck={false}
    />
  );
  return (
    <div>
      <Suspense fallback={fallback}>
        <CodeExpressionEditor
          id={id}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          ariaLabel={ariaLabel}
          mode={mode}
          expect={expect}
          getModel={getModel}
          lastValue={lastValue}
          rows={rows}
        />
      </Suspense>
      {parsed && !parsed.ok && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-danger">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
          <span>
            {parsed.error.message} (at {parsed.error.start + 1})
            {parsed.error.hint && <span className="text-muted-foreground"> — {parsed.error.hint}</span>}
          </span>
        </p>
      )}
      {parsed?.ok && (issues ?? []).length === 0 && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-success">
          <CheckCircle2 className="h-3 w-3" /> Parses
        </p>
      )}
      <FieldIssues issues={issues ?? []} />
    </div>
  );
}
