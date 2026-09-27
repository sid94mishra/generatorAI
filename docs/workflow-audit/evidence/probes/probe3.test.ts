const CORE = 'C:/Users/sidmishra/Desktop/New folder (2)/GeneratorAI/packages/core';

const st = (id: string, extra: object = {}) => ({ id, workflowDefinitionId: 'd', name: id, order: 0, prompts: [], variables: {}, hooks: [], createdAt: new Date(), ...extra });
const ed = (from: string, to: string, edgeType: string) => ({ id: `${from}-${to}-${edgeType}`, workflowDefinitionId: 'd', fromStageId: from, toStageId: to, edgeType });

describe('probe3 — pure scheduler semantics', () => {
  it('S1: override-skipped middle stage cascades skip to its on_success successor', async () => {
    const { buildDAG } = await import(`${CORE}/src/domain/dag/DAGValidator.ts`);
    const { reconcileDAG } = await import(`${CORE}/src/services/DAGScheduler.ts`);
    const dag = buildDAG([st('A'), st('B'), st('C')] as never, [ed('A', 'B', 'on_success'), ed('B', 'C', 'on_success')] as never);
    const r = reconcileDAG(dag, new Map([['A', 'completed'], ['B', 'skipped'], ['C', 'pending']]) as never);
    console.log('[probe] S1', JSON.stringify(r));
    expect(r.toSkip).toEqual(['C']);
  });

  it('S2: A->B with BOTH on_success and on_failure edges: B is always skipped', async () => {
    const { buildDAG } = await import(`${CORE}/src/domain/dag/DAGValidator.ts`);
    const { reconcileDAG } = await import(`${CORE}/src/services/DAGScheduler.ts`);
    const dag = buildDAG([st('A'), st('B')] as never, [ed('A', 'B', 'on_success'), ed('A', 'B', 'on_failure')] as never);
    const ok = reconcileDAG(dag, new Map([['A', 'completed'], ['B', 'pending']]) as never);
    const bad = reconcileDAG(dag, new Map([['A', 'failed'], ['B', 'pending']]) as never);
    console.log('[probe] S2', JSON.stringify({ ok, bad }));
    expect(ok.toSkip).toEqual(['B']);
    expect(bad.toSkip).toEqual(['B']);
  });

  it('S3: a failed stage followed by an always/on_completion cleanup stage reports the run completed', async () => {
    const { buildDAG } = await import(`${CORE}/src/domain/dag/DAGValidator.ts`);
    const { computeTerminalRunStatusFor } = await import(`${CORE}/src/services/DAGScheduler.ts`);
    const dag = buildDAG([st('Build'), st('Cleanup')] as never, [ed('Build', 'Cleanup', 'always')] as never);
    const s = computeTerminalRunStatusFor(dag, new Map([['Build', 'failed'], ['Cleanup', 'completed']]) as never);
    const dag2 = buildDAG([st('Build'), st('Notify')] as never, [ed('Build', 'Notify', 'on_completion')] as never);
    const s2 = computeTerminalRunStatusFor(dag2, new Map([['Build', 'failed'], ['Notify', 'completed']]) as never);
    console.log('[probe] S3', s, s2);
    expect(s).toBe('completed');
    expect(s2).toBe('completed');
  });

  it('S4: OR-join is impossible — D after (B on_success) OR (C on_failure) is skipped when both succeed', async () => {
    const { buildDAG } = await import(`${CORE}/src/domain/dag/DAGValidator.ts`);
    const { reconcileDAG } = await import(`${CORE}/src/services/DAGScheduler.ts`);
    const dag = buildDAG([st('B'), st('C'), st('D')] as never, [ed('B', 'D', 'on_success'), ed('C', 'D', 'on_failure')] as never);
    const r = reconcileDAG(dag, new Map([['B', 'completed'], ['C', 'completed'], ['D', 'pending']]) as never);
    console.log('[probe] S4', JSON.stringify(r));
    expect(r.toSkip).toEqual(['D']);
  });

  it('S5: condition grammar edge cases', async () => {
    const { evaluateCondition } = await import(`${CORE}/src/domain/dag/ConditionEvaluator.ts`);
    const ev = (expression: string, variables: Record<string, unknown> = {}) =>
      evaluateCondition({ type: 'expression', expression } as never, { parentStatus: 'completed', variables } as never);
    const out = {
      bareNOT: ev('NOT'),
      bang: ev('!'),
      danglingOR: ev('OR variables.x == 1', { x: 1 }),
      unquotedString: ev('variables.env == prod', { env: 'prod' }),
      leadingZeros: ev("variables.zip == '02134'", { zip: 2134 }),
      quotedLeft: ev("'a b' == variables.s", { s: 'a b' }),
    };
    console.log('[probe] S5', JSON.stringify(out));
    expect(out.bareNOT).toBe(true);
  });
});
