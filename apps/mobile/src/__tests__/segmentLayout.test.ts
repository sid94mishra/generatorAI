import { describe, expect, it } from 'vitest';
import { segmentLayout } from '../components/ui/segmentLayout';
import { isEdgeTouch } from '../components/ui/pagerMath';

describe('adaptive peer navigation', () => {
  it('fits short filters without scrolling', () => {
    expect(segmentLayout([{ label: 'All' }, { label: 'Active' }], 360, 1))
      .toEqual({ slot: 180, contentWidth: 360, scrollable: false });
  });
  it('preserves long labels and counts on a narrow phone at large text sizes', () => {
    const items = ['Chat', 'Changes', 'Files', 'Tasks', 'Terminal', 'Browser', 'Computer']
      .map((label) => ({ label, count: 128 }));
    const normal = segmentLayout(items, 320, 1);
    const large = segmentLayout(items, 320, 1.4);
    expect(normal.scrollable).toBe(true);
    expect(large.slot).toBeGreaterThan(normal.slot);
    expect(large.contentWidth).toBe(large.slot * items.length);
  });
  it('handles an empty catalogue without infinity or NaN', () => {
    expect(segmentLayout([], 0, 1)).toEqual({ slot: 0, contentWidth: 0, scrollable: false });
  });
  it('reserves both Android back edges while preserving the iOS left-only contract', () => {
    expect(isEdgeTouch(10, 24, 390)).toBe(true);
    expect(isEdgeTouch(380, 24, 390)).toBe(true);
    expect(isEdgeTouch(195, 24, 390)).toBe(false);
    expect(isEdgeTouch(380, 24)).toBe(false);
  });
});
