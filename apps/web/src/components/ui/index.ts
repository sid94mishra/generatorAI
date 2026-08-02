// ────────────────────────────────────────────────────────────────
// UI primitives — the single source of truth for GeneratorAI's
// design system. Import everything from '@/components/ui'.
//
//   import { Button, Card, Badge, Select, Modal, Input } from '@/components/ui';
//
// Layering:
//   ui/primitives/*  — vendored shadcn/ui parts (Radix/cmdk/sonner);
//                      low-level, for composing bespoke layouts.
//   ui/*             — the app-facing API (this barrel). Prefer these.
//
// See apps/web/DESIGN_SYSTEM.md for tokens + usage guidance.
// ────────────────────────────────────────────────────────────────

// Canonical primitives
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button.js';
export { Card, type CardProps } from './Card.js';
export { Badge, type BadgeProps, type BadgeTone, type BadgeSize } from './Badge.js';
export { Input, Textarea, type InputProps, type TextareaProps } from './Input.js';
export { Modal, type ModalProps, type ModalSize } from './Modal.js';
export { Select, type SelectOption, type SelectProps } from './Select.js';
export { StatCard, type StatCardProps } from './StatCard.js';
export { StatusBadge, type StatusBadgeProps } from './StatusBadge.js';
export { PageHeader, type PageHeaderProps } from './PageHeader.js';
export { SearchInput, type SearchInputProps } from './SearchInput.js';
export { Tabs, type TabsProps, type TabItem } from './Tabs.js';
export { EmptyState, type EmptyStateProps } from './EmptyState.js';
export { Tooltip, type TooltipProps } from './Tooltip.js';
export { ToggleSwitch, type ToggleSwitchProps } from './ToggleSwitch.js';
export { Spinner, type SpinnerProps, type SpinnerSize } from './Spinner.js';
export { Skeleton, SessionListSkeleton, ChatMessageSkeleton, CardGridSkeleton, type SkeletonProps } from './Skeleton.js';
export { Kbd, isMacPlatform, type KbdProps, type KbdKey } from './Kbd.js';
export { SearchableSelect, type SearchableSelectProps } from './SearchableSelect.js';

// Existing primitives re-exported here so '@/components/ui' is the one entry point
export { NumberStepper } from '@/components/workflow/NumberStepper.js';
export { CollapsibleSection } from '@/components/workflow/CollapsibleSection.js';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog.js';

// Vendored shadcn/ui parts (low-level; prefer the primitives above)
export * from './primitives/dialog.js';
export * from './primitives/alert-dialog.js';
export * from './primitives/popover.js';
export * from './primitives/dropdown-menu.js';
export * from './primitives/command.js';
export * from './primitives/switch.js';
export * from './primitives/checkbox.js';
export * from './primitives/separator.js';
export * from './primitives/scroll-area.js';
export * from './primitives/table.js';
export { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from './primitives/tooltip.js';
export { TabsRoot, TabsList, TabsTrigger, TabsContent } from './primitives/tabs.js';
export { Toaster, toast } from './primitives/sonner.js';
