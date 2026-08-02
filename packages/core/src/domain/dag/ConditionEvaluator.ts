// ────────────────────────────────────────────────────────────────
// ConditionEvaluator — Evaluates StageCondition against context
// ────────────────────────────────────────────────────────────────

import type { StageCondition, StageRunStatus } from '@generatorai/shared';

/**
 * Context for evaluating edge conditions.
 * Contains the results of parent stage executions.
 */
export interface ConditionContext {
  /** Status of the parent stage run (the source of the edge) */
  parentStatus: StageRunStatus;
  /** Variables available for expression evaluation */
  variables?: Record<string, unknown>;
}

/**
 * Evaluate a StageCondition against the given context.
 *
 * Condition types:
 * - `always` → always true
 * - `on_success` → true if parent completed successfully
 * - `on_failure` → true if parent failed
 * - `expression` → simple safe expression evaluator (no eval)
 */
export function evaluateCondition(
  condition: StageCondition | undefined,
  context: ConditionContext,
): boolean {
  // No condition means always proceed
  if (!condition) return true;

  switch (condition.type) {
    case 'always':
      return true;

    case 'on_success':
      return context.parentStatus === 'completed';

    case 'on_failure':
      return context.parentStatus === 'failed';

    case 'expression':
      return evaluateExpression(condition.expression ?? '', context);

    default:
      // Unknown condition type, default to false for safety
      return false;
  }
}

/**
 * Safe expression evaluator (Phase 2, 2.3).
 *
 * Supports simple comparisons plus AND / OR / NOT logical operators and
 * parentheses. No `eval` — we tokenise, shunting-yard to postfix, and
 * evaluate the postfix stack with a small leaf evaluator.
 *
 * Supported:
 * - Boolean literals:       `true` / `false`
 * - Comparisons:            `status == 'completed'` / `retryCount < 3` / ...
 * - Logical operators:      `AND`, `OR`, `NOT` (case-insensitive); alias `&&`, `||`, `!`
 * - Parentheses:            `(a OR b) AND NOT c`
 * - Dotted variable paths:  `variables.user.name == 'alice'`
 *
 * Anything unparseable evaluates to `false` — deliberately fail-safe so a
 * typo in a stage condition never silently runs a stage that shouldn't.
 */
function evaluateExpression(
  expression: string,
  context: ConditionContext,
): boolean {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return false;

  try {
    const tokens = tokenize(trimmed);
    if (tokens.length === 0) return false;
    const postfix = toPostfix(tokens);
    return evalPostfix(postfix, context);
  } catch {
    return false;
  }
}

type LogicalOp = 'AND' | 'OR' | 'NOT';
type Token =
  | { kind: 'leaf'; text: string }
  | { kind: 'op'; op: LogicalOp }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

/**
 * Split `expression` into a small set of tokens. We deliberately DO NOT
 * tokenise inside string literals — quoted values can contain anything,
 * including spaces and parens, and must pass through as a single leaf.
 *
 * A "leaf" token is a chunk of expression that either:
 *   - is a bare boolean / literal, or
 *   - is a full `left OP right` comparison to be parsed by `resolveValue`.
 * Leaves are everything between logical operators / parentheses.
 */
function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let leafStart = -1;

  const flushLeaf = (end: number): void => {
    if (leafStart < 0) return;
    const text = input.slice(leafStart, end).trim();
    if (text.length > 0) out.push({ kind: 'leaf', text });
    leafStart = -1;
  };

  while (i < input.length) {
    const ch = input[i];

    // Skip whitespace outside leaves.
    if ((ch === ' ' || ch === '\t' || ch === '\n') && leafStart < 0) {
      i++;
      continue;
    }

    // String literals — consume to the matching quote, stay inside the leaf.
    if (ch === "'" || ch === '"') {
      if (leafStart < 0) leafStart = i;
      const quote = ch;
      i++;
      while (i < input.length && input[i] !== quote) i++;
      if (i < input.length) i++; // consume closing quote
      continue;
    }

    // Parentheses are structural.
    if (ch === '(' || ch === ')') {
      flushLeaf(i);
      out.push({ kind: ch === '(' ? 'lparen' : 'rparen' });
      i++;
      continue;
    }

    // Logical operators: && || ! and case-insensitive AND OR NOT.
    if (ch === '&' && input[i + 1] === '&') {
      flushLeaf(i);
      out.push({ kind: 'op', op: 'AND' });
      i += 2;
      continue;
    }
    if (ch === '|' && input[i + 1] === '|') {
      flushLeaf(i);
      out.push({ kind: 'op', op: 'OR' });
      i += 2;
      continue;
    }
    if (ch === '!' && input[i + 1] !== '=') {
      // NOT — but ONLY if we're not already inside a leaf expression (to
      // avoid splitting "x != y" when someone writes it without spaces).
      if (leafStart < 0) {
        out.push({ kind: 'op', op: 'NOT' });
        i++;
        continue;
      }
    }

    // Word operators: AND / OR / NOT at a word boundary outside a leaf.
    if (leafStart < 0) {
      const word = input.slice(i).match(/^(AND|OR|NOT)\b/i);
      if (word) {
        const kw = word[0].toUpperCase() as LogicalOp;
        out.push({ kind: 'op', op: kw });
        i += word[0].length;
        continue;
      }
    } else {
      // Inside a leaf: do not split on word operators. Comparison operators
      // like `==` / `!=` stay in the leaf, they're parsed by resolveValue.
    }

    // Otherwise we're accumulating leaf characters.
    if (leafStart < 0) leafStart = i;
    i++;
  }
  flushLeaf(input.length);
  return out;
}

/** Shunting-yard: infix tokens → postfix (RPN). */
function toPostfix(tokens: Token[]): Token[] {
  const out: Token[] = [];
  const ops: Token[] = [];
  const precedence: Record<LogicalOp, number> = { NOT: 3, AND: 2, OR: 1 };
  for (const t of tokens) {
    if (t.kind === 'leaf') {
      out.push(t);
    } else if (t.kind === 'op') {
      while (ops.length > 0) {
        const top = ops[ops.length - 1];
        if (!top || top.kind !== 'op') break;
        // NOT is right-associative; AND/OR left-associative.
        const topPrec = precedence[top.op];
        const curPrec = precedence[t.op];
        const shouldPop =
          t.op === 'NOT' ? topPrec > curPrec : topPrec >= curPrec;
        if (!shouldPop) break;
        out.push(ops.pop()!);
      }
      ops.push(t);
    } else if (t.kind === 'lparen') {
      ops.push(t);
    } else {
      // rparen — pop until matching lparen.
      while (ops.length > 0 && ops[ops.length - 1]!.kind !== 'lparen') {
        out.push(ops.pop()!);
      }
      if (ops.length === 0) throw new Error('Mismatched parenthesis');
      ops.pop(); // discard lparen
    }
  }
  while (ops.length > 0) {
    const t = ops.pop()!;
    if (t.kind === 'lparen' || t.kind === 'rparen') {
      throw new Error('Mismatched parenthesis');
    }
    out.push(t);
  }
  return out;
}

/** Evaluate RPN with leaves resolved against `context`. */
function evalPostfix(postfix: Token[], context: ConditionContext): boolean {
  const stack: boolean[] = [];
  for (const t of postfix) {
    if (t.kind === 'leaf') {
      stack.push(evaluateLeaf(t.text, context));
    } else if (t.kind === 'op') {
      if (t.op === 'NOT') {
        const a = stack.pop() ?? false;
        stack.push(!a);
      } else {
        const b = stack.pop() ?? false;
        const a = stack.pop() ?? false;
        stack.push(t.op === 'AND' ? a && b : a || b);
      }
    }
  }
  // A well-formed boolean expression reduces to exactly one value. Anything
  // else (e.g. two leaves with a missing operator: `a==1 b==2`) is malformed —
  // fail safe to `false` rather than silently returning only the last leaf.
  return stack.length === 1 ? stack[0]! : false;
}

/** Evaluate a leaf string (comparison or boolean literal) to a bool. */
function evaluateLeaf(text: string, context: ConditionContext): boolean {
  if (text === 'true') return true;
  if (text === 'false') return false;

  const comparisonMatch = text.match(/^(\S+)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
  if (comparisonMatch) {
    const [, leftExpr, operator, rightExpr] = comparisonMatch;
    if (!leftExpr || !operator || !rightExpr) return false;
    const leftValue = resolveValue(leftExpr.trim(), context);
    const rightValue = resolveValue(rightExpr.trim(), context);
    return compareValues(leftValue, operator, rightValue);
  }

  // Bare identifier / variable reference used as a boolean.
  const v = resolveValue(text, context);
  return Boolean(v);
}

/**
 * Resolve a value reference to its actual value.
 */
function resolveValue(
  expr: string,
  context: ConditionContext,
): unknown {
  // String literal (quoted)
  if ((expr.startsWith("'") && expr.endsWith("'")) || (expr.startsWith('"') && expr.endsWith('"'))) {
    return expr.slice(1, -1);
  }

  // Numeric literal
  const num = Number(expr);
  if (!Number.isNaN(num) && expr !== '') {
    return num;
  }

  // Boolean literals
  if (expr === 'true') return true;
  if (expr === 'false') return false;

  // Context references
  if (expr === 'status' || expr === 'parentStatus') {
    return context.parentStatus;
  }

  // Variable references: variables.key.nested (dotted paths supported)
  if (expr.startsWith('variables.')) {
    const path = expr.slice('variables.'.length).split('.');
    let current: unknown = context.variables;
    for (const key of path) {
      if (current != null && typeof current === 'object') {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return current;
  }

  return undefined;
}

/** Coerce a value to a finite number, or undefined if it isn't numeric. */
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Type-tolerant equality. Edge-condition operands frequently cross the
 * string/number boundary (a numeric variable stored as text in SQLite/JSON vs
 * a numeric literal), so `variables.retryCount == 3` must hold when the stored
 * value is `"3"`. Falls back to string-form comparison for non-numeric values
 * (e.g. `status == 'completed'`).
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== undefined && bn !== undefined) return an === bn;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/**
 * Compare two values with the given operator. Relational operators coerce both
 * sides to numbers (returning false if either is non-numeric); equality is
 * type-tolerant via {@link looseEquals}.
 */
function compareValues(
  left: unknown,
  operator: string,
  right: unknown,
): boolean {
  const ln = toNumber(left);
  const rn = toNumber(right);
  switch (operator) {
    case '==':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);
    case '<':
      return ln !== undefined && rn !== undefined && ln < rn;
    case '>':
      return ln !== undefined && rn !== undefined && ln > rn;
    case '<=':
      return ln !== undefined && rn !== undefined && ln <= rn;
    case '>=':
      return ln !== undefined && rn !== undefined && ln >= rn;
    default:
      return false;
  }
}
