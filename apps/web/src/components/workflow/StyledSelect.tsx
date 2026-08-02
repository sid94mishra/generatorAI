// ────────────────────────────────────────────────────────────────
// StyledSelect — backward-compatibility shim.
// The canonical implementation now lives in components/ui/Select.
// Existing imports keep working; new code should import { Select }.
// ────────────────────────────────────────────────────────────────

export { Select as StyledSelect, type SelectOption } from '@/components/ui/Select.js';
