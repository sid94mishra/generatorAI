// Tool-card registry contract (B-18; the Workflow Overhaul's extension point, D-35).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { deriveTimeline, type StreamBlock } from '@generatorai/client-core';
import { registerToolCard, resolveToolCard, StepList, type ToolCardProps } from '../index.js';

afterEach(cleanup);

describe('tool-card registry', () => {
  it('ships the redesign built-ins (shell → terminal, file edits → changes, browser)', () => {
    expect(resolveToolCard('Bash')?.openIn).toBe('terminal');
    expect(resolveToolCard('Edit')?.openIn).toBe('changes');
    expect(resolveToolCard('mcp__generatorai-tools__navigate_page')?.openIn).toBe('browser');
    expect(resolveToolCard('some_unknown_tool')).toBeNull();
    expect(resolveToolCard(undefined)).toBeNull();
  });

  it('an exact match beats a pattern; the latest registration wins; unregister restores', () => {
    const offPattern = registerToolCard({ id: 't.pattern', match: /^run_/, verb: () => 'Pattern' });
    const offExact = registerToolCard({ id: 't.exact', match: 'run_workflow', verb: () => 'Exact' });
    const offLater = registerToolCard({ id: 't.later', match: (tool) => tool.startsWith('run_'), verb: () => 'Later' });
    expect(resolveToolCard('run_workflow')?.id).toBe('t.exact');
    expect(resolveToolCard('run_other')?.id).toBe('t.later');
    offLater();
    expect(resolveToolCard('run_other')?.id).toBe('t.pattern');
    offExact();
    offPattern();
    expect(resolveToolCard('run_workflow')).toBeNull();
  });

  it('re-registering an id replaces the entry (so an overhaul entry can override a built-in id)', () => {
    const off1 = registerToolCard({ id: 't.same', match: 'x_tool', verb: () => 'One' });
    const off2 = registerToolCard({ id: 't.same', match: 'x_tool', verb: () => 'Two' });
    expect(resolveToolCard('x_tool')?.verb?.({} as never)).toBe('Two');
    off1(); // stale unregister is a no-op
    expect(resolveToolCard('x_tool')).not.toBeNull();
    off2();
  });

  it('a registered entry drives the row (verb, target, result) and draws its card under it', () => {
    function RunCard({ step, ctx }: ToolCardProps) {
      return <p>card for {String((step.args as { name: string }).name)} live={String(ctx.live)}</p>;
    }
    const off = registerToolCard({
      id: 'workflow.run',
      match: 'run_workflow',
      icon: 'workflows',
      verb: () => 'Started workflow',
      target: (step) => (step.args as { name: string }).name,
      result: () => 'Running',
      subject: () => 'Nightly audit',
      Card: RunCard,
    });
    const blocks: StreamBlock[] = [
      { type: 'tool_call', blockId: 1, callId: 'c1', tool: 'run_workflow', args: { name: 'nightly' }, status: 'complete' },
    ];
    render(
      <MemoryRouter>
        <StepList steps={deriveTimeline(blocks, { active: false })} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Started workflow')).toBeInTheDocument();
    expect(screen.getByText('nightly')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-card')).toHaveTextContent('Called');
    expect(screen.getByTestId('tool-call-card')).toHaveTextContent('Nightly audit');
    expect(screen.getByText('card for nightly live=false')).toBeInTheDocument();
    off();
  });
});
