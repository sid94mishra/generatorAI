// ────────────────────────────────────────────────────────────────
// EventFacade — ai.events.*
// ────────────────────────────────────────────────────────────────

import type { CoreServices } from '@generatorai/core';
import type { AgentEvent, PersistedEvent } from '@generatorai/shared';

export class EventFacade {
  constructor(private services: CoreServices) {}

  /** Subscribe to all events globally */
  onAll(handler: (event: PersistedEvent) => void): () => void {
    return this.services.eventBus.subscribeAll(handler, 'sdk-global');
  }

  /** Subscribe to events for a specific run */
  onRun(runId: string, handler: (event: PersistedEvent) => void): () => void {
    return this.services.eventBus.subscribeToWorkflowRun(runId, handler);
  }

  /** Subscribe to events for a specific session */
  onSession(sessionId: string, handler: (event: PersistedEvent) => void): () => void {
    return this.services.eventBus.subscribe(sessionId, handler);
  }

  /** Replay historical events for a session */
  async replay(sessionId: string, afterSequence?: number): Promise<PersistedEvent[]> {
    return this.services.eventBus.getSessionEvents(sessionId, afterSequence);
  }

  /** Emit an event (for custom integrations) */
  async emit(sessionId: string, event: AgentEvent): Promise<PersistedEvent> {
    return this.services.eventBus.emit(sessionId, event);
  }
}
