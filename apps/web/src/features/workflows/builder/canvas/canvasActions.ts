// ────────────────────────────────────────────────────────────────
// canvasActions — store actions the canvas's menus and bars share.
// ────────────────────────────────────────────────────────────────

import { toast } from '@/ui/primitives/Toast/Toast.js';
import { useWorkflowBuilderStore, type ContainerKind } from '@/stores/workflowBuilderStore.js';

/** Wrap stages (one scope) in a new loop or map; the store's refusal is toasted. */
export function wrapStages(keys: readonly string[], kind: ContainerKind): void {
  const result = useWorkflowBuilderStore.getState().wrapInContainer(keys, kind);
  if ('error' in result) toast.error(result.error);
}
