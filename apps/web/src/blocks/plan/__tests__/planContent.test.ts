import { describe, expect, it } from 'vitest';
import { withoutLeadingTitle } from '../planContent.js';

describe('withoutLeadingTitle', () => {
  it('drops a leading H1 that repeats the title', () => {
    expect(withoutLeadingTitle('# Architect the tracker\n\n## Goal\nShip it.', 'Architect the tracker')).toBe('## Goal\nShip it.');
    expect(withoutLeadingTitle('\n#  architect THE tracker \n## Goal', 'Architect the tracker')).toBe('## Goal');
  });
  it('keeps a different heading and documents without one', () => {
    expect(withoutLeadingTitle('# Something else\n## Goal', 'Architect')).toBe('# Something else\n## Goal');
    expect(withoutLeadingTitle('## Goal\n# Architect', 'Architect')).toBe('## Goal\n# Architect');
  });
});
