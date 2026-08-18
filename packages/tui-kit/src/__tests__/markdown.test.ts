import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'ink';
import { Markdown } from '../content.js';
import { ThemeProvider } from '../theme.js';
import { detectTerminal } from '@generatorai/cli-core';

const caps = detectTerminal({
  stdout: { isTTY: true, columns: 120, rows: 40 },
  overrides: { isTTY: true, columns: 120, rows: 40, colorDepth: 'truecolor', unicode: true },
});

const render = (content: string) =>
  renderToString(
    React.createElement(
      ThemeProvider,
      { capabilities: caps, theme: 'github', children: React.createElement(Markdown, { content }) },
    ),
    { columns: 120 },
  );

describe('Markdown', () => {
  it('renders every item of an ordered list', () => {
    const out = render(
      'Would you like me to:\n\n' +
        '1. **Expand a section** (e.g., renewal, AAMVA integration)?\n' +
        '2. **Dive deeper** (e.g., database schema)?\n' +
        '3. **Generate diagrams** for the flows?\n' +
        '4. **Document the CI/CD pipeline** and deployment strategy?\n',
    );

    // Dropping or merging list items silently rewrites what the agent said.
    expect(out).toContain('Expand a section');
    expect(out).toContain('Dive deeper');
    expect(out).toContain('Generate diagrams');
    expect(out).toContain('Document the CI/CD pipeline');
  });

  it('keeps list items on separate lines', () => {
    const out = render('1. alpha\n2. beta\n3. gamma\n');
    const lines = out.split('\n').filter((l) => l.trim());
    const withAlpha = lines.find((l) => l.includes('alpha')) ?? '';
    expect(withAlpha).not.toContain('beta');
  });

  it('does not lose text around emoji', () => {
    const out = render('## 🎯 Key Findings\n\nSwagger/OpenAPI documentation\n');
    expect(out).toContain('Key Findings');
    expect(out).toContain('Swagger/OpenAPI documentation');
  });
});
