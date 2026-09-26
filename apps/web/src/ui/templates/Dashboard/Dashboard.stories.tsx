import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Card } from '../../primitives/Card/Card.js';
import { NavItem } from '../../primitives/NavItem/NavItem.js';
import { ActivityRow } from '../../patterns/ActivityRow/ActivityRow.js';
import { PageHeader } from '../../patterns/PageHeader/PageHeader.js';
import { SectionHeader } from '../../patterns/SectionHeader/SectionHeader.js';
import { StatStrip } from '../../patterns/StatStrip/StatStrip.js';
import { KeyValueList } from '../../patterns/KeyValueList/KeyValueList.js';
import { Dashboard } from './Dashboard.js';

const sections = (
  <div className="flex flex-col gap-5">
    <div className="flex flex-col gap-2">
      <SectionHeader title="Needs you" count={2} countTone="warn" />
      <div className="flex flex-col overflow-hidden rounded-card border border-line-soft">
        <ActivityRow status="needs_you" title="Approve plan" context="release-agent" time="4m" twoLine detail="Waiting for your review" />
        <ActivityRow status="needs_you" title="Answer question" context="reviewer" time="9m" twoLine detail="Which branch should this target?" />
      </div>
    </div>
    <div className="flex flex-col gap-2">
      <SectionHeader title="Running" count={1} />
      <div className="flex flex-col overflow-hidden rounded-card border border-line-soft">
        <ActivityRow status="running" title="Nightly dependency audit" context="agents-repo" time="2m" />
      </div>
    </div>
  </div>
);

const aside = (
  <>
    <StatStrip layout="grid" items={[{ value: 12, label: 'Chats' }, { value: 4, label: 'Runs' }]} />
    <Card>
      <Card.Header title="System" />
      <Card.Body>
        <KeyValueList labelWidth={80} items={[{ label: 'Version', value: 'v0.4.2', mono: true }]} />
      </Card.Body>
    </Card>
    <div className="flex flex-col gap-1">
      <NavItem label="Settings" icon="settings" render={<a href="#" />} />
    </div>
  </>
);

const meta = {
  component: Dashboard,
  tags: ['vrt-themes'],
  args: { header: <PageHeader title="Home" />, greeting: 'Good afternoon' },
} satisfies Meta<typeof Dashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="h-[640px] w-280 overflow-hidden rounded-panel border border-line-soft">
      <Dashboard
        header={<PageHeader title="Home" />}
        dateLine="Thursday, 26 September"
        greeting="Good afternoon"
        sections={sections}
        aside={aside}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Good afternoon')).toBeInTheDocument();
  },
};

/** wide (aside beside the sections) vs narrow (`asideStacked`). */
export const Matrix: Story = {
  render: () => (
    <div className="h-[400px] w-160 overflow-hidden rounded-panel border border-line-soft">
      <Dashboard
        header={<PageHeader title="Home" />}
        greeting="Good afternoon"
        sections={sections}
        aside={aside}
        asideStacked
      />
    </div>
  ),
};
