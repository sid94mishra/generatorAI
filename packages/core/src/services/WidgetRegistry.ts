// ────────────────────────────────────────────────────────────────
// WidgetRegistry — In-memory catalog of extension-contributed widgets.
//
// Populated by ExtensionManager as extensions are (re)loaded. Read by
// WidgetService.createInstance. Removing an extension calls
// unregisterByExtension() to purge all its descriptors atomically.
// ────────────────────────────────────────────────────────────────

import type { WidgetDescriptor } from '@generatorai/shared';
import type { IWidgetRegistry } from '../domain/ports/IWidgetRegistry.js';

export class WidgetRegistry implements IWidgetRegistry {
  private readonly items = new Map<string, WidgetDescriptor>();

  list(): WidgetDescriptor[] {
    return Array.from(this.items.values());
  }

  get(id: string): WidgetDescriptor | undefined {
    return this.items.get(id);
  }

  register(descriptor: WidgetDescriptor): void {
    if (!descriptor.id || !descriptor.id.includes('/')) {
      throw new Error(
        `WidgetRegistry.register: invalid descriptor id "${descriptor.id}" (expected "<extensionId>/<component>")`,
      );
    }
    if (this.items.has(descriptor.id)) {
      throw new Error(`WidgetRegistry: widget "${descriptor.id}" already registered`);
    }
    this.items.set(descriptor.id, descriptor);
  }

  unregister(id: string): boolean {
    return this.items.delete(id);
  }

  unregisterByExtension(extensionId: string): number {
    let n = 0;
    for (const [id, d] of this.items) {
      if (d.extensionId === extensionId) {
        this.items.delete(id);
        n++;
      }
    }
    return n;
  }
}
