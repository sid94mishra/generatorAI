// ────────────────────────────────────────────────────────────────
// WF-18 ExitRuleTable — a loop's exit rules (WorkflowLoopBuilder board):
//
//   Until        → Complete · done          (first `complete` rule)
//   Fail when    [expression]               (first `fail` rule)
//   Pause when   [expression]               (first `pause` rule)
//   Stall        ×2 in a row → Exhaust · no_changes
//   More rules   every further rule, with its own action
//   + Add rule                     Order: fail, complete, pause, exhaust
//
// A quick row edits the FIRST rule of its action; until it has a condition
// it writes nothing (an empty rule is invalid) and keeps its streak and
// reason as a draft; clearing the condition removes the rule. The summary
// on a set row opens its streak ("in a row") and reason. Presentational:
// the expression editor and the validation messages come from the caller
// through `renderCondition` / `renderIssues` (pointers relative to the
// rule list: `/2/when`).
// ────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react';
import { LOOP_EXIT_ACTIONS, type ExitRule, type LoopExitAction } from '@generatorai/workflow-spec';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { Select } from '@/ui/primitives/Select/Select.js';

/** What the caller's condition editor receives. */
export interface ExitConditionSlot {
  /** The rule's index in `rules`; undefined for a quick row that has no rule yet. */
  index: number | undefined;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
}

export interface ExitRuleTableProps {
  rules: readonly ExitRule[];
  onChange: (rules: ExitRule[]) => void;
  /** The boolean expression editor of a rule. */
  renderCondition: (slot: ExitConditionSlot) => ReactNode;
  /**
   * Validation messages at `pointers` (relative to the rule list: `/2/reason`).
   * `exact`: only issues at exactly those pointers; otherwise also below them.
   */
  renderIssues?: (pointers: readonly string[], exact: boolean) => ReactNode;
  className?: string;
}

interface QuickRow {
  action: LoopExitAction;
  label: string;
  hint: string;
  reason: string;
  placeholder: string;
}

/** The four quick rows, in the plan's order. */
export const EXIT_QUICK_ROWS: readonly QuickRow[] = [
  {
    action: 'complete',
    label: 'Until',
    hint: 'Ends the loop successfully',
    reason: 'done',
    placeholder: "e.g. stages.review.output.verdict == 'approve'",
  },
  {
    action: 'fail',
    label: 'Fail when',
    hint: 'Fails the loop',
    reason: 'failed',
    placeholder: "e.g. stages.assess.output.status == 'impossible'",
  },
  {
    action: 'pause',
    label: 'Pause when',
    hint: 'Parks the loop for an operator decision',
    reason: 'needs_input',
    placeholder: "e.g. stages.assess.output.status == 'blocked'",
  },
  {
    action: 'exhaust',
    label: 'Stall',
    hint: 'Treats the loop as exhausted: the on-limit policy applies',
    reason: 'stalled',
    placeholder: 'e.g. not loop.last.signals.workspaceChanged',
  },
];

export const EXIT_ACTION_LABEL: Record<LoopExitAction, string> = {
  complete: 'Complete',
  fail: 'Fail',
  pause: 'Pause',
  exhaust: 'Exhaust',
};

const ACTION_META: Record<LoopExitAction, string> = {
  complete: 'end successfully',
  fail: 'fail the loop',
  pause: 'operator decision',
  exhaust: 'apply on limit',
};

const ACTION_ITEMS = LOOP_EXIT_ACTIONS.map((a) => ({ value: a, label: EXIT_ACTION_LABEL[a], meta: ACTION_META[a] }));

export const EXIT_REASON_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** "×2 in a row → Exhaust · no_changes". */
export function exitRuleSummary(rule: ExitRule): string {
  const streak = rule.consecutive > 1 ? `×${rule.consecutive} in a row ` : '';
  return `${streak}→ ${EXIT_ACTION_LABEL[rule.action]} · ${rule.reason}`;
}

/**
 * The quick rows' rule indexes (the first rule of each action) and the
 * other rules ("more rules"), in list order.
 */
export function splitExitRules(rules: readonly ExitRule[]): {
  quick: Map<LoopExitAction, number>;
  extra: { rule: ExitRule; index: number }[];
} {
  const quick = new Map<LoopExitAction, number>();
  rules.forEach((r, i) => {
    if (!quick.has(r.action)) quick.set(r.action, i);
  });
  const quickSet = new Set(quick.values());
  return { quick, extra: rules.map((rule, index) => ({ rule, index })).filter(({ index }) => !quickSet.has(index)) };
}

/** The exit rules of a loop: four quick rows, more rules, add, the firing order. */
export function ExitRuleTable({ rules, onChange, renderCondition, renderIssues, className }: ExitRuleTableProps) {
  const { quick, extra } = splitExitRules(rules);
  const replace = (index: number, rule: ExitRule) => onChange(rules.map((r, i) => (i === index ? rule : r)));
  const remove = (index: number) => onChange(rules.filter((_, i) => i !== index));
  const addRule = () => {
    // A new rule joins "more rules" when its action already has a quick row.
    const action = LOOP_EXIT_ACTIONS.find((a) => quick.has(a)) ?? 'complete';
    let n = rules.length + 1;
    while (rules.some((r) => r.reason === `rule_${n}`)) n++;
    onChange([...rules, { when: '', action, consecutive: 1, reason: `rule_${n}` }]);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="exit-rule-table">
      {EXIT_QUICK_ROWS.map((row) => {
        const index = quick.get(row.action);
        return (
          <QuickExitRow
            key={row.action}
            row={row}
            index={index}
            rule={index === undefined ? undefined : rules[index]}
            onAdd={(rule) => onChange([...rules, rule])}
            onReplace={replace}
            onRemove={remove}
            renderCondition={renderCondition}
            renderIssues={renderIssues}
          />
        );
      })}

      {extra.length > 0 ? <p className="pt-1 text-small font-medium text-fg-2">More rules</p> : null}
      {extra.map(({ rule, index }) => (
        <div key={index} className="flex flex-col gap-2 rounded-card border border-line-soft p-2.5">
          <div className="flex items-center gap-1.5">
            <Select
              aria-label={`Rule ${index + 1} action`}
              size="sm"
              value={rule.action}
              onValueChange={(v) => v && replace(index, { ...rule, action: v as LoopExitAction })}
              items={ACTION_ITEMS}
              className="flex-1"
            />
            <IconButton icon="trash" size="sm" label={`Remove rule ${index + 1}`} onClick={() => remove(index)} />
          </div>
          {renderCondition({
            index,
            value: rule.when,
            onChange: (when) => replace(index, { ...rule, when }),
            ariaLabel: `Rule ${index + 1} condition`,
            placeholder: 'A boolean evaluated after each iteration',
          })}
          <StreakAndReason
            rule={rule}
            onChange={(r) => replace(index, r)}
            label={`Rule ${index + 1}`}
            issues={renderIssues?.([`/${index}/consecutive`, `/${index}/reason`], false)}
          />
          {renderIssues?.([`/${index}`], true)}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" icon="plus" className="-ml-2" onClick={addRule}>
          Add rule
        </Button>
        <span className="ml-auto text-small text-fg-3">Order: fail, complete, pause, exhaust</span>
      </div>
    </div>
  );
}

function QuickExitRow({
  row,
  index,
  rule,
  onAdd,
  onReplace,
  onRemove,
  renderCondition,
  renderIssues,
}: {
  row: QuickRow;
  index: number | undefined;
  rule: ExitRule | undefined;
  onAdd: (rule: ExitRule) => void;
  onReplace: (index: number, rule: ExitRule) => void;
  onRemove: (index: number) => void;
  renderCondition: ExitRuleTableProps['renderCondition'];
  renderIssues: ExitRuleTableProps['renderIssues'];
}) {
  // Until the row has a condition it writes nothing; its streak and reason wait here.
  const [draft, setDraft] = useState<ExitRule>({ when: '', action: row.action, consecutive: 1, reason: row.reason });
  const [open, setOpen] = useState(false);
  const current = rule ?? draft;
  const reasonInvalid = !EXIT_REASON_PATTERN.test(current.reason);

  const update = (next: ExitRule) => {
    if (index !== undefined && rule) {
      if (!next.when.trim()) {
        // Clearing the condition removes the rule; the rest stays for retyping.
        setDraft({ ...next, when: '' });
        onRemove(index);
      } else {
        onReplace(index, next);
      }
      return;
    }
    if (next.when.trim()) onAdd(next);
    else setDraft(next);
  };

  const set = rule !== undefined || current.when !== '';
  const expanded = set && (open || reasonInvalid);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-control items-center gap-2">
        <span className="shrink-0 text-ui text-fg">{row.label}</span>
        {set ? (
          <Button
            size="sm"
            variant="ghost"
            trailingIcon={expanded ? 'chevron-up' : 'chevron-down'}
            className="-mr-2 ml-auto min-w-0 font-mono"
            aria-expanded={expanded}
            title="Streak and reason"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="truncate">{exitRuleSummary(current)}</span>
          </Button>
        ) : (
          <span className="ml-auto truncate text-small text-fg-3">{row.hint}</span>
        )}
      </div>
      {renderCondition({
        index,
        value: current.when,
        onChange: (when) => update({ ...current, when }),
        ariaLabel: `${row.label} condition`,
        placeholder: row.placeholder,
      })}
      <Reveal open={expanded} gap={1.5}>
        <StreakAndReason rule={current} onChange={update} label={row.label} />
      </Reveal>
      {index !== undefined ? renderIssues?.([`/${index}/consecutive`, `/${index}/reason`], false) : null}
      {index !== undefined ? renderIssues?.([`/${index}`], true) : null}
    </div>
  );
}

function StreakAndReason({
  rule,
  onChange,
  label,
  issues,
}: {
  rule: ExitRule;
  onChange: (rule: ExitRule) => void;
  label: string;
  issues?: ReactNode;
}) {
  const invalid = !EXIT_REASON_PATTERN.test(rule.reason);
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          size="sm"
          aria-label={`${label} in a row`}
          value={rule.consecutive}
          onValueChange={(v) => onChange({ ...rule, consecutive: Math.min(10, Math.max(1, v ?? 1)) })}
          min={1}
          max={10}
          unit="in a row"
        />
        <Input
          mono
          size="sm"
          value={rule.reason}
          onChange={(e) => onChange({ ...rule, reason: e.target.value })}
          aria-label={`${label} reason`}
          placeholder="lower_snake_case"
          spellCheck={false}
          invalid={invalid}
        />
      </div>
      <p className="text-small text-fg-3">Iterations in a row the rule must hold; the reason is recorded as the exit reason.</p>
      {invalid ? <p className="text-small text-err">Lower snake case, starting with a letter, at most 40 characters</p> : null}
      {issues}
    </div>
  );
}
