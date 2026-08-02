// ────────────────────────────────────────────────────────────────
// IWidgetRegistry — Domain port for the widget descriptor catalog.
//
// Populated by ExtensionManager as extensions are loaded. Consumed by
// WidgetService.createInstance for descriptor lookup + prop validation.
// ────────────────────────────────────────────────────────────────

import type { WidgetDescriptor } from '@generatorai/shared';

export interface IWidgetRegistry {
  /** List every registered widget descriptor, in insertion order. */
  list(): WidgetDescriptor[];

  /** Exact-id lookup (`<extensionId>/<component>`). Returns undefined if not registered. */
  get(id: string): WidgetDescriptor | undefined;

  /** Add a descriptor. Throws on collision. */
  register(descriptor: WidgetDescriptor): void;

  /** Remove a descriptor. Returns true if present. */
  unregister(id: string): boolean;

  /** Remove every descriptor owned by an extension. Returns count removed. */
  unregisterByExtension(extensionId: string): number;
}
