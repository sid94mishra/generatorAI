import { backLabel, dispatchHeaderPress, inlineTitleOpacity, iosHeaderModel, iosContentLargeTitle, iosHeaderColorOptions, iosHeaderOptions, paneToggleLabel, sidebarToggleLabel, splitActions } from './headerModel';
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
    // Beside a persistent iPad sidebar a module root uses the inline title (MD-147).
    expect(iosHeaderOptions({ role: 'top', title: 'Chats', sidebarToggleState: 'shown' }).headerLargeTitle).toBe(false);
    expect(iosHeaderOptions({ role: 'top', title: 'Chats', sidebarToggleState: 'hidden' }).headerLargeTitle).toBe(true);
  });

  it('moves a counted large title into the content under an opaque bar (MD-153)', () => {
    expect(iosContentLargeTitle({ role: 'top', count: 48 })).toBe(true);
    expect(iosContentLargeTitle({ role: 'top', count: null })).toBe(true);
    expect(iosContentLargeTitle({ role: 'top' })).toBe(false);
    expect(iosContentLargeTitle({ role: 'top', count: 3, largeTitle: false })).toBe(false);
    expect(iosHeaderOptions({ role: 'top', title: 'Chats', count: 48 })).toMatchObject({ headerLargeTitle: false, headerTransparent: false });
    expect([0, 24, 34, 44, 200].map(inlineTitleOpacity)).toEqual([0, 0, 0.5, 1, 1]);
  });

  it('paints the iOS header from the theme (bar, titles, tint, blur per appearance)', () => {
    const dark = { surface: '#111113', fg: '#ededef', appearance: 'dark' as const };
    expect(iosHeaderColorOptions(dark, false)).toMatchObject({
      headerStyle: { backgroundColor: '#111113' },
      headerLargeStyle: { backgroundColor: '#111113' },
      headerTintColor: '#ededef',
      headerTitleStyle: { color: '#ededef' },
      headerLargeTitleStyle: { color: '#ededef' },
    });
    expect(iosHeaderColorOptions(dark, false).headerBlurEffect).toBeUndefined();
    expect(iosHeaderColorOptions(dark, true)).toMatchObject({ headerStyle: {}, headerBlurEffect: 'systemChromeMaterialDark' });
    expect(iosHeaderColorOptions({ ...dark, appearance: 'light' }, true).headerBlurEffect).toBe('systemChromeMaterialLight');
  });

  it('models the iOS bar as values and dispatches presses to the latest props (MD-162)', () => {
    const onMenuSelect = jest.fn();
    const onPress = jest.fn();
    const crumb = jest.fn();
    const p = {
      role: 'workspace' as const,
      title: 'Chat',
      breadcrumb: [{ label: 'Chats', onPress: crumb }],
      onBack: () => undefined,
      paneToggle: { open: true, count: 1, attention: false, onPress },
      actions: [{ id: 'chat-menu', icon: 'more' as const, label: 'Chat actions', menu: [{ id: 'rename', label: 'Rename' }, { type: 'separator' as const }], onMenuSelect }],
    };
    const model = iosHeaderModel(p, 1);
    expect(model.titleView).toBe('breadcrumb');
    expect(model.left.map((l) => l.target)).toEqual(['back']);
    expect(model.right.map((r) => r.kind)).toEqual(['menu', 'pane']);
    expect(JSON.stringify(iosHeaderModel({ ...p, onBack: () => 1, actions: [{ ...p.actions[0]!, onMenuSelect: jest.fn() }] }, 1))).toBe(JSON.stringify(model));
    dispatchHeaderPress(p, 'menu:chat-menu:rename');
    dispatchHeaderPress(p, 'pane');
    dispatchHeaderPress(p, 'crumb:0');
    expect(onMenuSelect).toHaveBeenCalledWith('rename');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(crumb).toHaveBeenCalledTimes(1);
  });
});
