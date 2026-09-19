import { describe, expect, it } from 'vitest';
import { runTitle } from '../runTitle.js';

describe('runTitle', () => {
  it('strips the epoch the server appends', () => {
    expect(runTitle('Code Review - Run 1789753968513')).toBe('Code Review');
  });

  it('accepts the dash variants a renamed run may carry', () => {
    expect(runTitle('Nightly – Run 1789753968513')).toBe('Nightly');
    expect(runTitle('Nightly — Run 1789753968513')).toBe('Nightly');
  });

  it('leaves a name the user chose alone', () => {
    expect(runTitle('Run 3 of the migration')).toBe('Run 3 of the migration');
    expect(runTitle('Release - Run 7')).toBe('Release - Run 7');
  });

  it('falls back when there is no name, or nothing but the suffix', () => {
    expect(runTitle(null)).toBe('Workflow run');
    expect(runTitle('', 'Untitled')).toBe('Untitled');
    expect(runTitle('- Run 1789753968513')).toBe('- Run 1789753968513');
  });
});
