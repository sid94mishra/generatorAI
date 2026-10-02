// Pure PairingCodeInput logic (03 MP-40; MD-35): normalisation, grouping, cell geometry and the spoken value.
export const PAIRING_CODE_LENGTH = 12;
export const PAIRING_CODE_GROUP = 4;

/** Uppercase; spaces, dashes and anything outside A–Z / 0–9 stripped; capped at 12. */
export function normalizePairingCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, PAIRING_CODE_LENGTH);
}

/** [['A','B','C','D'], …] with '' for empty cells. */
export function pairingCells(value: string): string[][] {
  const chars = normalizePairingCode(value).split('');
  return Array.from({ length: PAIRING_CODE_LENGTH / PAIRING_CODE_GROUP }, (_, g) =>
    Array.from({ length: PAIRING_CODE_GROUP }, (_, i) => chars[g * PAIRING_CODE_GROUP + i] ?? ''),
  );
}

const SEPARATOR = 12;
const GAP = 6;

/** Cell width for an available row width: (available − 2 × 12 − 9 × 6) / 12, clamped to 22–32 (MD-35). */
export function pairingCellWidth(available: number): number {
  const raw = (available - 2 * SEPARATOR - 9 * GAP) / PAIRING_CODE_LENGTH;
  return Math.max(22, Math.min(32, Math.floor(raw)));
}

/** "A B C D, E F G H, I J" — characters spelled, groups paused. */
export function spokenPairingCode(value: string): string {
  return pairingCells(value)
    .map((group) => group.filter(Boolean).join(' '))
    .filter(Boolean)
    .join(', ');
}
