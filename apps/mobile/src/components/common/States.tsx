// Compatibility shim.
//
// The real implementations now live in `components/ui/States`, alongside the
// rest of the design system. This file exists so the pairing and auth screens
// — which are deliberately untouched by the redesign, because breaking the
// enrolment path is expensive — keep working against one implementation
// rather than a second, drifting copy.
//
// New code should import from `../ui` instead.

export { Spinner, LoadingState, EmptyState, ErrorState, LockedState } from '../ui/States';
