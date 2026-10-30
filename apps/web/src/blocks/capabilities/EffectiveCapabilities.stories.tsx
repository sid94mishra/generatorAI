import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import type { ResolvedAgentProjection } from '@generatorai/shared';
import { EffectiveCapabilities } from './EffectiveCapabilities.js';

const projection: ResolvedAgentProjection = {
  driving: { name: 'Bug Fixer', description: 'Fixes failing tests.', role: 'agent', projection: 'append' },
  agentVersion: 4,
  skills: { names: ['Code review', 'Release notes'] },
  mcpServers: { github: {} },
  toolPolicy: {
    groups: {
      browser: true,
      widgets: true,
      extensionAuthoring: false,
      orchestration: false,
      fileRead: true,
      fileWrite: true,
      shell: true,
      web: false,
    },
  },
  runtime: { model: 'claude-sonnet-5', reasoningEffort: 'medium', maxTurns: 40 },
  team: [],
  warnings: [],
} as unknown as ResolvedAgentProjection;

const meta = {
  component: EffectiveCapabilities,
  tags: ['vrt-themes'],
  args: { projection },
} satisfies Meta<typeof EffectiveCapabilities>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Effective capabilities')).toBeInTheDocument();
    await expect(canvas.getByText('Code review')).toBeInTheDocument();
    await expect(canvas.getByText('No resolution warnings.')).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { projection: undefined, isLoading: true },
};

export const Unsaved: Story = {
  args: { dirty: true, baseCounts: { skills: 1, mcpServers: 0 } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Unsaved')).toBeInTheDocument();
    // The count sits beside the "Skills · " label as a sibling text node, so
    // its own element's `textContent` includes the label too — match by
    // substring instead of the exact (split) text.
    await expect(
      canvas.getByText((_, element) => element?.textContent === 'Skills · 2 (1 from agent + 1 added)'),
    ).toBeInTheDocument();
  },
};

export const WithWarnings: Story = {
  args: {
    projection: {
      ...projection,
      warnings: [{ code: 'MCP_SERVER_DISABLED', params: { id: 'github' } }],
    } as unknown as ResolvedAgentProjection,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/is disabled and will be skipped/)).toBeInTheDocument();
  },
};

export const Error_: Story = {
  name: 'Error',
  args: { projection: undefined, error: new Error('Network error') },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Could not resolve capabilities/)).toBeInTheDocument();
  },
};
