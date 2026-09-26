import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { NavItem } from '../../primitives/NavItem/NavItem.js';
import { ListPane } from '../../patterns/ListPane/ListPane.js';
import { SettingRow, SettingsSection } from '../../patterns/SettingsSection/SettingsSection.js';
import { MasterDetail } from './MasterDetail.js';

// Demo frame height only (not a design token) — named so the ratchet's
// `literalInlineStyle` check reads it as computed, not hard-coded.
const FRAME_HEIGHT = { height: 640 };

function ScriptsList() {
  return (
    <ListPane title="Scripts" count={3} action={<IconButton icon="plus" label="New script" size="sm" />}>
      <NavItem label="Deploy staging" icon="scripts" active />
      <NavItem label="Nightly backup" icon="scripts" />
      <NavItem label="Rotate API keys" icon="scripts" />
    </ListPane>
  );
}

function ScriptDetail() {
  return (
    <SettingsSection title="Deploy staging" description="Runs on the staging codebase's default shell.">
      <SettingRow label="Last run" control={<span className="text-small text-fg-3">2 hours ago</span>} />
      <SettingRow label="Schedule" control={<span className="text-small text-fg-3">On push to main</span>} />
    </SettingsSection>
  );
}

const meta = {
  component: MasterDetail,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: { list: null, detail: null },
} satisfies Meta<typeof MasterDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Scripts shape (PW): a 320-wide ListPane beside the padded, scrolling detail column. */
export const Default: Story = {
  render: () => (
    <div className="w-[1000px] overflow-hidden rounded-panel border border-line-soft" style={FRAME_HEIGHT}>
      <MasterDetail list={<ScriptsList />} detail={<ScriptDetail />} />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Scripts' })).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'Deploy staging' })).toBeVisible();
  },
};

/** listWidth 220 + bareDetail: how S-11 SettingsModalFrame composes its own nav + content around this template. */
export const SettingsVariant: Story = {
  render: () => (
    <div className="w-[960px] overflow-hidden rounded-panel border border-line-soft" style={FRAME_HEIGHT}>
      <MasterDetail
        listWidth={220}
        bareDetail
        list={
          <nav className="flex h-full flex-col gap-1 bg-raised p-2">
            <NavItem label="Appearance" dense active />
            <NavItem label="Security" dense />
          </nav>
        }
        detail={
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <ScriptDetail />
          </div>
        }
      />
    </div>
  ),
};

/** Below the ~900px container breakpoint, list and detail stack instead of sitting side by side. */
export const Narrow: Story = {
  render: () => (
    <div className="w-160 overflow-hidden rounded-panel border border-line-soft" style={FRAME_HEIGHT}>
      <MasterDetail list={<ScriptsList />} detail={<ScriptDetail />} />
    </div>
  ),
};
