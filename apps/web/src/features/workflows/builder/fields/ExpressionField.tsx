// ────────────────────────────────────────────────────────────────
// ExpressionField — the Expression v2 input (P05 WP-5B.5): a lazy
// CodeMirror editor with scope autocomplete, a live type check and a
// last-run hover, over a plain textarea until the chunk arrives. With
// `mode="template"` it edits a template (`{{ … }}` placeholders in text).
// Under it: the parse result ("Parses" / the syntax error) and the
// validator's issues for the field.
// ────────────────────────────────────────────────────────────────

import { lazy, Suspense, useCallback, useMemo } from 'react';
import { parseExpression } from '@generatorai/workflow-spec';
import type { BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { useLastRunValue } from '@/hooks/workflowBuilderQueries.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { builderScopeModel, type PlaceHint } from '../expression/builderScope.js';
import { FieldIssues } from './FieldIssues.js';

/** The CodeMirror editor, in its own lazy chunk (with CodeMirror itself). */
const CodeExpressionEditor = lazy(() => import('../expression/CodeExpressionEditor.js'));

export interface ExpressionFieldProps {
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
  /** Hide the "Parses" line (dense tables). */
  quiet?: boolean;
}

/** An expression (or template) editor with autocomplete, type check and last-run hover. */
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
  rows = 1,
  quiet = false,
}: ExpressionFieldProps) {
  const parsed = useMemo(() => (mode === 'expression' && value.trim() ? parseExpression(value) : null), [mode, value]);
  const placeKey = place ? JSON.stringify(place) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the place is compared by value
  const getModel = useCallback(() => builderScopeModel(place), [placeKey]);
  const lastValue = useLastRunValue();
  const invalid = (issues ?? []).some((i) => i.severity === 'error') || (parsed !== null && !parsed.ok);
  const fallback = (
    <Textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      disabled={disabled}
      aria-label={ariaLabel}
      textareaClassName="font-mono"
      placeholder={placeholder}
      spellCheck={false}
      invalid={invalid}
    />
  );
  return (
    <div className="flex min-w-0 flex-col gap-1">
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
          invalid={invalid}
        />
      </Suspense>
      {parsed && !parsed.ok ? (
        <p className="flex items-start gap-1.5 text-small text-err">
          <Icon concept="status-failed" size={12} className="mt-0.5 shrink-0" />
          <span>
            {parsed.error.message} (at {parsed.error.start + 1})
            {parsed.error.hint ? <span className="text-fg-3"> — {parsed.error.hint}</span> : null}
          </span>
        </p>
      ) : null}
      {!quiet && parsed?.ok && (issues ?? []).length === 0 ? (
        <p className="flex items-center gap-1.5 text-small text-ok">
          <Icon concept="status-succeeded" size={12} /> Parses
        </p>
      ) : null}
      <FieldIssues issues={issues ?? []} />
    </div>
  );
}
