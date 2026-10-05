import { describe, expect, it } from 'vitest';
import { taskResultBody } from '../src/services/orchestrator/OrchestratorService.js';

describe('taskResultBody', () => {
  it('reads a well-formed digest block', () => {
    expect(taskResultBody('Done.\n<TASK_RESULT>\n{"status":"completed"}\n</TASK_RESULT>')).toBe('{"status":"completed"}');
  });
  it('tolerates stray spaces in the tags and a missing closing tag', () => {
    expect(taskResultBody('< TASK_RESULT>\n{"status":"completed"}\n< /TASK_RESULT >')).toBe('{"status":"completed"}');
    expect(taskResultBody('Review done.\n<TASK_RESULT>\n{"status":"partial"}')).toBe('{"status":"partial"}');
  });
  it('is null without a block', () => {
    expect(taskResultBody('just text')).toBeNull();
  });
});
