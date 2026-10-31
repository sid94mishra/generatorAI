// Read-only window text: the driver indexes only what can be acted on; its display text lives in tree_markdown.
import { describe, expect, it } from 'vitest';
import { readOnlyText, unreadableWindow } from '../driverPayloads.js';

// Measured on macOS Calculator after 12 × 34 =.
const CALCULATOR = [
  '- [0] AXWindow "Calculator" [id=main actions=[raise]]',
  '    - AXStaticText = "12 × 34" (Last Expression)',
  '    - AXStaticText = "408" (Edit field)',
  '    - [1] AXButton (Delete) [id=Delete actions=[press]]',
  '    - [20] AXButton (Equals) [id=Equals actions=[press]]',
].join('\n');

describe('readOnlyText', () => {
  it("reads a calculator's display, not its buttons", () => {
    expect(readOnlyText(CALCULATOR)).toEqual(['Last Expression: 12 × 34', 'Edit field: 408']);
  });

  it('never returns a secure field and stays bounded', () => {
    expect(readOnlyText('  - AXSecureTextField = "hunter2" (Password)')).toEqual([]);
    const flood = Array.from({ length: 500 }, (_, i) => `  - AXStaticText = "line ${i}"`).join('\n');
    expect(readOnlyText(flood).length).toBeLessThanOrEqual(60);
  });
});

describe('unreadableWindow', () => {
  it('leaves a readable state alone', () => {
    expect(unreadableWindow(JSON.stringify({ snapshot_id: 's1', pid: 1, window_id: 2, elements: [] }))).toBeNull();
  });
});
