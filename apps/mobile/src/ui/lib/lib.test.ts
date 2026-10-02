import { describe, expect, it } from 'vitest';
import { cn } from './cn';
import { formatBytes, formatCount, formatElapsed, spokenElapsed } from './format';
import { tid } from './testIds';

describe('cn (mobile 02 §9.7)', () => {
  it('merges the mobile vocabulary as real groups', () => {
    expect(cn('text-fg-2', 'text-title')).toBe('text-fg-2 text-title');
    expect(cn('min-h-row', 'min-h-row-2')).toBe('min-h-row-2');
    expect(cn('rounded-card', 'rounded-card-lg')).toBe('rounded-card-lg');
    expect(cn('size-hit', 'size-icon-button-sm')).toBe('size-icon-button-sm');
    expect(cn('px-gutter', 'px-4')).toBe('px-4');
    expect(cn('text-micro', false && 'hidden', 'text-small')).toBe('text-small');
  });
});

describe('format', () => {
  it('formats elapsed time and its spoken form', () => {
    expect(formatElapsed(252_000)).toBe('4:12');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-5)).toBe('0:00');
    expect(spokenElapsed(252_000)).toBe('4 minutes 12 seconds');
    expect(spokenElapsed(60_000)).toBe('1 minute');
    expect(spokenElapsed(0)).toBe('0 seconds');
  });
  it('caps counts', () => {
    expect(formatCount(120, 99)).toBe('99+');
    expect(formatCount(7)).toBe('7');
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(2150)).toBe('2.1 KB');
    expect(formatBytes(32 * 1024)).toBe('32 KB');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('tid', () => {
  it('builds kebab-case ids', () => {
    expect(tid('drawer', 'search')).toBe('drawer-search');
    expect(tid('pane', 'tab', 'changes')).toBe('pane-tab-changes');
  });
});
