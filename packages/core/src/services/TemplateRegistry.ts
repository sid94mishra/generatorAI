// ────────────────────────────────────────────────────────────────
// TemplateRegistry — unified registry for workflow and stage templates
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ILogger } from '@generatorai/shared';
import { WorkflowTemplateSchema, StageTemplateSchema } from '@generatorai/shared';
import type { WorkflowTemplate, StageTemplate } from '@generatorai/shared';

export class TemplateRegistry {
  private workflowTemplates = new Map<string, WorkflowTemplate>();
  private stageTemplates = new Map<string, StageTemplate>();

  constructor(private readonly logger: ILogger) {}

  /** Load workflow templates from a directory (JSON files). */
  async loadWorkflowTemplates(dir: string): Promise<void> {
    const files = await this.safeReadDir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(dir, file);
      try {
        const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        const parsed = WorkflowTemplateSchema.safeParse(raw);
        if (parsed.success) {
          this.registerWorkflowTemplate(parsed.data);
          this.logger.info(`[TemplateRegistry] Loaded workflow template: ${parsed.data.id} from ${file}`);
        } else {
          this.logger.warn(
            `[TemplateRegistry] Invalid workflow template ${file}: ${JSON.stringify(parsed.error.format())}`,
          );
        }
      } catch (err) {
        this.logger.warn(`[TemplateRegistry] Failed to load ${file}: ${err}`);
      }
    }
  }

  /** Load stage templates from a directory (JSON files). */
  async loadStageTemplates(dir: string): Promise<void> {
    const files = await this.safeReadDir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(dir, file);
      try {
        const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        const parsed = StageTemplateSchema.safeParse(raw);
        if (parsed.success) {
          this.registerStageTemplate(parsed.data);
          this.logger.info(`[TemplateRegistry] Loaded stage template: ${parsed.data.id} from ${file}`);
        } else {
          this.logger.warn(
            `[TemplateRegistry] Invalid stage template ${file}: ${JSON.stringify(parsed.error.format())}`,
          );
        }
      } catch (err) {
        this.logger.warn(`[TemplateRegistry] Failed to load ${file}: ${err}`);
      }
    }
  }

  // ── Workflow Templates ─────────────────────────────────────────

  registerWorkflowTemplate(template: WorkflowTemplate): void {
    this.workflowTemplates.set(template.id, template);
  }

  getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
    return this.workflowTemplates.get(id);
  }

  getAllWorkflowTemplates(): WorkflowTemplate[] {
    return [...this.workflowTemplates.values()];
  }

  hasWorkflowTemplate(id: string): boolean {
    return this.workflowTemplates.has(id);
  }

  // ── Stage Templates ────────────────────────────────────────────

  registerStageTemplate(template: StageTemplate): void {
    this.stageTemplates.set(template.id, template);
  }

  getStageTemplate(id: string): StageTemplate | undefined {
    return this.stageTemplates.get(id);
  }

  getAllStageTemplates(): StageTemplate[] {
    return [...this.stageTemplates.values()];
  }

  hasStageTemplate(id: string): boolean {
    return this.stageTemplates.has(id);
  }

  // ── Combined accessors ─────────────────────────────────────────

  /** Get total template count (workflow + stage) */
  getTemplateCount(): number {
    return this.workflowTemplates.size + this.stageTemplates.size;
  }

  // ── Private helpers ────────────────────────────────────────────

  private async safeReadDir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch {
      this.logger.warn(`[TemplateRegistry] Templates directory not found: ${dir}`);
      return [];
    }
  }
}
