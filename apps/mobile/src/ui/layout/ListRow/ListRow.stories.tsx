import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Badge } from '../../primitives/Badge';
import { ProviderLogo } from '../../primitives/ProviderLogo';
import { ListSection } from '../ListSection';
import { ListRow } from './ListRow';

const noop = (): void => undefined;

function Rows(): React.ReactElement {
  const [haptics, setHaptics] = useState(true);
  const [mode, setMode] = useState('auto');
  const [turns, setTurns] = useState(20);
  const [checks, setChecks] = useState({ read: true, write: false });
  const [model, setModel] = useState<string | null>('sonnet');
  const [effort, setEffort] = useState('medium');
  return (
    <>
      <ListSection title="Navigation, value, toggle, picker" footer="Notifications, App lock and Haptics are set per device.">
        <ListRow kind="navigation" icon="settings" title="General" value="Claude Sonnet 5" onPress={noop} />
        <ListRow kind="navigation" icon="lock" title="App lock & privacy" subtitle="Face ID after 1 minute" onPress={noop} />
        <ListRow kind="toggle" icon="bell" title="Haptics" switchValue={haptics} onValueChange={setHaptics} />
        <ListRow kind="value" icon="server" title="Server" value="local:3100" mono copyable />
        <ListRow
          kind="picker"
          title="Default model"
          picker={{ value: model, onValueChange: setModel, options: [{ value: 'sonnet', label: 'Claude Sonnet 5' }, { value: 'opus', label: 'Claude Opus 5.5' }] }}
        />
      </ListSection>
      <ListSection title="Radio (MD-49)">
        {['auto', 'plan', 'ask'].map((m) => (
          <ListRow key={m} kind="radio" title={m[0]!.toUpperCase() + m.slice(1)} selected={mode === m} onPress={() => setMode(m)} />
        ))}
      </ListSection>
      <ListSection title="Check, stepper, segmented">
        <ListRow kind="check" title="Read files" selected={checks.read} onValueChange={(v) => setChecks((c) => ({ ...c, read: v }))} />
        <ListRow kind="check" title="Write files" selected={checks.write} onValueChange={(v) => setChecks((c) => ({ ...c, write: v }))} provenance={<Badge label="Changed" icon="undo" size="sm" />} />
        <ListRow kind="stepper" title="Max turns" stepper={{ value: turns, onValueChange: setTurns, min: 1, max: 100 }} />
        <ListRow kind="segmented" title="Effort" segmented={{ value: effort, onValueChange: setEffort, segments: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] }} />
      </ListSection>
      <ListSection title="Link, requires admin, destructive, disabled" count={4} action={{ label: 'See all', onPress: noop }}>
        <ListRow kind="link" icon="external-link" title="Documentation" onPress={noop} />
        <ListRow kind="requires-admin" icon="key" title="Network exposure" onPress={noop} />
        <ListRow kind="destructive" icon="trash" title="Unpair this iPhone" onPress={noop} />
        <ListRow kind="navigation" icon="mcp" title="MCP servers" value="6 of 9" disabled disabledReason="Server offline" onPress={noop} />
      </ListSection>
      <ListSection title="Leading glyph (provider logos)">
        <ListRow kind="navigation" leading={<ProviderLogo provider="claude-agent" />} title="Claude Code" subtitle="Connected" onPress={noop} />
        <ListRow kind="radio" leading={<ProviderLogo provider="codex" />} title="GPT-6-Luna" badge={<Badge label="default" size="sm" />} selected onPress={noop} />
      </ListSection>
    </>
  );
}

function ListRowGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Every kind inside ListSections">
        <Rows />
      </StorySection>
      <StorySection title="Long text, Android carded, font scale 2.0, right to left">
        <ListSection variant="carded">
          <ListRow kind="navigation" icon="agents" title={LONG_TEXT} subtitle={LONG_TEXT} value="5 of 6" onPress={noop} />
          <ListRow kind="navigation" icon="skills" title="Skills" value="4 of 5" onPress={noop} />
        </ListSection>
        <WithFontScale scale={2}>
          <ListSection>
            <ListRow kind="navigation" icon="settings" title="General" value="Claude Sonnet 5" onPress={noop} />
          </ListSection>
        </WithFontScale>
        <RightToLeft>
          <ListSection title="Right to left">
            <ListRow kind="navigation" icon="settings" title="General" value="Claude Sonnet 5" onPress={noop} />
          </ListSection>
        </RightToLeft>
      </StorySection>
      <StorySection title="Positioned rows (virtualised lists draw the group from `position`)">
        <ListRow kind="navigation" title="First" position="first" onPress={noop} />
        <ListRow kind="navigation" title="Middle" position="middle" onPress={noop} />
        <ListRow kind="navigation" title="Last" position="last" onPress={noop} />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <ListSection title="App">
            <ListRow kind="navigation" icon="settings" title="General" value="Claude Sonnet 5" onPress={noop} />
            <ListRow kind="destructive" title="Sign out" onPress={noop} />
          </ListSection>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/ListRow', component: ListRowGallery } satisfies Meta<typeof ListRowGallery>;
export default meta;
export const AllKinds: StoryObj<typeof meta> = {};
