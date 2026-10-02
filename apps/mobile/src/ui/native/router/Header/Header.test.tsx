import { backLabel, iosHeaderOptions, paneToggleLabel, sidebarToggleLabel, splitActions } from './headerModel';
import type { HeaderAction } from './Header.types';

const a = (id: string, destructive = false): HeaderAction => ({ id, icon: 'search', label: id, destructive });

describe('Header (ML-02)', () => {
  it('keeps the platform max inline, overflows the rest and always the destructive (MD-22, 06 §2.4)', () => {
    expect(splitActions([a('a'), a('b')], 1, 2)).toEqual({ inline: [a('a'), a('b')], overflow: [] });
    expect(splitActions([a('a'), a('b'), a('c')], 1, 2)).toEqual({ inline: [a('a')], overflow: [a('b'), a('c')] });
    expect(splitActions([a('a'), a('x', true)], 1, 3)).toEqual({ inline: [a('a')], overflow: [a('x', true)] });
    expect(splitActions([a('a'), a('b')], 1.6, 3).inline).toEqual([]);
  });

  it('names toggles and back', () => {
    expect(paneToggleLabel(false, 2)).toBe('Open workspace pane, 2 changes');
    expect(paneToggleLabel(true, 1)).toBe('Hide workspace pane, 1 change');
    expect(paneToggleLabel(false, 0)).toBe('Open workspace pane');
    expect(sidebarToggleLabel('drawer')).toBe('Open sidebar');
    expect(sidebarToggleLabel('shown', true)).toBe('Hide navigation drawer');
    expect(backLabel([{ label: 'Chats' }, { label: 'payments-service' }])).toBe('Back to payments-service');
    expect(backLabel(undefined)).toBe('Back');
  });

  it('builds the iOS native-stack options per role (MD-94)', () => {
    expect(iosHeaderOptions({ role: 'top', title: 'Chats' })).toMatchObject({ headerLargeTitle: true, headerTransparent: true, headerBackVisible: false });
    expect(iosHeaderOptions({ role: 'detail', title: 'Run' })).toMatchObject({ headerLargeTitle: false, headerBackVisible: true });
    expect(iosHeaderOptions({ role: 'detail', title: 'Run', onBack: () => undefined }).headerBackVisible).toBe(false);
    expect(iosHeaderOptions({ role: 'modal', title: 'Edit' }).headerTransparent).toBe(false);
    expect(iosHeaderOptions({ role: 'top', title: 'Chats', opaque: true }).headerTransparent).toBe(false);
  });
});
