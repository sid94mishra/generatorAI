// B-02 AgentPicker, connected to `useSelectableAgents` (mocked by module).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Agent } from '@generatorai/shared';

const state = vi.hoisted(() => ({ agents: [] as unknown[], isLoading: false }));
vi.mock('@/hooks/agentQueries.js', () => ({
  useSelectableAgents: () => ({ data: state.agents, isLoading: state.isLoading }),
}));

import { AgentPicker } from './AgentPicker.js';

function agent(partial: Partial<Agent> & Pick<Agent, 'slug' | 'name' | 'scope'>): Agent {
  return {
    id: partial.slug,
    projectId: '',
    ref: `${partial.scope}:${partial.slug}`,
    description: 'An agent.',
    instructions: '',
    role: 'agent',
    projection: 'append',
    tags: [],
    enabled: true,
    skillIds: [],
    mcpServerIds: [],
    tools: {},
    runtime: {},
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  };
}

const orchestrator = agent({ slug: 'lead', name: 'Lead', scope: 'global', role: 'orchestrator', runtime: { model: 'claude-opus-5-5' } });
const fixer = agent({ slug: 'bug-fixer', name: 'Bug Fixer', scope: 'project', skillIds: ['a', 'b', 'c'], mcpServerIds: ['github'], runtime: { model: 'claude-sonnet-5' } });
const reviewer = agent({ slug: 'reviewer', name: 'Code Reviewer', scope: 'system', tags: ['review'] });
const disabled = agent({ slug: 'off', name: 'Switched Off', scope: 'global', enabled: false });

beforeEach(() => {
  state.agents = [orchestrator, fixer, reviewer, disabled];
  state.isLoading = false;
});
afterEach(cleanup);

function setup(props: Partial<Parameters<typeof AgentPicker>[0]> = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AgentPicker value={undefined} onChange={onChange} {...props} />
    </MemoryRouter>,
  );
  return { onChange, user };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('agent-picker'));
  return screen.findByTestId('agent-picker-popup');
}

describe('AgentPicker', () => {
  it('lists "No agent", then orchestrators, then workers, hiding disabled agents', async () => {
    const { user } = setup();
    const popup = await open(user);
    const options = within(popup).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('No agent — just a model'),
      expect.stringContaining('Lead'),
      expect.stringContaining('Bug Fixer'),
      expect.stringContaining('Code Reviewer'),
    ]);
    expect(within(popup).getByRole('tab', { name: /All/ })).toHaveTextContent('3');
  });

  it('selecting an agent reports its ref and the agent, then closes', async () => {
    const { user, onChange } = setup();
    const popup = await open(user);
    await user.click(within(popup).getByRole('option', { name: /Bug Fixer/ }));
    expect(onChange).toHaveBeenCalledWith('project:bug-fixer', fixer);
    await waitFor(() => expect(screen.queryByTestId('agent-picker-popup')).toBeNull());
  });

  it('shows the selection with its summary and clears it', async () => {
    const { user, onChange } = setup({ value: 'project:bug-fixer' });
    expect(screen.getByTestId('agent-picker')).toHaveTextContent('Bug Fixer');
    expect(screen.getByText('3 skills · 1 MCP server · claude-sonnet-5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onChange).toHaveBeenCalledWith(undefined, undefined);
  });

  it('honours role and excludeRefs', async () => {
    const { user } = setup({ role: 'agent', excludeRefs: ['system:reviewer'] });
    const popup = await open(user);
    const names = within(popup).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(names.some((n) => n.includes('Lead'))).toBe(false);
    expect(names.some((n) => n.includes('Code Reviewer'))).toBe(false);
    expect(names.some((n) => n.includes('Bug Fixer'))).toBe(true);
  });

  it('search filters by name, description and tags; Enter picks the highlight', async () => {
    const { user, onChange } = setup();
    const popup = await open(user);
    const search = within(popup).getByRole('searchbox', { name: 'Search agents' });
    await user.type(search, 'review');
    expect(within(popup).getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('system:reviewer', reviewer);
  });
});
