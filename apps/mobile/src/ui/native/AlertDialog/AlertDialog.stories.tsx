import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StoryRow, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { Text } from '../../primitives/Text';
import { AlertDialogHost, confirm } from './AlertDialog';
import type { AlertDialogOptions } from './AlertDialog.types';

const CASES: Array<{ name: string; options: AlertDialogOptions }> = [
  { name: 'Delete chat', options: { title: 'Delete this chat?', message: '"Draft release notes 2.4" and its transcript are removed. This can\'t be undone.', confirmLabel: 'Delete', icon: 'trash' } },
  { name: 'Storage cleanup (impact)', options: { title: 'Clean up workspaces?', message: 'Finished workspaces are removed from this server.', impact: ['23 workspaces · 4.2 GB'], confirmLabel: 'Clean up' } },
  { name: 'Kill terminal', options: { title: 'Kill this terminal?', confirmLabel: 'Kill' } },
  { name: 'Non-destructive', options: { title: 'Restart the agent?', message: 'The current turn stops.', confirmLabel: 'Restart', destructive: false } },
  { name: 'Revoke device (step-up)', options: { title: 'Revoke this iPhone?', message: 'It can no longer reach this server.', confirmLabel: 'Revoke', requireStepUp: true } },
];

function Trigger({ name, options }: { name: string; options: AlertDialogOptions }): React.ReactElement {
  const [result, setResult] = useState('—');
  return (
    <StoryRow>
      <Button label={name} variant="destructive" size="sm" onPress={() => void confirm(options).then((v) => setResult(v ? 'confirmed' : 'cancelled'))} />
      <Text role="footnote" tone="fg-3">
        {result}
      </Text>
    </StoryRow>
  );
}

function AlertDialogGallery(): React.ReactElement {
  return (
    <StoryPage>
      <AlertDialogHost />
      <StorySection title="confirm(): iOS UIAlertController; Android M3 dialog through the host (else the system dialog)">
        {CASES.map((c) => (
          <Trigger key={c.name} {...c} />
        ))}
      </StorySection>
      <StorySection title="Theme matrix (Android dialog colours follow the active theme)">
        <ThemeMatrix>
          <Trigger {...CASES[0]!} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/AlertDialog', component: AlertDialogGallery } satisfies Meta<typeof AlertDialogGallery>;
export default meta;
export const Confirmations: StoryObj<typeof meta> = {};
