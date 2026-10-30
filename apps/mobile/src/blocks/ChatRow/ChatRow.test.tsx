// MChats meta (MD-153, MD-163): only a project slug is mono; the model label (and an agent's name) is sans.
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { themed } from '../../ui/__tests__/themed';
import { ChatRow } from './ChatRow';
import { chatRowView } from './chatRowModel';

const classOf = (text: string): string => String(screen.getByText(text).props.className ?? '');

describe('ChatRow meta fonts (MChats)', () => {
  it('sets a project slug in mono, a display name and the model label in sans (MD-163)', async () => {
    const base = { status: null, archived: false, lastActivityAt: new Date(0).toISOString(), tags: [], modelLabel: 'faux-model' };
    await render(themed(<ChatRow row={chatRowView({ ...base, id: 'c1', title: 'Fix the flaky test', projectName: 'payments-service' })} onAction={() => undefined} swipe={false} />));
    expect(classOf('payments-service')).toContain('font-mono');
    expect(classOf('faux-model')).toContain('font-sans');
    expect(classOf('faux-model')).not.toContain('font-mono');
  });

  it('keeps a project display name in sans', async () => {
    const row = chatRowView({ id: 'c2', title: 'Fix the flaky test', status: null, archived: false, lastActivityAt: new Date(0).toISOString(), tags: [], projectName: 'Mobile sandbox repo', modelLabel: 'faux-model' });
    await render(themed(<ChatRow row={row} onAction={() => undefined} swipe={false} />));
    expect(classOf('Mobile sandbox repo')).toContain('font-sans');
    expect(classOf('Mobile sandbox repo')).not.toContain('font-mono');
  });
});
