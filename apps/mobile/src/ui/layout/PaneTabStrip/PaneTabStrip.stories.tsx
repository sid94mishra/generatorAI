import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { PaneTabStrip } from './PaneTabStrip';
import type { PaneTab } from './PaneTabStrip.types';

const TABS: PaneTab[] = [
  { id: 'changes', type: 'changes', label: 'Changes', icon: 'changes', count: 2 },
  { id: 'files', type: 'files', label: 'Files', icon: 'files' },
  { id: 'terminal', type: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'browser', type: 'browser', label: 'Browser', icon: 'browser' },
  { id: 'tasks', type: 'tasks', label: 'Tasks', icon: 'tasks', count: 3 },
  { id: 'plan', type: 'plan', label: 'Plan', icon: 'plan', attention: true },
];
const INSTANCES: PaneTab[] = [
  { id: 't1', type: 'terminal', label: 'pwsh', icon: 'terminal' },
  { id: 't2', type: 'terminal', label: 'Agent commands', icon: 'terminal', count: 4, closable: true },
];

function Strip({ tabs = TABS, variant = 'tabs' as const, cap = false }: { tabs?: PaneTab[]; variant?: 'tabs' | 'instanceChips'; cap?: boolean }): React.ReactElement {
  const [active, setActive] = useState(tabs[0]!.id);
  return (
    <PaneTabStrip
      tabs={tabs}
      active={active}
      onSelect={setActive}
      variant={variant}
      onClose={() => undefined}
      onAdd={cap ? undefined : () => undefined}
      addLabel="New terminal"
      accessibilityLabel={variant === 'tabs' ? 'Workspace tabs' : 'Terminals'}
    />
  );
}

function PaneTabStripGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Tabs: pinned + conditional, counts, needs-you dot (iOS pills / Android underline)">
        <Strip />
      </StorySection>
      <StorySection title="Instance chips with ✕ and +; at the cap the + is hidden">
        <Strip tabs={INSTANCES} variant="instanceChips" />
        <Strip tabs={INSTANCES} variant="instanceChips" cap />
      </StorySection>
      <StorySection title="Font scale 1.6, right to left">
        <WithFontScale scale={1.6}>
          <Strip />
        </WithFontScale>
        <RightToLeft>
          <Strip />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Strip />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/PaneTabStrip', component: PaneTabStripGallery } satisfies Meta<typeof PaneTabStripGallery>;
export default meta;
export const Tabs: StoryObj<typeof meta> = {};
