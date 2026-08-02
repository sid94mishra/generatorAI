// ────────────────────────────────────────────────────────────────
// Gate action presentation.
//
// Pure, and deliberately NOT inside the component file: it encodes a safety
// rule (approve and reject must never look alike) that has to be unit
// testable without dragging React Native into the test runner.
// ────────────────────────────────────────────────────────────────

export interface GateAction {
  id: string;
  label: string;
  tone: 'primary' | 'danger' | 'neutral';
}

const AFFIRMATIVE = /(approve|accept|yes|continue|proceed)/;
const NEGATIVE = /(reject|deny|no|cancel|abort|stop)/;

/**
 * Map a server-supplied action id to its presentation.
 *
 * Unknown actions render as neutral rather than being hidden: a newer server
 * offering an action this build does not recognise must still be actionable,
 * because the alternative is a gate the user cannot resolve at all.
 */
export function toGateAction(id: string): GateAction {
  const normalized = id.toLowerCase();
  if (AFFIRMATIVE.test(normalized)) return { id, label: humanize(id), tone: 'primary' };
  if (NEGATIVE.test(normalized)) return { id, label: humanize(id), tone: 'danger' };
  return { id, label: humanize(id), tone: 'neutral' };
}

function humanize(id: string): string {
  const spaced = id.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
