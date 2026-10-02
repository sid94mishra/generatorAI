import { describe, expect, it } from 'vitest';

import { activeRow, otherRow, shortAddress } from './serverSwitcherModel';

describe('ServerSwitcher model (MB-20)', () => {
  it('describes the active server from its connection', () => {
    expect(activeRow('connected')).toEqual({ tone: 'ok', word: 'Connected', trailing: 'check' });
    expect(activeRow('reconnecting').word).toBe('Reconnecting…');
    expect(activeRow('disconnected')).toMatchObject({ tone: 'idle', word: 'Offline' });
  });

  it('describes other servers from their probe', () => {
    expect(otherRow(undefined, false)).toMatchObject({ word: 'Checking…', trailing: 'spinner' });
    expect(otherRow('connected', false)).toMatchObject({ tone: 'ok', trailing: 'none' });
    expect(otherRow('offline', false)).toMatchObject({ word: 'Offline', trailing: 'retry' });
    expect(otherRow('error', false).trailing).toBe('retry');
    expect(otherRow('unpaired', false)).toMatchObject({ word: 'Pairing changed', trailing: 'pair-again' });
    expect(otherRow('connected', true)).toMatchObject({ word: 'Switching…', trailing: 'spinner' });
  });

  it('prints a short mono address', () => {
    expect(shortAddress('http://127.0.0.1:3100/')).toBe('local:3100');
    expect(shortAddress('https://10.0.4.12:3100')).toBe('10.0.4.12:3100');
  });
});
