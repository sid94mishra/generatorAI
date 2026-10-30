import { describe, expect, it } from 'vitest';
import { fieldLabel, hasStructuredOutput, structuredOutputMarkdown } from './structuredOutput.js';

describe('structuredOutputMarkdown', () => {
  it('keeps angle-bracket placeholders as text, and code spans as they are', () => {
    expect(structuredOutputMarkdown({ footer: 'shows "Pulse v<version> · <n> monitors" via `meta<T>()`' })).toBe(
      '**Footer:** shows "Pulse v\\<version\\> · \\<n\\> monitors" via `meta<T>()`',
    );
  });

  it('shows a spec field by field: short text inline, lists as bullets, flat records one per line', () => {
    const md = structuredOutputMarkdown({
      summary: 'Maintenance windows suppress incidents.',
      backendTasks: ['Add the windows table', 'Skip checks inside a window'],
      risks: [{ title: 'Clock skew', severity: 'medium' }],
      notes: '',
    });
    expect(md).toBe(
      [
        '**Summary:** Maintenance windows suppress incidents.',
        '**Backend tasks**\n\n- Add the windows table\n- Skip checks inside a window',
        '**Risks**\n\n- Clock skew — Severity: medium',
      ].join('\n\n'),
    );
  });

  it('keeps deeper nesting as JSON and long text as a paragraph', () => {
    const md = structuredOutputMarkdown({ plan: { steps: [{ id: 1, files: ['a.ts'] }] }, body: 'line one\nline two' });
    expect(md).toContain('**Plan**\n\n```json');
    expect(md).toContain('**Body**\n\nline one\nline two');
  });

  it('labels camel and snake keys, and knows what is worth showing', () => {
    expect(fieldLabel('frontend_tasks')).toBe('Frontend tasks');
    expect(fieldLabel('acceptanceCriteria')).toBe('Acceptance criteria');
    expect(fieldLabel('apiTasks')).toBe('API tasks');
    expect(hasStructuredOutput({ a: 1 })).toBe(true);
    expect(hasStructuredOutput({})).toBe(false);
    expect(hasStructuredOutput('text')).toBe(false);
  });
});
