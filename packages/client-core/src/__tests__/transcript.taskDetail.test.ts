import { describe, expect, it } from 'vitest';
import { taskDetailSteps, taskReviewLine } from '../transcript/taskDetail.js';

describe('task detail read model (D-89)', () => {
  it('turns the latest tool calls into folded timeline steps', () => {
    const steps = taskDetailSteps({
      lastSteps: [
        { id: 'a', tool: 'Read', args: { file_path: 'src/a.ts' }, status: 'complete', at: '' },
        { id: 'b', tool: 'Read', args: { file_path: 'src/b.ts' }, status: 'complete', at: '' },
        { id: 'c', tool: 'Bash', args: { command: 'pnpm test' }, status: 'complete', success: false, at: '' },
        { id: 'd', tool: 'Write', args: { file_path: 'src/slug.ts' }, status: 'complete', fileOp: { kind: 'create', filePath: 'src/slug.ts', additions: 12, deletions: 0 }, at: '' },
      ],
    });
    expect(steps.map((s) => s.verb)).toEqual(['Read', 'Read', 'Ran', 'Edited']);
    expect(steps[2]!.status).toBe('failed');
    expect(steps[3]!.fileOp).toMatchObject({ additions: 12 });
  });

  it('says how the review went', () => {
    expect(taskReviewLine({ outcome: 'accepted', reviewRounds: 1, maxReviewRounds: 3 })).toBe('Reviewed by the orchestrator · accepted · 1 of 3 review rounds');
    expect(taskReviewLine({ outcome: 'in_review', reviewRounds: 0, maxReviewRounds: 3 })).toBe('Reviewed by the orchestrator · reading the result · 0 of 3 review rounds');
    expect(taskReviewLine({ outcome: 'running', reviewRounds: 0, maxReviewRounds: 3 })).toBeUndefined();
  });
});
