import { describe, expect, it } from 'vitest';
import { gateInputText } from '../gates/gateInput.js';

describe('gateInputText', () => {
  it('shows a shell gate as its command', () => {
    expect(gateInputText(JSON.stringify({ command: 'git push -u origin main' }, null, 2))).toBe('git push -u origin main');
    expect(gateInputText(JSON.stringify({ command: 'ls', description: 'List files' }))).toBe('ls');
  });
  it('keeps any other input verbatim', () => {
    const write = JSON.stringify({ path: 'src/a.ts', content: 'x' }, null, 2);
    expect(gateInputText(write)).toBe(write);
    expect(gateInputText(JSON.stringify({ command: 'ls', cwd: '/tmp' }))).toBe('{"command":"ls","cwd":"/tmp"}');
    expect(gateInputText('plain text')).toBe('plain text');
  });
});
