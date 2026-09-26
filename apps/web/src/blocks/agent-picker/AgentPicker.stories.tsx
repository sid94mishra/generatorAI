import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { Agent } from '@generatorai/shared';
import { AgentPickerView } from './AgentPicker.view.js';

// Demo agents in the `listSelectableAgents` payload shape.
function agent(partial: Partial<Agent> & Pick<Agent, 'slug' | 'name' | 'scope'>): Agent {
  return {
    id: partial.slug,
    projectId: partial.scope === 'project' ? 'p1' : '',
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

const agents: Agent[] = [
  agent({
    slug: 'orchestrator', name: 'Orchestrator', scope: 'global', role: 'orchestrator', version: 3,
    description: 'Splits work into subtasks for its team',
    skillIds: ['s1', 's2'], mcpServerIds: ['github'],
    runtime: { model: 'claude-opus-5-5', reasoningEffort: 'high' },
    orchestration: { teamAgentRefs: ['project:bug-fixer', 'system:code-reviewer'] },
  }),
  agent({
    slug: 'bug-fixer', name: 'Bug Fixer', scope: 'project', description: 'Fixes failing tests with a minimal diff',
    skillIds: ['s1', 's2', 's3'], mcpServerIds: ['github'], runtime: { model: 'claude-sonnet-5' },
  }),
  agent({
    slug: 'code-reviewer', name: 'Code Reviewer', scope: 'system', description: 'Reviews diffs for correctness and risk',
    skillIds: ['s1', 's2'], mcpServerIds: ['github'], runtime: { model: 'claude-sonnet-5' },
  }),
  agent({
    slug: 'test-writer', name: 'Test Writer', scope: 'global', description: 'Adds the tests a change is missing',
    skillIds: ['s1', 's2', 's3'], runtime: { model: 'claude-sonnet-5' },
  }),
];

const meta = {
  component: AgentPickerView,
  tags: ['vrt-themes'],
  args: {
    agents,
    value: 'project:bug-fixer',
    onSelect: fn(),
    manageAgentsHref: '/agents',
    onNavigate: fn(),
  },
  decorators: [(Story) => <div className="flex min-h-140 w-200 flex-col p-4"><div className="w-105">{Story()}</div></div>],
} satisfies Meta<typeof AgentPickerView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The field with its summary line; open it and pick with the keyboard. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId('agent-picker');
    await expect(trigger).toHaveTextContent('Bug Fixer');
    await expect(canvas.getByText('3 skills · 1 MCP server · claude-sonnet-5')).toBeVisible();
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    const search = await body.findByRole('searchbox', { name: 'Search agents' });
    await waitFor(() => expect(search).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onSelect).toHaveBeenCalledWith('system:code-reviewer');
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull());
  },
};

/** Open on an orchestrator: team, runtime, always-on orchestration. */
export const OrchestratorDetail: Story = {
  args: { defaultOpen: true, value: 'global:orchestrator' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const list = await body.findByRole('listbox', { name: 'Agents' });
    await expect(within(list).getByRole('group', { name: 'Orchestrators' })).toBeVisible();
    await expect(within(list).getByRole('group', { name: 'Workers' })).toBeVisible();
    const detail = body.getByTestId('agent-picker-detail');
    await expect(within(detail).getByText('Orchestrator · Global · v3')).toBeVisible();
    await expect(within(detail).getByRole('list', { name: 'Team' })).toHaveTextContent('Bug Fixer');
    await expect(within(detail).getByText('claude-opus-5-5 · effort high')).toBeVisible();
    await expect(within(detail).getByText('Orchestration (spawn workers)')).toBeVisible();
  },
};

/** Scope tabs with counts, and an empty scope. */
export const Scopes: Story = {
  args: { defaultOpen: true, agents: agents.filter((a) => a.scope !== 'project'), value: undefined },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('tab', { name: /Built-in/ }));
    await expect(body.getAllByRole('option')).toHaveLength(2); // No agent + Code Reviewer
    await userEvent.click(body.getByRole('tab', { name: /Project/ }));
    await expect(body.getByText('No project agents.')).toBeVisible();
  },
};

/** No agent selected: the placeholder and the "No agent" row checked. */
export const NoAgent: Story = {
  args: { defaultOpen: true, value: undefined },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('option', { name: /No agent — just a model/ })).toHaveAttribute('aria-selected', 'true');
  },
};

/** A query nothing matches. */
export const EmptySearch: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(await body.findByRole('searchbox', { name: 'Search agents' }), 'zebra');
    await expect(await body.findByText('No agents match “zebra”.')).toBeVisible();
  },
};

export const Loading: Story = {
  args: { defaultOpen: true, agents: [], loading: true, value: undefined },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('status', { name: 'Loading agents' })).toBeVisible();
  },
};

export const Disabled: Story = { args: { disabled: true } };
