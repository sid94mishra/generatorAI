// The Activity popover follows one card, never the entity: an answered gate moves its entity from Needs you to
// Recent as a new card, and the popover used to reopen there (the e2e activity-column flake).
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useActivityStore } from '@/stores/activityStore.js';
import { previewKey, usePreview } from './ActivityItem.js';

afterEach(() => useActivityStore.getState().setPreview(null));

describe('Activity popover key', () => {
  it('names the group, so the same entity in another group is a different popover', () => {
    expect(previewKey({ group: 'needs_you', key: 'chat:a' })).not.toBe(previewKey({ group: 'recent', key: 'chat:a' }));
    expect(previewKey({ group: 'running', key: 'chat:a' }, 'rail')).toBe('rail:running:chat:a');
  });

  it('the card that moved group does not open the popover of the card it was', () => {
    const asked = renderHook(() => usePreview(previewKey({ group: 'needs_you', key: 'chat:a' })));
    act(() => asked.result.current.openNow());
    expect(asked.result.current.open).toBe(true);

    const recent = renderHook(() => usePreview(previewKey({ group: 'recent', key: 'chat:a' })));
    expect(recent.result.current.open).toBe(false);
  });

  it('a card that unmounts with its popover open closes it (Esc then reaches the column)', () => {
    const card = renderHook(() => usePreview(previewKey({ group: 'needs_you', key: 'chat:a' })));
    act(() => card.result.current.openNow());
    act(() => card.unmount());
    expect(useActivityStore.getState().preview).toBeNull();
  });

  it('unmounting another card leaves an open popover alone', () => {
    const open = renderHook(() => usePreview(previewKey({ group: 'needs_you', key: 'chat:a' })));
    const other = renderHook(() => usePreview(previewKey({ group: 'recent', key: 'chat:b' })));
    act(() => open.result.current.openNow());
    act(() => other.unmount());
    expect(open.result.current.open).toBe(true);
  });
});
