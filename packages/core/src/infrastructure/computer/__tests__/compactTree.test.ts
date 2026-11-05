import { describe, expect, it } from 'vitest';
import { compactTree } from '../driverPayloads.js';

// Verbatim from cua-driver 0.38.0, macOS Calculator.
const CALCULATOR = `- [0] AXWindow "Calculator" [id=main actions=[raise]]
    - AXStaticText = "1,234, × 56 − 789" (Last Expression)
    - AXStaticText = "68,315" (Edit field)
    - [1] AXButton (Delete) [id=Delete help="Delete the last digit or operation entered (long press to delete all)" actions=[press]]
    - [5] AXButton (7) [id=Seven actions=[press]]
  - [21] AXToolbar
    - [23] AXButton (Mode) [id=Mode: basic; unitConversion: false help="Change Calculator mode" actions=[increment,decrement,delete,cancel,press,name:move previous
target:0x0
selector:(null),name:remove from toolbar
target:0x0
selector:(null)]]
  - [24] AXButton [actions=[press]]
- [26] AXMenuBar [actions=[cancel]] (menus collapsed: run an item with invoke_menu path, or pass query to search menu items)`;

describe('compactTree', () => {
  it('keeps rows, labels, values and read-only text, and drops descriptor junk and repeated ids', () => {
    expect(compactTree(CALCULATOR)).toBe(`- [0] AXWindow "Calculator" [raise]
    - AXStaticText = "1,234, × 56 − 789" (Last Expression)
    - AXStaticText = "68,315" (Edit field)
    - [1] AXButton (Delete) [press]
    - [5] AXButton (7) [press]
  - [21] AXToolbar
    - [23] AXButton (Mode) [increment,decrement,delete,cancel,press]
  - [24] AXButton [press]
- [26] AXMenuBar [cancel] (menus collapsed: run an item with invoke_menu path, or pass query to search menu items)`);
  });
});
