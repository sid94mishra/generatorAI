import React, { useState } from 'react';
import { screen, userEvent } from '@testing-library/react-native';

import { renderThemed } from '../../ui/__tests__/themed';
import { SheetProvider } from '../../ui/native/Sheet';
import { Composer } from './Composer';
import type { ComposerProps } from './Composer.types';

function Harness(over: Partial<ComposerProps>): React.ReactElement {
  const [draft, setDraft] = useState('');
  return (
    <SheetProvider>
      <Composer
        draft={draft}
        onDraftChange={setDraft}
        onSend={over.onSend ?? jest.fn()}
        voiceAvailable
        attachments={[]}
        onRemoveAttachment={jest.fn()}
        attachAvailable
        onStop={jest.fn()}
        isStreaming={false}
        agent={{ name: 'Bug Fixer' }}
        modelLabel="Sonnet 5"
        {...over}
      />
    </SheetProvider>
  );
}

describe('Composer (MB-01)', () => {
  it('Send is disabled until there is a draft; the placeholder replies to the agent (MD-03)', async () => {
    const user = userEvent.setup();
    const onSend = jest.fn();
    await renderThemed(<Harness onSend={onSend} />);
    expect(screen.getByPlaceholderText('Reply to Bug Fixer…')).toBeTruthy();
    expect(screen.getByTestId('composer-send').props.accessibilityState).toMatchObject({ disabled: true });
    await user.type(screen.getByTestId('composer-input'), 'Run the tests');
    await user.press(screen.getByTestId('composer-send'));
    expect(onSend).toHaveBeenCalled();
  });

  it('shows the locked agent chip, the model chip, the mic and the "+" menu', async () => {
    const onModelPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Harness onModelPress={onModelPress} />);
    expect(screen.getByTestId('composer-agent')).toBeTruthy();
    expect(screen.getByLabelText('Dictate a message')).toBeTruthy();
    expect(screen.getByTestId('composer-options')).toBeTruthy();
    await user.press(screen.getByTestId('composer-model'));
    expect(onModelPress).toHaveBeenCalled();
  });

  it('a pending gate keeps typing open and offers Cancel and send', async () => {
    const user = userEvent.setup();
    const onCancelAndSend = jest.fn();
    await renderThemed(<Harness disabled gate={{ label: 'Waiting for your permission decision', busy: false, onCancelAndSend }} />);
    await user.type(screen.getByTestId('composer-input'), 'Instead do this');
    await user.press(screen.getByTestId('composer-cancel-and-send'));
    expect(onCancelAndSend).toHaveBeenCalled();
  });

  it('Stop while running (two-phase states)', async () => {
    await renderThemed(<Harness isStreaming stopState={{ label: 'Stop', enabled: true, forceAvailable: false }} />);
    expect(screen.getByRole('button', { name: 'Stop Bug Fixer' })).toBeTruthy();
  });
});
