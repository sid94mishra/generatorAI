// ────────────────────────────────────────────────────────────────
// AutomationFacade — ai.automations.*
// ────────────────────────────────────────────────────────────────

import type { CoreServices } from '@generatorai/core';
import type {
  Automation,
  AutomationExecution,
  CreateAutomationParams,
  UpdateAutomationParams,
} from '@generatorai/shared';

export class AutomationFacade {
  constructor(private services: CoreServices) {}

  /** Create a new automation */
  async create(input: CreateAutomationParams): Promise<Automation> {
    return this.services.automationService.createAutomation(input);
  }

  /** List all automations */
  async list(projectId?: string): Promise<Automation[]> {
    return this.services.automationService.listAutomations(projectId);
  }

  /** Get an automation with recent executions */
  async get(automationId: string): Promise<Automation & { executions?: AutomationExecution[] }> {
    return this.services.automationService.getAutomationWithExecutions(automationId) as never;
  }

  /** Trigger an automation manually */
  async trigger(automationId: string): Promise<AutomationExecution> {
    return this.services.automationService.triggerManual(automationId);
  }

  /** Update an automation */
  async update(automationId: string, updates: UpdateAutomationParams): Promise<Automation> {
    return this.services.automationService.updateAutomation(automationId, updates);
  }

  /** Delete an automation */
  async delete(automationId: string): Promise<void> {
    return this.services.automationService.deleteAutomation(automationId);
  }

  /** Enable an automation */
  async enable(automationId: string): Promise<Automation> {
    return this.services.automationService.enableAutomation(automationId);
  }

  /** Disable an automation */
  async disable(automationId: string): Promise<Automation> {
    return this.services.automationService.disableAutomation(automationId);
  }

  /** Get execution details */
  async getExecution(executionId: string): Promise<AutomationExecution> {
    return this.services.automationService.getExecution(executionId);
  }
}
