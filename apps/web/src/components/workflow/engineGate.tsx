// ────────────────────────────────────────────────────────────────
// engineGate — builder helpers shared by the stage panel, the edge
// editor and the workflow settings:
//   • `EngineGated` renders a control the current engine cannot execute
//     (the spec's `engineIssues` list) disabled, with the upgrade tooltip;
//   • `FieldIssues` shows the validator's issues next to the field they
//     point at (D-25);
//   • `ExpressionField` is an Expression v2 textarea with a live parse.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { ENGINE_LEVEL, parseExpression } from '@generatorai/workflow-spec';
import { Textarea, Tooltip } from '@/components/ui/index.js';
import type { BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { cn } from '@/lib/utils.js';

/** True once the engine that executes every v2 field ships (P03 flips ENGINE_LEVEL). */
export const ENGINE_SUPPORTS_V2: boolean = ENGINE_LEVEL === 'v2';

export const ENGINE_UPGRADE_HINT = 'Available after the engine upgrade';

/** Wrap a control the engine gate rejects: rendered, disabled, with a tooltip. */
export function EngineGated({ children, className }: { children: React.ReactNode; className?: string }) {
  if (ENGINE_SUPPORTS_V2) return <>{children}</>;
  return (
    <Tooltip content={ENGINE_UPGRADE_HINT} side="top">
      <div className={cn('cursor-not-allowed opacity-60', className)} aria-disabled="true" data-engine-gated="">
        <div className="pointer-events-none">{children}</div>
      </div>
    </Tooltip>
  );
}

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
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * An Expression v2 input. The syntax is checked on every keystroke with the
 * spec parser; type errors (unknown variables, stages that are not
 * ancestors) come from the validator and arrive through `issues`.
 */
export function ExpressionField({
  id,
  value,
  onChange,
  placeholder,
  issues,
  disabled,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  issues?: readonly BuilderIssue[];
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const parsed = useMemo(() => (value.trim() ? parseExpression(value) : null), [value]);
  return (
    <div>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        disabled={disabled}
        aria-label={ariaLabel}
        className="resize-y font-mono text-xs"
        placeholder={placeholder}
        spellCheck={false}
      />
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
