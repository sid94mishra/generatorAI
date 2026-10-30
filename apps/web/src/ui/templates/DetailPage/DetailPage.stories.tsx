import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Card } from '../../primitives/Card/Card.js';
import { Tabs } from '../../primitives/Tabs/Tabs.js';
import { Banner } from '../../patterns/Banner/Banner.js';
import { PageHeader } from '../../patterns/PageHeader/PageHeader.js';
import { PageTitle } from '../../patterns/PageTitle/PageTitle.js';
import { Inspector } from '../../patterns/Inspector/Inspector.js';
import { KeyValueList } from '../../patterns/KeyValueList/KeyValueList.js';
import { DetailPage } from './DetailPage.js';

function WithTabsAndRail() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="h-[560px] w-260 overflow-hidden rounded-panel border border-line-soft">
      <DetailPage
        header={<PageHeader title="agents-repo" />}
        title={<PageTitle variant="detail" title="agents-repo" description="git@github.com:generatorai/agents-repo.git" meta={['3 codebases', '12 chats']} />}
        banner={<Banner tone="warn" lead="2 need you" />}
        tabs={
          <Tabs
            label="Project sections"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'overview', label: 'Overview' },
              { value: 'codebases', label: 'Codebases', count: 3 },
              { value: 'runs', label: 'Runs' },
            ]}
          />
        }
        content={<div className="text-ui text-fg-2">{tab} content</div>}
        rail={
          <>
            <Card>
              <Card.Header title="System" />
              <Card.Body>
                <KeyValueList labelWidth={80} items={[{ label: 'Branch', value: 'main', mono: true }]} />
              </Card.Body>
            </Card>
          </>
        }
      />
    </div>
  );
}

const meta = {
  component: DetailPage,
  tags: ['vrt-themes'],
  args: { header: <PageHeader title="Detail" />, title: <PageTitle variant="detail" title="Detail" />, content: 'Content' },
} satisfies Meta<typeof DetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <WithTabsAndRail />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'agents-repo' })).toBeInTheDocument();
  },
};

/** rail (a 360px card column) vs inspector (C-18, 400px, its own chrome). */
export const Matrix: Story = {
  render: () => (
    <div className="h-[400px] w-220 overflow-hidden rounded-panel border border-line-soft">
      <DetailPage
        header={<PageHeader title="Codebase" />}
        title={<PageTitle variant="detail" title="Codebase" />}
        content={<div className="text-ui text-fg-2">Files content</div>}
        inspector={
          <Inspector title="Worktree" subtitle="wt-4f2">
            <KeyValueList labelWidth={80} items={[{ label: 'Branch', value: 'main', mono: true }]} />
          </Inspector>
        }
      />
    </div>
  ),
};
