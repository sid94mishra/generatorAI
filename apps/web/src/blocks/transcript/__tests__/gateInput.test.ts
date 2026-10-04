import { describe, expect, it } from 'vitest';
import { gateInputText } from '../gates/gateInput.js';

describe('gateInputText', () => {
  it('shows a shell gate as its command', () => {
    expect(gateInputText(JSON.stringify({ command: 'git push -u origin main' }, null, 2))).toBe('git push -u origin main');
    expect(gateInputText(JSON.stringify({ command: 'ls', description: 'List files' }))).toBe('ls');
  });
  it('lists the other options of a shell call under its command', () => {
    expect(gateInputText(JSON.stringify({ command: 'ls', cwd: '/tmp' }))).toBe('ls\n# cwd: /tmp');
    expect(gateInputText(JSON.stringify({ command: 'npm ci', timeout: 300000, description: 'Install' }))).toBe('npm ci\n# timeout: 300000');
  });
  it('shows the command of a summary the server cut off', () => {
    const long = JSON.stringify({ command: `python3 - <<'E'\nprint("${'x'.repeat(700)}")\nE`, timeout: 1 }, null, 1).slice(0, 600) + '…';
    const shown = gateInputText(long);
    expect(shown.startsWith("python3 - <<'E'\nprint(\"xxx")).toBe(true);
    expect(shown.endsWith('…')).toBe(true);
  });
  it('keeps any other input verbatim', () => {
    const write = JSON.stringify({ path: 'src/a.ts', content: 'x' }, null, 2);
    expect(gateInputText(write)).toBe(write);
    expect(gateInputText('plain text')).toBe('plain text');
  });
});
