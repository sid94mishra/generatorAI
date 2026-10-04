import { describe, expect, it } from 'vitest';
import { parseReviewPrompt } from '../reviewPrompt.js';

const PROMPT = [
  '<review_feedback round="1" workspace="w1">',
  '<file path="web/src/App.tsx" alias="app" lines="2-4" side="additions">',
  '```',
  'export function App() {}',
  '```',
  '<comment id="rc_1" intent="fix">Wrap the heading in a &lt;main&gt; landmark.</comment>',
  '<comment id="rc_2">And &quot;name&quot; it.</comment>',
  '</file>',
  '</review_feedback>',
  '',
  'Address every comment above.',
  'Intent meanings:',
  '- fix: Change the code as described.',
  'After each change, state which comment id it resolves. If you disagree with a comment, say so instead of silently skipping it.',
  '',
  'Also run the tests.',
].join('\n');

describe('parseReviewPrompt', () => {
  it('reads the comments and the trailing note of a review prompt', () => {
    expect(parseReviewPrompt(PROMPT)).toEqual({
      comments: [
        { path: 'web/src/App.tsx', lines: '2-4', intent: 'fix', body: 'Wrap the heading in a <main> landmark.' },
        { path: 'web/src/App.tsx', lines: '2-4', body: 'And "name" it.' },
      ],
      note: 'Also run the tests.',
    });
  });
  it('is null for an ordinary message', () => {
    expect(parseReviewPrompt('Please add <main> to App.tsx')).toBeNull();
  });
});
