import { describe, expect, it } from 'vitest';
import { parseStagePrompt } from '../stagePrompt.js';

const PROMPT = [
  'The previous request for this step was interrupted before it finished. Continue from where you stopped; do not redo steps that are already done.',
  '',
  '<generatorai:stage-context trust="untrusted">',
  '## Completed stage "Spec"',
  'Wrote the spec.',
  '',
  '```json',
  '{ "slug": "auth" }',
  '```',
  '',
  '---',
  '',
  '## Completed stage "Backend"',
  'Built the API.',
  '</generatorai:stage-context>',
  '',
  'Review the work and fix what is wrong.',
  '',
  '---',
  '**Expected output:**',
  'A verdict.',
  '',
].join('\n');

describe('parseStagePrompt', () => {
  it('splits the instruction from the fenced context, the output contract and the resume notice', () => {
    expect(parseStagePrompt(PROMPT)).toEqual({
      instruction: 'Review the work and fix what is wrong.',
      context: [
        { stage: 'Spec', body: 'Wrote the spec.\n\n```json\n{ "slug": "auth" }\n```' },
        { stage: 'Backend', body: 'Built the API.' },
      ],
      outputContract: '**Expected output:**\nA verdict.',
      resumed: true,
    });
  });

  it('keeps a horizontal rule that is not the output contract', () => {
    expect(parseStagePrompt('Do A.\n\n---\nThen B.')).toBeNull();
    expect(parseStagePrompt('Do A.\n\n---\nWhen you are done, call `submit_output` with x')?.instruction).toBe('Do A.');
  });

  it('is null for an ordinary message', () => {
    expect(parseStagePrompt('Please add <main> to App.tsx')).toBeNull();
  });
});
