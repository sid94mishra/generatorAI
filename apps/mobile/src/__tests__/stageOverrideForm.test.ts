import { describe, expect, it } from 'vitest';

import { formatStageVariables, parseStageVariables } from '../components/work/stageOverrideForm';

describe('parseStageVariables', () => {
  it('parses key=value lines with typed scalars', () => {
    expect(parseStageVariables('depth=2\nverbose=true\n# note\n\nname = api users\nratio=0.5')).toEqual({
      variables: { depth: 2, verbose: true, name: 'api users', ratio: 0.5 },
      error: null,
    });
  });

  it('keeps = inside values', () => {
    expect(parseStageVariables('query=a=b').variables).toEqual({ query: 'a=b' });
  });

  it('reports the first bad line', () => {
    expect(parseStageVariables('ok=1\nnope').error).toBe('Line 2: use key=value.');
    expect(parseStageVariables('1bad=x').error).toMatch(/not a valid variable name/);
    expect(parseStageVariables('__stageOverrides=x').error).toMatch(/reserved/);
  });

  it('round-trips through text', () => {
    const text = formatStageVariables({ depth: 2, name: 'x' });
    expect(parseStageVariables(text).variables).toEqual({ depth: 2, name: 'x' });
  });
});
