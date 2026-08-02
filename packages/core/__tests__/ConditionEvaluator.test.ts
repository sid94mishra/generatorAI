import { describe, it, expect } from 'vitest';
import { evaluateCondition, type ConditionContext } from '../src/domain/dag/ConditionEvaluator.js';
import type { StageCondition } from '@generatorai/shared';

const ctx = (parentStatus: ConditionContext['parentStatus'], variables?: Record<string, unknown>): ConditionContext => ({
  parentStatus,
  variables,
});
const expr = (expression: string): StageCondition => ({ type: 'expression', expression }) as StageCondition;

describe('evaluateCondition — basic types', () => {
  it('undefined condition always proceeds', () => {
    expect(evaluateCondition(undefined, ctx('completed'))).toBe(true);
  });
  it('always → true regardless of parent status', () => {
    expect(evaluateCondition({ type: 'always' } as StageCondition, ctx('failed'))).toBe(true);
  });
  it('on_success → true only when parent completed', () => {
    expect(evaluateCondition({ type: 'on_success' } as StageCondition, ctx('completed'))).toBe(true);
    expect(evaluateCondition({ type: 'on_success' } as StageCondition, ctx('failed'))).toBe(false);
  });
  it('on_failure → true only when parent failed', () => {
    expect(evaluateCondition({ type: 'on_failure' } as StageCondition, ctx('failed'))).toBe(true);
    expect(evaluateCondition({ type: 'on_failure' } as StageCondition, ctx('completed'))).toBe(false);
  });
  it('unknown condition type fails safe (false)', () => {
    expect(evaluateCondition({ type: 'bogus' } as unknown as StageCondition, ctx('completed'))).toBe(false);
  });
});

describe('evaluateCondition — expressions', () => {
  it('boolean literals', () => {
    expect(evaluateCondition(expr('true'), ctx('completed'))).toBe(true);
    expect(evaluateCondition(expr('false'), ctx('completed'))).toBe(false);
  });
  it('numeric comparisons against variables', () => {
    expect(evaluateCondition(expr('variables.count > 5'), ctx('completed', { count: 10 }))).toBe(true);
    expect(evaluateCondition(expr('variables.count > 5'), ctx('completed', { count: 3 }))).toBe(false);
    expect(evaluateCondition(expr('variables.count >= 5'), ctx('completed', { count: 5 }))).toBe(true);
  });
  it('status reference comparison', () => {
    expect(evaluateCondition(expr("status == 'completed'"), ctx('completed'))).toBe(true);
    expect(evaluateCondition(expr("status == 'completed'"), ctx('failed'))).toBe(false);
  });
  it('string equality on a variable', () => {
    expect(evaluateCondition(expr("variables.env == 'prod'"), ctx('completed', { env: 'prod' }))).toBe(true);
    expect(evaluateCondition(expr("variables.env != 'prod'"), ctx('completed', { env: 'dev' }))).toBe(true);
  });
  it('AND / OR / NOT logical operators', () => {
    expect(evaluateCondition(expr('variables.a > 1 && variables.b < 10'), ctx('completed', { a: 5, b: 3 }))).toBe(true);
    expect(evaluateCondition(expr('variables.a > 1 && variables.b < 10'), ctx('completed', { a: 5, b: 99 }))).toBe(false);
    expect(evaluateCondition(expr('variables.a > 100 || variables.b < 10'), ctx('completed', { a: 1, b: 3 }))).toBe(true);
    expect(evaluateCondition(expr('!variables.flag'), ctx('completed', { flag: false }))).toBe(true);
    expect(evaluateCondition(expr('!variables.flag'), ctx('completed', { flag: true }))).toBe(false);
  });
  it('dotted variable paths resolve', () => {
    expect(evaluateCondition(expr("variables.meta.stage == 'build'"), ctx('completed', { meta: { stage: 'build' } }))).toBe(true);
  });
  it('missing variable / unparseable expression fails safe (false)', () => {
    expect(evaluateCondition(expr('variables.missing > 5'), ctx('completed', {}))).toBe(false);
    expect(evaluateCondition(expr(')(&^%$ garbage'), ctx('completed'))).toBe(false);
    expect(evaluateCondition(expr(''), ctx('completed'))).toBe(false);
  });
});
