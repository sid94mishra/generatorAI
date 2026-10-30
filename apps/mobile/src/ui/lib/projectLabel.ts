// MD-163: a project label is set in mono only when it is a slug ("payments-service"); a display name ("Mobile sandbox
// repo") reads as prose and uses the sans footnote role. Every row that shows a project label (chat rows, Home, attention
// rows, automations, search results) goes through this, so the rule lives in one place.

const SLUG = /^[a-z0-9][a-z0-9._/-]*$/;

/** True when the label looks like a slug or path-ish identifier rather than a display name. */
export function isProjectSlug(label: string): boolean {
  return SLUG.test(label);
}

/** The Text role for a project label in a row's meta line: `monoSm` for a slug, `footnote` otherwise. */
export function projectLabelRole(label: string): 'monoSm' | 'footnote' {
  return isProjectSlug(label) ? 'monoSm' : 'footnote';
}
